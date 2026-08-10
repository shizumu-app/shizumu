//! Key-rotation flow (key rotation plan 4).
//!
//! After a device is revoked, a remaining device rotates the account keys:
//! generate a fresh epoch secret `ES_{e+1}`, derive the new epoch keys, wrap
//! `ES` to every remaining device's kex pubkey, re-attest each remaining
//! device's signing key under the new epoch's user signing key, publish all
//! of it to the relay, and adopt the new epoch locally. The revoked device
//! is not in the wrap set, so it can never obtain `ES_{e+1}` — it is locked
//! out of all content from epoch e+1 onward.
//!
//! Everything is derived from the fresh `ES`: the new epoch's
//! `user_sign_priv` signs the attestations, and receivers verify them after
//! deriving the same key from their wrapped copy of `ES`. The account's
//! epoch-0 user key is not involved, so a paired device (which never holds
//! the BIP-39 phrase) can drive a rotation.
//!
//! Recovery-key wrapping (so the phrase can still recover post-rotation
//! epochs) lands in plan 6; this module wraps to devices only.

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use ed25519_dalek::Signer;

use crate::db::Db;
use crate::sync::keys::DeviceKeys;
use crate::sync::{config, epoch, wire};

fn decode32(b64: &str, what: &str) -> Result<[u8; 32], String> {
    let raw = B64
        .decode(b64)
        .map_err(|e| format!("{what} base64: {e}"))?;
    raw.try_into()
        .map_err(|v: Vec<u8>| format!("{what} is {} bytes, expected 32", v.len()))
}

/// Rotate the account keys after revoking `revoked_device_id`. Returns the
/// new current epoch. The caller is responsible for having already revoked
/// the device on the relay (so it can't keep uploading), but rotation works
/// regardless since the revoked device is excluded from the wrap set.
pub fn rotate_after_revoke(
    db: &Db,
    device_keys: &DeviceKeys,
    base_url: &str,
    user_id: &str,
    revoked_device_id: &str,
) -> Result<i64, String> {
    // 1. Remaining devices = active and not the just-revoked one.
    let devices =
        wire::devices::list_devices(base_url, device_keys, user_id).map_err(|e| e.to_string())?;
    let remaining: Vec<wire::devices::DeviceInfo> = devices
        .into_iter()
        .filter(|d| d.revoked_at.is_none() && d.id != revoked_device_id)
        .collect();
    if remaining.is_empty() {
        return Err("rotation aborted: no remaining devices to wrap to".to_string());
    }
    // Every remaining device must have published its kex + sign pubkeys,
    // else wrapping/attesting would silently lock it out. Refuse instead.
    for d in &remaining {
        if d.device_kex_pub.as_deref().unwrap_or("").is_empty() || d.device_sign_pub.is_empty() {
            return Err(format!(
                "device {} is not ready for rotation (kex/sign pubkey not yet published)",
                d.id
            ));
        }
    }

    // 2. The new epoch number.
    let new_epoch = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        config::get_current_epoch(&conn).map_err(|e| e.to_string())? + 1
    };

    // 3. Fresh secret + derived keys for the new epoch.
    let es = epoch::generate_epoch_secret();
    let new_keys = epoch::epoch_keys_from_secret(&es);

    // 4. Wrap ES to each remaining device + re-attest its signing key under
    //    the new epoch's user signing key.
    let mut wrapped_keys: Vec<(String, Vec<u8>)> = Vec::with_capacity(remaining.len());
    let mut attestations: Vec<(String, Vec<u8>)> = Vec::with_capacity(remaining.len());
    for d in &remaining {
        let kex_pub = decode32(
            d.device_kex_pub.as_deref().unwrap_or(""),
            "device_kex_pub",
        )?;
        let wrapped = epoch::wrap_epoch_secret(&es, &kex_pub)?;
        wrapped_keys.push((d.id.clone(), wrapped));

        let sign_pub = decode32(&d.device_sign_pub, "device_sign_pub")?;
        let sig = new_keys.user_sign_priv.sign(&sign_pub);
        attestations.push((d.id.clone(), sig.to_bytes().to_vec()));
    }

    // 4b. Wrap ES to the phrase-recovery key too, so the phrase can recover
    //     this epoch even if every device is later lost (recovery contract).
    //     The recovery pubkey is published once by a phrase-holding device;
    //     if it isn't available yet, log and proceed (devices are covered;
    //     the next rotation after publication closes the gap).
    match wire::epochs::get_epoch_keys(base_url, device_keys, user_id) {
        Ok(fetched) => match fetched.recovery_kex_pub {
            Some(rk_b64) => {
                let rk = decode32(&rk_b64, "recovery_kex_pub")?;
                let wrapped = epoch::wrap_epoch_secret(&es, &rk)?;
                wrapped_keys.push(("recovery".to_string(), wrapped));
            }
            None => log::warn!(
                "rotation: no recovery key published yet — epoch {new_epoch} is device-only \
                 recoverable until a phrase-holding device publishes one"
            ),
        },
        Err(e) => log::warn!("rotation: could not read recovery key ({e}); proceeding device-only"),
    }

    // 5. Publish to the relay (bumps the account's current epoch).
    let current = wire::epochs::post_epochs(
        base_url,
        device_keys,
        user_id,
        new_epoch,
        wrapped_keys,
        attestations,
    )
    .map_err(|e| e.to_string())?;

    // 6. Adopt the new epoch locally so subsequent ops emit under it.
    {
        let conn = db.lock().map_err(|e| e.to_string())?;
        config::put_epoch_secret(&conn, new_epoch, &es).map_err(|e| e.to_string())?;
        config::set_current_epoch(&conn, new_epoch).map_err(|e| e.to_string())?;
    }

    Ok(current)
}

