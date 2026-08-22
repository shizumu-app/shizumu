//! `POST /v1/devices/enroll` — single_user mode bootstrap.
//! `POST /v1/devices/self-enroll` — zero-user self-claim variant.
//!
//! Spec §5.3: the operator runs `shizumu-relay init-user --pub <…>`
//! out-of-band, which writes the user row and prints a one-shot
//! enrollment_token (32 bytes hex, 1-hour TTL). The first device
//! posts the token here together with its device keypair and an
//! `authorized_sig` proving the user's signing key endorses this
//! device's pubkey.
//!
//! `self_enroll` is the zero-user variant: when the relay is running
//! in single_user mode with no users yet, the first device can claim
//! the slot by posting user + device pubkeys directly. The relay
//! returns 409 if a user already exists.
//!
//! Unlike every other request, these endpoints are NOT signed via §5.1
//! (no device exists yet on the relay). The enrollment_token (or
//! self-claim privilege) is the capability; `authorized_sig` is what
//! proves the user owns the account.

use crate::sync::keys::{DeviceKeys, UserKeys};
use crate::sync::wire::{WireErrorBody, WireErrorEnvelope};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use ed25519_dalek::Signer;
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Serialize)]
struct EnrollRequest<'a> {
    enrollment_token: &'a str,
    user_kex_pub: String,
    device_sign_pub: String,
    /// base64 of the 32-byte X25519 public key used to wrap epoch secrets
    /// (key rotation plan 1).
    device_kex_pub: String,
    device_id: String,
    device_label: &'a str,
    authorized_sig: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EnrollResponse {
    pub user_id: String,
    pub device_id: String,
}

#[derive(Debug)]
pub enum EnrollError {
    /// Local-side failure (cannot reach relay, TLS error, request
    /// build failed). Carries the underlying reqwest error string.
    Transport(String),
    /// Relay returned a structured non-2xx error envelope.
    Wire { status: u16, body: WireErrorBody },
    /// Relay returned a non-2xx without (or with malformed) envelope.
    UnexpectedStatus { status: u16, body: String },
    /// Relay returned 2xx but the body did not deserialize as the
    /// documented response shape.
    BadResponse(String),
}

impl std::fmt::Display for EnrollError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EnrollError::Transport(s) => write!(f, "transport: {s}"),
            EnrollError::Wire { status, body } => {
                write!(f, "relay returned {status} {}: {}", body.code, body.message)
            }
            EnrollError::UnexpectedStatus { status, body } => {
                write!(f, "relay returned {status} (unparseable body): {body}")
            }
            EnrollError::BadResponse(s) => write!(f, "malformed enroll response: {s}"),
        }
    }
}

impl std::error::Error for EnrollError {}

/// Build the JSON body the relay expects. Pulled out so tests can
/// exercise the construction without standing up an HTTP mock.
pub fn build_enroll_body(
    user_keys: &UserKeys,
    device_keys: &DeviceKeys,
    enrollment_token: &str,
    device_label: &str,
) -> serde_json::Value {
    let device_sign_pub = device_keys.device_sign_pub_bytes();
    // authorized_sig = user_sign_priv.sign(device_sign_pub)
    // The signed payload is the raw 32 bytes of the device pubkey;
    // the relay verifies this against the user's stored user_sign_pub.
    let authorized_sig = user_keys.user_sign_priv.sign(&device_sign_pub);

    serde_json::to_value(&EnrollRequest {
        enrollment_token,
        user_kex_pub: B64.encode(user_keys.user_kex_pub_bytes()),
        device_sign_pub: B64.encode(device_sign_pub),
        device_kex_pub: B64.encode(device_keys.device_kex_pub_bytes()),
        device_id: device_keys.device_id.to_string(),
        device_label,
        authorized_sig: B64.encode(authorized_sig.to_bytes()),
    })
    .expect("EnrollRequest is always serializable")
}

