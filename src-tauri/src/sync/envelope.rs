//! Envelope encryption for op blobs + deterministic doc identifiers.
//!
//! Two primitives the wire pipeline needs:
//!
//!   1. **doc_id_ct** — a stable per-doc identifier the relay uses to
//!      index ops without seeing the plaintext doc UUID. Computed as
//!      `HMAC-SHA256(meta_key, doc_uuid_bytes)`. Deterministic across
//!      devices so the same logical doc collapses to one bucket.
//!
//!   2. **op envelope** — every op's payload is encrypted to a fresh
//!      per-op subkey derived from `content_master_key` and the op's
//!      UUID. We use a fixed all-zero nonce: that is sound because
//!      each subkey is used exactly once. Determinism is required —
//!      `blake3(ciphertext)` is the content-address the relay
//!      deduplicates retries against (spec §4 "Content-addressed.
//!      Idempotent retries").
//!
//! Subkey derivation:
//!
//! ```text
//! subkey = HKDF-SHA256(
//!     ikm    = content_master_key,
//!     salt   = none,
//!     info   = b"shizumu.op.v1" || op_id_bytes,
//!     length = 32 bytes,
//! )
//! ```
//!
//! XChaCha20-Poly1305 is the AEAD. The output ciphertext blob layout:
//!
//! ```text
//! [ op_id_bytes (16) ]  ‖  [ AEAD ciphertext (plaintext + 16-byte tag) ]
//! ```
//!
//! The op_id prefix lets the receiver derive the subkey before
//! decrypting (the relay's GET /ops response does NOT carry op_id, so
//! it must travel inside the blob). op_id is also fed as the AEAD's
//! additional-authenticated-data, so the tag covers it — flipping the
//! prefix invalidates the tag.

use crate::sync::keys::SecretKey32;
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use uuid::Uuid;
use zeroize::Zeroize;

const OP_SUBKEY_INFO: &[u8] = b"shizumu.op.v1";
const OP_NONCE: [u8; 24] = [0u8; 24];
const OP_ID_PREFIX_LEN: usize = 16;

/// HMAC-SHA256(meta_key, doc_uuid) → 32 bytes. Deterministic so the
/// same doc on different devices produces the same identifier.
pub fn doc_id_ct(meta_key: &SecretKey32, doc_uuid: &Uuid) -> [u8; 32] {
    doc_id_ct_from_bytes(meta_key, doc_uuid.as_bytes())
}

/// HMAC-SHA256 over arbitrary doc-id bytes. The op_log column stores
/// doc_id as TEXT — usually a UUID string, but `setting_op` rows use
/// the setting key directly. Hashing whatever bytes the column holds
/// keeps the doc-grouping invariant: same logical doc → same
/// doc_id_ct on the wire.
pub fn doc_id_ct_from_bytes(meta_key: &SecretKey32, doc_id: &[u8]) -> [u8; 32] {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(meta_key.as_bytes())
        .expect("HMAC-SHA256 accepts any key length");
    mac.update(doc_id);
    let result = mac.finalize().into_bytes();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result);
    out
}

/// Encrypt an op payload. `op_id` is the UUID written into op_log.op_id
/// — using it as the subkey context ensures retries of the same op
/// produce the same ciphertext, which is the contract `blake3(ct)` as
/// a content-address depends on.
///
/// Output layout: `op_id_bytes (16) || AEAD ciphertext`. The op_id
/// also travels as AAD so the AEAD tag covers it — a flipped prefix
/// fails the integrity check at decrypt time.
pub fn encrypt_op(
    content_master: &SecretKey32,
    op_id: &Uuid,
    plaintext: &[u8],
) -> Vec<u8> {
    let mut subkey = [0u8; 32];
    derive_subkey(content_master, op_id, &mut subkey);

    let cipher = XChaCha20Poly1305::new((&subkey).into());
    let aead_ct = cipher
        .encrypt(
            XNonce::from_slice(&OP_NONCE),
            Payload {
                msg: plaintext,
                aad: op_id.as_bytes(),
            },
        )
        .expect("encryption cannot fail with a valid 32-byte key");
    subkey.zeroize();

    let mut out = Vec::with_capacity(OP_ID_PREFIX_LEN + aead_ct.len());
    out.extend_from_slice(op_id.as_bytes());
    out.extend_from_slice(&aead_ct);
    out
}

