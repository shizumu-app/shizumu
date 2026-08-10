//! Attachment objects — `PUT`/`GET`/`DELETE /v1/users/<uid>/attachments/<hash>`.
//!
//! Attachment ciphertext used to ride inside an `attachment_blob` op
//! payload (see `sync::wire::attachment_blob`), base64-chunked and
//! synced through the same channel as every other op. This module is
//! the replacement: the bytes go straight to their own object-storage
//! endpoint, out of band from the op log, and the op merely references
//! the hash. `hash_hex` is the lowercase hex blake3 digest of the
//! ciphertext, matching the URL path the relay expects.
//!
//! All three endpoints are signed exactly like `PUT /blobs/<hash>`
//! (`sync/wire/upload.rs`) and `GET /blobs/<hash>` (`sync/wire/pull.rs`):
//! the signature covers the body's SHA-256 hex digest, so PUT
//! materialises the body upfront and GET/DELETE sign over the empty
//! body. A PUT over the account's storage cap returns 429
//! `quota_exceeded` (not 413) — the relay treats attachment storage
//! pressure the same way `put_blob` treats op-log storage pressure,
//! and the shared 429 → `WireError::Throttled` mapping already applies
//! to every endpoint in this module (via `bounded_wire_error`), so no
//! new error handling is needed here.
//!
//! A PUT that finds every upload slot on the relay busy returns 503
//! `upload_slots_busy` with a `Retry-After` header instead — that maps
//! to the same `WireError::Throttled` as 429, so the worker
//! honours the relay's (typically short) pacing hint instead of waiting
//! out its own minute-plus exponential floor.

use crate::sync::keys::DeviceKeys;
use crate::sync::signing::sign_request;
use crate::sync::wire::attachment_blob::MAX_BLOB_BYTES;
use crate::sync::wire::{normalize_base_url, WireError};
use serde::Deserialize;
use std::io::Read;
use std::time::Duration;

