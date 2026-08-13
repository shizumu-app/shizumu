//! Wire format for the `attachment_blob` op_kind. Splits a blob into
//! 256KB chunks (base64-encoded inside the encrypted payload). Receive
//! side reassembles, verifies sha256, writes to the local blob store.
//!
//! Unlike the HTTP-relay modules that share this directory, this is a
//! payload-schema module: it describes what lives inside the encrypted
//! op_log payload, not how to call the relay over HTTPS.

use serde::{Deserialize, Serialize};

pub const CHUNK_SIZE: usize = 256 * 1024;

/// Hard ceiling on a single reassembled attachment. `size_bytes` and the
/// chunk list both arrive inside a decrypted-but-UNAUTHENTICATED op (the
/// AEAD tag proves only that some account key-holder produced it, not that
/// it is well-formed — see the v0.4 security audit, finding C1/H2). Without
/// a bound, a malicious relay sends `size_bytes = i64::MAX` and the
/// `Vec::with_capacity` below aborts the process.
///
/// 104 MiB: the product ceiling is 100 MB (insert_attachment,
/// attachments/commands.rs:84) and the receive guard must sit at or above
/// what the send side accepts, with a little headroom.
pub const MAX_BLOB_BYTES: usize = 104 * 1024 * 1024;

#[derive(Serialize, Deserialize, Debug)]
pub struct AttachmentBlobPayload {
    pub op: String,
    /// `sha256(plaintext)` — the LOCAL content address. The blob store
    /// path, the `attachments` primary key and every `blob_hash` attr in
    /// page content are all this value, and it is what a fetched object
    /// is verified against after decryption.
    pub blob_hash: String,
    pub mime_type: Option<String>,
    pub size_bytes: i64,
    pub chunks_b64: Vec<String>,
    /// `blake3(ciphertext)` — the RELAY address of the object holding
    /// these bytes, i.e. the `<hash>` in
    /// `/v1/users/<uid>/attachments/<hash>`. The relay verifies
    /// `blake3(body)` against this path segment itself, so nothing else
    /// can be used, and the relay never sees the plaintext the local
    /// address is derived from — hence two hashes, not one.
    ///
    /// `Option` + `#[serde(default)]` for two shapes that legitimately
    /// lack it: a legacy inline op (the bytes are in `chunks_b64`), and
    /// a reference op emitted by an early build of this branch before
    /// the upload existed. Both must keep deserialising.
    #[serde(default)]
    pub object_key: Option<String>,
    /// Which key epoch the object at `object_key` was SEALED under.
    ///
    /// The object body is `envelope::encrypt_op` under
    /// `epoch::content_master_key_for_epoch(object_epoch)`, exactly the
    /// way an op's ciphertext is sealed under `op_log.epoch`. It has to
    /// travel with the reference because the receiver has no other way
    /// to know: the epoch the OP was stamped with can be later (a
    /// rotation between the PUT and the emit), and a peer pulling this
    /// op months afterwards is on a different epoch again.
    ///
    /// `Option` + `#[serde(default)]`, and absent means epoch 0 — a
    /// statement about history, not a fallback. Every op that can lack
    /// this field was emitted by a build that sealed attachment objects
    /// under `user_keys.content_master_key`, which IS the epoch-0 key.
    #[serde(default)]
    pub object_epoch: Option<i64>,
    /// This op RETRACTS the reference it names, rather than publishing
    /// one. The op log is append-only, so un-syncing an attachment
    /// cannot delete the reference op that put it there — it can only
    /// supersede it. Without that, a peer holding
    /// `(sync = 1, has_local = 0, object_key = K)` GETs a deleted K
    /// every tick, 404s, and retries for the life of the account.
    ///
    /// `object_key` is REQUIRED on a revocation and names the exact
    /// object being retracted, so the receiver can leave a different
    /// object for the same content alone (the same file sealed on two
    /// devices lands under two keys, and only the uploader's own key is
    /// the one being deleted).
    ///
    /// `Option` + `#[serde(default)]` + `skip_serializing_if`: absent
    /// on every ordinary reference and inline op, past and future, so
    /// nothing about the existing wire shape changes. A client that
    /// predates the field reads a revocation as a plain reference
    /// naming an object key it already has, and its COALESCE upsert
    /// leaves the row exactly as it was — a no-op, not a corruption.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revoked: Option<bool>,
    /// The user-facing name of the attachment, carried so a device that
    /// RECEIVES this reference shows the real filename rather than the
    /// blob_hash. `merge` had nothing else to use and fell back to the
    /// hash — the origin of the raw-UUID filenames on synced attachments.
    ///
    /// `Option` + `#[serde(default)]` + `skip_serializing_if`: absent on a
    /// legacy inline op and on any reference emitted before this field
    /// existed, and a receiver without it keeps the hash fallback. Purely
    /// additive; nothing about the existing wire shape changes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filename: Option<String>,
    pub hlc_ts: i64,
}

