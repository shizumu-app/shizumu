//! Key-rotation epoch crypto (key rotation plan 2).
//!
//! An epoch secret `ES_e` (32 random bytes, NOT phrase-derived) seeds the
//! rotated keys for epoch e >= 1: `content_master_key`, `meta_key`, and
//! `user_sign_priv`. Epoch 0 keeps the existing phrase-derived keys (see
//! `keys.rs`), so existing data stays readable.
//!
//! `ES_e` is distributed by sealing it (age / X25519) to every entitled
//! device's kex pubkey AND to a phrase-derived recovery key, so the phrase
//! alone can still recover every epoch even after all devices are lost.
//! This module is pure crypto: no storage, no wire, no op changes (those
//! land in later rotation plans).

use std::io::{Read, Write};

use bech32::ToBase32;
use ed25519_dalek::SigningKey;
use hkdf::Hkdf;
use rand_core::{OsRng, RngCore};
use sha2::Sha256;
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::Zeroize;

use rusqlite::Connection;

use super::config;
use super::keys::{SecretKey32, UserKeys};

// Domain-separated HKDF info tags for epoch-secret derivation. Distinct
// from the phrase-seed tags in `keys.rs` so the ES-derived and seed-derived
// keys can never collide.
const INFO_EPOCH_CONTENT: &[u8] = b"shizumu.epoch.content_master.v1";
const INFO_EPOCH_META: &[u8] = b"shizumu.epoch.meta_key.v1";
const INFO_EPOCH_SIGN: &[u8] = b"shizumu.epoch.user_sign.v1";
// Phrase-derived recovery kex key — wrap recipient #2 for every epoch
// secret, so the phrase recovers all epochs.
const INFO_RECOVERY_KEX: &[u8] = b"shizumu.recovery_kex.v1";

/// The three rotated keys for one epoch. All three zeroize on drop
/// (`SecretKey32` and ed25519 `SigningKey` with the `zeroize` feature).
pub struct EpochKeys {
    pub content_master_key: SecretKey32,
    pub meta_key: SecretKey32,
    pub user_sign_priv: SigningKey,
}

/// Generate a fresh random epoch secret (`ES_e`). The caller seals it to
/// the entitled recipients; it is never stored in the clear on the relay.
pub fn generate_epoch_secret() -> [u8; 32] {
    let mut es = [0u8; 32];
    OsRng.fill_bytes(&mut es);
    es
}

/// Derive the epoch keys from an epoch secret (epoch e >= 1).
pub fn epoch_keys_from_secret(es: &[u8; 32]) -> EpochKeys {
    let hk = Hkdf::<Sha256>::new(None, es);

    let mut content = [0u8; 32];
    hk.expand(INFO_EPOCH_CONTENT, &mut content).expect("hkdf expand");
    let content_master_key = SecretKey32::from_bytes(content);
    content.zeroize();

    let mut meta = [0u8; 32];
    hk.expand(INFO_EPOCH_META, &mut meta).expect("hkdf expand");
    let meta_key = SecretKey32::from_bytes(meta);
    meta.zeroize();

    let mut sign_seed = [0u8; 32];
    hk.expand(INFO_EPOCH_SIGN, &mut sign_seed).expect("hkdf expand");
    let user_sign_priv = SigningKey::from_bytes(&sign_seed);
    sign_seed.zeroize();

    EpochKeys {
        content_master_key,
        meta_key,
        user_sign_priv,
    }
}

/// Derive the phrase-recovery X25519 secret from the BIP-39 seed
/// (`Mnemonic::to_seed("")`). Its public half is a wrap recipient for every
/// epoch secret, so the phrase can unwrap all epochs after total device loss.
pub fn recovery_kex_from_seed(seed: &[u8]) -> StaticSecret {
    let hk = Hkdf::<Sha256>::new(None, seed);
    let mut kseed = [0u8; 32];
    hk.expand(INFO_RECOVERY_KEX, &mut kseed).expect("hkdf expand");
    let k = StaticSecret::from(kseed);
    kseed.zeroize();
    k
}