/// Send the enrollment request to a relay base URL (e.g.
/// `https://sync.example.com`). Returns the (user_id, device_id)
/// pair the caller persists into `sync_state`.
pub fn enroll(
    base_url: &str,
    user_keys: &UserKeys,
    device_keys: &DeviceKeys,
    enrollment_token: &str,
    device_label: &str,
) -> Result<EnrollResponse, EnrollError> {
    let body = build_enroll_body(user_keys, device_keys, enrollment_token, device_label);
    let url = format!(
        "{}/v1/devices/enroll",
        crate::sync::wire::normalize_base_url(base_url)
    );

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| EnrollError::Transport(e.to_string()))?;

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .map_err(|e| EnrollError::Transport(e.to_string()))?;

    let status = resp.status().as_u16();
    let raw = resp
        .text()
        .map_err(|e| EnrollError::Transport(e.to_string()))?;

    if (200..300).contains(&status) {
        serde_json::from_str::<EnrollResponse>(&raw)
            .map_err(|e| EnrollError::BadResponse(e.to_string()))
    } else if let Ok(env) = serde_json::from_str::<WireErrorEnvelope>(&raw) {
        Err(EnrollError::Wire {
            status,
            body: env.error,
        })
    } else {
        Err(EnrollError::UnexpectedStatus { status, body: raw })
    }
}

// ---------------------------------------------------------------
// POST /v1/devices/self-enroll — zero-user self-claim
// ---------------------------------------------------------------

#[derive(Debug, Serialize)]
struct SelfEnrollRequest {
    user_sign_pub: String,
    user_kex_pub: String,
    device_sign_pub: String,
    /// base64 of the 32-byte X25519 public key (key rotation plan 1).
    device_kex_pub: String,
    device_id: String,
    device_label: String,
    authorized_sig: String,
}

/// Build the JSON body for self-enroll. Same `authorized_sig` contract
/// as `build_enroll_body` (user_sign_priv signs device_sign_pub bytes)
/// but carries the full user pubkeys so the relay can create both user
/// and device rows in one shot.
pub fn build_self_enroll_body(
    user_keys: &UserKeys,
    device_keys: &DeviceKeys,
    label: &str,
) -> serde_json::Value {
    let device_sign_pub = device_keys.device_sign_pub_bytes();
    let authorized_sig = user_keys.user_sign_priv.sign(&device_sign_pub);

    serde_json::to_value(&SelfEnrollRequest {
        user_sign_pub: B64.encode(user_keys.user_sign_pub_bytes()),
        user_kex_pub: B64.encode(user_keys.user_kex_pub_bytes()),
        device_sign_pub: B64.encode(device_sign_pub),
        device_kex_pub: B64.encode(device_keys.device_kex_pub_bytes()),
        device_id: device_keys.device_id.to_string(),
        device_label: label.to_string(),
        authorized_sig: B64.encode(authorized_sig.to_bytes()),
    })
    .expect("SelfEnrollRequest is always serializable")
}

/// Claim the sole user slot on a zero-user relay running in
/// single_user mode. Returns the same `EnrollResponse` shape as
/// `enroll()`. On 409 the relay already has a user; the caller
/// should surface this as "relay_already_claimed".
pub fn self_enroll(
    base_url: &str,
    user_keys: &UserKeys,
    device_keys: &DeviceKeys,
    device_label: &str,
) -> Result<EnrollResponse, EnrollError> {
    let body = build_self_enroll_body(user_keys, device_keys, device_label);
    let url = format!(
        "{}/v1/devices/self-enroll",
        crate::sync::wire::normalize_base_url(base_url)
    );

    // self-enroll special-cases 409 (a relay that already has a user)
    // into a distinct code the frontend keys off of, so it cannot go
    // through the generic send_bootstrap — everything else is shared.
    let (status, raw) = post_bootstrap(&url, &body)?;
    if status == 409 {
        // Relay already has a user — surface a specific code so the
        // frontend can show a clear message.
        return Err(EnrollError::Wire {
            status: 409,
            body: WireErrorBody {
                code: "relay_already_claimed".to_string(),
                message: "this relay already has a registered user".to_string(),
            },
        });
    }
    parse_bootstrap_response(status, raw)
}