#[derive(Debug, Clone, Deserialize)]
pub struct PutAttachmentResponse {
    pub stored_bytes: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DeleteAttachmentResponse {
    pub deleted: bool,
    pub freed_bytes: i64,
}

/// How long to wait for the TCP+TLS handshake. A relay that is down
/// should be given up on quickly; this bound has nothing to do with
/// how big the body is.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

/// How long a transfer may sit IDLE — no progress at all — before it is
/// abandoned. Not a bound on the transfer's total length.
///
/// `reqwest::blocking` has no read/idle timeout of its own (checked
/// against 0.12.28: `ClientBuilder::read_timeout` is async-only), so
/// this is expressed at the socket layer: keepalive probes everywhere,
/// and `TCP_USER_TIMEOUT` — a real "unacknowledged data for this long
/// means the connection is dead" bound — on the platforms that have it.
/// Linux and Android are two of the three desktop/mobile targets;
/// elsewhere keepalive alone is the bound.
///
/// Neither catches a relay ACKing one byte every 30 seconds: the
/// connection is never idle and no data is ever unacknowledged. That is
/// what `read_bounded`'s wall clock is for.
const IDLE_TIMEOUT: Duration = Duration::from_secs(60);

/// The slowest link this client is willing to call a working transfer:
/// 25 000 bytes/second, i.e. 200 kbit/s. Below a 3G floor, and well
/// below anything a user would describe as connected. It exists only to
/// turn the body-size ceiling into a wall-clock number.
const MIN_TRANSFER_BYTES_PER_SEC: u64 = 25_000;

/// The whole-request deadline for an OBJECT transfer (PUT of the
/// ciphertext, GET of the body).
///
/// `MAX_BLOB_BYTES` (104 MiB = 109 051 904 B) ÷ 25 000 B/s ≈ 4362 s ≈
/// 73 minutes. Derived, not typed in, so it cannot drift from the
/// ceiling it is a function of.
///
/// The number that shipped before this branch was 60s, inherited from
/// `upload.rs` / `pull.rs` where the bodies are small op batches.
/// Against the 104 MiB ceiling that demanded ~14 Mbit/s of sustained
/// upstream: below that the PUT could never succeed — not slowly,
/// never — while the row stayed pending, the worker re-sent tens of
/// megabytes every 30 seconds, each attempt sealed under a fresh
/// per-object UUID so every timed-out-but-committed PUT left a distinct
/// orphan on a relay whose `gc_orphan_blobs` bails out, and the sweep
/// runs before `upload::run_pass` so N such attachments stalled all page
/// and op sync for N×60s per tick.
///
/// The correction to that was removing the deadline outright, and that
/// went too far the other way. `worker::tick` runs `run_object_fetch_at`
/// INLINE, so an unbounded GET against a relay this module explicitly
/// does not trust means one dribbling response stalls all page and op
/// sync for the life of the process. Generous is the answer; unbounded
/// is not.
const OBJECT_TRANSFER_DEADLINE: Duration =
    Duration::from_secs(MAX_BLOB_BYTES as u64 / MIN_TRANSFER_BYTES_PER_SEC);

/// The whole-request deadline for a CONTROL request — one with an empty
/// body and a small JSON response. DELETE is the only one, and it has
/// no business inheriting the budget above: nothing about it is large.
/// It was bounded at 60s before that budget was widened from the
/// transfer path to the whole module.
///
/// It is also the one on a `#[tauri::command]` thread.
/// `attachments::commands::attachment_set_sync` calls
/// `delete_attachment` synchronously, so a relay that completes the
/// TCP/TLS handshake (past `CONNECT_TIMEOUT`) and then never sends a
/// response byte leaves the invoke promise unresolved and the sync
/// toggle spinning in the UI forever.
const CONTROL_REQUEST_DEADLINE: Duration = Duration::from_secs(60);

/// How much of a control response is worth buffering. A relay's JSON
/// answer to a DELETE or a PUT is two integers; 64 KiB is already
/// absurd. Same reasoning as `read_bounded_body`'s ceiling — the relay
/// is untrusted at the transport layer.
const MAX_CONTROL_RESPONSE_BYTES: u64 = 64 * 1024;

/// Which deadline a request gets, as a function of its SHAPE.
///
/// The finding is that this was one number for every endpoint in the
/// module: the generous budget below is justified by a 100 MB body, and
/// only PUT and GET have one. A pure function so the wiring is
/// assertable — see `delete_does_not_inherit_the_large_body_exemption`
/// — and each call site passes the same method literal it hands to
/// `sign_request`, so the two cannot silently disagree about what the
/// request is.
fn deadline_for(method: &str) -> Option<Duration> {
    match method {
        // The body IS the attachment (PUT) or the response is (GET).
        "PUT" | "GET" => Some(OBJECT_TRANSFER_DEADLINE),
        // Empty body, tiny JSON response.
        _ => Some(CONTROL_REQUEST_DEADLINE),
    }
}

/// Build a blocking reqwest client for one object-endpoint request. GET
/// follows redirects (a presigned-URL storage backend may 302 the way
/// `pull::get_blob` does); PUT and DELETE don't need redirects but a
/// shared builder keeps this module simple.
///
/// Three bounds, none of which subsumes another: give up quickly on a
/// relay that is not there (`CONNECT_TIMEOUT`), quickly on a connection
/// that has stopped moving (`IDLE_TIMEOUT`, at the socket layer), and
/// eventually on one that is moving too slowly to ever finish
/// (`deadline_for`). Never on one that is simply large and slow — that
/// is what `OBJECT_TRANSFER_DEADLINE`'s floor rate buys.
///
/// The other half of the transfer fix is on the client side of the
/// sweep: a repeatedly failing attachment backs off instead of being
/// retried every tick (`attachments::backfill::upload_retry_delay_ms`).
fn build_client(method: &str) -> Result<reqwest::blocking::Client, WireError> {
    let builder = reqwest::blocking::Client::builder()
        .timeout(deadline_for(method))
        .connect_timeout(CONNECT_TIMEOUT)
        .tcp_keepalive(IDLE_TIMEOUT)
        .redirect(reqwest::redirect::Policy::limited(5));
    #[cfg(any(target_os = "linux", target_os = "android"))]
    let builder = builder.tcp_user_timeout(IDLE_TIMEOUT);
    builder
        .build()
        .map_err(|e| WireError::Transport(e.to_string()))
}

/// Read a response body under BOTH a byte ceiling and a wall clock.
///
/// The byte half is the v0.4 audit's C1/H2 guard: the relay is
/// unauthenticated at the transport layer, so a hostile one could
/// stream an unbounded body and exhaust client memory. Two independent
/// checks, because a hostile server controls both — `Content-Length`,
/// if present, is rejected before any body bytes are read; the bytes
/// actually read are capped via `Read::take`, so a response that omits
/// or understates its `Content-Length` is still cut off rather than
/// buffered whole.
///
/// The time half is the same threat with the other dial: a body that
/// arrives one ACKed byte at a time never trips the byte cap, never
/// looks idle to keepalive, and never leaves data unacknowledged for
/// `TCP_USER_TIMEOUT`. `deadline` is checked between reads, which is
/// where a dribbling peer is; a completely silent one is caught by the
/// client's own whole-request deadline instead. Neither is redundant.
///
/// The stall is LOGGED here rather than left to the caller: this is the
/// only frame that knows how long it waited and how much it got.
fn read_bounded(
    resp: reqwest::blocking::Response,
    max: u64,
    deadline: Duration,
    what: &str,
) -> Result<Vec<u8>, WireError> {
    if let Some(declared) = resp.content_length() {
        if declared > max {
            return Err(WireError::BadResponse(format!(
                "attachment content-length {declared} exceeds max {max} bytes"
            )));
        }
    }

    let started = std::time::Instant::now();
    // Read at most one byte past the ceiling: if that extra byte shows
    // up, the body is over the limit regardless of what (or whether)
    // Content-Length claimed, and we bail without having buffered an
    // unbounded amount.
    let mut reader = resp.take(max + 1);
    let mut buf = Vec::new();
    let mut chunk = [0u8; 64 * 1024];
    loop {
        let n = reader
            .read(&mut chunk)
            .map_err(|e| WireError::Transport(e.to_string()))?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
        if buf.len() as u64 > max {
            return Err(WireError::BadResponse(format!(
                "attachment body exceeded max {max} bytes"
            )));
        }
        let elapsed = started.elapsed();
        if elapsed > deadline {
            let msg = format!(
                "{what} stalled: {} bytes in {elapsed:?}, past the {deadline:?} budget \
                 (floor rate {MIN_TRANSFER_BYTES_PER_SEC} B/s)",
                buf.len()
            );
            log::warn!("attachment object: {msg}");
            return Err(WireError::Transport(msg));
        }
    }
    Ok(buf)
}

/// `extract_wire_error`, but with the error body read under a ceiling
/// and a clock.
///
/// `read_bounded` guarded the 2xx paths only; every non-2xx response
/// went to the shared `extract_wire_error`, whose `resp.text()` has no
/// bound of any kind. On the object clients that read is governed by
/// `OBJECT_TRANSFER_DEADLINE`, so a hostile or compromised relay could
/// answer 500 with an endless body and make this client buffer at full
/// line rate for ~73 minutes — gigabytes. That is the same v0.4 audit
/// C1/H2 threat `read_bounded` exists for, on the one path that had
/// been left out, and the window widened across this branch: 60s, then
/// unbounded, now 73 minutes.
///
/// An error envelope is two short strings, so it is read on the CONTROL
/// budget no matter which endpoint produced it. A body over that ceiling
/// is discarded rather than parsed — but the STATUS survives, because
/// that is what callers branch on and a relay that sends a megabyte of
/// nonsense with a 404 is still telling us the object is gone.
///
/// The status decision and the envelope parse both come from
/// `sync::wire`, so this cannot drift from the shared function on which
/// statuses skip the body (429/503) or on how a body that is read gets
/// interpreted.
fn bounded_wire_error(resp: reqwest::blocking::Response) -> WireError {
    if let Some(throttled) = crate::sync::wire::throttled_status(&resp) {
        return throttled;
    }
    let status = resp.status().as_u16();
    match read_bounded(
        resp,
        MAX_CONTROL_RESPONSE_BYTES,
        CONTROL_REQUEST_DEADLINE,
        "error response",
    ) {
        Ok(raw) => crate::sync::wire::wire_error_from_body(
            status,
            String::from_utf8_lossy(&raw).into_owned(),
        ),
        Err(e) => {
            log::warn!("attachment object: unreadable {status} error body: {e}");
            WireError::UnexpectedStatus {
                status,
                body: format!(
                    "error body was not readable within {MAX_CONTROL_RESPONSE_BYTES} bytes / \
                     {CONTROL_REQUEST_DEADLINE:?} and was discarded: {e}"
                ),
            }
        }
    }
}

/// A control response (DELETE's, and the one that follows a PUT) is
/// small and quick — bounded on its own terms, not on the transfer's.
/// A PUT client necessarily carries the transfer exemption; without
/// this the tiny JSON that follows the upload inherits it, and
/// `resp.text()` on a relay that stops sending mid-response never
/// returns.
fn interpret_json_response<R: serde::de::DeserializeOwned>(
    resp: reqwest::blocking::Response,
) -> Result<R, WireError> {
    let status = resp.status().as_u16();
    if (200..300).contains(&status) {
        let raw = read_bounded(
            resp,
            MAX_CONTROL_RESPONSE_BYTES,
            CONTROL_REQUEST_DEADLINE,
            "control response",
        )?;
        return serde_json::from_slice::<R>(&raw)
            .map_err(|e| WireError::BadResponse(e.to_string()));
    }
    Err(bounded_wire_error(resp))
}

/// Upload one attachment ciphertext object. `hash_hex` is the
/// lowercase hex blake3 of `ciphertext`; the relay verifies the body
/// hashes to it. Signed PUT, mirrors `upload::put_blob` exactly.
pub fn put_attachment(
    base_url: &str,
    device_keys: &DeviceKeys,
    user_id: &str,
    hash_hex: &str,
    ciphertext: Vec<u8>,
) -> Result<PutAttachmentResponse, WireError> {
    let client = build_client("PUT")?;
    let path = format!("/v1/users/{user_id}/attachments/{hash_hex}");
    let headers = sign_request(device_keys, "PUT", &path, &ciphertext);
    let url = format!("{}{path}", normalize_base_url(base_url));

    let resp = client
        .put(&url)
        .header("Content-Type", "application/octet-stream")
        .header("X-Device-Id", &headers.device_id)
        .header("X-Timestamp", &headers.timestamp)
        .header("X-Nonce", &headers.nonce)
        .header("X-Sig", &headers.signature)
        .body(ciphertext)
        .send()
        .map_err(|e| WireError::Transport(e.to_string()))?;

    interpret_json_response(resp)
}

/// Fetch one attachment ciphertext object. Returns the raw bytes.
/// 404 `attachment_not_found` surfaces as `WireError::Wire` via
/// `extract_wire_error`, same shape as `pull::get_blob`'s
/// `blob_not_found`.
///
/// The response is bounded by `MAX_BLOB_BYTES` (the same ceiling
/// `attachment_blob::reassemble` enforces on the legacy inline-op
/// path — one number, not a second one that can drift from it). The
/// relay is unauthenticated at the transport layer the way an op
/// payload's `size_bytes` is (v0.4 security audit C1/H2): a malicious
/// or compromised relay could otherwise stream an unbounded body and
/// exhaust client memory. Two independent checks, because a hostile
/// server controls both: `Content-Length`, if present, is checked
/// before any body bytes are read; the actual bytes read are also
/// capped via `Read::take`, so a response that omits or understates
/// its `Content-Length` is still cut off rather than buffered whole.
pub fn get_attachment(
    base_url: &str,
    device_keys: &DeviceKeys,
    user_id: &str,
    hash_hex: &str,
) -> Result<Vec<u8>, WireError> {
    let client = build_client("GET")?;
    let path = format!("/v1/users/{user_id}/attachments/{hash_hex}");
    let headers = sign_request(device_keys, "GET", &path, b"");
    let url = format!("{}{path}", normalize_base_url(base_url));

    let resp = client
        .get(&url)
        .header("X-Device-Id", &headers.device_id)
        .header("X-Timestamp", &headers.timestamp)
        .header("X-Nonce", &headers.nonce)
        .header("X-Sig", &headers.signature)
        .send()
        .map_err(|e| WireError::Transport(e.to_string()))?;

    let status = resp.status().as_u16();
    if !(200..300).contains(&status) {
        return Err(bounded_wire_error(resp));
    }
    read_bounded_body(resp, OBJECT_TRANSFER_DEADLINE)
}

/// Read an attachment body under the object ceiling and the object
/// deadline. `deadline` is a parameter rather than the constant so the
/// stall path is testable in a second instead of in 73 minutes — see
/// `a_dribbling_body_is_cut_off_by_the_clock`.
fn read_bounded_body(
    resp: reqwest::blocking::Response,
    deadline: Duration,
) -> Result<Vec<u8>, WireError> {
    read_bounded(resp, MAX_BLOB_BYTES as u64, deadline, "object body")
}

/// Delete one attachment ciphertext object. Idempotent: deleting an
/// already-gone (or never-existed) hash returns 200 with
/// `deleted: false, freed_bytes: 0` rather than an error, so callers
/// can retry freely. Signed DELETE with an empty body, mirrors
/// `devices::revoke_device`'s signing but reads a JSON response
/// instead of a bare 204.
pub fn delete_attachment(
    base_url: &str,
    device_keys: &DeviceKeys,
    user_id: &str,
    hash_hex: &str,
) -> Result<DeleteAttachmentResponse, WireError> {
    let client = build_client("DELETE")?;
    let path = format!("/v1/users/{user_id}/attachments/{hash_hex}");
    // DELETE bodies are empty; we still pass an empty byte slice so the
    // signer's sha256_hex(body) lands on the canonical empty hash.
    let headers = sign_request(device_keys, "DELETE", &path, b"");
    let url = format!("{}{path}", normalize_base_url(base_url));

    let resp = client
        .delete(&url)
        .header("X-Device-Id", &headers.device_id)
        .header("X-Timestamp", &headers.timestamp)
        .header("X-Nonce", &headers.nonce)
        .header("X-Sig", &headers.signature)
        .send()
        .map_err(|e| WireError::Transport(e.to_string()))?;

    interpret_json_response(resp)
}

#[cfg(test)]
mod tests {
    use super::*;
    use httpmock::prelude::*;

