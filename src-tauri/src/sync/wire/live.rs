//! `GET /v1/users/<uid>/live` — server-sent events for wakeup-on-new-op.
//!
//! Spec §5.6: signed via query string (because `EventSource` cannot
//! carry custom headers). The wire format is the standard SSE
//! `text/event-stream` — events separated by blank lines, each event
//! consisting of `event: <kind>` and `data: <json>` lines.
//!
//! We treat SSE as a pure wakeup signal — every received `event: op`
//! sets a wake-flag the polling worker reads between sleep slices.
//! The polling worker is still authoritative for what actually gets
//! pulled; spec §5.6 explicitly says "SSE is a wakeup, not a stream
//! — clients MUST always pull on (re)connect rather than reconstruct
//! missed events from SSE alone."

use crate::sync::keys::DeviceKeys;
use crate::sync::wire::normalize_base_url;
use std::io::{BufRead, BufReader};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// One parsed SSE event. We only care about `op` (wake the worker)
/// and `closed` (relay revoked us — bail out of the listen loop).
/// `ping` is silently consumed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LiveEvent {
    Op,
    Closed { reason: String },
    Ping,
    Unknown(String),
}

/// Sign and open a streaming GET against `/v1/users/<uid>/live`. On
/// success returns the reader; on auth/transport failure returns the
/// error. The relay's first response is the SSE handshake; data
/// arrives as events afterwards.
pub fn open_stream(
    base_url: &str,
    device_keys: &DeviceKeys,
    user_id: &str,
) -> Result<Box<dyn BufRead + Send>, String> {
    // Per spec §5.6, the four signed values go in the query string
    // rather than headers. Build the path with the auth params, sign,
    // then re-build with the signature appended.
    let path_with_auth = build_signed_path(device_keys, user_id);
    let url = format!("{}{}", normalize_base_url(base_url), path_with_auth);

    // No request timeout — SSE connections are intentionally long-
    // lived. We DO set a connect timeout so an unreachable relay
    // doesn't hang the spawn forever.
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(None)
        .build()
        .map_err(|e| format!("sse client build: {e}"))?;

    let resp = client
        .get(&url)
        .header("Accept", "text/event-stream")
        .send()
        .map_err(|e| format!("sse connect: {e}"))?;
    let status = resp.status().as_u16();
    if !(200..300).contains(&status) {
        let body = resp.text().unwrap_or_default();
        return Err(format!("sse handshake returned {status}: {body}"));
    }
    Ok(Box::new(BufReader::new(resp)))
}

/// Drive the SSE loop until shutdown is signalled OR the relay
/// returns an `event: closed`. Each `event: op` sets `wake_flag` to
/// true; the polling worker picks it up on its next sleep-slice
/// check.
///
/// On a transport error, returns Ok so the caller can reconnect with
/// backoff. On an explicit `closed` event, returns Err with the
/// reason so the caller can stop reconnecting (e.g. device revoked).
pub fn listen_loop(
    reader: &mut dyn BufRead,
    wake_flag: &AtomicBool,
    shutdown: &AtomicBool,
) -> Result<(), String> {
    let mut event_name = String::new();
    let mut data_payload = String::new();
    let mut line = String::new();

    loop {
        if shutdown.load(Ordering::SeqCst) {
            return Ok(());
        }
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => return Ok(()), // connection closed by server; reconnect
            Ok(_) => {}
            Err(_) => return Ok(()), // any io error → caller reconnects
        }

        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            // blank line: dispatch the accumulated event
            let parsed = parse_event(&event_name, &data_payload);
            event_name.clear();
            data_payload.clear();
            match parsed {
                LiveEvent::Op => wake_flag.store(true, Ordering::SeqCst),
                LiveEvent::Closed { reason } => {
                    return Err(format!("relay closed connection: {reason}"));
                }
                _ => {}
            }
        } else if let Some(rest) = trimmed.strip_prefix("event:") {
            event_name = rest.trim().to_string();
        } else if let Some(rest) = trimmed.strip_prefix("data:") {
            // Multiple data: lines per event are joined with \n; we
            // expect single-line JSON so straight assignment is fine
            // in practice. Keep the API correct for future events.
            if !data_payload.is_empty() {
                data_payload.push('\n');
            }
            data_payload.push_str(rest.trim_start());
        }
        // Other field types (id:, retry:, comment lines starting with
        // ':') are ignored per the SSE spec.
    }
}

