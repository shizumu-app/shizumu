//! Pairing wire endpoints (spec §5.3).
//!
//! Seven endpoints over two roles:
//!
//! Existing-device side (signed via §5.1):
//!   - `POST .../pair/start`     issue a pair_token
//!   - `GET  .../pair/ephemeral` fetch the new device's ephemeral_pub
//!   - `POST .../pair/wrapped`   upload the age-wrapped key bundle
//!   - `POST .../pair/finalize`  authorize the new device after SAS match
//!
//! New-device side (pair_token gates, no Ed25519 signature yet — the
//! new device hasn't been authorized):
//!   - `POST .../pair/upload`    deposit ephemeral X25519 pubkey
//!   - `GET  .../pair/wrapped`   fetch the age envelope
//!   - `GET  .../pair/status`    poll for finalize completion
//!
//! The signed paths reuse the standard §5.1 canonical_request machinery
//! via `signed_post_json` (cloned from wire::upload's helper pattern).
//! The pair_token-gated paths are plain HTTP — pair_token is the bearer.

use crate::sync::keys::DeviceKeys;
use crate::sync::signing::sign_request;
use crate::sync::wire::{normalize_base_url, WireError, WireErrorEnvelope};
use serde::{Deserialize, Serialize};
use std::time::Duration;

fn build_client() -> Result<reqwest::blocking::Client, WireError> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| WireError::Transport(e.to_string()))
}

fn interpret<R: serde::de::DeserializeOwned>(
    resp: reqwest::blocking::Response,
) -> Result<R, WireError> {
    let status = resp.status().as_u16();
    let raw = resp
        .text()
        .map_err(|e| WireError::Transport(e.to_string()))?;
    if (200..300).contains(&status) {
        serde_json::from_str(&raw).map_err(|e| WireError::BadResponse(e.to_string()))
    } else if let Ok(env) = serde_json::from_str::<WireErrorEnvelope>(&raw) {
        Err(WireError::Wire {
            status,
            body: env.error,
        })
    } else {
        Err(WireError::UnexpectedStatus { status, body: raw })
    }
}

/// Used when the relay returns 204 No Content (no body to deserialize).
fn interpret_empty(resp: reqwest::blocking::Response) -> Result<(), WireError> {
    let status = resp.status().as_u16();
    if (200..300).contains(&status) {
        Ok(())
    } else {
        let raw = resp
            .text()
            .map_err(|e| WireError::Transport(e.to_string()))?;
        if let Ok(env) = serde_json::from_str::<WireErrorEnvelope>(&raw) {
            Err(WireError::Wire {
                status,
                body: env.error,
            })
        } else {
            Err(WireError::UnexpectedStatus { status, body: raw })
        }
    }
}

fn signed_post_json<R: serde::de::DeserializeOwned>(
    client: &reqwest::blocking::Client,
    device_keys: &DeviceKeys,
    base_url: &str,
    path: &str,
    body: &impl Serialize,
) -> Result<R, WireError> {
    let body_bytes = serde_json::to_vec(body).map_err(|e| WireError::BadResponse(e.to_string()))?;
    let headers = sign_request(device_keys, "POST", path, &body_bytes);
    let url = format!("{}{}", normalize_base_url(base_url), path);
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
    interpret(resp)
}

fn signed_post_empty(
    client: &reqwest::blocking::Client,
    device_keys: &DeviceKeys,
    base_url: &str,
    path: &str,
    body: &impl Serialize,
) -> Result<(), WireError> {
    let body_bytes = serde_json::to_vec(body).map_err(|e| WireError::BadResponse(e.to_string()))?;
    let headers = sign_request(device_keys, "POST", path, &body_bytes);
    let url = format!("{}{}", normalize_base_url(base_url), path);
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
    interpret_empty(resp)
}

fn signed_get_json<R: serde::de::DeserializeOwned>(
    client: &reqwest::blocking::Client,
    device_keys: &DeviceKeys,
    base_url: &str,
    path: &str,
) -> Result<R, WireError> {
    let headers = sign_request(device_keys, "GET", path, b"");
    let url = format!("{}{}", normalize_base_url(base_url), path);
    let resp = client
        .get(&url)
        .header("X-Device-Id", &headers.device_id)
        .header("X-Timestamp", &headers.timestamp)
        .header("X-Nonce", &headers.nonce)
        .header("X-Sig", &headers.signature)
        .send()
        .map_err(|e| WireError::Transport(e.to_string()))?;
    interpret(resp)
}