// ---------------------------------------------------------------
// POST /v1/devices/init — multi_user mode bootstrap
// ---------------------------------------------------------------

/// Enroll a new user+device on a relay running in multi_user mode.
/// Same body format as self_enroll (user + device pubkeys with
/// authorized_sig). Creates a fresh user row and device row atomically.
/// Returns 409 if `user_sign_pub` is already registered on this relay.
pub fn init(
    base_url: &str,
    user_keys: &UserKeys,
    device_keys: &DeviceKeys,
    device_label: &str,
) -> Result<EnrollResponse, EnrollError> {
    let body = build_self_enroll_body(user_keys, device_keys, device_label);
    send_bootstrap(
        &format!(
            "{}/v1/devices/init",
            crate::sync::wire::normalize_base_url(base_url)
        ),
        &body,
    )
}

/// Attach this device to the account the phrase already belongs to.
/// `init` creates; this one finds. The relay answers 404 user_not_found
/// for a phrase it has never seen, which the UI turns into "no account
/// matches this phrase" instead of a silent empty account.
pub fn recover(
    base_url: &str,
    user_keys: &UserKeys,
    device_keys: &DeviceKeys,
    device_label: &str,
) -> Result<EnrollResponse, EnrollError> {
    let body = build_self_enroll_body(user_keys, device_keys, device_label);
    send_bootstrap(
        &format!(
            "{}/v1/devices/recover",
            crate::sync::wire::normalize_base_url(base_url)
        ),
        &body,
    )
}

/// Do the actual HTTP round-trip for a bootstrap verb (init / self-enroll
/// / recover) and hand back the raw status/body pair. Shared so the
/// three verbs cannot drift in how the request itself is built and sent.
fn post_bootstrap(url: &str, body: &serde_json::Value) -> Result<(u16, String), EnrollError> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| EnrollError::Transport(e.to_string()))?;

    let resp = client
        .post(url)
        .json(body)
        .send()
        .map_err(|e| EnrollError::Transport(e.to_string()))?;

    let status = resp.status().as_u16();
    let raw = resp
        .text()
        .map_err(|e| EnrollError::Transport(e.to_string()))?;

    Ok((status, raw))
}

/// Map the relay's envelope into EnrollResponse / EnrollError for the
/// bootstrap verbs that have no special-cased status code (init,
/// recover). self_enroll intercepts 409 before falling into this.
fn parse_bootstrap_response(status: u16, raw: String) -> Result<EnrollResponse, EnrollError> {
    if (200..300).contains(&status) {
        serde_json::from_str::<EnrollResponse>(&raw)
            .map_err(|e| EnrollError::BadResponse(e.to_string()))
    } else if let Ok(env) = serde_json::from_str::<WireErrorEnvelope>(&raw) {
        Err(EnrollError::Wire {
            status,
            body: env.error,
        })
    } else {
        Err(EnrollError::UnexpectedStatus { status, body: raw })
    }
}

