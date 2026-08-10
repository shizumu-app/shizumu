//! `GET /v1/users/<uid>/quota` — storage usage / cap / tier readout.
//!
//! Signed via §5.1 like the other user-scoped endpoints. The relay
//! reports `used` bytes (sum of synced attachment blob sizes for the
//! user), `cap` bytes (null for self-hosted / uncapped tiers), and a
//! short tier label the UI surfaces verbatim ("self_hosted",
//! "trail_keeper", etc.).
//!
//! Shape mirrors `devices::list_devices` — a one-shot signed GET that
//! parses a single JSON envelope. Header names match what
//! `signed_get_json` in `pair.rs` emits (`X-Device-Id`, `X-Timestamp`,
//! `X-Nonce`, `X-Sig`); the relay accepts either casing.

use crate::sync::keys::DeviceKeys;
use crate::sync::signing::sign_request;
use crate::sync::wire::{extract_wire_error, normalize_base_url, WireError};
use serde::Deserialize;
use std::time::Duration;

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct QuotaResponse {
    pub used: i64,
    pub cap: Option<i64>,
    pub tier: String,
}

/// Send a signed GET to read this user's storage quota. `cap=None`
/// when the relay is self-hosted / uncapped — callers render the
/// "infinity" branch in that case.
pub fn get_quota(
    base_url: &str,
    device_keys: &DeviceKeys,
    user_id: &str,
) -> Result<QuotaResponse, WireError> {
    let path = format!("/v1/users/{user_id}/quota");
    let headers = sign_request(device_keys, "GET", &path, b"");
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| WireError::Transport(e.to_string()))?;
    let req = client
        .get(format!("{}{path}", normalize_base_url(base_url)))
        .header("X-Device-Id", &headers.device_id)
        .header("X-Timestamp", &headers.timestamp)
        .header("X-Nonce", &headers.nonce)
        .header("X-Sig", &headers.signature);
    let resp = req.send().map_err(|e| WireError::Transport(e.to_string()))?;
    if resp.status().is_success() {
        return resp
            .json::<QuotaResponse>()
            .map_err(|e| WireError::Transport(format!("decode quota: {e}")));
    }
    Err(extract_wire_error(resp))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::keys::generate_device_keys;
    use httpmock::prelude::*;

    #[test]
    fn get_quota_parses_capped_response() {
        let server = MockServer::start();
        let dk = generate_device_keys();
        let m = server.mock(|when, then| {
            when.method(GET).path("/v1/users/u/quota");
            then.status(200).json_body(serde_json::json!({
                "used": 12345,
                "cap": 1073741824i64,
                "tier": "trail_keeper",
            }));
        });
        let q = get_quota(&server.base_url(), &dk, "u").unwrap();
        assert_eq!(q.used, 12345);
        assert_eq!(q.cap, Some(1073741824));
        assert_eq!(q.tier, "trail_keeper");
        m.assert();
    }

    #[test]
    fn get_quota_parses_uncapped_response() {
        let server = MockServer::start();
        let dk = generate_device_keys();
        server.mock(|when, then| {
            when.method(GET).path("/v1/users/u/quota");
            then.status(200).json_body(serde_json::json!({
                "used": 999,
                "cap": null,
                "tier": "self_hosted",
            }));
        });
        let q = get_quota(&server.base_url(), &dk, "u").unwrap();
        assert_eq!(q.used, 999);
        assert_eq!(q.cap, None);
        assert_eq!(q.tier, "self_hosted");
    }

    #[test]
    fn get_quota_maps_4xx_to_wire_error() {
        let server = MockServer::start();
        let dk = generate_device_keys();
        server.mock(|when, then| {
            when.method(GET).path("/v1/users/u/quota");
            then.status(401).json_body(serde_json::json!({
                "error": { "code": "unauthorized", "message": "bad sig" }
            }));
        });
        let err = get_quota(&server.base_url(), &dk, "u").unwrap_err();
        match err {
            WireError::Wire { status, body } => {
                assert_eq!(status, 401);
                assert_eq!(body.code, "unauthorized");
            }
            other => panic!("expected Wire(401), got {other:?}"),
        }
    }
}
