//! Per-request Ed25519 signing per spec §5.1.
//!
//! Canonical request:
//!
//! ```text
//! METHOD          \n
//! X-Device-Id     \n
//! PATH_WITH_QUERY \n
//! X-Timestamp     \n
//! X-Nonce         \n
//! sha256_hex(body)
//! ```
//!
//! - `METHOD` is uppercase ASCII.
//! - `PATH_WITH_QUERY` is the exact bytes between `METHOD ` and ` HTTP/`
//!   on the request line. The signer here MUST be handed the same bytes
//!   the HTTP client puts on the wire — no normalization, no
//!   percent-decoding.
//! - `X-Timestamp` is decimal milliseconds since Unix epoch.
//! - `X-Nonce` is exactly 32 lowercase hex characters (16 random bytes),
//!   unique per request within the device's 10-minute nonce cache.
//! - `sha256_hex(body)` is the lowercase 64-char hex digest of the
//!   request body bytes; for empty body it is exactly
//!   `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
//! - `X-Sig` is base64 (standard alphabet, with padding) of the 64
//!   raw Ed25519 signature bytes.

use crate::sync::keys::DeviceKeys;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use ed25519_dalek::Signer;
use rand_core::{OsRng, RngCore};
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

/// The four header values a signed request must carry on top of any
/// content headers. The HTTP client wires these onto the outgoing
/// request as `X-Device-Id`, `X-Timestamp`, `X-Nonce`, `X-Sig`.
#[derive(Debug, Clone)]
pub struct SignedHeaders {
    pub device_id: String,
    pub timestamp: String,
    pub nonce: String,
    pub signature: String,
}

/// Sign a request. `path_with_query` is the exact byte sequence the
/// HTTP client will put on the wire (e.g. `/v1/users/<uid>/me` or
/// `/v1/users/<uid>/ops?since=42`). `body` is the raw request body
/// bytes (empty slice for GET).
pub fn sign_request(
    device_keys: &DeviceKeys,
    method: &str,
    path_with_query: &str,
    body: &[u8],
) -> SignedHeaders {
    let timestamp = now_millis_string();
    let nonce = generate_nonce_hex();
    sign_request_with(device_keys, method, path_with_query, body, &timestamp, &nonce)
}

/// Test-friendly variant: caller supplies timestamp + nonce so the
/// canonical string is fully deterministic. Production callers should
/// use `sign_request`, which fills both in for them.
pub fn sign_request_with(
    device_keys: &DeviceKeys,
    method: &str,
    path_with_query: &str,
    body: &[u8],
    timestamp: &str,
    nonce: &str,
) -> SignedHeaders {
    let canonical = canonical_request(
        method,
        &device_keys.device_id.to_string(),
        path_with_query,
        timestamp,
        nonce,
        body,
    );
    let sig = device_keys.device_sign_priv.sign(canonical.as_bytes());
    SignedHeaders {
        device_id: device_keys.device_id.to_string(),
        timestamp: timestamp.to_string(),
        nonce: nonce.to_string(),
        signature: B64.encode(sig.to_bytes()),
    }
}

/// Build the canonical_request string exactly as defined in §5.1. Kept
/// public so the test harness (and a future relay-side verifier) can
/// re-derive what was signed without re-implementing the format.
pub fn canonical_request(
    method: &str,
    device_id: &str,
    path_with_query: &str,
    timestamp: &str,
    nonce: &str,
    body: &[u8],
) -> String {
    let body_digest = sha256_hex(body);
    let mut s = String::with_capacity(
        method.len()
            + 1
            + device_id.len()
            + 1
            + path_with_query.len()
            + 1
            + timestamp.len()
            + 1
            + nonce.len()
            + 1
            + body_digest.len(),
    );
    s.push_str(method);
    s.push('\n');
    s.push_str(device_id);
    s.push('\n');
    s.push_str(path_with_query);
    s.push('\n');
    s.push_str(timestamp);
    s.push('\n');
    s.push_str(nonce);
    s.push('\n');
    s.push_str(&body_digest);
    s
}

/// Lowercase 64-char hex SHA-256 digest. Matches the wire format for
/// the body line of canonical_request.
pub fn sha256_hex(body: &[u8]) -> String {
    let digest = Sha256::digest(body);
    hex::encode(digest)
}

fn now_millis_string() -> String {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is before 1970")
        .as_millis();
    ms.to_string()
}

