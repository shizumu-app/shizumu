//! `POST /v1/account/email` and `GET /v1/account/email-status` — web-access
//! account email management.
//!
//! Both endpoints are device-signed via §5.1. The path has no `:uid` segment;
//! the relay identifies the caller via the Ed25519 signature headers alone.
//!
//! Error codes from the relay:
//!   `bad_email`         — not a valid email address
//!   `bad_password`      — password too short (< 8 chars)
//!   `email_unavailable` — address already registered (409)
//!   `mail_failed`       — relay could not send the verification email (502)

use crate::sync::keys::DeviceKeys;
use crate::sync::signing::sign_request;
use crate::sync::wire::{extract_wire_error, normalize_base_url, WireError};
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Shape returned by `GET /v1/account/email-status`.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct EmailStatus {
    pub email: Option<String>,
    pub verified: bool,
}

/// `POST /v1/account/email` — register or update the email/password for web
/// access. Returns `Ok(())` on 202; maps relay error codes to a string the
/// command layer surfaces verbatim to the frontend.
pub fn set_email(
    relay_url: &str,
    device_keys: &DeviceKeys,
    email: &str,
    password: &str,
) -> Result<(), WireError> {
    let path = "/v1/account/email";
    let body_bytes = serde_json::to_vec(&serde_json::json!({ "email": email, "password": password }))
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

/// `GET /v1/account/email-status` — fetch the email address and verification
/// status for this account.
pub fn email_status(relay_url: &str, device_keys: &DeviceKeys) -> Result<EmailStatus, WireError> {
    let path = "/v1/account/email-status";
    let headers = sign_request(device_keys, "GET", path, b"");
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| WireError::Transport(e.to_string()))?;
    let resp = client
        .get(format!("{}{path}", normalize_base_url(relay_url)))
        .header("X-Device-Id", &headers.device_id)
        .header("X-Timestamp", &headers.timestamp)
        .header("X-Nonce", &headers.nonce)
        .header("X-Sig", &headers.signature)
        .send()
        .map_err(|e| WireError::Transport(e.to_string()))?;
    if resp.status().is_success() {
        return resp
            .json::<EmailStatus>()
            .map_err(|e| WireError::Transport(format!("decode email-status: {e}")));
    }
    Err(extract_wire_error(resp))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::keys::generate_device_keys;
    use httpmock::prelude::*;

    #[test]
    fn set_email_returns_ok_on_202() {
        let server = MockServer::start();
        let dk = generate_device_keys();
        let m = server.mock(|when, then| {
            when.method(POST).path("/v1/account/email");
            then.status(202);
        });
        set_email(&server.base_url(), &dk, "a@b.com", "hunter2!").unwrap();
        m.assert();
    }

    #[test]
    fn set_email_maps_error_envelope() {
        let server = MockServer::start();
        let dk = generate_device_keys();
        server.mock(|when, then| {
            when.method(POST).path("/v1/account/email");
            then.status(409).json_body(serde_json::json!({
                "error": { "code": "email_unavailable", "message": "taken" }
            }));
        });
        let err = set_email(&server.base_url(), &dk, "a@b.com", "hunter2!").unwrap_err();
        match err {
            WireError::Wire { status, body } => {
                assert_eq!(status, 409);
                assert_eq!(body.code, "email_unavailable");
            }
            other => panic!("expected Wire(409), got {other:?}"),
        }
    }

    #[test]
    fn email_status_parses_response() {
        let server = MockServer::start();
        let dk = generate_device_keys();
        let m = server.mock(|when, then| {
            when.method(GET).path("/v1/account/email-status");
            then.status(200).json_body(serde_json::json!({
                "email": "a@b.com",
                "verified": true,
            }));
        });
        let s = email_status(&server.base_url(), &dk).unwrap();
        assert_eq!(s.email.as_deref(), Some("a@b.com"));
        assert!(s.verified);
        m.assert();
    }

    #[test]
    fn email_status_parses_null_email() {
        let server = MockServer::start();
        let dk = generate_device_keys();
        server.mock(|when, then| {
            when.method(GET).path("/v1/account/email-status");
            then.status(200).json_body(serde_json::json!({
                "email": null,
                "verified": false,
            }));
        });
        let s = email_status(&server.base_url(), &dk).unwrap();
        assert!(s.email.is_none());
        assert!(!s.verified);
    }
}
