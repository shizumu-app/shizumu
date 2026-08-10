//! Op upload — the two-phase ceremony from spec §5.4.
//!
//! `POST /v1/users/<uid>/ops` announces op metadata. The relay returns
//! `need_upload` (hashes it doesn't have ciphertext for yet) and `ack`
//! (hashes it has already committed, idempotent retry-friendly).
//!
//! `PUT /v1/users/<uid>/blobs/<hash>` uploads one ciphertext blob and
//! returns `{ "user_seq": N }` once it lands in `committed` state.
//!
//! Both endpoints are signed per §5.1. The signing helper here mirrors
//! the canonical-request format exactly; we cannot rely on reqwest's
//! built-in auth machinery because the signature must cover the
//! body's SHA-256 hex digest, which means we need to materialise the
//! request body before sending.

use crate::sync::keys::DeviceKeys;
use crate::sync::signing::sign_request;
use crate::sync::wire::{normalize_base_url, WireError};
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// One row in the `POST /ops` request body.
///
/// `blob_hash` is the lowercase hex blake3 of the ciphertext bytes.
/// `doc_id_ct` is the base64-encoded 32-byte HMAC the relay groups by.
/// `op_kind` matches the `^[a-z][a-z0-9_]{0,31}$` regex.
#[derive(Debug, Clone, Serialize)]
pub struct OpMetadata {
    pub blob_hash: String,
    pub blob_size: u64,
    pub doc_id_ct: String,
    pub op_kind: String,
    pub stream_id: i32,
    /// Key epoch this op was encrypted under (key rotation). 0 = the
    /// original phrase-derived keyring; the relay stores it opaquely so
    /// receivers can select the right decryption key.
    pub epoch: i64,
}

#[derive(Debug, Serialize)]
struct PostOpsRequest<'a> {
    ops: &'a [OpMetadata],
}

#[derive(Debug, Clone, Deserialize)]
pub struct OpAck {
    pub blob_hash: String,
    pub user_seq: i64,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct PostOpsResponse {
    #[serde(default)]
    pub need_upload: Vec<String>,
    #[serde(default)]
    pub ack: Vec<OpAck>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PutBlobResponse {
    pub user_seq: i64,
}

/// Build a blocking reqwest client with a sensible upload timeout.
/// Centralised so both endpoints share the same configuration.
fn build_client() -> Result<reqwest::blocking::Client, WireError> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| WireError::Transport(e.to_string()))
}

/// Send a signed POST with a JSON body. The signature covers the
/// canonical_request including sha256_hex(body), so we serialise the
/// body upfront and pass the bytes to the signer.
fn signed_post_json<R: serde::de::DeserializeOwned>(
    client: &reqwest::blocking::Client,
    device_keys: &DeviceKeys,
    base_url: &str,
    path_with_query: &str,
    body: &impl Serialize,
) -> Result<R, WireError> {
    let body_bytes = serde_json::to_vec(body).map_err(|e| WireError::BadResponse(e.to_string()))?;
    let headers = sign_request(device_keys, "POST", path_with_query, &body_bytes);
    let url = format!("{}{}", normalize_base_url(base_url), path_with_query);

    let resp = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("X-Device-Id", &headers.device_id)
        .header("X-Timestamp", &headers.timestamp)
        .header("X-Nonce", &headers.nonce)
        .header("X-Sig", &headers.signature)
        .body(body_bytes)
        .send()
        .map_err(|e| WireError::Transport(e.to_string()))?;

    interpret_response(resp)
}