    // Plain #[test], not #[tokio::test]: this wire layer is synchronous —
    // mirror sync/wire/upload.rs's own tests exactly.
    #[test]
    fn put_attachment_sends_ciphertext_and_reads_stored_bytes() {
        let server = MockServer::start();
        let hash = "b".repeat(64);
        let m = server.mock(|when, then| {
            when.method(PUT).path(format!("/v1/users/u/attachments/{hash}"));
            then.status(200).json_body(serde_json::json!({ "stored_bytes": 7 }));
        });
        let keys = crate::sync::keys::generate_device_keys();
        let res = put_attachment(&server.base_url(), &keys, "u", &hash, vec![1, 2, 3, 4, 5, 6, 7])
            .unwrap();
        m.assert();
        assert_eq!(res.stored_bytes, 7);
    }

    #[test]
    fn delete_attachment_is_idempotent() {
        let server = MockServer::start();
        let hash = "c".repeat(64);
        server.mock(|when, then| {
            when.method(DELETE).path(format!("/v1/users/u/attachments/{hash}"));
            then.status(200).json_body(serde_json::json!({ "deleted": false, "freed_bytes": 0 }));
        });
        let keys = crate::sync::keys::generate_device_keys();
        let res = delete_attachment(&server.base_url(), &keys, "u", &hash).unwrap();
        assert!(!res.deleted);
        assert_eq!(res.freed_bytes, 0);
    }