pub fn build_payload(
    blob_hash: &str,
    mime_type: Option<&str>,
    bytes: &[u8],
    hlc_ts: i64,
) -> AttachmentBlobPayload {
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine;
    let chunks_b64 = bytes.chunks(CHUNK_SIZE).map(|c| B64.encode(c)).collect();
    AttachmentBlobPayload {
        op: "attachment_blob".into(),
        blob_hash: blob_hash.into(),
        mime_type: mime_type.map(|s| s.to_string()),
        size_bytes: bytes.len() as i64,
        chunks_b64,
        // The bytes are right here; there is no object to point at.
        object_key: None,
        // …and therefore nothing that was sealed as an object. The op's
        // own ciphertext epoch (`op_log.epoch`) covers these bytes.
        object_epoch: None,
        revoked: None,
        // The bytes carry no reference; the local row still has the name.
        filename: None,
        hlc_ts,
    }
}

/// A reference-shaped payload: the op says which attachment and how big,
/// and the bytes live at PUT /v1/users/<uid>/attachments/<object_key>.
///
/// Carries BOTH addresses. `object_key` is what the receiver fetches by
/// (the relay enforces `blake3(body)` against it); `blob_hash` is what
/// the receiver verifies the DECRYPTED bytes against before writing them
/// to its own store. One without the other is not enough: fetching needs
/// the relay's address, and trusting the result needs the local one.
///
/// …and `object_epoch`, which is what the receiver OPENS it with. Three
/// pieces, three jobs: fetch by, decrypt with, verify against.
///
/// `chunks_b64` stays in the struct, empty, rather than becoming an
/// Option — an older client deserialising this op must see a well-formed
/// payload with no chunks, not a missing field it rejects.
pub fn build_reference_payload(
    blob_hash: &str,
    mime_type: Option<&str>,
    size_bytes: i64,
    object_key: &str,
    object_epoch: i64,
    hlc_ts: i64,
) -> AttachmentBlobPayload {
    AttachmentBlobPayload {
        op: "attachment_blob".into(),
        blob_hash: blob_hash.into(),
        mime_type: mime_type.map(|s| s.to_string()),
        size_bytes,
        chunks_b64: Vec::new(),
        object_key: Some(object_key.to_string()),
        object_epoch: Some(object_epoch),
        revoked: None,
        // Filled in by the emit path, which holds the row the name lives on.
        filename: None,
        hlc_ts,
    }
}

/// A revocation-shaped payload: "the object I published at
/// `object_key` for `blob_hash` is gone; stop asking for it."
///
/// Emitted on the on→off edge of the sync toggle, in the same
/// transaction that clears the row's `object_key`, and BEFORE the
/// relay DELETE goes out. The op log is append-only — the reference op
/// that published `object_key` can never be removed — so the only way
/// to stop peers 404-ing on a deleted object forever is to publish a
/// second op that supersedes the first.
///
/// It carries `object_key` because the retraction is about ONE object,
/// not about the content: the same file sealed on two devices lands
/// under two different keys, both valid, and only the emitting
/// device's own key is the one being deleted from the relay. A peer
/// whose row names a different key must keep it.
///
/// `size_bytes` and `mime_type` are carried unchanged so a client that
/// predates `revoked` still sees a well-formed reference op (its
/// COALESCE upsert then changes nothing) instead of a payload it
/// rejects as malformed.
pub fn build_revocation_payload(
    blob_hash: &str,
    mime_type: Option<&str>,
    size_bytes: i64,
    object_key: &str,
    hlc_ts: i64,
) -> AttachmentBlobPayload {
    AttachmentBlobPayload {
        op: "attachment_blob".into(),
        blob_hash: blob_hash.into(),
        mime_type: mime_type.map(|s| s.to_string()),
        size_bytes,
        chunks_b64: Vec::new(),
        object_key: Some(object_key.to_string()),
        // The object is being deleted; there is nothing left to open,
        // so there is no epoch to name.
        object_epoch: None,
        revoked: Some(true),
        // A retraction names no name — it removes an object, not content.
        filename: None,
        hlc_ts,
    }
}