fn build_signed_path(device_keys: &DeviceKeys, user_id: &str) -> String {
    // Per spec §5.6 the query-string auth fields carry the same
    // canonical_request as the equivalent header-mode request. The
    // canonical_request signs over `path_with_query` — and since the
    // signature ITSELF is part of the query, we sign over the path
    // with `device_id`, `timestamp`, `nonce` present but `sig` NOT
    // appended. The spec example matches this construction.
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock predates 1970")
        .as_millis()
        .to_string();
    let mut nonce_bytes = [0u8; 16];
    rand_core::RngCore::fill_bytes(&mut rand_core::OsRng, &mut nonce_bytes);
    let nonce = hex::encode(nonce_bytes);
    let device_id = device_keys.device_id.to_string();

    let path_without_sig = format!(
        "/v1/users/{user_id}/live?device_id={device_id}&timestamp={timestamp}&nonce={nonce}"
    );
    let signed = crate::sync::signing::sign_request_with(
        device_keys,
        "GET",
        &path_without_sig,
        b"",
        &timestamp,
        &nonce,
    );
    // base64 standard alphabet may contain '+' and '/' — URL-encode them.
    let sig_url = urlencoding_minimal(&signed.signature);
    format!("{path_without_sig}&sig={sig_url}")
}

fn parse_event(event_name: &str, _data: &str) -> LiveEvent {
    match event_name {
        "op" => LiveEvent::Op,
        "ping" | "" => LiveEvent::Ping,
        "closed" => LiveEvent::Closed {
            reason: _data.to_string(),
        },
        other => LiveEvent::Unknown(other.to_string()),
    }
}

/// Minimal URL-encoder for base64 standard alphabet (the only chars
/// we need to escape in `sig=`): '+' → '%2B', '/' → '%2F', '=' → '%3D'.
fn urlencoding_minimal(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '+' => out.push_str("%2B"),
            '/' => out.push_str("%2F"),
            '=' => out.push_str("%3D"),
            other => out.push(other),
        }
    }
    out
}