    /// Happy path: GET /attachments/<hash> returns the raw ciphertext
    /// bytes, mirroring `pull::get_blob_returns_raw_bytes`.
    #[test]
    fn get_attachment_returns_raw_bytes() {
        let server = MockServer::start();
        let keys = crate::sync::keys::generate_device_keys();
        let hash = "a".repeat(64);
        let body = vec![9u8, 8, 7, 6, 5];

        let m = server.mock(|when, then| {
            when.method(GET)
                .path(format!("/v1/users/u/attachments/{hash}"))
                .header_exists("X-Sig");
            then.status(200)
                .header("content-type", "application/octet-stream")
                .body(body.clone());
        });
        let got = get_attachment(&server.base_url(), &keys, "u", &hash).unwrap();
        m.assert();
        assert_eq!(got, body);
    }

    /// 404 attachment_not_found surfaces as a structured Wire error.
    #[test]
    fn get_attachment_surfaces_attachment_not_found() {
        let server = MockServer::start();
        let keys = crate::sync::keys::generate_device_keys();
        let hash = "f".repeat(64);
        server.mock(|when, then| {
            when.method(GET).path(format!("/v1/users/u/attachments/{hash}"));
            then.status(404).json_body(serde_json::json!({
                "error": { "code": "attachment_not_found", "message": "no committed row" }
            }));
        });
        let err = get_attachment(&server.base_url(), &keys, "u", &hash).unwrap_err();
        match err {
            WireError::Wire { status, body } => {
                assert_eq!(status, 404);
                assert_eq!(body.code, "attachment_not_found");
            }
            other => panic!("expected Wire, got {other:?}"),
        }
    }

