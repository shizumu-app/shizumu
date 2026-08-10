//! `DELETE /v1/users/<uid>/devices/<did>` — device revocation.
//!
//! Phase 14.22 surfaces the wire helper for revoking a paired device.
//! The relay implements this and responds with 204 No Content on
//! success; afterward, any signed request from that device returns
//! 401 device_revoked and the live channel's `closed` event lets the
//! revoked device's worker stop cleanly.
//!
//! The request is signed per §5.1 by the device performing the
//! revocation — typically the user's own device revoking a different
//! paired device. Self-revocation (a device revoking itself) is also
//! valid: the next signed call comes back 401 and the worker exits.

use crate::sync::keys::DeviceKeys;
use crate::sync::signing::sign_request;
use crate::sync::wire::{extract_wire_error, normalize_base_url, WireError};
use serde::Deserialize;
use std::time::Duration;

/// One row from `GET /v1/users/<uid>/devices` (spec §5.3). The
/// `revoked_at` field is non-null for devices the user revoked at
/// some prior point; the UI typically filters those out before
/// rendering.
#[derive(Debug, Clone, Deserialize, serde::Serialize)]
pub struct DeviceInfo {
    pub id: String,
    pub label: Option<String>,
    pub created_at: i64,
    pub revoked_at: Option<i64>,
    /// base64 X25519 kex pubkey, or None if not yet published (key rotation
    /// plan 1). The worker backfills its own device's key when this is None.
    #[serde(default)]
    pub device_kex_pub: Option<String>,
    /// base64 Ed25519 signing pubkey (key rotation plan 4/5: re-attestation).
    #[serde(default)]
    pub device_sign_pub: String,
}

#[derive(Debug, Deserialize)]
struct ListDevicesResponse {
    devices: Vec<DeviceInfo>,
}

/// Send a signed GET to list the user's devices. Returns the list
/// (including any revoked rows — callers can filter).
pub fn list_devices(
    base_url: &str,
    device_keys: &DeviceKeys,
    user_id: &str,
) -> Result<Vec<DeviceInfo>, WireError> {
    let path = format!("/v1/users/{user_id}/devices");
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
        let parsed: ListDevicesResponse = resp
            .json()
            .map_err(|e| WireError::Transport(format!("decode list_devices: {e}")))?;
        return Ok(parsed.devices);
    }
    Err(extract_wire_error(resp))
}

/// Send a signed DELETE to revoke the target device. Returns Ok on
/// 204; any other status maps to WireError.
pub fn revoke_device(
    base_url: &str,
    device_keys: &DeviceKeys,
    user_id: &str,
    target_device_id: &str,
) -> Result<(), WireError> {
    let path = format!("/v1/users/{user_id}/devices/{target_device_id}");
    // DELETE bodies are empty; we still pass an empty byte slice so
    // the signer's sha256_hex(body) lands on the canonical empty hash.
    let headers = sign_request(device_keys, "DELETE", &path, b"");
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| WireError::Transport(e.to_string()))?;
    let req = client
        .delete(format!("{}{path}", normalize_base_url(base_url)))
        .header("X-Device-Id", &headers.device_id)
        .header("X-Timestamp", &headers.timestamp)
        .header("X-Nonce", &headers.nonce)
        .header("X-Sig", &headers.signature);
    let resp = req.send().map_err(|e| WireError::Transport(e.to_string()))?;
    if resp.status().is_success() {
        return Ok(());
    }
    Err(extract_wire_error(resp))
}

/// Publish this device's X25519 kex pubkey to the relay (key rotation
/// plan 1 backfill). Signed PUT; the relay only fills a NULL, so this is
/// idempotent. `kex_pub_b64` is base64 of the 32-byte public key.
pub fn put_device_kex(
    base_url: &str,
    device_keys: &DeviceKeys,
    user_id: &str,
    device_id: &str,
    kex_pub_b64: &str,
) -> Result<(), WireError> {
    let path = format!("/v1/users/{user_id}/devices/{device_id}/kex");
    let body = serde_json::json!({ "device_kex_pub": kex_pub_b64 });
    let body_bytes = serde_json::to_vec(&body).expect("json serialize");
    let headers = sign_request(device_keys, "PUT", &path, &body_bytes);
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| WireError::Transport(e.to_string()))?;
    let req = client
        .put(format!("{}{path}", normalize_base_url(base_url)))
        .header("X-Device-Id", &headers.device_id)
        .header("X-Timestamp", &headers.timestamp)
        .header("X-Nonce", &headers.nonce)
        .header("X-Sig", &headers.signature)
        .header("Content-Type", "application/json")
        .body(body_bytes);
    let resp = req.send().map_err(|e| WireError::Transport(e.to_string()))?;
    if resp.status().is_success() {
        return Ok(());
    }
    Err(extract_wire_error(resp))
}