/// POST an unsigned bootstrap body (init / self-enroll / recover) and
/// map the relay's envelope into EnrollResponse / EnrollError. Shared so
/// the three bootstrap verbs cannot drift in how they read a 4xx.
fn send_bootstrap(url: &str, body: &serde_json::Value) -> Result<EnrollResponse, EnrollError> {
    let (status, raw) = post_bootstrap(url, body)?;
    parse_bootstrap_response(status, raw)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::keys::{generate_device_keys, generate_seed_phrase, user_keys_from_phrase};
    use ed25519_dalek::{Verifier, VerifyingKey};
    use httpmock::prelude::*;

    fn fresh_keys() -> (UserKeys, DeviceKeys) {
        let m = generate_seed_phrase();
        (user_keys_from_phrase(&m), generate_device_keys())
    }

    /// The body fields match the spec §5.3 shape and the authorized_sig
    /// verifies against user_sign_pub over the raw device_sign_pub
    /// bytes — the contract the relay checks on receipt.
    #[test]
    fn enroll_body_has_required_fields_and_valid_signature() {
        let (uk, dk) = fresh_keys();
        let body = build_enroll_body(&uk, &dk, "deadbeef".repeat(8).as_str(), "laptop");

        for field in [
            "enrollment_token",
            "user_kex_pub",
            "device_sign_pub",
            "device_kex_pub",
            "device_id",
            "device_label",
            "authorized_sig",
        ] {
            assert!(body.get(field).is_some(), "missing field {field}");
        }

        let dev_pub_b64 = body["device_sign_pub"].as_str().unwrap();
        let sig_b64 = body["authorized_sig"].as_str().unwrap();
        let dev_pub: [u8; 32] = B64.decode(dev_pub_b64).unwrap().try_into().unwrap();
        let sig_bytes: [u8; 64] = B64.decode(sig_b64).unwrap().try_into().unwrap();

        let user_pub = VerifyingKey::from_bytes(&uk.user_sign_pub_bytes()).unwrap();
        user_pub
            .verify(&dev_pub, &ed25519_dalek::Signature::from_bytes(&sig_bytes))
            .expect("authorized_sig must verify under user_sign_pub over device_sign_pub bytes");
    }

    /// Pubkeys land on the wire as base64 of exactly 32 bytes (no PEM,
    /// no hex). The relay's parser rejects anything else with 400.
    #[test]
    fn pubkeys_on_wire_are_base64_of_32_bytes() {
        let (uk, dk) = fresh_keys();
        let body = build_enroll_body(&uk, &dk, "x", "x");
        for field in ["user_kex_pub", "device_sign_pub", "device_kex_pub"] {
            let v = B64.decode(body[field].as_str().unwrap()).unwrap();
            assert_eq!(v.len(), 32, "field {field} must be 32 raw bytes");
        }
    }

    /// 201 on the happy path: caller receives the (user_id, device_id)
    /// pair to persist into sync_state. The request lands at
    /// /v1/devices/enroll with the expected JSON body.
    #[test]
    fn enroll_happy_path_against_mock_relay() {
        let server = MockServer::start();
        let (uk, dk) = fresh_keys();
        let token = "a".repeat(64);

        let mock = server.mock(|when, then| {
            when.method(POST)
                .path("/v1/devices/enroll")
                .header("content-type", "application/json")
                .json_body_partial(format!(
                    r#"{{"enrollment_token":"{token}","device_label":"laptop"}}"#
                ));
            then.status(201).json_body(serde_json::json!({
                "user_id": "11111111-2222-3333-4444-555555555555",
                "device_id": dk.device_id.to_string(),
            }));
        });

        let resp = enroll(&server.base_url(), &uk, &dk, &token, "laptop").unwrap();
        mock.assert();
        assert_eq!(resp.user_id, "11111111-2222-3333-4444-555555555555");
        assert_eq!(resp.device_id, dk.device_id.to_string());
    }

    /// 404 `enrollment_token_invalid` (spec §5.3) is the typical
    /// failure mode. The caller must receive a structured Wire error
    /// so the UI can render the right message ("re-run init-user" vs
    /// "check your network").
    #[test]
    fn enroll_surfaces_structured_wire_errors() {
        let server = MockServer::start();
        let (uk, dk) = fresh_keys();

        server.mock(|when, then| {
            when.method(POST).path("/v1/devices/enroll");
            then.status(404).json_body(serde_json::json!({
                "error": {
                    "code": "enrollment_token_invalid",
                    "message": "Unknown / expired / consumed"
                }
            }));
        });

        let err = enroll(&server.base_url(), &uk, &dk, "stale", "laptop").unwrap_err();
        match err {
            EnrollError::Wire { status, body } => {
                assert_eq!(status, 404);
                assert_eq!(body.code, "enrollment_token_invalid");
            }
            other => panic!("expected Wire error, got: {other:?}"),
        }
    }

    /// Non-envelope error bodies fall through to UnexpectedStatus so
    /// the caller can still log what the relay actually returned.
    #[test]
    fn enroll_surfaces_unparseable_error_bodies() {
        let server = MockServer::start();
        let (uk, dk) = fresh_keys();

        server.mock(|when, then| {
            when.method(POST).path("/v1/devices/enroll");
            then.status(502).body("upstream gateway error");
        });

        let err = enroll(&server.base_url(), &uk, &dk, "x", "laptop").unwrap_err();
        match err {
            EnrollError::UnexpectedStatus { status, body } => {
                assert_eq!(status, 502);
                assert!(body.contains("upstream"));
            }
            other => panic!("expected UnexpectedStatus, got: {other:?}"),
        }
    }

    /// Transport failure (no listener at the URL) surfaces as
    /// EnrollError::Transport so the UI can render a "can't reach
    /// relay" message distinct from a 4xx/5xx.
    #[test]
    fn enroll_surfaces_transport_failure() {
        let (uk, dk) = fresh_keys();
        // Port 1 is reliably closed; reqwest will fail fast.
        let err = enroll("http://127.0.0.1:1", &uk, &dk, "x", "laptop").unwrap_err();
        assert!(matches!(err, EnrollError::Transport(_)), "got: {err:?}");
    }

    #[test]
    fn init_happy_path_against_mock_relay() {
        let server = MockServer::start();
        let (uk, dk) = fresh_keys();

        let mock = server.mock(|when, then| {
            when.method(POST)
                .path("/v1/devices/init")
                .header("content-type", "application/json");
            then.status(201).json_body(serde_json::json!({
                "user_id": "11111111-2222-3333-4444-555555555555",
                "device_id": dk.device_id.to_string(),
            }));
        });

        let resp = init(&server.base_url(), &uk, &dk, "laptop").unwrap();
        mock.assert();
        assert_eq!(resp.user_id, "11111111-2222-3333-4444-555555555555");
        assert_eq!(resp.device_id, dk.device_id.to_string());
    }

    #[test]
    fn init_surfaces_relay_errors() {
        let server = MockServer::start();
        let (uk, dk) = fresh_keys();

        server.mock(|when, then| {
            when.method(POST).path("/v1/devices/init");
            then.status(409).json_body(serde_json::json!({
                "error": {
                    "code": "user_sign_pub_already_registered",
                    "message": "this signing key is already registered"
                }
            }));
        });

        let err = init(&server.base_url(), &uk, &dk, "laptop").unwrap_err();
        match err {
            EnrollError::Wire { status, body } => {
                assert_eq!(status, 409);
                assert_eq!(body.code, "user_sign_pub_already_registered");
            }
            other => panic!("expected Wire error, got: {other:?}"),
        }
    }

    #[test]
    fn init_surfaces_transport_failure() {
        let (uk, dk) = fresh_keys();
        let err = init("http://127.0.0.1:1", &uk, &dk, "laptop").unwrap_err();
        assert!(matches!(err, EnrollError::Transport(_)), "got: {err:?}");
    }

    #[test]
    fn recover_posts_the_bootstrap_body_and_returns_the_existing_user() {
        let server = MockServer::start();
        let m = server.mock(|when, then| {
            when.method(POST).path("/v1/devices/recover");
            then.status(200).json_body(serde_json::json!({
                "user_id": "11111111-1111-1111-1111-111111111111",
                "device_id": "22222222-2222-2222-2222-222222222222"
            }));
        });
        let (uk, dk) = fresh_keys();
        let resp = recover(&server.base_url(), &uk, &dk, "phone").unwrap();
        m.assert();
        assert_eq!(resp.user_id, "11111111-1111-1111-1111-111111111111");
    }

    #[test]
    fn recover_surfaces_user_not_found_as_a_relay_error() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(POST).path("/v1/devices/recover");
            then.status(404).json_body(serde_json::json!({
                "error": {"code": "user_not_found", "message": "no account matches this recovery phrase"}
            }));
        });
        let (uk, dk) = fresh_keys();
        let err = recover(&server.base_url(), &uk, &dk, "phone").unwrap_err();
        assert!(err.to_string().contains("user_not_found"), "{err}");
    }
}