    /// 429 quota_exceeded (not 413) maps to Throttled — same as every
    /// other 429 in this codebase, via `extract_wire_error`.
    #[test]
    fn put_attachment_surfaces_quota_exceeded_as_throttled() {
        let server = MockServer::start();
        let keys = crate::sync::keys::generate_device_keys();
        let hash = "d".repeat(64);
        server.mock(|when, then| {
            when.method(PUT).path(format!("/v1/users/u/attachments/{hash}"));
            then.status(429).json_body(serde_json::json!({
                "error": { "code": "quota_exceeded", "message": "cap reached" }
            }));
        });
        let err = put_attachment(&server.base_url(), &keys, "u", &hash, vec![1, 2, 3]).unwrap_err();
        assert!(matches!(err, WireError::Throttled { .. }), "got {err:?}");
    }

    /// Regression pin: a 429 must still map to `Throttled` with the
    /// parsed `Retry-After` duration exactly as before 503 handling was
    /// added — 429 and 503 share `extract_wire_error`'s branch, and a
    /// careless refactor of that branch (e.g. replacing the 429 check
    /// instead of widening it) would show up here as a wrong or missing
    /// `retry_after`.
    #[test]
    fn put_attachment_429_with_retry_after_still_returns_throttled_with_duration() {
        let server = MockServer::start();
        let keys = crate::sync::keys::generate_device_keys();
        let hash = "e".repeat(64);
        server.mock(|when, then| {
            when.method(PUT).path(format!("/v1/users/u/attachments/{hash}"));
            then.status(429).header("retry-after", "5").json_body(serde_json::json!({
                "error": { "code": "quota_exceeded", "message": "cap reached" }
            }));
        });
        let err = put_attachment(&server.base_url(), &keys, "u", &hash, vec![1, 2, 3]).unwrap_err();
        match err {
            WireError::Throttled { retry_after } => {
                assert_eq!(retry_after, Some(std::time::Duration::from_secs(5)));
            }
            other => panic!("expected Throttled, got {other:?}"),
        }
    }

    /// 503 `upload_slots_busy` with a `Retry-After` header maps to
    /// `Throttled` with the parsed duration, same as 429 — this is the
    /// whole point of the fix: a busy-slots 503 gets the relay's short
    /// pacing hint honoured instead of the worker's minute-plus
    /// exponential floor.
    #[test]
    fn put_attachment_surfaces_upload_slots_busy_503_with_retry_after_as_throttled() {
        let server = MockServer::start();
        let keys = crate::sync::keys::generate_device_keys();
        let hash = "1".repeat(64);
        server.mock(|when, then| {
            when.method(PUT).path(format!("/v1/users/u/attachments/{hash}"));
            then.status(503).header("retry-after", "3").json_body(serde_json::json!({
                "error": { "code": "upload_slots_busy", "message": "all slots busy" }
            }));
        });
        let err = put_attachment(&server.base_url(), &keys, "u", &hash, vec![1, 2, 3]).unwrap_err();
        match err {
            WireError::Throttled { retry_after } => {
                assert_eq!(retry_after, Some(std::time::Duration::from_secs(3)));
            }
            other => panic!("expected Throttled, got {other:?}"),
        }
    }

    /// A 503 with no `Retry-After` header (a proxy's generic 503 rather
    /// than the relay's own) still maps to `Throttled`, just with
    /// `retry_after: None` — the worker falls back to its own
    /// exponential schedule for the next attempt, same as a 429 with no
    /// header.
    #[test]
    fn put_attachment_surfaces_503_without_retry_after_as_throttled_none() {
        let server = MockServer::start();
        let keys = crate::sync::keys::generate_device_keys();
        let hash = "2".repeat(64);
        server.mock(|when, then| {
            when.method(PUT).path(format!("/v1/users/u/attachments/{hash}"));
            then.status(503);
        });
        let err = put_attachment(&server.base_url(), &keys, "u", &hash, vec![1, 2, 3]).unwrap_err();
        assert!(
            matches!(err, WireError::Throttled { retry_after: None }),
            "got {err:?}"
        );
    }

    /// Transport failure on a closed port maps to Transport, not Wire.
    #[test]
    fn put_attachment_surfaces_transport_failure() {
        let keys = crate::sync::keys::generate_device_keys();
        let err = put_attachment("http://127.0.0.1:1", &keys, "u", &"a".repeat(64), vec![1])
            .unwrap_err();
        assert!(matches!(err, WireError::Transport(_)), "got {err:?}");
    }

    // --- oversized-response guard -------------------------------------
    //
    // httpmock always computes an accurate Content-Length from the body
    // it's given (a mismatched custom header + real body panics inside
    // its own hyper server), so it cannot produce the lying or omitted
    // Content-Length a hostile relay could send. These two tests drive a
    // raw socket instead so the response framing is under direct control.

    use std::io::Write;
    use std::net::{TcpListener, TcpStream};

    /// Accept one connection and hand it to `respond` on a background
    /// thread. Returns the base URL to hit.
    fn spawn_raw_server(respond: impl FnOnce(TcpStream) + Send + 'static) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
        let addr = listener.local_addr().expect("local_addr");
        std::thread::spawn(move || {
            if let Ok((stream, _)) = listener.accept() {
                respond(stream);
            }
        });
        format!("http://{addr}")
    }