// =====================================================================
// Existing-device endpoints (signed)
// =====================================================================

#[derive(Debug, Serialize)]
struct PairStartRequest {
    ttl_seconds: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PairStartResponse {
    pub pair_token: String,
    pub expires_at: i64,
}

/// Existing device requests a pair_token (max ttl 600s per spec).
pub fn pair_start(
    base_url: &str,
    device_keys: &DeviceKeys,
    user_id: &str,
    ttl_seconds: u32,
) -> Result<PairStartResponse, WireError> {
    let client = build_client()?;
    let path = format!("/v1/users/{user_id}/devices/pair/start");
    signed_post_json(
        &client,
        device_keys,
        base_url,
        &path,
        &PairStartRequest { ttl_seconds },
    )
}

#[derive(Debug, Clone, Deserialize)]
pub struct PairEphemeralResponse {
    pub ephemeral_pub: String,
}

/// Existing device fetches the new device's ephemeral_pub. Must
/// compute SAS locally and display BEFORE wrapping anything.
pub fn pair_ephemeral(
    base_url: &str,
    device_keys: &DeviceKeys,
    user_id: &str,
    pair_token: &str,
) -> Result<PairEphemeralResponse, WireError> {
    let client = build_client()?;
    let path = format!(
        "/v1/users/{user_id}/devices/pair/ephemeral?pair_token={pair_token}"
    );
    signed_get_json(&client, device_keys, base_url, &path)
}

#[derive(Debug, Serialize)]
struct PairWrappedUpload<'a> {
    pair_token: &'a str,
    wrapped: &'a str,
}

/// Existing device uploads the age-wrapped key bundle. Returns 204
/// on success; we surface that as Ok(()).
pub fn pair_upload_wrapped(
    base_url: &str,
    device_keys: &DeviceKeys,
    user_id: &str,
    pair_token: &str,
    wrapped_b64: &str,
) -> Result<(), WireError> {
    let client = build_client()?;
    let path = format!("/v1/users/{user_id}/devices/pair/wrapped");
    signed_post_empty(
        &client,
        device_keys,
        base_url,
        &path,
        &PairWrappedUpload {
            pair_token,
            wrapped: wrapped_b64,
        },
    )
}

#[derive(Debug, Serialize)]
struct PairFinalizeRequest<'a> {
    pair_token: &'a str,
    device_sign_pub: &'a str,
    device_id: &'a str,
    device_label: &'a str,
    authorized_sig: &'a str,
    sas_confirmed: bool,
}

/// Existing device finalizes after the user has confirmed SAS match.
/// `sas_confirmed` MUST be true — relay rejects false with 400.
pub fn pair_finalize(
    base_url: &str,
    device_keys: &DeviceKeys,
    user_id: &str,
    pair_token: &str,
    new_device_sign_pub_b64: &str,
    new_device_id: &str,
    new_device_label: &str,
    authorized_sig_b64: &str,
) -> Result<(), WireError> {
    let client = build_client()?;
    let path = format!("/v1/users/{user_id}/devices/pair/finalize");
    signed_post_empty(
        &client,
        device_keys,
        base_url,
        &path,
        &PairFinalizeRequest {
            pair_token,
            device_sign_pub: new_device_sign_pub_b64,
            device_id: new_device_id,
            device_label: new_device_label,
            authorized_sig: authorized_sig_b64,
            sas_confirmed: true,
        },
    )
}

// =====================================================================
// New-device endpoints (pair_token-gated, unsigned)
// =====================================================================

#[derive(Debug, Serialize)]
struct PairUploadRequest<'a> {
    pair_token: &'a str,
    ephemeral_pub: &'a str,
}

/// New device deposits its ephemeral_pub. Capability is the pair_token.
pub fn pair_upload_ephemeral(
    base_url: &str,
    user_id: &str,
    pair_token: &str,
    ephemeral_pub_b64: &str,
) -> Result<(), WireError> {
    let client = build_client()?;
    let path = format!("/v1/users/{user_id}/devices/pair/upload");
    let url = format!("{}{}", normalize_base_url(base_url), path);
    let body = PairUploadRequest {
        pair_token,
        ephemeral_pub: ephemeral_pub_b64,
    };
    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .map_err(|e| WireError::Transport(e.to_string()))?;
    interpret_empty(resp)
}