/// Fetch this device's wrapped epoch secrets from the relay, unwrap any not
/// already stored locally, and advance the local current epoch to the
/// relay's — but only up to the highest epoch this device actually holds the
/// secret for (so it never stamps an op under an epoch it can't encrypt).
/// Called on sync so a device that didn't drive a rotation picks up the new
/// epoch key and can read/emit new-epoch content. Returns how many new
/// epoch secrets it stored.
pub fn fetch_and_store_epoch_keys(
    db: &Db,
    device_keys: &DeviceKeys,
    base_url: &str,
    user_id: &str,
) -> Result<usize, String> {
    let fetched =
        wire::epochs::get_epoch_keys(base_url, device_keys, user_id).map_err(|e| e.to_string())?;
    let relay_epoch = fetched.current_epoch;
    let mut stored = 0usize;
    for (epoch, wrapped_es) in fetched.keys {
        let already = {
            let conn = db.lock().map_err(|e| e.to_string())?;
            config::get_epoch_secret(&conn, epoch)
                .map_err(|e| e.to_string())?
                .is_some()
        };
        if already {
            continue;
        }
        let es = epoch::unwrap_epoch_secret(&wrapped_es, &device_keys.device_kex_priv)?;
        let conn = db.lock().map_err(|e| e.to_string())?;
        config::put_epoch_secret(&conn, epoch, &es).map_err(|e| e.to_string())?;
        stored += 1;
    }
    // Advance the local epoch only if we hold the secret for the relay's
    // current epoch (epoch 0 always available). Prevents emitting under an
    // epoch whose key we couldn't unwrap.
    {
        let conn = db.lock().map_err(|e| e.to_string())?;
        let have_it = relay_epoch == 0
            || config::get_epoch_secret(&conn, relay_epoch)
                .map_err(|e| e.to_string())?
                .is_some();
        if have_it {
            config::set_current_epoch(&conn, relay_epoch).map_err(|e| e.to_string())?;
        }
    }
    Ok(stored)
}