    /// Best-effort drain of the inbound request so our response writes
    /// don't race a half-sent request. A signed GET has no body and
    /// small headers, so this always arrives in one read in practice.
    fn drain_request(stream: &mut TcpStream) {
        let mut buf = [0u8; 4096];
        let _ = stream.read(&mut buf);
    }

    /// A relay that declares a Content-Length above the ceiling must be
    /// rejected from the header alone, before any body read is
    /// attempted. Proven two ways: the connection is closed right after
    /// the header block with zero body bytes ever sent, so a client that
    /// tried to read a body against that promise would see a transport
    /// decode error (premature EOF vs. the declared length) rather than
    /// our `BadResponse` — and it would take a beat to notice, not
    /// return instantly.
    #[test]
    fn get_attachment_rejects_oversized_content_length_without_reading_body() {
        let claimed = MAX_BLOB_BYTES as u64 + 1;
        let base_url = spawn_raw_server(move |mut stream| {
            drain_request(&mut stream);
            let head = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {claimed}\r\nContent-Type: application/octet-stream\r\n\r\n"
            );
            let _ = stream.write_all(head.as_bytes());
            // Deliberately never write the promised body, and let the
            // stream close here (end of closure) rather than keeping it
            // open — a body-read attempt hits premature EOF quickly
            // instead of hanging on the client's 60s timeout.
        });
        let keys = crate::sync::keys::generate_device_keys();
        let hash = "1".repeat(64);

        let started = std::time::Instant::now();
        let err = get_attachment(&base_url, &keys, "u", &hash).unwrap_err();
        assert!(
            started.elapsed() < std::time::Duration::from_secs(5),
            "took {:?} — looks like it tried to read the (never-sent) body instead of \
             bailing on the header",
            started.elapsed()
        );
        match err {
            WireError::BadResponse(msg) => {
                assert!(msg.contains("content-length"), "got {msg:?}")
            }
            other => panic!("expected BadResponse, got {other:?}"),
        }
    }

    /// The accept side of the same boundary: a response of *exactly*
    /// `MAX_BLOB_BYTES` — the legitimate maximum-size attachment this
    /// ceiling exists to allow through — must come back intact, not
    /// rejected. Pairs with the `max + 1` test above so both edges of
    /// the `> max` comparison in `read_bounded_body` are pinned; if that
    /// were ever loosened to `>= max`, this is the test that would catch
    /// it (a real maximum-size attachment would start being silently
    /// refused, and nothing on the rejection side would notice).
    #[test]
    fn get_attachment_accepts_body_of_exactly_max_blob_bytes() {
        let size = MAX_BLOB_BYTES as u64;
        let base_url = spawn_raw_server(move |mut stream| {
            drain_request(&mut stream);
            let head = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {size}\r\nContent-Type: application/octet-stream\r\n\r\n"
            );
            let _ = stream.write_all(head.as_bytes());

            let chunk = vec![0xABu8; 64 * 1024];
            let mut sent: u64 = 0;
            while sent < size {
                let remaining = (size - sent) as usize;
                let n = remaining.min(chunk.len());
                if stream.write_all(&chunk[..n]).is_err() {
                    break;
                }
                sent += n as u64;
            }
        });
        let keys = crate::sync::keys::generate_device_keys();
        let hash = "3".repeat(64);