/// The phrase-recovery X25519 public key bytes.
pub fn recovery_kex_pub_from_seed(seed: &[u8]) -> [u8; 32] {
    PublicKey::from(&recovery_kex_from_seed(seed)).to_bytes()
}

/// Derive the recovery X25519 secret from the locally-stored BIP-39 phrase.
/// Present only on a device that holds the phrase (the primary device, or a
/// device recovering from the phrase). Returns `Ok(None)` when no phrase is
/// stored (e.g. a paired device — it relies on a phrase-holding device to
/// publish the recovery pubkey).
pub fn recovery_kex_from_stored_phrase() -> Result<Option<StaticSecret>, String> {
    let Some(stored) = super::secret_store::load().map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let Some(phrase) = stored.phrase.as_deref() else {
        return Ok(None);
    };
    let m = bip39::Mnemonic::parse_normalized(phrase)
        .map_err(|e| format!("stored phrase is invalid: {e}"))?;
    Ok(Some(recovery_kex_from_seed(&m.to_seed(""))))
}

/// The recovery X25519 public key derived from the locally-stored phrase, or
/// `None` if no phrase is stored on this device.
pub fn recovery_kex_pub_from_stored_phrase() -> Result<Option<[u8; 32]>, String> {
    Ok(recovery_kex_from_stored_phrase()?.map(|k| PublicKey::from(&k).to_bytes()))
}