/// Send a signed PUT with raw bytes (application/octet-stream).
fn signed_put_bytes<R: serde::de::DeserializeOwned>(
    client: &reqwest::blocking::Client,
    device_keys: &DeviceKeys,
    base_url: &str,
    path_with_query: &str,
    body: Vec<u8>,
) -> Result<R, WireError> {
    let headers = sign_request(device_keys, "PUT", path_with_query, &body);
    let url = format!("{}{}", normalize_base_url(base_url), path_with_query);

    let resp = client
        .put(&url)
        .header("Content-Type", "application/octet-stream")
        .header("X-Device-Id", &headers.device_id)
        .header("X-Timestamp", &headers.timestamp)
        .header("X-Nonce", &headers.nonce)
        .header("X-Sig", &headers.signature)
        .body(body)
        .send()
        .map_err(|e| WireError::Transport(e.to_string()))?;

    interpret_response(resp)
}

fn interpret_response<R: serde::de::DeserializeOwned>(
    resp: reqwest::blocking::Response,
) -> Result<R, WireError> {
    let status = resp.status().as_u16();
    if (200..300).contains(&status) {
        let raw = resp
            .text()
            .map_err(|e| WireError::Transport(e.to_string()))?;
        return serde_json::from_str::<R>(&raw).map_err(|e| WireError::BadResponse(e.to_string()));
    }
    Err(crate::sync::wire::extract_wire_error(resp))
}

/// Announce op metadata. `ops` is capped at 200 entries on the wire
/// (`max_ops_per_post`); callers slice their work appropriately.
pub fn post_ops(
    base_url: &str,
    device_keys: &DeviceKeys,
    user_id: &str,
    ops: &[OpMetadata],
) -> Result<PostOpsResponse, WireError> {
    let client = build_client()?;
    let path = format!("/v1/users/{user_id}/ops");
    signed_post_json(&client, device_keys, base_url, &path, &PostOpsRequest { ops })
}

