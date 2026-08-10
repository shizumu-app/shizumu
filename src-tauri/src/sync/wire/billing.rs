//! `POST /v1/billing/redeem` — license key redemption.
//!
//! The endpoint is device-signed via §5.1. The relay identifies the caller
//! via the Ed25519 signature headers alone.
//!
//! Error codes from the relay:
//!   `unknown_key`   — key does not exist (404)
//!   `already_bound` — key is already bound to another account (409)
//!   `inactive`      — key exists but is not active / subscription lapsed (403)
//!   `bad_body`      — malformed request body (400)

use crate::sync::keys::DeviceKeys;
use crate::sync::signing::sign_request;
use crate::sync::wire::{extract_wire_error, normalize_base_url, WireError};
use std::time::Duration;

/// `POST /v1/billing/redeem` — redeem a license key for the calling device's
/// account. Returns `Ok(())` on 200; maps relay error codes to a string the
/// command layer surfaces verbatim to the frontend.
pub fn redeem(
    relay_url: &str,
    device_keys: &DeviceKeys,
    license_key: &str,
) -> Result<(), WireError> {
    let path = "/v1/billing/redeem";
    let body_bytes =
        serde_json::to_vec(&serde_json::json!({ "license_key": license_key }))
            .map_err(|e| WireError::BadResponse(format!("serialize body: {e}")))?;
    let headers = sign_request(device_keys, "POST", path, &body_bytes);
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| WireError::Transport(e.to_string()))?;
    let resp = client
        .post(format!("{}{path}", normalize_base_url(relay_url)))
        .header("Content-Type", "application/json")
        .header("X-Device-Id", &headers.device_id)
        .header("X-Timestamp", &headers.timestamp)
        .header("X-Nonce", &headers.nonce)
        .header("X-Sig", &headers.signature)
        .body(body_bytes)
        .send()
        .map_err(|e| WireError::Transport(e.to_string()))?;
    if resp.status().is_success() {
        return Ok(());
    }
    Err(extract_wire_error(resp))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::keys::generate_device_keys;
    use httpmock::prelude::*;

    #[test]
    fn redeem_returns_ok_on_200() {
        let server = MockServer::start();
        let dk = generate_device_keys();
        let m = server.mock(|when, then| {
            when.method(POST).path("/v1/billing/redeem");
            then.status(200);
        });
        redeem(&server.base_url(), &dk, "TEST-KEY-1234").unwrap();
        m.assert();
    }

    #[test]
    fn redeem_maps_unknown_key() {
        let server = MockServer::start();
        let dk = generate_device_keys();
        server.mock(|when, then| {
            when.method(POST).path("/v1/billing/redeem");
            then.status(404).json_body(serde_json::json!({
                "error": { "code": "unknown_key", "message": "key not found" }
            }));
        });
        let err = redeem(&server.base_url(), &dk, "BAD-KEY").unwrap_err();
        match err {
            WireError::Wire { status, body } => {
                assert_eq!(status, 404);
                assert_eq!(body.code, "unknown_key");
            }
            other => panic!("expected Wire(404), got {other:?}"),
        }
    }

    #[test]
    fn redeem_maps_already_bound() {
        let server = MockServer::start();
        let dk = generate_device_keys();
        server.mock(|when, then| {
            when.method(POST).path("/v1/billing/redeem");
            then.status(409).json_body(serde_json::json!({
                "error": { "code": "already_bound", "message": "key already in use" }
            }));
        });
        let err = redeem(&server.base_url(), &dk, "BOUND-KEY").unwrap_err();
        match err {
            WireError::Wire { status, body } => {
                assert_eq!(status, 409);
                assert_eq!(body.code, "already_bound");
            }
            other => panic!("expected Wire(409), got {other:?}"),
        }
    }

    #[test]
    fn redeem_maps_inactive() {
        let server = MockServer::start();
        let dk = generate_device_keys();
        server.mock(|when, then| {
            when.method(POST).path("/v1/billing/redeem");
            then.status(403).json_body(serde_json::json!({
                "error": { "code": "inactive", "message": "subscription not active" }
            }));
        });
        let err = redeem(&server.base_url(), &dk, "LAPSED-KEY").unwrap_err();
        match err {
            WireError::Wire { status, body } => {
                assert_eq!(status, 403);
                assert_eq!(body.code, "inactive");
            }
            other => panic!("expected Wire(403), got {other:?}"),
        }
    }
}