/// Does this op retract a reference rather than publish one?
///
/// Checked BEFORE `payload_is_reference` on the receive side: a
/// revocation is reference-shaped (no chunks) and would otherwise be
/// merged as a fresh reference, re-arming the 404 loop it exists to
/// end. A revocation with no `object_key` names nothing and is not a
/// revocation — see `build_revocation_payload`.
pub fn payload_is_revocation(p: &AttachmentBlobPayload) -> bool {
    p.revoked == Some(true) && p.object_key.is_some()
}

/// Which epoch key opens the object this reference names.
///
/// Absent means 0, and that is a fact rather than a guess: the only ops
/// that can lack `object_epoch` were emitted before the field existed,
/// by a build whose upload path sealed every object with
/// `user_keys.content_master_key` — the epoch-0 key — regardless of the
/// account's current epoch. So epoch 0 is precisely what those objects
/// were sealed under, and reading them any other way would fail.
pub fn object_epoch_of(p: &AttachmentBlobPayload) -> i64 {
    p.object_epoch.unwrap_or(0)
}

/// Does this op carry its bytes, or point at them?
///
/// Deliberately still decided by `chunks_b64` alone and NOT by
/// `object_key`: a reference op emitted by an early build of this branch
/// has no object key, and it is still a reference (there are no bytes in
/// it). Deciding on the key instead would send those ops down the inline
/// path, where `reassemble` would hand back zero bytes for a nonzero
/// `size_bytes`. The legacy inline op on the live relay (user_seq 524)
/// depends on this predicate too.
pub fn payload_is_reference(p: &AttachmentBlobPayload) -> bool {
    p.chunks_b64.is_empty()
}