/// Upload one ciphertext blob. `hash_hex` is the lowercase hex
/// blake3 the relay expects in the URL path; the request body is
/// the raw bytes that hash to it.
pub fn put_blob(
    base_url: &str,
    device_keys: &DeviceKeys,
    user_id: &str,
    hash_hex: &str,
    ciphertext: Vec<u8>,
) -> Result<PutBlobResponse, WireError> {
    let client = build_client()?;
    let path = format!("/v1/users/{user_id}/blobs/{hash_hex}");
    signed_put_bytes(&client, device_keys, base_url, &path, ciphertext)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::envelope::blob_hash_hex;
    use crate::sync::keys::generate_device_keys;
    use httpmock::prelude::*;

    fn fresh_device() -> DeviceKeys {
        generate_device_keys()
    }

    /// Happy path: POST /ops returns `need_upload` + `ack`. The
    /// request carries the four signed headers and the JSON body
    /// matches the spec §5.4 shape.
    #[test]
    fn post_ops_round_trips_request_and_response() {
        let server = MockServer::start();
        let dk = fresh_device();
        let user_id = "u-1";

        let want_hash = "a".repeat(64);
        let ack_hash = "b".repeat(64);

        let mock = server.mock(|when, then| {
            when.method(POST)
                .path(format!("/v1/users/{user_id}/ops"))
                .header_exists("X-Device-Id")
                .header_exists("X-Timestamp")
                .header_exists("X-Nonce")
                .header_exists("X-Sig")
                .header("content-type", "application/json")
                .json_body_partial(format!(
                    r#"{{"ops":[{{"blob_hash":"{want_hash}","op_kind":"page_blob"}}]}}"#
                ));
            then.status(200).json_body(serde_json::json!({
                "need_upload": [&want_hash],
                "ack": [{ "blob_hash": &ack_hash, "user_seq": 42 }],
            }));
        });

        let ops = vec![OpMetadata {
            blob_hash: want_hash.clone(),
            blob_size: 17,
            doc_id_ct: "AAAA".into(),
            op_kind: "page_blob".into(),
            stream_id: 1,
            epoch: 0,
        }];
        let resp = post_ops(&server.base_url(), &dk, user_id, &ops).unwrap();
        mock.assert();
        assert_eq!(resp.need_upload, vec![want_hash]);
        assert_eq!(resp.ack.len(), 1);
        assert_eq!(resp.ack[0].blob_hash, ack_hash);
        assert_eq!(resp.ack[0].user_seq, 42);
    }

    /// Every signed request carries the four §5.1 headers. Header
    /// presence is the wiring contract; the primitive that produces
    /// the values is tested in `sync::signing`.
    #[test]
    fn post_ops_attaches_all_four_signed_headers() {
        let server = MockServer::start();
        let dk = fresh_device();
        let mock = server.mock(|when, then| {
            when.method(POST)
                .path("/v1/users/u/ops")
                .header_exists("X-Device-Id")
                .header_exists("X-Timestamp")
                .header_exists("X-Nonce")
                .header_exists("X-Sig");
            then.status(200).json_body(serde_json::json!({}));
        });
        post_ops(&server.base_url(), &dk, "u", &[]).unwrap();
        mock.assert();
    }

    /// 413 too_many_ops surfaces as a structured Wire error so the
    /// orchestrator can shrink its batch and retry.
    #[test]
    fn post_ops_surfaces_too_many_ops() {
        let server = MockServer::start();
        let dk = fresh_device();

        server.mock(|when, then| {
            when.method(POST).path("/v1/users/u/ops");
            then.status(413).json_body(serde_json::json!({
                "error": { "code": "too_many_ops", "message": "limit 200" }
            }));
        });
        let err = post_ops(&server.base_url(), &dk, "u", &[]).unwrap_err();
        match err {
            WireError::Wire { status, body } => {
                assert_eq!(status, 413);
                assert_eq!(body.code, "too_many_ops");
            }
            other => panic!("expected Wire, got {other:?}"),
        }
    }

    /// PUT /blobs/<hash> happy path: ciphertext flows through, signed
    /// headers attached, response carries the assigned user_seq.
    #[test]
    fn put_blob_round_trips_request_and_response() {
        let server = MockServer::start();
        let dk = fresh_device();
        let ciphertext = vec![0xab; 256];
        let hash_hex = blob_hash_hex(&ciphertext);

        let mock = server.mock(|when, then| {
            when.method(PUT)
                .path(format!("/v1/users/u/blobs/{hash_hex}"))
                .header("content-type", "application/octet-stream")
                .header_exists("X-Sig");
            then.status(200).json_body(serde_json::json!({"user_seq": 7}));
        });

        let resp = put_blob(&server.base_url(), &dk, "u", &hash_hex, ciphertext).unwrap();
        mock.assert();
        assert_eq!(resp.user_seq, 7);
    }


    /// 400 blob_hash_mismatch is the contract violation case: a
    /// client uploading bytes that don't hash to the URL path. Surface
    /// it as a Wire error so the orchestrator can drop the op and
    /// log a corruption warning (this should never happen if encrypt
    /// is deterministic).
    #[test]
    fn put_blob_surfaces_blob_hash_mismatch() {
        let server = MockServer::start();
        let dk = fresh_device();

        let hash = "f".repeat(64);
        server.mock(|when, then| {
            when.method(PUT).path(format!("/v1/users/u/blobs/{hash}"));
            then.status(400).json_body(serde_json::json!({
                "error": { "code": "blob_hash_mismatch", "message": "blake3 != URL hash" }
            }));
        });

        let err = put_blob(&server.base_url(), &dk, "u", &hash, vec![1, 2, 3]).unwrap_err();
        match err {
            WireError::Wire { status, body } => {
                assert_eq!(status, 400);
                assert_eq!(body.code, "blob_hash_mismatch");
            }
            other => panic!("expected Wire, got {other:?}"),
        }
    }

    /// Transport failure on a closed port maps to Transport, not
    /// Wire — the UI distinguishes "no relay" from "relay rejected".
    #[test]
    fn put_blob_surfaces_transport_failure() {
        let dk = fresh_device();
        let err = put_blob("http://127.0.0.1:1", &dk, "u", &"a".repeat(64), vec![1]).unwrap_err();
        assert!(matches!(err, WireError::Transport(_)), "got {err:?}");
    }
}