/// Seal an epoch secret to an X25519 recipient pubkey (age). Recipient is a
/// device kex pubkey or the recovery pubkey.
pub fn wrap_epoch_secret(es: &[u8; 32], recipient_pub: &[u8; 32]) -> Result<Vec<u8>, String> {
    let recipient_str =
        bech32::encode("age", recipient_pub.to_base32(), bech32::Variant::Bech32)
            .map_err(|e| format!("bech32 recipient encode: {e}"))?;
    let recipient: age::x25519::Recipient = recipient_str
        .parse()
        .map_err(|e: &'static str| format!("recipient parse: {e}"))?;
    let encryptor = age::Encryptor::with_recipients(vec![Box::new(recipient)])
        .ok_or_else(|| "age::Encryptor returned None".to_string())?;

    let mut out = Vec::new();
    let mut w = encryptor
        .wrap_output(&mut out)
        .map_err(|e| format!("age wrap setup: {e}"))?;
    w.write_all(es).map_err(|e| format!("age write: {e}"))?;
    w.finish().map_err(|e| format!("age finish: {e}"))?;
    Ok(out)
}

/// Unwrap an epoch secret with the recipient's X25519 private key.
pub fn unwrap_epoch_secret(
    wrapped: &[u8],
    recipient_priv: &StaticSecret,
) -> Result<[u8; 32], String> {
    let secret_bytes = recipient_priv.to_bytes();
    let identity_str = bech32::encode(
        "AGE-SECRET-KEY-",
        secret_bytes.to_base32(),
        bech32::Variant::Bech32,
    )
    .map_err(|e| format!("bech32 identity encode: {e}"))?
    .to_uppercase();
    let identity: age::x25519::Identity = identity_str
        .parse()
        .map_err(|e: &'static str| format!("identity parse: {e}"))?;

    let decryptor = match age::Decryptor::new(wrapped) {
        Ok(age::Decryptor::Recipients(d)) => d,
        Ok(age::Decryptor::Passphrase(_)) => {
            return Err("epoch secret is passphrase-encrypted, not x25519".to_string());
        }
        Err(e) => return Err(format!("age decryptor setup: {e}")),
    };
    let identities: Vec<Box<dyn age::Identity>> = vec![Box::new(identity)];
    let mut reader = decryptor
        .decrypt(identities.iter().map(|b| b.as_ref()))
        .map_err(|e| format!("age decrypt: {e}"))?;
    let mut pt = Vec::new();
    reader
        .read_to_end(&mut pt)
        .map_err(|e| format!("age read: {e}"))?;
    if pt.len() != 32 {
        let n = pt.len();
        pt.zeroize();
        return Err(format!("epoch secret is {n} bytes, expected 32"));
    }
    let mut es = [0u8; 32];
    es.copy_from_slice(&pt);
    pt.zeroize();
    Ok(es)
}

/// Resolve the `content_master_key` for `epoch`. Epoch 0 is the
/// phrase-derived key from `user_keys`; epoch >= 1 derives from the stored
/// epoch secret. Returns `None` when the epoch secret isn't available
/// locally (e.g. a revoked device that never received it) — the op then
/// cannot be decrypted, which is the intended lockout, not an error.
pub fn content_master_key_for_epoch(
    conn: &Connection,
    user_keys: &UserKeys,
    epoch: i64,
) -> Result<Option<SecretKey32>, String> {
    if epoch == 0 {
        return Ok(Some(SecretKey32::from_bytes(
            *user_keys.content_master_key.as_bytes(),
        )));
    }
    match config::get_epoch_secret(conn, epoch).map_err(|e| e.to_string())? {
        Some(es) => Ok(Some(epoch_keys_from_secret(&es).content_master_key)),
        None => Ok(None),
    }
}

/// Resolve the `meta_key` for `epoch` (same epoch-0 / epoch-N rule as
/// `content_master_key_for_epoch`).
pub fn meta_key_for_epoch(
    conn: &Connection,
    user_keys: &UserKeys,
    epoch: i64,
) -> Result<Option<SecretKey32>, String> {
    if epoch == 0 {
        return Ok(Some(SecretKey32::from_bytes(*user_keys.meta_key.as_bytes())));
    }
    match config::get_epoch_secret(conn, epoch).map_err(|e| e.to_string())? {
        Some(es) => Ok(Some(epoch_keys_from_secret(&es).meta_key)),
        None => Ok(None),
    }
}

/// Resolve the `user_sign_priv` (Ed25519) for `epoch`. Epoch 0 is the
/// phrase-derived account key; epoch >= 1 derives from the stored epoch
/// secret. Used at emit time to attest the author's device key under the
/// op's epoch (key rotation plan 5). Returns `None` when the epoch secret
/// isn't available locally.
pub fn user_sign_priv_for_epoch(
    conn: &Connection,
    user_keys: &UserKeys,
    epoch: i64,
) -> Result<Option<SigningKey>, String> {
    if epoch == 0 {
        return Ok(Some(SigningKey::from_bytes(
            &user_keys.user_sign_priv.to_bytes(),
        )));
    }
    match config::get_epoch_secret(conn, epoch).map_err(|e| e.to_string())? {
        Some(es) => Ok(Some(epoch_keys_from_secret(&es).user_sign_priv)),
        None => Ok(None),
    }
}

/// Resolve the `user_sign_pub` (Ed25519 verifying key bytes) for `epoch`.
/// Used at receive time to verify an op author's attestation (plan 5).
pub fn user_sign_pub_for_epoch(
    conn: &Connection,
    user_keys: &UserKeys,
    epoch: i64,
) -> Result<Option<[u8; 32]>, String> {
    Ok(user_sign_priv_for_epoch(conn, user_keys, epoch)?
        .map(|sk| sk.verifying_key().to_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epoch_keys_are_deterministic_and_domain_separated() {
        let es = [7u8; 32];
        let a = epoch_keys_from_secret(&es);
        let b = epoch_keys_from_secret(&es);
        assert_eq!(a.content_master_key.as_bytes(), b.content_master_key.as_bytes());
        assert_eq!(a.meta_key.as_bytes(), b.meta_key.as_bytes());
        assert_eq!(
            a.user_sign_priv.to_bytes(),
            b.user_sign_priv.to_bytes(),
            "deterministic from the same secret"
        );
        // The three keys are independent (different HKDF info tags).
        assert_ne!(a.content_master_key.as_bytes(), a.meta_key.as_bytes());
        assert_ne!(
            a.content_master_key.as_bytes(),
            &a.user_sign_priv.to_bytes()
        );
        assert_ne!(a.meta_key.as_bytes(), &a.user_sign_priv.to_bytes());
    }

    #[test]
    fn different_secrets_yield_different_keys() {
        let a = epoch_keys_from_secret(&[1u8; 32]);
        let b = epoch_keys_from_secret(&[2u8; 32]);
        assert_ne!(a.content_master_key.as_bytes(), b.content_master_key.as_bytes());
        assert_ne!(a.meta_key.as_bytes(), b.meta_key.as_bytes());
        assert_ne!(a.user_sign_priv.to_bytes(), b.user_sign_priv.to_bytes());
    }

    #[test]
    fn recovery_key_is_deterministic_from_seed() {
        let seed = [9u8; 64];
        assert_eq!(
            recovery_kex_pub_from_seed(&seed),
            recovery_kex_pub_from_seed(&seed)
        );
        // Different seed -> different recovery key.
        assert_ne!(
            recovery_kex_pub_from_seed(&seed),
            recovery_kex_pub_from_seed(&[8u8; 64])
        );
    }

    #[test]
    fn wrap_then_unwrap_round_trips_to_a_device_key() {
        let device_priv = StaticSecret::random_from_rng(OsRng);
        let device_pub = PublicKey::from(&device_priv).to_bytes();
        let es = generate_epoch_secret();
        let wrapped = wrap_epoch_secret(&es, &device_pub).unwrap();
        let got = unwrap_epoch_secret(&wrapped, &device_priv).unwrap();
        assert_eq!(got, es);
    }

    #[test]
    fn wrap_then_unwrap_round_trips_to_the_recovery_key() {
        let seed = [3u8; 64];
        let recovery_pub = recovery_kex_pub_from_seed(&seed);
        let es = generate_epoch_secret();
        let wrapped = wrap_epoch_secret(&es, &recovery_pub).unwrap();
        let got = unwrap_epoch_secret(&wrapped, &recovery_kex_from_seed(&seed)).unwrap();
        assert_eq!(got, es);
    }

    #[test]
    fn content_master_key_for_epoch_resolves_0_n_and_missing() {
        let db = crate::test_helpers::test_db();
        let conn = db.lock().unwrap();
        let m = crate::sync::keys::generate_seed_phrase();
        let uk = crate::sync::keys::user_keys_from_phrase(&m);

        // Epoch 0 is the phrase-derived content key.
        let k0 = content_master_key_for_epoch(&conn, &uk, 0).unwrap().unwrap();
        assert_eq!(k0.as_bytes(), uk.content_master_key.as_bytes());

        // Epoch 1 with no stored secret -> None (the lockout case).
        assert!(content_master_key_for_epoch(&conn, &uk, 1).unwrap().is_none());

        // Store the epoch-1 secret -> resolves to its derived key, != epoch 0.
        let es = generate_epoch_secret();
        config::put_epoch_secret(&conn, 1, &es).unwrap();
        let k1 = content_master_key_for_epoch(&conn, &uk, 1).unwrap().unwrap();
        assert_eq!(
            k1.as_bytes(),
            epoch_keys_from_secret(&es).content_master_key.as_bytes()
        );
        assert_ne!(k1.as_bytes(), k0.as_bytes());
    }

    #[test]
    fn unwrap_with_wrong_key_fails() {
        let right = StaticSecret::random_from_rng(OsRng);
        let right_pub = PublicKey::from(&right).to_bytes();
        let wrong = StaticSecret::random_from_rng(OsRng);
        let es = generate_epoch_secret();
        let wrapped = wrap_epoch_secret(&es, &right_pub).unwrap();
        assert!(unwrap_epoch_secret(&wrapped, &wrong).is_err());
    }
}
