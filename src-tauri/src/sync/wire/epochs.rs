//! `POST /v1/users/<uid>/epochs` — publish a rotation (key rotation plan 4).
//!
//! After a device is revoked, a remaining device generates a new epoch
//! secret, wraps it to every remaining device (and the recovery key), and
//! re-attests each remaining device's signing key under the new epoch's
//! user signing key. This call ships the wrapped secrets + attestations to
//! the relay (which stores them opaquely) and bumps the account's current
//! epoch. The relay never sees the epoch secret in the clear.

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::sync::keys::DeviceKeys;
use crate::sync::signing::sign_request;
use crate::sync::wire::{extract_wire_error, normalize_base_url, WireError};

#[derive(Debug, Serialize)]
struct WrappedKeyDto {
    recipient_id: String,
    wrapped_es: String,
}

#[derive(Debug, Serialize)]
struct AttestationDto {
    device_id: String,
    authorized_sig: String,
}

#[derive(Debug, Serialize)]
struct PublishEpochRequest {
    epoch: i64,
    wrapped_keys: Vec<WrappedKeyDto>,
    attestations: Vec<AttestationDto>,
}

#[derive(Debug, Deserialize)]
struct PublishEpochResponse {
    current_epoch: i64,
}

/// Publish a new epoch. `wrapped_keys` maps recipient_id (a device UUID, or
/// the literal "recovery") to the raw age-wrapped epoch secret; `attestations`
/// maps device_id to the raw Ed25519 signature over that device's signing
/// pubkey under the new epoch's user signing key. Returns the relay's
/// post-update current_epoch.
pub fn post_epochs(
    base_url: &str,
    device_keys: &DeviceKeys,
    user_id: &str,
    epoch: i64,
    wrapped_keys: Vec<(String, Vec<u8>)>,
    attestations: Vec<(String, Vec<u8>)>,
) -> Result<i64, WireError> {
    let body = PublishEpochRequest {
        epoch,
        wrapped_keys: wrapped_keys
            .into_iter()
            .map(|(recipient_id, es)| WrappedKeyDto {
                recipient_id,
                wrapped_es: B64.encode(es),
            })
            .collect(),
        attestations: attestations
            .into_iter()
            .map(|(device_id, sig)| AttestationDto {
                device_id,
                authorized_sig: B64.encode(sig),
            })
            .collect(),
    };
    let body_bytes = serde_json::to_vec(&body).expect("PublishEpochRequest serializes");

    let path = format!("/v1/users/{user_id}/epochs");
    let headers = sign_request(device_keys, "POST", &path, &body_bytes);
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| WireError::Transport(e.to_string()))?;
    let resp = client
        .post(format!("{}{path}", normalize_base_url(base_url)))
        .header("X-Device-Id", &headers.device_id)
        .header("X-Timestamp", &headers.timestamp)
        .header("X-Nonce", &headers.nonce)
        .header("X-Sig", &headers.signature)
        .header("Content-Type", "application/json")
        .body(body_bytes)
        .send()
        .map_err(|e| WireError::Transport(e.to_string()))?;
    if resp.status().is_success() {
        let parsed: PublishEpochResponse = resp
            .json()
            .map_err(|e| WireError::Transport(format!("decode post_epochs: {e}")))?;
        return Ok(parsed.current_epoch);
    }
    Err(extract_wire_error(resp))
}

#[derive(Debug, Deserialize)]
struct WrappedKeyRow {
    epoch: i64,
    wrapped_es: String,
}

#[derive(Debug, Deserialize)]
struct EpochKeysResponse {
    current_epoch: i64,
    #[serde(default)]
    recovery_kex_pub: Option<String>,
    #[serde(default)]
    keys: Vec<WrappedKeyRow>,
}

/// This device's wrapped epoch secrets + the account's current epoch and
/// (if published) the phrase-recovery pubkey. Decoded form of
/// `GET /epochs/keys`.
pub struct FetchedEpochKeys {
    pub current_epoch: i64,
    /// base64 recovery X25519 pubkey, if a phrase-holding device published
    /// it. A rotating device wraps the new epoch secret to this too.
    pub recovery_kex_pub: Option<String>,
    pub keys: Vec<(i64, Vec<u8>)>,
}