#[derive(Debug, Clone, Deserialize)]
pub struct PairWrappedResponse {
    pub wrapped: String,
}

/// New device fetches the age-wrapped key bundle.
pub fn pair_fetch_wrapped(
    base_url: &str,
    user_id: &str,
    pair_token: &str,
) -> Result<PairWrappedResponse, WireError> {
    let client = build_client()?;
    let path = format!(
        "/v1/users/{user_id}/devices/pair/wrapped?pair_token={pair_token}"
    );
    let url = format!("{}{}", normalize_base_url(base_url), path);
    let resp = client
        .get(&url)
        .send()
        .map_err(|e| WireError::Transport(e.to_string()))?;
    interpret(resp)
}

#[derive(Debug, Clone, Deserialize)]
pub struct PairStatusResponse {
    pub status: String,
    pub user_id: Option<String>,
    pub device_id: Option<String>,
}

/// New device polls for finalize completion. Returns `status: "pending"`
/// until existing device finalizes, then `status: "ready"` with the
/// assigned user_id + device_id.
pub fn pair_status(
    base_url: &str,
    user_id: &str,
    pair_token: &str,
) -> Result<PairStatusResponse, WireError> {
    let client = build_client()?;
    let path = format!(
        "/v1/users/{user_id}/devices/pair/status?pair_token={pair_token}"
    );
    let url = format!("{}{}", normalize_base_url(base_url), path);
    let resp = client
        .get(&url)
        .send()
        .map_err(|e| WireError::Transport(e.to_string()))?;
    interpret(resp)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::keys::generate_device_keys;
    use httpmock::prelude::*;

    /// Existing device hits POST /pair/start, receives pair_token.
    #[test]
    fn pair_start_returns_token_and_expiry() {
        let server = MockServer::start();
        let dk = generate_device_keys();
        let mock = server.mock(|when, then| {
            when.method(POST)
                .path("/v1/users/u/devices/pair/start")
                .header_exists("X-Sig")
                .json_body_partial(r#"{"ttl_seconds":300}"#);
            then.status(200).json_body(serde_json::json!({
                "pair_token": "deadbeef".repeat(8),
                "expires_at": 1715000000000_i64
            }));
        });
        let r = pair_start(&server.base_url(), &dk, "u", 300).unwrap();
        mock.assert();
        assert_eq!(r.pair_token.len(), 64);
        assert_eq!(r.expires_at, 1715000000000);
    }

    /// New device's POST /pair/upload is unsigned — pair_token is
    /// the bearer. Spec §5.3: "unauthed; pair_token is the capability".
    #[test]
    fn pair_upload_is_unsigned_and_returns_204() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(POST)
                .path("/v1/users/u/devices/pair/upload");
            then.status(204);
        });
        let r = pair_upload_ephemeral(&server.base_url(), "u", "tok", "AAAA");
        mock.assert();
        r.unwrap();
    }

    /// 404 pair_token_unknown surfaces as Wire error so the UI can
    /// distinguish "expired token, regenerate QR" from transport
    /// failures.
    #[test]
    fn pair_upload_surfaces_unknown_token() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(POST).path("/v1/users/u/devices/pair/upload");
            then.status(404).json_body(serde_json::json!({
                "error": {"code":"pair_token_unknown","message":"no"}
            }));
        });
        let err = pair_upload_ephemeral(&server.base_url(), "u", "x", "y").unwrap_err();
        match err {
            WireError::Wire { status, body } => {
                assert_eq!(status, 404);
                assert_eq!(body.code, "pair_token_unknown");
            }
            other => panic!("expected Wire, got {other:?}"),
        }
    }

    /// 409 pair_token_consumed is the race-condition signal: an
    /// attacker (or a second legitimate device) already deposited an
    /// ephemeral_pub. UI should regenerate the QR.
    #[test]
    fn pair_upload_surfaces_token_consumed() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(POST).path("/v1/users/u/devices/pair/upload");
            then.status(409).json_body(serde_json::json!({
                "error": {"code":"pair_token_consumed","message":"race"}
            }));
        });
        let err = pair_upload_ephemeral(&server.base_url(), "u", "x", "y").unwrap_err();
        match err {
            WireError::Wire { body, .. } => assert_eq!(body.code, "pair_token_consumed"),
            other => panic!("got {other:?}"),
        }
    }

    /// Existing device fetches the new device's ephemeral_pub via
    /// signed GET. Query-string carries pair_token.
    #[test]
    fn pair_ephemeral_round_trips() {
        let server = MockServer::start();
        let dk = generate_device_keys();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/v1/users/u/devices/pair/ephemeral")
                .query_param("pair_token", "tok")
                .header_exists("X-Sig");
            then.status(200)
                .json_body(serde_json::json!({"ephemeral_pub":"AAAA"}));
        });
        let r = pair_ephemeral(&server.base_url(), &dk, "u", "tok").unwrap();
        mock.assert();
        assert_eq!(r.ephemeral_pub, "AAAA");
    }

    /// Existing device's wrapped upload (signed POST) returns 204.
    #[test]
    fn pair_upload_wrapped_round_trips() {
        let server = MockServer::start();
        let dk = generate_device_keys();
        let mock = server.mock(|when, then| {
            when.method(POST)
                .path("/v1/users/u/devices/pair/wrapped")
                .header_exists("X-Sig");
            then.status(204);
        });
        pair_upload_wrapped(&server.base_url(), &dk, "u", "tok", "WRAPPED_B64").unwrap();
        mock.assert();
    }

    /// New device's wrapped fetch (unsigned GET).
    #[test]
    fn pair_fetch_wrapped_returns_envelope() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/v1/users/u/devices/pair/wrapped")
                .query_param("pair_token", "tok");
            then.status(200)
                .json_body(serde_json::json!({"wrapped":"YWdlMQo="}));
        });
        let r = pair_fetch_wrapped(&server.base_url(), "u", "tok").unwrap();
        mock.assert();
        assert_eq!(r.wrapped, "YWdlMQo=");
    }

    /// Finalize requires sas_confirmed: true. The relay's 400 surfaces
    /// as a Wire error if we somehow send false.
    #[test]
    fn pair_finalize_sends_sas_confirmed_true() {
        let server = MockServer::start();
        let dk = generate_device_keys();
        let mock = server.mock(|when, then| {
            when.method(POST)
                .path("/v1/users/u/devices/pair/finalize")
                .header_exists("X-Sig")
                .json_body_partial(r#"{"sas_confirmed":true}"#);
            then.status(204);
        });
        pair_finalize(
            &server.base_url(),
            &dk,
            "u",
            "tok",
            "DEV_PUB_B64",
            "new-device-uuid",
            "phone",
            "SIG_B64",
        )
        .unwrap();
        mock.assert();
    }

    /// Status poll: pending → ready transition. New device decodes
    /// the assigned (user_id, device_id) when status flips.
    #[test]
    fn pair_status_returns_pending_then_ready() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET)
                .path("/v1/users/u/devices/pair/status")
                .query_param("pair_token", "tok-pending");
            then.status(200).json_body(serde_json::json!({"status":"pending"}));
        });
        let r = pair_status(&server.base_url(), "u", "tok-pending").unwrap();
        assert_eq!(r.status, "pending");
        assert!(r.user_id.is_none());

        server.mock(|when, then| {
            when.method(GET)
                .path("/v1/users/u/devices/pair/status")
                .query_param("pair_token", "tok-ready");
            then.status(200).json_body(serde_json::json!({
                "status":"ready",
                "user_id":"u-final",
                "device_id":"d-final"
            }));
        });
        let r = pair_status(&server.base_url(), "u", "tok-ready").unwrap();
        assert_eq!(r.status, "ready");
        assert_eq!(r.user_id.as_deref(), Some("u-final"));
        assert_eq!(r.device_id.as_deref(), Some("d-final"));
    }

    /// 410 pair_token_expired on status poll signals the new device
    /// the token TTL elapsed before finalize.
    #[test]
    fn pair_status_surfaces_expired_token() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/v1/users/u/devices/pair/status");
            then.status(410).json_body(serde_json::json!({
                "error":{"code":"pair_token_expired","message":"gone"}
            }));
        });
        let err = pair_status(&server.base_url(), "u", "tok").unwrap_err();
        match err {
            WireError::Wire { status, body } => {
                assert_eq!(status, 410);
                assert_eq!(body.code, "pair_token_expired");
            }
            other => panic!("got {other:?}"),
        }
    }
}