/// Spawn the SSE listener on a dedicated thread. The thread runs an
/// infinite reconnect loop until `shutdown` flips to true. On each
/// successful `event: op` it sets `wake_flag`; reconnect backoff
/// caps at 60 seconds.
pub fn spawn_listener(
    base_url: String,
    user_id: String,
    device_keys_seed: [u8; 32],
    device_id: uuid::Uuid,
    wake_flag: Arc<AtomicBool>,
    shutdown: Arc<AtomicBool>,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        // Reconstruct DeviceKeys inside the thread so the seed never
        // shares ownership with another thread's signing key.
        let device_sign_priv = ed25519_dalek::SigningKey::from_bytes(&device_keys_seed);
        // The SSE listener only signs requests with the Ed25519 key; the
        // kex key is never used on this path. Mint a throwaway so the
        // struct is well-formed without threading an unused seed in.
        let device_kex_priv = {
            use rand_core::RngCore;
            let mut s = [0u8; 32];
            rand_core::OsRng.fill_bytes(&mut s);
            x25519_dalek::StaticSecret::from(s)
        };
        let dk = DeviceKeys {
            device_id,
            device_sign_priv,
            device_kex_priv,
        };

        let mut backoff = Duration::from_secs(1);
        while !shutdown.load(Ordering::SeqCst) {
            match open_stream(&base_url, &dk, &user_id) {
                Ok(mut reader) => {
                    log::info!("sse: connected to {base_url}");
                    backoff = Duration::from_secs(1);
                    match listen_loop(reader.as_mut(), &wake_flag, &shutdown) {
                        Ok(()) => log::info!("sse: connection closed, reconnecting"),
                        Err(e) => {
                            log::warn!("sse: {e}");
                            // `closed` means revoked — stop trying.
                            if e.contains("device_revoked") {
                                return;
                            }
                        }
                    }
                }
                Err(e) => {
                    log::warn!("sse: connect failed: {e}");
                }
            }
            // Sleep with shutdown responsiveness.
            let slice = Duration::from_millis(250);
            let mut waited = Duration::ZERO;
            while waited < backoff && !shutdown.load(Ordering::SeqCst) {
                std::thread::sleep(slice);
                waited += slice;
            }
            backoff = (backoff * 2).min(Duration::from_secs(60));
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    /// Parser accumulates the `data:` line across multiple lines (per
    /// SSE spec) — but we only need single-line JSON in practice.
    /// Verify the event dispatch on blank-line boundaries.
    #[test]
    fn listen_loop_dispatches_op_event_and_sets_wake_flag() {
        let input = b"event: op\ndata: {\"user_seq\":5}\n\n";
        let mut cur = Cursor::new(&input[..]);
        let mut br = std::io::BufReader::new(&mut cur);
        let wake = AtomicBool::new(false);
        let shutdown = AtomicBool::new(false);
        let _ = listen_loop(&mut br, &wake, &shutdown);
        assert!(wake.load(Ordering::SeqCst));
    }

    /// `ping` heartbeat must NOT wake the worker — that would defeat
    /// the latency improvement (worker would wake every 30s anyway).
    #[test]
    fn ping_does_not_set_wake_flag() {
        let input = b"event: ping\ndata: {}\n\n";
        let mut cur = Cursor::new(&input[..]);
        let mut br = std::io::BufReader::new(&mut cur);
        let wake = AtomicBool::new(false);
        let shutdown = AtomicBool::new(false);
        let _ = listen_loop(&mut br, &wake, &shutdown);
        assert!(!wake.load(Ordering::SeqCst));
    }

    /// Two op events in a row both flip the flag (idempotent — the
    /// worker resets it after waking).
    #[test]
    fn multiple_op_events_each_set_wake_flag() {
        let input = b"event: op\ndata: {\"user_seq\":1}\n\nevent: op\ndata: {\"user_seq\":2}\n\n";
        let mut cur = Cursor::new(&input[..]);
        let mut br = std::io::BufReader::new(&mut cur);
        let wake = AtomicBool::new(false);
        let shutdown = AtomicBool::new(false);
        let _ = listen_loop(&mut br, &wake, &shutdown);
        assert!(wake.load(Ordering::SeqCst));
    }

    /// `event: closed` terminates the loop with an Err carrying the
    /// reason — so the caller can recognise device_revoked and stop
    /// reconnecting.
    #[test]
    fn closed_event_returns_err_with_reason() {
        let input = b"event: closed\ndata: {\"reason\":\"device_revoked\"}\n\n";
        let mut cur = Cursor::new(&input[..]);
        let mut br = std::io::BufReader::new(&mut cur);
        let wake = AtomicBool::new(false);
        let shutdown = AtomicBool::new(false);
        let err = listen_loop(&mut br, &wake, &shutdown).unwrap_err();
        assert!(err.contains("device_revoked"));
    }

    /// Shutdown signal cleanly exits the loop without waiting for
    /// more data — important so app shutdown isn't blocked on the
    /// next event.
    #[test]
    fn shutdown_signal_exits_cleanly() {
        // Cursor with infinite data isn't possible, so simulate by
        // pre-setting shutdown and an empty input.
        let input = b"";
        let mut cur = Cursor::new(&input[..]);
        let mut br = std::io::BufReader::new(&mut cur);
        let wake = AtomicBool::new(false);
        let shutdown = AtomicBool::new(true);
        listen_loop(&mut br, &wake, &shutdown).unwrap();
        assert!(!wake.load(Ordering::SeqCst));
    }

    /// Signing the live-stream path uses the standard canonical_request
    /// machinery — sig is just relocated to a query parameter.
    /// Verifies the four expected query params are present.
    #[test]
    fn build_signed_path_carries_all_four_auth_params() {
        let dk = crate::sync::keys::generate_device_keys();
        let path = build_signed_path(&dk, "u-test");
        assert!(path.starts_with("/v1/users/u-test/live?"));
        for required in ["device_id=", "timestamp=", "nonce=", "sig="] {
            assert!(path.contains(required), "missing {required}: {path}");
        }
        // Sig is URL-encoded base64 — should not contain '+' or '/'.
        let sig_part = path.split("sig=").nth(1).unwrap();
        assert!(!sig_part.contains('+'));
        assert!(!sig_part.contains('/'));
    }

    /// Minimal URL encoder handles the three base64 specials.
    #[test]
    fn url_encoder_handles_base64_specials() {
        assert_eq!(urlencoding_minimal("ab+cd/ef==").to_string(), "ab%2Bcd%2Fef%3D%3D");
        assert_eq!(urlencoding_minimal("plain"), "plain");
    }
}