pub fn reassemble(payload: &AttachmentBlobPayload) -> Result<Vec<u8>, String> {
    use base64::engine::general_purpose::STANDARD as B64;
    use base64::Engine;
    // Validate the relay-controlled declared size BEFORE allocating. A
    // negative or oversized `size_bytes` is rejected outright rather than
    // trusted into `with_capacity`.
    if payload.size_bytes < 0 || payload.size_bytes as u64 > MAX_BLOB_BYTES as u64 {
        return Err(format!(
            "attachment size_bytes {} out of range (0..={})",
            payload.size_bytes, MAX_BLOB_BYTES
        ));
    }
    let declared = payload.size_bytes as usize;
    let mut out = Vec::with_capacity(declared);
    for c in &payload.chunks_b64 {
        let bytes = B64.decode(c).map_err(|e| format!("chunk b64: {e}"))?;
        // Bound the running total so a short `size_bytes` paired with a long
        // chunk list can't grow `out` past the declared (already-capped) size.
        if out.len() + bytes.len() > declared {
            return Err("attachment chunks exceed declared size_bytes".to_string());
        }
        out.extend_from_slice(&bytes);
    }
    if out.len() != declared {
        return Err(format!(
            "attachment reassembled {} bytes, declared {}",
            out.len(),
            declared
        ));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    #[test]
    fn round_trip_preserves_bytes() {
        let bytes: Vec<u8> = (0..600_000).map(|i| (i % 251) as u8).collect();
        let mut h = Sha256::new();
        h.update(&bytes);
        let hash = hex::encode(h.finalize());
        let payload = build_payload(&hash, Some("application/octet-stream"), &bytes, 42);
        let got = reassemble(&payload).unwrap();
        assert_eq!(got, bytes);
        assert!(payload.chunks_b64.len() >= 3);
    }

    #[test]
    fn reassemble_rejects_absurd_size_bytes() {
        // A malicious relay sets size_bytes = i64::MAX with a tiny chunk
        // list; reassemble must reject BEFORE the with_capacity allocation
        // (security audit H2) rather than abort the process.
        let payload = AttachmentBlobPayload {
            op: "attachment_blob".into(),
            blob_hash: "00".into(),
            mime_type: None,
            size_bytes: i64::MAX,
            chunks_b64: vec![],
            object_key: None,
            object_epoch: None,
            revoked: None,
            filename: None,
            hlc_ts: 0,
        };
        assert!(reassemble(&payload).is_err());
    }

    #[test]
    fn reassemble_rejects_negative_size_bytes() {
        let payload = AttachmentBlobPayload {
            op: "attachment_blob".into(),
            blob_hash: "00".into(),
            mime_type: None,
            size_bytes: -1,
            chunks_b64: vec![],
            object_key: None,
            object_epoch: None,
            revoked: None,
            filename: None,
            hlc_ts: 0,
        };
        assert!(reassemble(&payload).is_err());
    }

    #[test]
    fn a_reference_payload_carries_no_bytes() {
        let p = build_reference_payload(
            "d".repeat(64).as_str(),
            Some("image/png"),
            1_284_326,
            &"9".repeat(64),
            0,
            0,
        );
        assert!(p.chunks_b64.is_empty(), "the bytes belong in the object, not the op");
        assert_eq!(p.size_bytes, 1_284_326);
        assert!(payload_is_reference(&p));
    }

    /// A reference has to carry BOTH addresses: the relay key to GET by
    /// and the local sha256 to verify the decrypted result against. If
    /// only one survived serialisation the receiver could either not
    /// fetch at all, or fetch and have to trust the relay.
    #[test]
    fn a_reference_payload_carries_both_addresses_over_the_wire() {
        let blob_hash = "d".repeat(64);
        let object_key = "7".repeat(64);
        let p = build_reference_payload(&blob_hash, Some("image/png"), 99, &object_key, 3, 0);
        let round: AttachmentBlobPayload =
            serde_json::from_str(&serde_json::to_string(&p).unwrap()).unwrap();
        assert_eq!(round.blob_hash, blob_hash, "sha256(plaintext): the local address");
        assert_eq!(
            round.object_key.as_deref(),
            Some(object_key.as_str()),
            "blake3(ciphertext): the relay address, the only one that can be in the URL"
        );
        assert_eq!(
            object_epoch_of(&round),
            3,
            "the epoch the object was sealed under is the third thing a receiver needs: \
             fetch by object_key, decrypt with this, verify against blob_hash"
        );
    }

    /// The epoch travels with the reference rather than being inferred
    /// from the op's own epoch. A rotation can land between the PUT and
    /// the emit, and a peer pulls this op on whatever epoch it is on
    /// later — neither of those is the epoch the bytes were sealed under.
    #[test]
    fn a_non_zero_object_epoch_survives_the_wire() {
        let p = build_reference_payload(&"a".repeat(64), None, 10, &"b".repeat(64), 7, 0);
        let raw = serde_json::to_string(&p).unwrap();
        assert!(raw.contains("\"object_epoch\":7"), "not on the wire: {raw}");
        let round: AttachmentBlobPayload = serde_json::from_str(&raw).unwrap();
        assert_eq!(object_epoch_of(&round), 7);
    }

    /// ABSENT MEANS 0, AND THAT IS NOT A FALLBACK.
    ///
    /// Reference ops emitted before this field existed were sealed by an
    /// upload path that used `user_keys.content_master_key` for every
    /// object no matter the account's epoch — and that key IS epoch 0's.
    /// So 0 is the epoch those objects were genuinely sealed under, and
    /// this default reads them correctly rather than guessing.
    #[test]
    fn an_absent_object_epoch_is_epoch_zero_because_that_is_what_it_was_sealed_under() {
        let raw = serde_json::json!({
            "op": "attachment_blob",
            "blob_hash": "a".repeat(64),
            "mime_type": "image/png",
            "size_bytes": 1234,
            "chunks_b64": [],
            "object_key": "b".repeat(64),
            "hlc_ts": 7
        });
        let p: AttachmentBlobPayload = serde_json::from_value(raw).unwrap();
        assert!(p.object_epoch.is_none(), "the field genuinely isn't there");
        assert_eq!(object_epoch_of(&p), 0);
    }

    /// An op that predates the object key — either a legacy inline one
    /// or a reference emitted by an early build of this branch — must
    /// still deserialise, with `object_key: None`. A client that
    /// rejected the missing field would wedge its pull loop on the op
    /// already committed at user_seq 524.
    #[test]
    fn a_payload_without_the_object_key_field_still_deserialises() {
        let raw = serde_json::json!({
            "op": "attachment_blob",
            "blob_hash": "a".repeat(64),
            "mime_type": "image/png",
            "size_bytes": 1234,
            "chunks_b64": [],
            "hlc_ts": 7
        });
        let p: AttachmentBlobPayload = serde_json::from_value(raw).unwrap();
        assert!(p.object_key.is_none());
        assert!(payload_is_reference(&p), "no chunks is still a reference");
    }

    #[test]
    fn a_legacy_inline_payload_is_not_a_reference() {
        // One of these is already committed on the live relay (user_seq 524)
        // and older clients keep producing them. The receive side must be able
        // to tell them apart forever.
        let p = build_payload("e".repeat(64).as_str(), Some("image/png"), &[1, 2, 3], 0);
        assert!(!p.chunks_b64.is_empty());
        assert!(!payload_is_reference(&p));
    }

    #[test]
    fn reassemble_rejects_chunks_exceeding_declared_size() {
        // size_bytes understates the actual chunk bytes — the running-total
        // guard must catch it so `out` can't grow past the declared size.
        let bytes = vec![7u8; 1000];
        let mut payload = build_payload("00", None, &bytes, 0);
        payload.size_bytes = 10; // lie: claim 10, ship 1000
        assert!(reassemble(&payload).is_err());
    }

    /// A revocation names the object it retracts and says so over the
    /// wire. Without `object_key` a receiver could not tell WHICH object
    /// died, and would have to either clear a key it never published or
    /// ignore the retraction entirely.
    #[test]
    fn a_revocation_carries_the_object_key_it_retracts() {
        let p = build_revocation_payload(&"a".repeat(64), Some("image/png"), 4096, &"b".repeat(64), 0);
        assert!(payload_is_revocation(&p));
        let raw = serde_json::to_string(&p).unwrap();
        assert!(raw.contains("\"revoked\":true"), "not on the wire: {raw}");
        let round: AttachmentBlobPayload = serde_json::from_str(&raw).unwrap();
        assert!(payload_is_revocation(&round));
        assert_eq!(round.object_key.as_deref(), Some("b".repeat(64).as_str()));
    }

    /// An ordinary reference must never read as a retraction, and must
    /// not grow a `revoked` key on the wire — the field is absent on
    /// every op shape that existed before it.
    #[test]
    fn a_reference_is_not_a_revocation_and_carries_no_revoked_field() {
        let p = build_reference_payload(&"a".repeat(64), None, 10, &"b".repeat(64), 2, 0);
        assert!(!payload_is_revocation(&p));
        let raw = serde_json::to_string(&p).unwrap();
        assert!(!raw.contains("revoked"), "the field leaked onto a reference op: {raw}");
    }

    /// `revoked: true` with no object key names nothing. It is treated
    /// as an ordinary (keyless) reference rather than as a retraction —
    /// asserting the negative because the alternative is worse than
    /// ignoring it: a receiver acting on it would have to clear
    /// whatever key its row happens to hold, including one uploaded by
    /// a third device that is still perfectly alive on the relay.
    #[test]
    fn a_revocation_with_no_object_key_retracts_nothing() {
        let raw = serde_json::json!({
            "op": "attachment_blob",
            "blob_hash": "a".repeat(64),
            "mime_type": Option::<String>::None,
            "size_bytes": 10,
            "chunks_b64": [],
            "revoked": true,
            "hlc_ts": 1
        });
        let p: AttachmentBlobPayload = serde_json::from_value(raw).unwrap();
        assert!(!payload_is_revocation(&p));
    }

    #[test]
    fn the_ceiling_admits_a_hundred_megabyte_attachment() {
        // The product ceiling is 100 MB (insert_attachment rejects above it,
        // attachments/commands.rs:84). The receive guard must not sit below
        // what the send side accepts, or a file uploads fine and is then
        // refused by the other device.
        assert!(MAX_BLOB_BYTES >= 100 * 1024 * 1024);
    }

    // An op emitted before `filename` existed has no such key. It MUST still
    // deserialise — a peer on the new build pulling an old peer's reference,
    // and this build reading its own earlier ops. `#[serde(default)]` gives
    // None, and the receiver falls back to the hash, which is exactly the
    // behaviour before this field.
    #[test]
    fn a_payload_without_filename_deserialises_to_none() {
        let json = serde_json::json!({
            "op": "attachment_blob",
            "blob_hash": "a".repeat(64),
            "mime_type": "image/png",
            "size_bytes": 10,
            "chunks_b64": [],
            "object_key": "b".repeat(64),
            "object_epoch": 0,
            "hlc_ts": 0
        })
        .to_string();
        let p: AttachmentBlobPayload = serde_json::from_str(&json).unwrap();
        assert_eq!(p.filename, None);
    }

    // A filename set on the payload survives the wire round-trip, so the
    // receiving device shows the real name instead of the blob_hash.
    #[test]
    fn filename_round_trips_through_serialisation() {
        let mut p = build_reference_payload(
            &"a".repeat(64), Some("image/png"), 10, &"b".repeat(64), 0, 0,
        );
        // build_reference_payload leaves it None; emit fills it in. Simulate.
        p.filename = Some("golden-retriever.jpg".to_string());
        let round: AttachmentBlobPayload =
            serde_json::from_str(&serde_json::to_string(&p).unwrap()).unwrap();
        assert_eq!(round.filename.as_deref(), Some("golden-retriever.jpg"));
    }

    // The builder itself does not set a name — the emit path does, from the
    // row. This pins that contract so a future refactor does not quietly
    // start sending a name the builder cannot know is correct.
    #[test]
    fn the_reference_builder_leaves_filename_for_the_emit_path() {
        let p = build_reference_payload(
            &"a".repeat(64), None, 10, &"b".repeat(64), 0, 0,
        );
        assert_eq!(p.filename, None);
    }
}