        let got = get_attachment(&base_url, &keys, "u", &hash).unwrap();
        assert_eq!(
            got.len() as u64,
            size,
            "exact-ceiling body was truncated or grown in transit"
        );
        assert!(
            got.iter().all(|&b| b == 0xAB),
            "exact-ceiling body came back corrupted"
        );
    }

    /// I3, CORRECTED — the object deadline is GENEROUS, not absent.
    ///
    /// A configuration assertion, and deliberately so: the only
    /// behaviour that distinguishes 73 minutes from no deadline is a
    /// transfer that runs for 73 minutes. What it pins is the
    /// arithmetic — the deadline is a function of the ceiling and a
    /// floor transfer rate, so it cannot drift from `MAX_BLOB_BYTES`,
    /// and neither the 60s that shipped originally nor the unbounded
    /// correction to it can come back without this going red.
    #[test]
    fn the_object_deadline_is_derived_from_the_ceiling_and_a_floor_rate() {
        let d = OBJECT_TRANSFER_DEADLINE;
        assert_eq!(
            d.as_secs(),
            MAX_BLOB_BYTES as u64 / MIN_TRANSFER_BYTES_PER_SEC,
            "the deadline must stay a function of the ceiling, not a typed-in number"
        );
        // 104 MiB at 200 kbit/s ≈ 4362s ≈ 73 min. The band is wide on
        // purpose: it fails on the 60s that shipped (a rate floor no
        // phone meets) and on a value so large it stops being a bound.
        assert!(
            d >= Duration::from_secs(30 * 60) && d <= Duration::from_secs(4 * 60 * 60),
            "{d:?} implies a floor rate of {:.2} Mbit/s",
            MAX_BLOB_BYTES as f64 * 8.0 / 1_000_000.0 / d.as_secs_f64()
        );
        // The per-operation bounds stand alongside it, not instead of it.
        assert!(CONNECT_TIMEOUT < IDLE_TIMEOUT);
        assert!(IDLE_TIMEOUT < d);
    }

    /// FINDING 2 — THE BODY NEEDS A CLOCK, NOT JUST A BYTE CAP.
    ///
    /// `MAX_BLOB_BYTES` bounds how much a hostile relay can make this
    /// client buffer; it says nothing about how long it can make it
    /// wait. A relay dribbling one ACKed byte at a time is never idle
    /// (so `tcp_keepalive` never probes) and never has unacknowledged
    /// data (so `tcp_user_timeout` never fires), and `worker::tick` runs
    /// `run_object_fetch_at` INLINE — one such GET stalls all page and
    /// op sync for the life of the process, with nothing logged.
    ///
    /// Driven with a short deadline rather than the real 73-minute one:
    /// the mechanism under test is the wall clock in the read loop, and
    /// the constant it is normally given is pinned separately above.
    /// Without the clock this test does not fail — it never returns.
    #[test]
    fn a_dribbling_body_is_cut_off_by_the_clock() {
        let base_url = spawn_raw_server(move |mut stream| {
            drain_request(&mut stream);
            // No Content-Length: framed by connection close, so the
            // client has no idea how much is still coming.
            let head =
                "HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Type: application/octet-stream\r\n\r\n";
            let _ = stream.write_all(head.as_bytes());
            // One byte at a time, forever — far under the byte ceiling,
            // and never still enough for any socket-level bound.
            loop {
                if stream.write_all(&[0x5A]).is_err() {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
        });
        // Unsigned: the raw server answers anything, and what is under
        // test is the read loop, not the signature.
        let client = build_client("GET").unwrap();
        let resp = client
            .get(format!("{base_url}/v1/users/u/attachments/{}", "5".repeat(64)))
            .send()
            .unwrap();

        let started = std::time::Instant::now();
        let err = read_bounded_body(resp, Duration::from_millis(400)).unwrap_err();
        let elapsed = started.elapsed();

        assert!(
            elapsed < Duration::from_secs(10),
            "the dribble was never cut off — took {elapsed:?}"
        );
        match err {
            WireError::Transport(msg) => assert!(msg.contains("stalled"), "got {msg:?}"),
            other => panic!("expected Transport(stalled), got {other:?}"),
        }
    }

    /// FINDING 1 — DELETE MUST NOT INHERIT THE LARGE-BODY EXEMPTION.
    ///
    /// The deadline above was removed from the SHARED client, so DELETE
    /// got the exemption too — and DELETE is the one that runs
    /// synchronously inside a `#[tauri::command]`
    /// (`attachment_set_sync` → `delete_attachment`). A relay that
    /// completes the handshake and then never answers hung that call
    /// indefinitely: the invoke promise never resolves and the sync
    /// toggle spins in the UI forever. It was bounded at 60s before.
    ///
    /// `deadline_for` is the decision, extracted so it is assertable —
    /// the alternative is a test that sits on a black-hole socket for a
    /// minute. Each call site passes the same method literal it gives
    /// `sign_request`, so the two cannot disagree about what the
    /// request is.
    #[test]
    fn delete_does_not_inherit_the_large_body_exemption() {
        assert_eq!(
            deadline_for("DELETE"),
            Some(CONTROL_REQUEST_DEADLINE),
            "an empty body and a two-integer JSON response justify no exemption"
        );
        assert!(
            CONTROL_REQUEST_DEADLINE <= Duration::from_secs(60),
            "this one blocks a command thread the UI is awaiting"
        );
        // The generous budget stays exactly where a 100 MB body earns it.
        assert_eq!(deadline_for("PUT"), Some(OBJECT_TRANSFER_DEADLINE));
        assert_eq!(deadline_for("GET"), Some(OBJECT_TRANSFER_DEADLINE));
        assert!(CONTROL_REQUEST_DEADLINE < OBJECT_TRANSFER_DEADLINE);
    }

    /// The response that follows a PUT is read on the client carrying
    /// that exemption, so `resp.text()` there was bounded by nothing at
    /// all — neither bytes nor time — against a relay this module
    /// explicitly does not trust. It goes through `read_bounded` now.
    ///
    /// Driven on the BYTE edge because that edge is fast; the clock in
    /// the same function gets its own behavioural test where a short
    /// deadline can be passed in.
    #[test]
    fn a_put_response_is_bounded_like_every_other_body() {
        let base_url = spawn_raw_server(move |mut stream| {
            drain_request(&mut stream);
            let head =
                "HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Type: application/json\r\n\r\n";
            let _ = stream.write_all(head.as_bytes());
            let _ = stream.write_all(b"{\"stored_bytes\": 7, \"pad\": \"");
            // A relay answering a 3-byte upload with an endless string.
            let chunk = vec![b'x'; 16 * 1024];
            let mut sent = 0u64;
            while sent < MAX_CONTROL_RESPONSE_BYTES + 32 * 1024 {
                if stream.write_all(&chunk).is_err() {
                    break;
                }
                sent += chunk.len() as u64;
            }
        });
        let keys = crate::sync::keys::generate_device_keys();

        let err = put_attachment(&base_url, &keys, "u", &"6".repeat(64), vec![1, 2, 3]).unwrap_err();
        match err {
            WireError::BadResponse(msg) => assert!(msg.contains("exceeded max"), "got {msg:?}"),
            other => panic!("expected BadResponse, got {other:?}"),
        }
    }

    /// The behavioural half, as far as a fast test can reach: a
    /// transfer that takes several seconds and never stalls completes.
    /// This does not catch a re-added 60s deadline (nothing fast can);
    /// it catches an aggressively short one, and it proves the client
    /// is not applying reqwest's own 30s default either.
    #[test]
    fn a_slow_but_progressing_transfer_is_not_cut_off() {
        let body = vec![0x7Eu8; 96 * 1024];
        let size = body.len();
        let base_url = spawn_raw_server(move |mut stream| {
            drain_request(&mut stream);
            let head = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {size}\r\nContent-Type: application/octet-stream\r\n\r\n"
            );
            let _ = stream.write_all(head.as_bytes());
            // ~2s of steady dribble: slow, but never idle.
            for chunk in body.chunks(4 * 1024) {
                if stream.write_all(chunk).is_err() {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(80));
            }
        });
        let keys = crate::sync::keys::generate_device_keys();
        let got = get_attachment(&base_url, &keys, "u", &"4".repeat(64)).unwrap();
        assert_eq!(got.len(), size);
    }

    /// THE ERROR PATH IS A BODY TOO.
    ///
    /// `read_bounded` guarded the 2xx paths; every non-2xx response went
    /// to the shared `extract_wire_error`, whose `resp.text()` has no
    /// ceiling at all. On these clients that read is governed by
    /// `OBJECT_TRANSFER_DEADLINE`, so a hostile or compromised relay
    /// could answer 500 with an endless body and make this client buffer
    /// at full line rate for ~73 minutes — gigabytes, against a relay
    /// this module explicitly does not trust (v0.4 audit C1/H2).
    ///
    /// Driven on the byte edge because that edge is fast; the clock in
    /// the same `read_bounded` has its own behavioural test. The status
    /// must survive the truncation — it is what callers branch on.
    #[test]
    fn an_error_body_is_bounded_like_every_other_body() {
        let base_url = spawn_raw_server(move |mut stream| {
            drain_request(&mut stream);
            let head =
                "HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\nContent-Type: application/json\r\n\r\n";
            let _ = stream.write_all(head.as_bytes());
            let _ = stream.write_all(b"{\"error\": {\"code\": \"internal\", \"message\": \"");
            // A relay answering a signed GET with an endless message.
            let chunk = vec![b'x'; 16 * 1024];
            let mut sent = 0u64;
            while sent < MAX_CONTROL_RESPONSE_BYTES + 32 * 1024 {
                if stream.write_all(&chunk).is_err() {
                    break;
                }
                sent += chunk.len() as u64;
            }
        });
        let keys = crate::sync::keys::generate_device_keys();

        let err = get_attachment(&base_url, &keys, "u", &"7".repeat(64)).unwrap_err();
        match err {
            WireError::UnexpectedStatus { status, body } => {
                assert_eq!(status, 500, "the status has to survive a discarded body");
                assert!(
                    (body.len() as u64) < MAX_CONTROL_RESPONSE_BYTES,
                    "buffered {} bytes of a relay's error body",
                    body.len()
                );
                assert!(body.contains("discarded"), "got {body:?}");
            }
            other => panic!("expected UnexpectedStatus, got {other:?}"),
        }
    }

    /// The accept side: an error envelope of ordinary size still parses
    /// into `Wire { code }` after going through the bounded reader — the
    /// ceiling must not cost callers the `code` they branch on. The 404
    /// test above covers `get_attachment`; this one covers the PUT path,
    /// where the error is read on a client carrying the 73-minute
    /// transfer exemption.
    #[test]
    fn a_normal_sized_error_envelope_still_parses_on_the_put_path() {
        let server = MockServer::start();
        let keys = crate::sync::keys::generate_device_keys();
        let hash = "8".repeat(64);
        server.mock(|when, then| {
            when.method(PUT).path(format!("/v1/users/u/attachments/{hash}"));
            then.status(400).json_body(serde_json::json!({
                "error": { "code": "hash_mismatch", "message": "body does not hash to the path" }
            }));
        });
        let err = put_attachment(&server.base_url(), &keys, "u", &hash, vec![1, 2, 3]).unwrap_err();
        match err {
            WireError::Wire { status, body } => {
                assert_eq!(status, 400);
                assert_eq!(body.code, "hash_mismatch");
            }
            other => panic!("expected Wire, got {other:?}"),
        }
    }

    /// A relay that omits (or understates) Content-Length — framing the
    /// body by connection-close instead, which HTTP/1.1 still permits —
    /// must still be cut off at the ceiling: the actual bytes read are
    /// bounded independent of what the header does or doesn't claim.
    /// The server keeps writing past the ceiling in small chunks; once
    /// the client stops reading (having hit its cap) the next write
    /// fails with a broken pipe and the server stops, so this test
    /// doesn't wait for gigabytes to actually cross the wire.
    #[test]
    fn get_attachment_cuts_off_body_with_no_trustworthy_content_length() {
        let base_url = spawn_raw_server(move |mut stream| {
            drain_request(&mut stream);
            let head =
                "HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Type: application/octet-stream\r\n\r\n";
            let _ = stream.write_all(head.as_bytes());

            let chunk = vec![0u8; 64 * 1024];
            let target = MAX_BLOB_BYTES as u64 + 4096;
            let mut sent: u64 = 0;
            while sent < target {
                if stream.write_all(&chunk).is_err() {
                    break;
                }
                sent += chunk.len() as u64;
            }
        });
        let keys = crate::sync::keys::generate_device_keys();
        let hash = "2".repeat(64);

        let err = get_attachment(&base_url, &keys, "u", &hash).unwrap_err();
        match err {
            WireError::BadResponse(msg) => {
                assert!(msg.contains("exceeded max"), "got {msg:?}")
            }
            other => panic!("expected BadResponse, got {other:?}"),
        }
    }
}