/// One-shot backfill driver (key rotation plan 1): list the account's
/// devices, and if THIS device's kex pubkey isn't published yet, publish it.
/// Returns Ok(true) if it published, Ok(false) if already present. The worker
/// calls this once per run so legacy/paired devices self-heal on first sync.
pub fn backfill_device_kex_if_needed(
    base_url: &str,
    device_keys: &DeviceKeys,
    user_id: &str,
) -> Result<bool, WireError> {
    let devices = list_devices(base_url, device_keys, user_id)?;
    let my_id = device_keys.device_id.to_string();
    let needs = devices
        .iter()
        .any(|d| d.id == my_id && d.device_kex_pub.is_none());
    if !needs {
        return Ok(false);
    }
    use base64::Engine;
    let kex_b64 = base64::engine::general_purpose::STANDARD.encode(device_keys.device_kex_pub_bytes());
    put_device_kex(base_url, device_keys, user_id, &my_id, &kex_b64)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::keys::generate_device_keys;
    use httpmock::prelude::*;

    #[test]
    fn revoke_device_204_returns_ok() {
        let server = MockServer::start();
        let dk = generate_device_keys();
        let m = server.mock(|when, then| {
            when.method(DELETE)
                .path("/v1/users/u/devices/peer-device");
            then.status(204);
        });
        let result = revoke_device(&server.base_url(), &dk, "u", "peer-device");
        assert!(result.is_ok());
        m.assert();
    }

    #[test]
    fn revoke_device_returns_wire_error_for_404() {
        let server = MockServer::start();
        let dk = generate_device_keys();
        server.mock(|when, then| {
            when.method(DELETE).path("/v1/users/u/devices/missing");
            then.status(404).json_body(serde_json::json!({
                "error": { "code": "not_found", "message": "no such device" }
            }));
        });
        let err = revoke_device(&server.base_url(), &dk, "u", "missing").unwrap_err();
        match err {
            WireError::Wire { status, body } => {
                assert_eq!(status, 404);
                assert_eq!(body.code, "not_found");
            }
            other => panic!("expected Wire(404), got {other:?}"),
        }
    }

    /// Phase 14.23: 429 with a Retry-After header maps to
    /// WireError::Throttled with the parsed Duration. The worker uses
    /// the hint to space out its next attempt.
    #[test]
    fn revoke_device_429_with_retry_after_returns_throttled() {
        let server = MockServer::start();
        let dk = generate_device_keys();
        server.mock(|when, then| {
            when.method(DELETE).path("/v1/users/u/devices/x");
            then.status(429).header("retry-after", "42");
        });
        let err = revoke_device(&server.base_url(), &dk, "u", "x").unwrap_err();
        match err {
            WireError::Throttled { retry_after } => {
                assert_eq!(retry_after, Some(std::time::Duration::from_secs(42)));
            }
            other => panic!("expected Throttled, got {other:?}"),
        }
    }

    /// 429 without a Retry-After header still maps to Throttled —
    /// just with `retry_after = None`, so the worker falls back to
    /// its exponential schedule.
    #[test]
    fn revoke_device_429_without_retry_after_returns_throttled_none() {
        let server = MockServer::start();
        let dk = generate_device_keys();
        server.mock(|when, then| {
            when.method(DELETE).path("/v1/users/u/devices/x");
            then.status(429);
        });
        let err = revoke_device(&server.base_url(), &dk, "u", "x").unwrap_err();
        assert!(matches!(err, WireError::Throttled { retry_after: None }));
    }

    #[test]
    fn backfill_publishes_when_own_kex_absent() {
        let server = MockServer::start();
        let dk = generate_device_keys();
        let my_id = dk.device_id.to_string();
        let list = server.mock(|when, then| {
            when.method(GET).path("/v1/users/u/devices");
            then.status(200).json_body(serde_json::json!({
                "devices": [
                    { "id": my_id, "label": null, "created_at": 1, "revoked_at": null, "device_kex_pub": null }
                ]
            }));
        });
        let put = server.mock(|when, then| {
            when.method(PUT).path(format!("/v1/users/u/devices/{my_id}/kex"));
            then.status(204);
        });
        assert!(backfill_device_kex_if_needed(&server.base_url(), &dk, "u").unwrap());
        list.assert();
        put.assert();
    }

    #[test]
    fn backfill_skips_when_own_kex_present() {
        let server = MockServer::start();
        let dk = generate_device_keys();
        let my_id = dk.device_id.to_string();
        server.mock(|when, then| {
            when.method(GET).path("/v1/users/u/devices");
            then.status(200).json_body(serde_json::json!({
                "devices": [
                    { "id": my_id, "label": null, "created_at": 1, "revoked_at": null, "device_kex_pub": "AAAA" }
                ]
            }));
        });
        let put_never = server.mock(|when, then| {
            when.method(PUT).path(format!("/v1/users/u/devices/{my_id}/kex"));
            then.status(204);
        });
        assert!(!backfill_device_kex_if_needed(&server.base_url(), &dk, "u").unwrap());
        put_never.assert_hits(0);
    }

    #[test]
    fn put_device_kex_204_with_signed_headers_and_body() {
        let server = MockServer::start();
        let dk = generate_device_keys();
        let m = server.mock(|when, then| {
            when.method(PUT)
                .path("/v1/users/u/devices/dev-1/kex")
                .header_exists("X-Device-Id")
                .header_exists("X-Sig")
                .json_body(serde_json::json!({ "device_kex_pub": "AAAA" }));
            then.status(204);
        });
        put_device_kex(&server.base_url(), &dk, "u", "dev-1", "AAAA").unwrap();
        m.assert();
    }

    #[test]
    fn revoke_device_passes_signed_headers() {
        let server = MockServer::start();
        let dk = generate_device_keys();
        let m = server.mock(|when, then| {
            when.method(DELETE)
                .path("/v1/users/u/devices/x")
                .header_exists("X-Device-Id")
                .header_exists("X-Timestamp")
                .header_exists("X-Nonce")
                .header_exists("X-Sig");
            then.status(204);
        });
        revoke_device(&server.base_url(), &dk, "u", "x").unwrap();
        m.assert();
    }
}