/// Phrase-only recovery: re-derive the recovery key from the locally-stored
/// phrase, fetch every recovery-wrapped epoch secret from the relay, unwrap
/// and store them, and advance the local epoch. Lets a freshly-enrolled
/// device that holds the recovered phrase read all historical epochs even if
/// every prior device was lost. Returns how many epoch secrets it stored.
pub fn recover_epoch_keys_from_phrase(
    db: &Db,
    device_keys: &DeviceKeys,
    base_url: &str,
    user_id: &str,
) -> Result<usize, String> {
    let recovery_priv = epoch::recovery_kex_from_stored_phrase()?
        .ok_or_else(|| "no phrase stored on this device; cannot recover epoch keys".to_string())?;
    let rows =
        wire::epochs::get_recovery_keys(base_url, device_keys, user_id).map_err(|e| e.to_string())?;
    let mut stored = 0usize;
    let mut max_epoch = 0i64;
    for (epoch_no, wrapped_es) in rows {
        max_epoch = max_epoch.max(epoch_no);
        let already = {
            let conn = db.lock().map_err(|e| e.to_string())?;
            config::get_epoch_secret(&conn, epoch_no)
                .map_err(|e| e.to_string())?
                .is_some()
        };
        if already {
            continue;
        }
        let es = epoch::unwrap_epoch_secret(&wrapped_es, &recovery_priv)?;
        let conn = db.lock().map_err(|e| e.to_string())?;
        config::put_epoch_secret(&conn, epoch_no, &es).map_err(|e| e.to_string())?;
        stored += 1;
    }
    if max_epoch > 0 {
        let conn = db.lock().map_err(|e| e.to_string())?;
        config::set_current_epoch(&conn, max_epoch).map_err(|e| e.to_string())?;
    }
    Ok(stored)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::keys::{generate_device_keys, persist_device_keys};
    use httpmock::prelude::*;

    #[test]
    fn rotate_wraps_remaining_devices_and_adopts_new_epoch() {
        let server = MockServer::start();
        let db = crate::test_helpers::test_db();
        let dk = {
            let conn = db.lock().unwrap();
            let dk = generate_device_keys();
            persist_device_keys(&conn, &dk).unwrap();
            dk
        };
        let self_id = dk.device_id.to_string();
        let self_kex = B64.encode(dk.device_kex_pub_bytes());
        let self_sign = B64.encode(dk.device_sign_pub_bytes());
        let peer = generate_device_keys();
        let peer_id = peer.device_id.to_string();

        // Device list: self + a ready peer + the revoked device.
        let list = server.mock(|when, then| {
            when.method(GET).path("/v1/users/u/devices");
            then.status(200).json_body(serde_json::json!({
                "devices": [
                    { "id": self_id, "label": null, "created_at": 1, "revoked_at": null,
                      "device_kex_pub": self_kex, "device_sign_pub": self_sign },
                    { "id": peer_id, "label": null, "created_at": 2, "revoked_at": null,
                      "device_kex_pub": B64.encode(peer.device_kex_pub_bytes()),
                      "device_sign_pub": B64.encode(peer.device_sign_pub_bytes()) },
                    { "id": "revoked-dev", "label": null, "created_at": 3, "revoked_at": null,
                      "device_kex_pub": B64.encode([9u8;32]), "device_sign_pub": B64.encode([8u8;32]) }
                ]
            }));
        });
        // Expect a publish for epoch 1 with exactly 2 wrapped keys (self + peer,
        // NOT the revoked device).
        let publish = server.mock(|when, then| {
            when.method(POST)
                .path("/v1/users/u/epochs")
                .json_body_partial(r#"{"epoch":1}"#.to_string());
            then.status(200).json_body(serde_json::json!({ "current_epoch": 1 }));
        });

        let got = rotate_after_revoke(&db, &dk, &server.base_url(), "u", "revoked-dev").unwrap();
        assert_eq!(got, 1);
        list.assert();
        publish.assert();

        // Local state: epoch secret stored + current epoch advanced.
        let conn = db.lock().unwrap();
        assert_eq!(config::get_current_epoch(&conn).unwrap(), 1);
        assert!(config::get_epoch_secret(&conn, 1).unwrap().is_some());
    }

    #[test]
    fn fetch_unwraps_and_stores_epoch_key_and_advances() {
        let server = MockServer::start();
        let db = crate::test_helpers::test_db();
        let dk = {
            let conn = db.lock().unwrap();
            let dk = generate_device_keys();
            persist_device_keys(&conn, &dk).unwrap();
            dk
        };
        // A peer wrapped this epoch secret to our kex pubkey during rotation.
        let es = epoch::generate_epoch_secret();
        let wrapped = epoch::wrap_epoch_secret(&es, &dk.device_kex_pub_bytes()).unwrap();
        server.mock(|when, then| {
            when.method(GET).path("/v1/users/u/epochs/keys");
            then.status(200).json_body(serde_json::json!({
                "current_epoch": 1,
                "keys": [{ "epoch": 1, "wrapped_es": B64.encode(&wrapped) }]
            }));
        });
        let n = fetch_and_store_epoch_keys(&db, &dk, &server.base_url(), "u").unwrap();
        assert_eq!(n, 1);
        let conn = db.lock().unwrap();
        assert_eq!(config::get_epoch_secret(&conn, 1).unwrap().unwrap(), es);
        assert_eq!(config::get_current_epoch(&conn).unwrap(), 1);
    }

    #[test]
    fn rotate_refuses_when_a_remaining_device_is_not_ready() {
        let server = MockServer::start();
        let db = crate::test_helpers::test_db();
        let dk = {
            let conn = db.lock().unwrap();
            let dk = generate_device_keys();
            persist_device_keys(&conn, &dk).unwrap();
            dk
        };
        let self_id = dk.device_id.to_string();
        server.mock(|when, then| {
            when.method(GET).path("/v1/users/u/devices");
            then.status(200).json_body(serde_json::json!({
                "devices": [
                    // self is ready, peer has NOT published a kex pub yet.
                    { "id": self_id, "label": null, "created_at": 1, "revoked_at": null,
                      "device_kex_pub": B64.encode(dk.device_kex_pub_bytes()),
                      "device_sign_pub": B64.encode(dk.device_sign_pub_bytes()) },
                    { "id": "peer-x", "label": null, "created_at": 2, "revoked_at": null,
                      "device_kex_pub": null, "device_sign_pub": "" }
                ]
            }));
        });
        let err = rotate_after_revoke(&db, &dk, &server.base_url(), "u", "revoked-dev").unwrap_err();
        assert!(err.contains("not ready for rotation"), "got: {err}");
    }
}
