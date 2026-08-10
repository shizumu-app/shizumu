//! Multi-device pairing primitives (spec §5.3).
//!
//! Two distinct pieces:
//!
//!   1. **Short Authentication String (SAS).** A 6-digit decimal
//!      number both devices compute locally from the new device's
//!      ephemeral X25519 pubkey. The user reads them aloud or
//!      compares screens — if the digits differ, an attacker
//!      substituted their own ephemeral_pub and the pairing aborts.
//!
//!   2. **Key bundle wrapping.** After SAS confirmation the existing
//!      device wraps the user's keyring (user_sign_priv, user_kex_priv,
//!      content_master_key, meta_key, user_id) in `age`, encrypted to
//!      the new device's ephemeral X25519 pubkey. The new device
//!      decrypts using its ephemeral private key.
//!
//! The age crate's `x25519::Recipient` doesn't expose a from-bytes
//! constructor — we round-trip the raw 32 X25519 pubkey bytes
//! through the bech32 `age1...` string format that age's parser
//! accepts.

use crate::sync::keys::{SecretKey32, UserKeys};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use bech32::ToBase32;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use uuid::Uuid;
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::Zeroize;

/// SAS digits — exactly 6, zero-padded.
pub type SasDigits = String;

/// Compute the 6-digit SAS both devices show during pairing.
///
/// SAS_INPUT  = "shizumu-pair-v1\n" || user_id || "\n" || base64_std(ephemeral_pub)
/// SAS_BYTES  = blake3(SAS_INPUT)[0..4]
/// SAS_DIGITS = (u32::from_le_bytes(SAS_BYTES) % 1_000_000), zero-padded to 6 chars
pub fn compute_sas(user_id: &Uuid, ephemeral_pub: &[u8; 32]) -> SasDigits {
    let mut input = String::new();
    input.push_str("shizumu-pair-v1\n");
    input.push_str(&user_id.as_hyphenated().to_string());
    input.push('\n');
    input.push_str(&B64.encode(ephemeral_pub));

    let hash = blake3::hash(input.as_bytes());
    let mut first4 = [0u8; 4];
    first4.copy_from_slice(&hash.as_bytes()[..4]);
    let n = u32::from_le_bytes(first4) % 1_000_000;
    format!("{n:06}")
}

/// Plaintext form of the key bundle the existing device sends to the
/// new device. Every secret carries its own zeroize-on-drop wrapper —
/// the struct holds the BASE64 strings only briefly during marshalling.
///
/// `device_sign_priv` and `device_id` are populated by the existing
/// device on behalf of the new device. The spec text says the new
/// device generates these, but the relay's `pair_upload` schema
/// doesn't carry them and `pair_finalize` (signed by the existing
/// device) needs them — so the existing device generates them and
/// ships them inside the age envelope. Still encrypted, still bound
/// to the new device's ephemeral_pub.
#[derive(Serialize, Deserialize)]
pub struct KeyBundle {
    pub user_sign_priv: String,
    pub user_kex_priv: String,
    pub content_master_key: String,
    pub meta_key: String,
    pub user_id: String,
    /// Device sign-key seed (32 bytes base64) the new device adopts.
    #[serde(default)]
    pub device_sign_priv: String,
    /// Device UUID the new device adopts.
    #[serde(default)]
    pub device_id: String,
}

// The bundle holds every account secret as base64 strings during the
// pairing window. Zeroize them on drop so they don't linger in freed heap /
// swap, and keep the secret fields out of any `{:?}` log line (security
// audit, low/hardening items).
impl Drop for KeyBundle {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.user_sign_priv.zeroize();
        self.user_kex_priv.zeroize();
        self.content_master_key.zeroize();
        self.meta_key.zeroize();
        self.device_sign_priv.zeroize();
        // user_id / device_id are public identifiers, not secrets.
    }
}

impl std::fmt::Debug for KeyBundle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("KeyBundle")
            .field("user_id", &self.user_id)
            .field("device_id", &self.device_id)
            .finish_non_exhaustive()
    }
}