fn decode_wrapped_rows(rows: Vec<WrappedKeyRow>) -> Result<Vec<(i64, Vec<u8>)>, WireError> {
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let bytes = B64
            .decode(&row.wrapped_es)
            .map_err(|e| WireError::Transport(format!("wrapped_es base64: {e}")))?;
        out.push((row.epoch, bytes));
    }
    Ok(out)
}

/// Fetch this device's wrapped epoch secrets (`GET /epochs/keys`). The caller
/// unwraps each `wrapped_es` with its device kex private key.
pub fn get_epoch_keys(
    base_url: &str,
    device_keys: &DeviceKeys,
    user_id: &str,
) -> Result<FetchedEpochKeys, WireError> {
    let path = format!("/v1/users/{user_id}/epochs/keys");
    let headers = sign_request(device_keys, "GET", &path, b"");
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| WireError::Transport(e.to_string()))?;
    let resp = client
        .get(format!("{}{path}", normalize_base_url(base_url)))
        .header("X-Device-Id", &headers.device_id)
        .header("X-Timestamp", &headers.timestamp)
        .header("X-Nonce", &headers.nonce)
        .header("X-Sig", &headers.signature)
        .send()
        .map_err(|e| WireError::Transport(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(extract_wire_error(resp));
    }
    let parsed: EpochKeysResponse = resp
        .json()
        .map_err(|e| WireError::Transport(format!("decode get_epoch_keys: {e}")))?;
    Ok(FetchedEpochKeys {
        current_epoch: parsed.current_epoch,
        recovery_kex_pub: parsed.recovery_kex_pub,
        keys: decode_wrapped_rows(parsed.keys)?,
    })
}

/// Publish this account's phrase-recovery X25519 pubkey
/// (`PUT /epochs/recovery-key`). Idempotent (relay fills NULL only); called
/// once by a device that holds the BIP-39 phrase. `recovery_kex_pub_b64` is
/// base64 of the 32-byte public key.
pub fn put_recovery_key(
    base_url: &str,
    device_keys: &DeviceKeys,
    user_id: &str,
    recovery_kex_pub_b64: &str,
) -> Result<(), WireError> {
    let path = format!("/v1/users/{user_id}/recovery-key");
    let body = serde_json::json!({ "recovery_kex_pub": recovery_kex_pub_b64 });
    let body_bytes = serde_json::to_vec(&body).expect("json serialize");
    let headers = sign_request(device_keys, "PUT", &path, &body_bytes);
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| WireError::Transport(e.to_string()))?;
    let resp = client
        .put(format!("{}{path}", normalize_base_url(base_url)))
        .header("X-Device-Id", &headers.device_id)
        .header("X-Timestamp", &headers.timestamp)
        .header("X-Nonce", &headers.nonce)
        .header("X-Sig", &headers.signature)
        .header("Content-Type", "application/json")
        .body(body_bytes)
        .send()
        .map_err(|e| WireError::Transport(e.to_string()))?;
    if resp.status().is_success() {
        return Ok(());
    }
    Err(extract_wire_error(resp))
}

