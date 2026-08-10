//! Per-op author authentication (key rotation plan 5, security audit C1).
//!
//! Each synced op is "self-authenticating": inside the encrypted blob it
//! carries its author device's signing pubkey, a signature over the op, and
//! the author's attestation under the op's epoch user-signing key. A receiver
//! verifies the whole chain against the epoch's `user_sign_pub` that it
//! derives LOCALLY from its own copy of the epoch secret — so it never trusts
//! the relay for authorship, and a revoked device (which can't obtain a new
//! epoch's secret/user-sign key) cannot forge a valid attestation for any
//! post-rotation epoch.
//!
//! The chain:
//!   - `op_sig`         = device_sign_priv.sign(op_id || payload)
//!   - `authorized_sig` = user_sign_priv_{epoch}.sign(author_sign_pub)
//! Verify: `user_sign_pub_{epoch}.verify(author_sign_pub, authorized_sig)`
//!     AND `author_sign_pub.verify(op_id || payload, op_sig)`.
//!
//! The wrapper lives INSIDE the AEAD plaintext, so the relay never sees it
//! and it inherits AEAD integrity. The decrypted inner `payload` is byte-
//! identical to the raw op payload, so merge logic is unchanged. Everything
//! is deterministic (Ed25519 is deterministic), preserving the content-
//! addressed retry-idempotency contract.

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::sync::envelope::{self, DecryptError};
use crate::sync::keys::{DeviceKeys, SecretKey32};

/// Authored-op wrapper, serialized as the AEAD plaintext. `av` is a format
/// discriminator so a legacy raw-payload plaintext (which lacks it) is
/// cleanly distinguished from an authored one.
#[derive(Serialize, Deserialize)]
struct AuthoredEnvelope {
    av: u8,
    /// base64 raw op payload bytes.
    p: String,
    /// author device UUID string.
    aid: String,
    /// base64 author Ed25519 signing pubkey (32 bytes).
    apk: String,
    /// base64 op signature (64 bytes) over `op_id || payload`.
    osig: String,
    /// base64 attestation (64 bytes): user_sign_priv_{epoch}.sign(author_sign_pub).
    asig: String,
}

const AUTHORED_VERSION: u8 = 1;

fn op_signing_bytes(op_id: &Uuid, payload: &[u8]) -> Vec<u8> {
    let mut v = Vec::with_capacity(16 + payload.len());
    v.extend_from_slice(op_id.as_bytes());
    v.extend_from_slice(payload);
    v
}

/// Seal an authored op: build the attestation chain and encrypt it under the
/// epoch content key. `epoch_user_sign_priv` is the op's epoch user-signing
/// key (epoch 0 = the phrase-derived account key).
pub fn seal_authored(
    content_key: &SecretKey32,
    op_id: &Uuid,
    payload: &[u8],
    device_keys: &DeviceKeys,
    epoch_user_sign_priv: &SigningKey,
) -> Vec<u8> {
    let author_sign_pub = device_keys.device_sign_pub_bytes();
    let op_sig = device_keys
        .device_sign_priv
        .sign(&op_signing_bytes(op_id, payload));
    let authorized_sig = epoch_user_sign_priv.sign(&author_sign_pub);

    let env = AuthoredEnvelope {
        av: AUTHORED_VERSION,
        p: B64.encode(payload),
        aid: device_keys.device_id.to_string(),
        apk: B64.encode(author_sign_pub),
        osig: B64.encode(op_sig.to_bytes()),
        asig: B64.encode(authorized_sig.to_bytes()),
    };
    let plaintext = serde_json::to_vec(&env).expect("AuthoredEnvelope serializes");
    envelope::encrypt_op(content_key, op_id, &plaintext)
}

/// A decrypted authored op. `payload` is the raw op payload (what merge
/// parses). Author fields are present only for `Authored`.
pub struct OpenedOp {
    pub op_id: Uuid,
    pub payload: Vec<u8>,
    pub authored: Option<Authored>,
}

pub struct Authored {
    pub author_device_id: String,
    pub author_sign_pub: [u8; 32],
    pub op_sig: [u8; 64],
    pub authorized_sig: [u8; 64],
}

#[derive(Debug)]
pub enum OpenError {
    Decrypt(DecryptError),
    /// Decrypted but the authored wrapper was malformed (e.g. bad base64 or
    /// wrong-length keys). Treated as a hard reject, not legacy.
    Malformed(String),
}