impl KeyBundle {
    /// Marshal the user's keyring into base64-string fields for the
    /// age plaintext. `user_id` is the canonical lowercase UUID.
    /// Device fields are empty; use `with_device_identity` to fill
    /// them before wrapping for a pairing flow.
    pub fn from_user_keys(uk: &UserKeys) -> Result<Self, String> {
        let user_id = uk
            .user_id
            .ok_or_else(|| "user_keys.user_id must be set before wrapping bundle".to_string())?
            .as_hyphenated()
            .to_string();
        Ok(Self {
            user_sign_priv: B64.encode(uk.user_sign_priv.to_bytes()),
            user_kex_priv: B64.encode(uk.user_kex_priv.to_bytes()),
            content_master_key: B64.encode(uk.content_master_key.as_bytes()),
            meta_key: B64.encode(uk.meta_key.as_bytes()),
            user_id,
            device_sign_priv: String::new(),
            device_id: String::new(),
        })
    }

    /// Attach the device identity (seed + UUID) the existing device
    /// generates on behalf of the new device. Required for pairing
    /// to complete with the current relay schema; harmless to set
    /// for any future call site that round-trips KeyBundle.
    pub fn with_device_identity(
        mut self,
        device_sign_priv_seed: &[u8; 32],
        device_id: &Uuid,
    ) -> Self {
        self.device_sign_priv = B64.encode(device_sign_priv_seed);
        self.device_id = device_id.as_hyphenated().to_string();
        self
    }

    /// Extract the embedded device identity (if any) — populated when
    /// the existing device included one in the wrapped bundle.
    pub fn embedded_device(
        &self,
    ) -> Result<Option<(Uuid, [u8; 32])>, String> {
        if self.device_sign_priv.is_empty() || self.device_id.is_empty() {
            return Ok(None);
        }
        let uuid = Uuid::parse_str(&self.device_id)
            .map_err(|e| format!("bundle device_id is not a UUID: {e}"))?;
        let seed = decode32(&self.device_sign_priv, "device_sign_priv")?;
        Ok(Some((uuid, seed)))
    }

    /// Unmarshal back into UserKeys. Used by the new device after
    /// it decrypts the age envelope. Every base64 field must round-
    /// trip into a 32-byte array.
    pub fn into_user_keys(self) -> Result<UserKeys, String> {
        let user_id = Uuid::parse_str(&self.user_id)
            .map_err(|e| format!("bundle user_id is not a UUID: {e}"))?;
        let sign_bytes = decode32(&self.user_sign_priv, "user_sign_priv")?;
        let user_sign_priv = ed25519_dalek::SigningKey::from_bytes(&sign_bytes);
        let kex_bytes = decode32(&self.user_kex_priv, "user_kex_priv")?;
        let user_kex_priv = StaticSecret::from(kex_bytes);
        let cm_bytes = decode32(&self.content_master_key, "content_master_key")?;
        let mk_bytes = decode32(&self.meta_key, "meta_key")?;

        Ok(UserKeys {
            user_id: Some(user_id),
            user_sign_priv,
            user_kex_priv,
            content_master_key: SecretKey32::from_bytes(cm_bytes),
            meta_key: SecretKey32::from_bytes(mk_bytes),
        })
    }
}

fn decode32(b64: &str, field: &str) -> Result<[u8; 32], String> {
    let raw = B64
        .decode(b64)
        .map_err(|e| format!("bundle field {field} not base64: {e}"))?;
    if raw.len() != 32 {
        return Err(format!(
            "bundle field {field} is {} bytes, expected 32",
            raw.len()
        ));
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&raw);
    Ok(out)
}