/// Decrypt an op payload. Reads the op_id from the ciphertext prefix,
/// derives the subkey, and verifies the AEAD tag (which covers the
/// op_id as AAD). Returns the (op_id, plaintext) pair. Any AEAD
/// failure means corrupted/forged op — never fall back to plaintext.
pub fn decrypt_op(
    content_master: &SecretKey32,
    ciphertext: &[u8],
) -> Result<(Uuid, Vec<u8>), DecryptError> {
    if ciphertext.len() < OP_ID_PREFIX_LEN {
        return Err(DecryptError::Truncated);
    }
    let mut prefix = [0u8; OP_ID_PREFIX_LEN];
    prefix.copy_from_slice(&ciphertext[..OP_ID_PREFIX_LEN]);
    let op_id = Uuid::from_bytes(prefix);
    let aead_ct = &ciphertext[OP_ID_PREFIX_LEN..];

    let mut subkey = [0u8; 32];
    derive_subkey(content_master, &op_id, &mut subkey);

    let cipher = XChaCha20Poly1305::new((&subkey).into());
    let pt = cipher.decrypt(
        XNonce::from_slice(&OP_NONCE),
        Payload {
            msg: aead_ct,
            aad: op_id.as_bytes(),
        },
    );
    subkey.zeroize();
    match pt {
        Ok(plain) => Ok((op_id, plain)),
        Err(_) => Err(DecryptError::Aead),
    }
}

/// `blake3(ciphertext)` — what the relay's PUT /blobs/<hash> URL
/// expects. Centralized here so the upload pipeline and the test
/// harness share a single source of truth.
pub fn blob_hash(ciphertext: &[u8]) -> [u8; 32] {
    *blake3::hash(ciphertext).as_bytes()
}

/// Hex-encoded blob hash for the wire URL path component.
pub fn blob_hash_hex(ciphertext: &[u8]) -> String {
    hex::encode(blob_hash(ciphertext))
}

fn derive_subkey(content_master: &SecretKey32, op_id: &Uuid, out: &mut [u8; 32]) {
    let hk = Hkdf::<Sha256>::new(None, content_master.as_bytes());
    hk.expand_multi_info(&[OP_SUBKEY_INFO, op_id.as_bytes()], out)
        .expect("32-byte output is well below HKDF-SHA256's 8160-byte limit");
}

#[derive(Debug)]
pub enum DecryptError {
    /// Ciphertext shorter than the 16-byte op_id prefix — cannot
    /// possibly be a well-formed envelope.
    Truncated,
    /// AEAD authentication failed (wrong key, op_id prefix flipped,
    /// or ciphertext tampered with).
    Aead,
}

impl std::fmt::Display for DecryptError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DecryptError::Truncated => f.write_str("ciphertext shorter than op_id prefix"),
            DecryptError::Aead => f.write_str(
                "aead authentication failed (wrong key, flipped op_id, or corrupted ciphertext)",
            ),
        }
    }
}

impl std::error::Error for DecryptError {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::keys::{generate_seed_phrase, user_keys_from_phrase};

    fn fresh_keys() -> (SecretKey32, SecretKey32) {
        let m = generate_seed_phrase();
        let uk = user_keys_from_phrase(&m);
        // Move both secrets out of UserKeys for use in this test. The
        // struct does not impl Clone by design, so we destructure.
        (uk.content_master_key, uk.meta_key)
    }

    #[test]
    fn doc_id_ct_is_deterministic_and_32_bytes() {
        let (_cm, meta) = fresh_keys();
        let doc = Uuid::new_v4();
        let a = doc_id_ct(&meta, &doc);
        let b = doc_id_ct(&meta, &doc);
        assert_eq!(a, b);
        assert_eq!(a.len(), 32);
    }

    #[test]
    fn doc_id_ct_changes_with_doc_or_key() {
        let (_cm1, meta1) = fresh_keys();
        let (_cm2, meta2) = fresh_keys();
        let d1 = Uuid::new_v4();
        let d2 = Uuid::new_v4();

        // Different doc, same key: different output.
        assert_ne!(doc_id_ct(&meta1, &d1), doc_id_ct(&meta1, &d2));
        // Same doc, different key: different output.
        assert_ne!(doc_id_ct(&meta1, &d1), doc_id_ct(&meta2, &d1));
    }