/// Fetch the recovery-wrapped epoch secrets (`GET /epochs/recovery-keys`).
/// Returns `[(epoch, wrapped_es_bytes)]` sealed to the recovery key; the
/// caller unwraps them with the phrase-derived recovery private key during a
/// phrase-only restore.
pub fn get_recovery_keys(
    base_url: &str,
    device_keys: &DeviceKeys,
    user_id: &str,
) -> Result<Vec<(i64, Vec<u8>)>, WireError> {
    let path = format!("/v1/users/{user_id}/epochs/recovery-keys");
    let headers = sign_request(device_keys, "GET", &path, b"");
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| WireError::Transport(e.to_string()))?;
    let resp = client
        .get(format!("{}{path}", normalize_base_url(base_url)))
        .header("X-Device-Id", &headers.device_id)
        .header("X-Timestamp", &headers.timestamp)
        .header("X-Nonce", &headers.nonce)
        .header("X-Sig", &headers.signature)
        .send()
        .map_err(|e| WireError::Transport(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(extract_wire_error(resp));
    }
    #[derive(Deserialize)]
    struct Resp {
        #[serde(default)]
        keys: Vec<WrappedKeyRow>,
    }
    let parsed: Resp = resp
        .json()
        .map_err(|e| WireError::Transport(format!("decode get_recovery_keys: {e}")))?;
    decode_wrapped_rows(parsed.keys)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::keys::generate_device_keys;
    use httpmock::prelude::*;

    #[test]
    fn post_epochs_sends_signed_body_and_returns_current_epoch() {
        let server = MockServer::start();
        let dk = generate_device_keys();
        let m = server.mock(|when, then| {
            when.method(POST)
                .path("/v1/users/u/epochs")
                .header_exists("X-Device-Id")
                .header_exists("X-Sig")
                .json_body_partial(r#"{"epoch":1}"#.to_string());
            then.status(200).json_body(serde_json::json!({ "current_epoch": 1 }));
        });
        let got = post_epochs(
            &server.base_url(),
            &dk,
            "u",
            1,
            vec![("dev-a".into(), vec![1, 2, 3])],
            vec![("dev-a".into(), vec![4, 5, 6])],
        )
        .unwrap();
        assert_eq!(got, 1);
        m.assert();
    }

    #[test]
    fn get_epoch_keys_parses_recovery_pub_and_rows() {
        let server = MockServer::start();
        let dk = generate_device_keys();
        server.mock(|when, then| {
            when.method(GET).path("/v1/users/u/epochs/keys");
            then.status(200).json_body(serde_json::json!({
                "current_epoch": 2,
                "recovery_kex_pub": "UkVDT1ZFUlk",
                "keys": [{ "epoch": 2, "wrapped_es": B64.encode([9u8; 40]) }]
            }));
        });
        let got = get_epoch_keys(&server.base_url(), &dk, "u").unwrap();
        assert_eq!(got.current_epoch, 2);
        assert_eq!(got.recovery_kex_pub.as_deref(), Some("UkVDT1ZFUlk"));
        assert_eq!(got.keys.len(), 1);
        assert_eq!(got.keys[0].0, 2);
    }

    #[test]
    fn put_recovery_key_204() {
        let server = MockServer::start();
        let dk = generate_device_keys();
        let m = server.mock(|when, then| {
            when.method(PUT)
                .path("/v1/users/u/recovery-key")
                .header_exists("X-Sig")
                .json_body(serde_json::json!({ "recovery_kex_pub": "AAAA" }));
            then.status(204);
        });
        put_recovery_key(&server.base_url(), &dk, "u", "AAAA").unwrap();
        m.assert();
    }

    #[test]
    fn get_recovery_keys_decodes_rows() {
        let server = MockServer::start();
        let dk = generate_device_keys();
        server.mock(|when, then| {
            when.method(GET).path("/v1/users/u/epochs/recovery-keys");
            then.status(200).json_body(serde_json::json!({
                "keys": [
                    { "epoch": 1, "wrapped_es": B64.encode([1u8; 30]) },
                    { "epoch": 2, "wrapped_es": B64.encode([2u8; 30]) }
                ]
            }));
        });
        let rows = get_recovery_keys(&server.base_url(), &dk, "u").unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].0, 1);
        assert_eq!(rows[1].0, 2);
    }

    #[test]
    fn post_epochs_surfaces_wire_error() {
        let server = MockServer::start();
        let dk = generate_device_keys();
        server.mock(|when, then| {
            when.method(POST).path("/v1/users/u/epochs");
            then.status(400).json_body(serde_json::json!({
                "error": { "code": "epoch_invalid", "message": "epoch must be > 0" }
            }));
        });
        let err = post_epochs(&server.base_url(), &dk, "u", 0, vec![], vec![]).unwrap_err();
        match err {
            WireError::Wire { status, body } => {
                assert_eq!(status, 400);
                assert_eq!(body.code, "epoch_invalid");
            }
            other => panic!("expected Wire(400), got {other:?}"),
        }
    }
}