fn generate_nonce_hex() -> String {
    let mut bytes = [0u8; 16];
    OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::keys::generate_device_keys;
    use ed25519_dalek::{Verifier, VerifyingKey};

    /// Empty-body digest is fixed by spec §5.1. Lock it in.
    #[test]
    fn sha256_hex_of_empty_body_matches_spec() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    /// Canonical string layout is byte-exact. If this test ever moves,
    /// the relay will reject every signature we produce.
    #[test]
    fn canonical_request_layout_is_byte_exact() {
        let s = canonical_request(
            "GET",
            "11111111-2222-3333-4444-555555555555",
            "/v1/users/abc/me",
            "1715000000000",
            "0123456789abcdef0123456789abcdef",
            b"",
        );
        let expected = "GET\n\
                        11111111-2222-3333-4444-555555555555\n\
                        /v1/users/abc/me\n\
                        1715000000000\n\
                        0123456789abcdef0123456789abcdef\n\
                        e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        assert_eq!(s, expected);
    }

    /// A signed request round-trips through Ed25519 verification with
    /// the device's public key. This is the contract the relay will
    /// apply on every request — if it ever fails locally, no request
    /// could succeed against a real relay.
    #[test]
    fn signature_verifies_against_device_pub_key() {
        let dk = generate_device_keys();
        let body = b"{\"hello\":\"world\"}";
        let h = sign_request(&dk, "POST", "/v1/users/u/ops", body);

        let canonical = canonical_request(
            "POST",
            &h.device_id,
            "/v1/users/u/ops",
            &h.timestamp,
            &h.nonce,
            body,
        );
        let sig_bytes: [u8; 64] = B64
            .decode(&h.signature)
            .unwrap()
            .try_into()
            .expect("64-byte signature");
        let sig = ed25519_dalek::Signature::from_bytes(&sig_bytes);
        let pubkey = VerifyingKey::from_bytes(&dk.device_sign_pub_bytes()).unwrap();
        pubkey.verify(canonical.as_bytes(), &sig).unwrap();
    }

    /// Tampering with the body must invalidate the signature against
    /// the original canonical_request — the body digest is part of
    /// what's signed.
    #[test]
    fn tampered_body_breaks_verification() {
        let dk = generate_device_keys();
        let body = b"original";
        let h = sign_request(&dk, "POST", "/v1/users/u/ops", body);

        let canonical_tampered = canonical_request(
            "POST",
            &h.device_id,
            "/v1/users/u/ops",
            &h.timestamp,
            &h.nonce,
            b"tampered",
        );
        let sig_bytes: [u8; 64] = B64
            .decode(&h.signature)
            .unwrap()
            .try_into()
            .unwrap();
        let sig = ed25519_dalek::Signature::from_bytes(&sig_bytes);
        let pubkey = VerifyingKey::from_bytes(&dk.device_sign_pub_bytes()).unwrap();
        assert!(pubkey.verify(canonical_tampered.as_bytes(), &sig).is_err());
    }

    /// Nonces must vary across calls so the relay's replay cache can
    /// detect re-uploads.
    #[test]
    fn nonce_changes_per_call() {
        let dk = generate_device_keys();
        let a = sign_request(&dk, "GET", "/v1/users/u/me", b"");
        let b = sign_request(&dk, "GET", "/v1/users/u/me", b"");
        assert_ne!(a.nonce, b.nonce);
    }

    /// The nonce wire format is 32 lowercase hex chars (16 bytes). The
    /// relay rejects anything else with `400 bad_signature_headers`.
    #[test]
    fn nonce_is_32_lowercase_hex_chars() {
        let dk = generate_device_keys();
        let h = sign_request(&dk, "GET", "/", b"");
        assert_eq!(h.nonce.len(), 32);
        assert!(h.nonce.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }

    /// Signature wire format: standard-alphabet base64 of 64 raw bytes
    /// = 88 chars including padding.
    #[test]
    fn signature_is_88_char_base64() {
        let dk = generate_device_keys();
        let h = sign_request(&dk, "GET", "/", b"");
        assert_eq!(h.signature.len(), 88);
        let raw = B64.decode(&h.signature).unwrap();
        assert_eq!(raw.len(), 64);
    }

    /// Different method, path, or body must produce different
    /// signatures even with identical timestamp + nonce.
    #[test]
    fn signature_changes_with_method_path_or_body() {
        let dk = generate_device_keys();
        let ts = "1715000000000";
        let n = "00000000000000000000000000000000";
        let base = sign_request_with(&dk, "GET", "/x", b"", ts, n).signature;
        assert_ne!(
            base,
            sign_request_with(&dk, "POST", "/x", b"", ts, n).signature
        );
        assert_ne!(
            base,
            sign_request_with(&dk, "GET", "/y", b"", ts, n).signature
        );
        assert_ne!(
            base,
            sign_request_with(&dk, "GET", "/x", b"a", ts, n).signature
        );
    }
}