    #[test]
    fn encrypt_decrypt_round_trip() {
        let (cm, _meta) = fresh_keys();
        let op = Uuid::new_v4();
        let pt = b"hello, write-to-think world. the rest sinks.";
        let ct = encrypt_op(&cm, &op, pt);
        assert_ne!(&ct[..], &pt[..], "ciphertext must differ from plaintext");
        // Layout: op_id (16) || aead_ct (plaintext + 16-byte tag)
        assert!(
            ct.len() >= OP_ID_PREFIX_LEN + pt.len() + 16,
            "ciphertext carries op_id prefix + 16-byte tag"
        );
        let (round_op, round_pt) = decrypt_op(&cm, &ct).unwrap();
        assert_eq!(round_op, op, "decrypt recovers op_id from prefix");
        assert_eq!(round_pt, pt);
    }

    #[test]
    fn encryption_is_deterministic_for_retries() {
        // The content-addressed retry contract depends on this. If
        // the same op_id + key + plaintext produced different
        // ciphertext between attempts, the relay would never collapse
        // retries.
        let (cm, _meta) = fresh_keys();
        let op = Uuid::new_v4();
        let pt = b"deterministic ciphertext is the retry contract";
        let a = encrypt_op(&cm, &op, pt);
        let b = encrypt_op(&cm, &op, pt);
        assert_eq!(a, b);
        assert_eq!(blob_hash(&a), blob_hash(&b));
    }

    #[test]
    fn decrypt_fails_when_op_id_prefix_is_flipped() {
        // The op_id prefix is fed to the AEAD as AAD; flipping it
        // invalidates the tag even though the AEAD ciphertext bytes
        // are untouched.
        let (cm, _meta) = fresh_keys();
        let op = Uuid::new_v4();
        let pt = b"payload";
        let mut ct = encrypt_op(&cm, &op, pt);
        ct[0] ^= 0x01;
        assert!(decrypt_op(&cm, &ct).is_err());
    }

    #[test]
    fn decrypt_fails_with_wrong_content_master_key() {
        let (cm1, _) = fresh_keys();
        let (cm2, _) = fresh_keys();
        let op = Uuid::new_v4();
        let ct = encrypt_op(&cm1, &op, b"secret");
        assert!(decrypt_op(&cm2, &ct).is_err());
    }

    #[test]
    fn decrypt_fails_on_tampered_ciphertext() {
        let (cm, _) = fresh_keys();
        let op = Uuid::new_v4();
        let mut ct = encrypt_op(&cm, &op, b"do not flip my bits");
        let i = ct.len() / 2;
        ct[i] ^= 0x01;
        assert!(decrypt_op(&cm, &ct).is_err());
    }

    #[test]
    fn decrypt_fails_on_truncated_blob() {
        let (cm, _) = fresh_keys();
        // Less than the 16-byte prefix → Truncated, never reaches AEAD.
        let err = decrypt_op(&cm, &[1u8; 8]).unwrap_err();
        assert!(matches!(err, DecryptError::Truncated));
    }

    #[test]
    fn blob_hash_matches_blake3_of_ciphertext() {
        let (cm, _) = fresh_keys();
        let op = Uuid::new_v4();
        let ct = encrypt_op(&cm, &op, b"x");
        let h = blob_hash(&ct);
        let direct = *blake3::hash(&ct).as_bytes();
        assert_eq!(h, direct);
        assert_eq!(blob_hash_hex(&ct).len(), 64);
    }

    #[test]
    fn empty_plaintext_round_trips() {
        // Tombstone ops may have empty payloads; the envelope is then
        // op_id_prefix (16) + AEAD ciphertext (just the 16-byte tag).
        let (cm, _) = fresh_keys();
        let op = Uuid::new_v4();
        let ct = encrypt_op(&cm, &op, b"");
        assert_eq!(ct.len(), OP_ID_PREFIX_LEN + 16, "empty payload = prefix + pure tag");
        let (round_op, pt) = decrypt_op(&cm, &ct).unwrap();
        assert_eq!(round_op, op);
        assert!(pt.is_empty());
    }
}