/// Decrypt + parse an op. Returns the inner payload plus author fields when
/// the op is authored. A decrypted plaintext that isn't an authored envelope
/// is treated as a legacy unsigned op (pre-plan-5 / pre-GA): `authored` is
/// `None` and the raw plaintext is the payload.
pub fn open_authored(
    content_key: &SecretKey32,
    ciphertext: &[u8],
) -> Result<OpenedOp, OpenError> {
    let (op_id, plaintext) =
        envelope::decrypt_op(content_key, ciphertext).map_err(OpenError::Decrypt)?;

    match serde_json::from_slice::<AuthoredEnvelope>(&plaintext) {
        Ok(env) if env.av == AUTHORED_VERSION => {
            let payload = B64
                .decode(&env.p)
                .map_err(|e| OpenError::Malformed(format!("payload b64: {e}")))?;
            let author_sign_pub: [u8; 32] = B64
                .decode(&env.apk)
                .ok()
                .and_then(|v| v.try_into().ok())
                .ok_or_else(|| OpenError::Malformed("author_sign_pub not 32 bytes".into()))?;
            let op_sig: [u8; 64] = B64
                .decode(&env.osig)
                .ok()
                .and_then(|v| v.try_into().ok())
                .ok_or_else(|| OpenError::Malformed("op_sig not 64 bytes".into()))?;
            let authorized_sig: [u8; 64] = B64
                .decode(&env.asig)
                .ok()
                .and_then(|v| v.try_into().ok())
                .ok_or_else(|| OpenError::Malformed("authorized_sig not 64 bytes".into()))?;
            Ok(OpenedOp {
                op_id,
                payload,
                authored: Some(Authored {
                    author_device_id: env.aid,
                    author_sign_pub,
                    op_sig,
                    authorized_sig,
                }),
            })
        }
        // Not an authored envelope -> legacy raw-payload op.
        _ => Ok(OpenedOp {
            op_id,
            payload: plaintext,
            authored: None,
        }),
    }
}

/// Verify an authored op's chain against the epoch's user-signing pubkey
/// (which the receiver derived locally from its epoch secret). Returns true
/// iff both the attestation and the op signature verify.
pub fn verify_authored(
    op_id: &Uuid,
    opened: &Authored,
    payload: &[u8],
    epoch_user_sign_pub: &[u8; 32],
) -> bool {
    let Ok(user_vk) = VerifyingKey::from_bytes(epoch_user_sign_pub) else {
        return false;
    };
    let Ok(author_vk) = VerifyingKey::from_bytes(&opened.author_sign_pub) else {
        return false;
    };
    // 1. The author's device key was attested by the epoch's user key.
    if user_vk
        .verify(&opened.author_sign_pub, &Signature::from_bytes(&opened.authorized_sig))
        .is_err()
    {
        return false;
    }
    // 2. The op was signed by that author device.
    author_vk
        .verify(
            &op_signing_bytes(op_id, payload),
            &Signature::from_bytes(&opened.op_sig),
        )
        .is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::keys::{generate_device_keys, generate_seed_phrase, user_keys_from_phrase};

    #[test]
    fn authored_op_round_trips_and_verifies() {
        let uk = user_keys_from_phrase(&generate_seed_phrase());
        let dk = generate_device_keys();
        let op_id = Uuid::new_v4();
        let payload = br#"{"op":"save_page","page_id":"x","hlc_ts":42}"#;

        let ct = seal_authored(&uk.content_master_key, &op_id, payload, &dk, &uk.user_sign_priv);
        let opened = open_authored(&uk.content_master_key, &ct).unwrap();
        assert_eq!(opened.op_id, op_id);
        assert_eq!(opened.payload, payload);
        let authored = opened.authored.expect("authored");
        assert_eq!(authored.author_device_id, dk.device_id.to_string());

        let epoch_pub = uk.user_sign_pub_bytes();
        assert!(verify_authored(&op_id, &authored, &opened.payload, &epoch_pub));
    }

    #[test]
    fn verify_fails_under_wrong_epoch_user_key() {
        let uk = user_keys_from_phrase(&generate_seed_phrase());
        let other = user_keys_from_phrase(&generate_seed_phrase());
        let dk = generate_device_keys();
        let op_id = Uuid::new_v4();
        let payload = b"payload";
        let ct = seal_authored(&uk.content_master_key, &op_id, payload, &dk, &uk.user_sign_priv);
        let authored = open_authored(&uk.content_master_key, &ct)
            .unwrap()
            .authored
            .unwrap();
        // A different account's user key must not validate the attestation.
        assert!(!verify_authored(&op_id, &authored, payload, &other.user_sign_pub_bytes()));
    }

    #[test]
    fn verify_fails_when_op_id_or_payload_tampered() {
        let uk = user_keys_from_phrase(&generate_seed_phrase());
        let dk = generate_device_keys();
        let op_id = Uuid::new_v4();
        let payload = b"original";
        let ct = seal_authored(&uk.content_master_key, &op_id, payload, &dk, &uk.user_sign_priv);
        let authored = open_authored(&uk.content_master_key, &ct)
            .unwrap()
            .authored
            .unwrap();
        let epoch_pub = uk.user_sign_pub_bytes();
        // Wrong payload -> op_sig fails.
        assert!(!verify_authored(&op_id, &authored, b"tampered", &epoch_pub));
        // Wrong op_id -> op_sig fails.
        assert!(!verify_authored(&Uuid::new_v4(), &authored, payload, &epoch_pub));
    }

    #[test]
    fn legacy_raw_payload_opens_as_unauthored() {
        let uk = user_keys_from_phrase(&generate_seed_phrase());
        let op_id = Uuid::new_v4();
        // A pre-plan-5 op: raw payload encrypted directly (no authored wrapper).
        let raw = br#"{"op":"save_page","hlc_ts":1}"#;
        let ct = envelope::encrypt_op(&uk.content_master_key, &op_id, raw);
        let opened = open_authored(&uk.content_master_key, &ct).unwrap();
        assert!(opened.authored.is_none());
        assert_eq!(opened.payload, raw);
    }
}