/// Wrap the bundle JSON in an age envelope, encrypted to the new
/// device's ephemeral X25519 pubkey. The output is the raw age
/// envelope bytes — the caller base64-encodes for the wire.
pub fn wrap_bundle(bundle: &KeyBundle, ephemeral_pub: &[u8; 32]) -> Result<Vec<u8>, String> {
    let plaintext = serde_json::to_vec(bundle)
        .map_err(|e| format!("bundle serialization failed: {e}"))?;

    // The age crate's x25519::Recipient doesn't expose from-bytes;
    // round-trip the raw pubkey through the bech32 "age1..." string
    // format the parser accepts.
    let recipient_str = bech32::encode(
        "age",
        ephemeral_pub.to_base32(),
        bech32::Variant::Bech32,
    )
    .map_err(|e| format!("bech32 encode of recipient failed: {e}"))?;
    let recipient: age::x25519::Recipient = recipient_str
        .parse()
        .map_err(|e: &'static str| format!("recipient parse failed: {e}"))?;

    let encryptor = age::Encryptor::with_recipients(vec![Box::new(recipient)])
        .ok_or_else(|| "age::Encryptor returned None (recipient list empty)".to_string())?;

    let mut out = Vec::new();
    let mut writer = encryptor
        .wrap_output(&mut out)
        .map_err(|e| format!("age wrap setup: {e}"))?;
    writer
        .write_all(&plaintext)
        .map_err(|e| format!("age write: {e}"))?;
    writer.finish().map_err(|e| format!("age finish: {e}"))?;
    Ok(out)
}

/// Unwrap the age envelope using the new device's ephemeral secret.
/// Returns the decoded `KeyBundle` — caller is responsible for
/// folding it into local sync state via [`KeyBundle::into_user_keys`].
pub fn unwrap_bundle(
    wrapped: &[u8],
    ephemeral_priv: &StaticSecret,
) -> Result<KeyBundle, String> {
    // Re-encode the StaticSecret to bech32 "AGE-SECRET-KEY-1..." so
    // age::x25519::Identity::from_str accepts it.
    let secret_bytes = ephemeral_priv.to_bytes();
    let identity_str = bech32::encode(
        "AGE-SECRET-KEY-",
        secret_bytes.to_base32(),
        bech32::Variant::Bech32,
    )
    .map_err(|e| format!("bech32 encode of identity failed: {e}"))?
    .to_uppercase();
    let identity: age::x25519::Identity = identity_str
        .parse()
        .map_err(|e: &'static str| format!("identity parse failed: {e}"))?;

    let decryptor = match age::Decryptor::new(wrapped) {
        Ok(age::Decryptor::Recipients(d)) => d,
        Ok(age::Decryptor::Passphrase(_)) => {
            return Err("bundle is passphrase-encrypted, not x25519-recipient".to_string());
        }
        Err(e) => return Err(format!("age decryptor setup: {e}")),
    };

    let identities: Vec<Box<dyn age::Identity>> = vec![Box::new(identity)];
    let mut reader = decryptor
        .decrypt(identities.iter().map(|b| b.as_ref()))
        .map_err(|e| format!("age decrypt: {e}"))?;
    let mut plaintext = Vec::new();
    reader
        .read_to_end(&mut plaintext)
        .map_err(|e| format!("age read: {e}"))?;
    let bundle: KeyBundle = serde_json::from_slice(&plaintext)
        .map_err(|e| format!("bundle JSON parse: {e}"))?;
    plaintext.zeroize();
    Ok(bundle)
}

/// Convenience: generate a fresh ephemeral X25519 keypair the new
/// device uses for one pairing session. Both ends use static-secrets
/// rather than ephemeral_secret so we can serialise the secret to
/// disk if needed (pairing may span an app restart).
pub fn generate_ephemeral_keypair() -> (StaticSecret, PublicKey) {
    let secret = StaticSecret::random_from_rng(rand_core::OsRng);
    let public = PublicKey::from(&secret);
    (secret, public)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::keys::{generate_seed_phrase, user_keys_from_phrase};

    /// SAS is deterministic from (user_id, ephemeral_pub).
    #[test]
    fn sas_is_deterministic() {
        let uid = Uuid::nil();
        let pub_bytes = [0xab; 32];
        let a = compute_sas(&uid, &pub_bytes);
        let b = compute_sas(&uid, &pub_bytes);
        assert_eq!(a, b);
        assert_eq!(a.len(), 6);
        assert!(a.chars().all(|c| c.is_ascii_digit()));
    }

    /// Different ephemeral_pub → different SAS (with very high prob).
    /// Sanity check that the hash actually changes with the input.
    #[test]
    fn sas_changes_with_ephemeral_pub() {
        let uid = Uuid::new_v4();
        let a = compute_sas(&uid, &[0xab; 32]);
        let b = compute_sas(&uid, &[0xcd; 32]);
        assert_ne!(a, b);
    }

    /// Different user_id → different SAS. Stops a cross-user replay.
    #[test]
    fn sas_changes_with_user_id() {
        let pub_bytes = [0x42; 32];
        let a = compute_sas(&Uuid::nil(), &pub_bytes);
        let b = compute_sas(&Uuid::new_v4(), &pub_bytes);
        assert_ne!(a, b);
    }

    /// SAS is always exactly 6 zero-padded decimal digits.
    /// Probes a few inputs to catch a missing zero-pad.
    #[test]
    fn sas_is_always_six_digits() {
        for i in 0..20 {
            let pub_bytes = [i as u8; 32];
            let sas = compute_sas(&Uuid::nil(), &pub_bytes);
            assert_eq!(sas.len(), 6, "sas {sas:?} for byte {i}");
        }
    }

    /// Round-trip: marshal UserKeys → KeyBundle → JSON → KeyBundle → UserKeys.
    #[test]
    fn key_bundle_round_trip_preserves_all_secrets() {
        let m = generate_seed_phrase();
        let mut uk = user_keys_from_phrase(&m);
        uk.user_id = Some(Uuid::new_v4());

        let bundle = KeyBundle::from_user_keys(&uk).unwrap();
        let json = serde_json::to_vec(&bundle).unwrap();
        let parsed: KeyBundle = serde_json::from_slice(&json).unwrap();
        let restored = parsed.into_user_keys().unwrap();

        assert_eq!(restored.user_id, uk.user_id);
        assert_eq!(restored.user_sign_pub_bytes(), uk.user_sign_pub_bytes());
        assert_eq!(restored.user_kex_pub_bytes(), uk.user_kex_pub_bytes());
        assert_eq!(
            restored.content_master_key.as_bytes(),
            uk.content_master_key.as_bytes()
        );
        assert_eq!(restored.meta_key.as_bytes(), uk.meta_key.as_bytes());
    }

    /// Round-trip through age: existing-device wrap → new-device unwrap.
    /// This is the core pairing security contract.
    #[test]
    fn age_envelope_round_trip_recovers_bundle() {
        let m = generate_seed_phrase();
        let mut uk = user_keys_from_phrase(&m);
        uk.user_id = Some(Uuid::new_v4());
        let bundle = KeyBundle::from_user_keys(&uk).unwrap();

        let (ephem_priv, ephem_pub) = generate_ephemeral_keypair();
        let wrapped = wrap_bundle(&bundle, ephem_pub.as_bytes()).unwrap();
        // The ciphertext must differ from the plaintext (sanity).
        let plain_json = serde_json::to_vec(&bundle).unwrap();
        assert_ne!(wrapped, plain_json);

        let recovered = unwrap_bundle(&wrapped, &ephem_priv).unwrap();
        assert_eq!(recovered.user_id, bundle.user_id);
        assert_eq!(recovered.user_sign_priv, bundle.user_sign_priv);
        assert_eq!(recovered.content_master_key, bundle.content_master_key);
    }

    /// Wrong ephemeral private key fails decryption — proves the
    /// envelope is actually bound to the ephemeral_pub.
    #[test]
    fn unwrap_fails_with_wrong_ephemeral_key() {
        let m = generate_seed_phrase();
        let mut uk = user_keys_from_phrase(&m);
        uk.user_id = Some(Uuid::new_v4());
        let bundle = KeyBundle::from_user_keys(&uk).unwrap();

        let (_correct_priv, ephem_pub) = generate_ephemeral_keypair();
        let (attacker_priv, _) = generate_ephemeral_keypair();
        let wrapped = wrap_bundle(&bundle, ephem_pub.as_bytes()).unwrap();
        let err = unwrap_bundle(&wrapped, &attacker_priv).unwrap_err();
        assert!(
            err.contains("decrypt") || err.contains("identity"),
            "expected age decrypt error, got: {err}"
        );
    }

    /// Bundle without user_id fails marshalling — pairing makes no
    /// sense for an un-enrolled user.
    #[test]
    fn from_user_keys_rejects_missing_user_id() {
        let m = generate_seed_phrase();
        let uk = user_keys_from_phrase(&m);
        assert!(uk.user_id.is_none());
        let err = KeyBundle::from_user_keys(&uk).unwrap_err();
        assert!(err.contains("user_id"));
    }
}
