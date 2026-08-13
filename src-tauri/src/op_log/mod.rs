//! Op-log foundation — Phase 13 of v0.3.0.
//!
//! Every mutation that crosses the page / lineage / pin / setting
//! surfaces is recorded here as a content-addressed audit trail, so
//! v0.4's sync engine can stream them to a self-deploy relay without
//! the v0.3 command surface having to know it exists.
//!
//! v0.3 fills `payload_blob` with serde-JSON and leaves `ciphertext`,
//! `doc_id_ct`, `device_id`, and `user_seq` NULL. v0.4 populates them
//! with encrypted envelopes once the crypto + wire layers land.
//!
//! See `docs/v0.3.0-phase13-op-log.md` for the full design.

pub mod backfill;
pub mod dispatch;
pub mod hlc;
pub mod op_kind;
pub mod stats;

pub use dispatch::{stream, AppliedOp, Op, OpLogEngine};
pub use hlc::{Hlc, HlcGenerator};
pub use op_kind::{OpKind, OpKindError};

use std::sync::Arc;

/// Tauri state handle for the op-log engine. Held alongside the `Db`
/// state. Cheap to clone (Arc).
pub type OpLog = Arc<OpLogEngine>;

impl OpLogEngine {
    /// Silent-apply: never propagates errors to the caller. Used by
    /// the v0.3 command surface so a transient op_log failure (disk
    /// full, etc.) cannot rip the user's mutation out from under them
    /// — the mutation already committed by the time this is called.
    /// Failures are logged at warn-level for soak diagnostics.
    pub fn try_apply(&self, conn: &rusqlite::Connection, op: Op) {
        let kind = op.kind.clone();
        let doc_id = op.doc_id.clone();
        if let Err(e) = self.apply(conn, op) {
            log::warn!(
                "op_log apply failed silently (kind={kind}, doc_id={doc_id:?}): {e}"
            );
        }
    }
}

/// Call-site sugar for page mutations. Equivalent to:
/// `engine.try_apply(conn, Op { kind: page_blob, doc_id: Some(page_id),
///                              stream_id: DISCRETE_PAGES, payload: ... })`.
pub fn emit_page(
    engine: &OpLog,
    conn: &rusqlite::Connection,
    page_id: &str,
    op_name: &str,
    fields: serde_json::Value,
) {
    engine.try_apply(
        conn,
        Op {
            kind: OpKind::page_blob(),
            doc_id: Some(page_id.to_string()),
            stream_id: stream::DISCRETE_PAGES,
            payload: serde_json::json!({
                "op": op_name,
                "page_id": page_id,
                "fields": fields,
            }),
        },
    );
}

/// Emit a `page_yjs` op carrying a yjs update for a continuous-trail
/// page. Goes to the CONTINUOUS_YJS stream so the relay can prioritise
/// bandwidth separately from per-day discrete-page traffic. The
/// `update_bytes` are the v2-encoded yjs delta produced by the editor;
/// `content_snapshot` is the derived TipTap JSON (FTS + legacy reader
/// fodder) so receivers don't need to run a yrs→JSON converter
/// themselves.
pub fn emit_page_yjs(
    engine: &OpLog,
    conn: &rusqlite::Connection,
    page_id: &str,
    update_bytes: &[u8],
    content_snapshot: &str,
) {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    engine.try_apply(
        conn,
        Op {
            kind: OpKind::page_yjs(),
            doc_id: Some(page_id.to_string()),
            stream_id: stream::CONTINUOUS_YJS,
            payload: serde_json::json!({
                "op": "yjs_update",
                "page_id": page_id,
                "fields": {
                    "update": B64.encode(update_bytes),
                    "content_json": content_snapshot,
                },
            }),
        },
    );
}

/// Call-site sugar for lineage mutations.
pub fn emit_lineage(
    engine: &OpLog,
    conn: &rusqlite::Connection,
    lineage_id: &str,
    op_name: &str,
    fields: serde_json::Value,
) {
    engine.try_apply(
        conn,
        Op {
            kind: OpKind::lineage_op(),
            doc_id: Some(lineage_id.to_string()),
            stream_id: stream::SETTINGS_LINEAGES_PINS,
            payload: serde_json::json!({
                "op": op_name,
                "lineage_id": lineage_id,
                "fields": fields,
            }),
        },
    );
}

/// Call-site sugar for pin (shared-object) mutations.
pub fn emit_pin(
    engine: &OpLog,
    conn: &rusqlite::Connection,
    pin_id: &str,
    op_name: &str,
    fields: serde_json::Value,
) {
    engine.try_apply(
        conn,
        Op {
            kind: OpKind::pin_op(),
            doc_id: Some(pin_id.to_string()),
            stream_id: stream::SETTINGS_LINEAGES_PINS,
            payload: serde_json::json!({
                "op": op_name,
                "pin_id": pin_id,
                "fields": fields,
            }),
        },
    );
}

/// Call-site sugar for emitting an `attachment_blob` op. Builds a
/// reference-shaped payload via `sync::wire::attachment_blob::
/// build_reference_payload` — the op names both addresses and the size;
/// the bytes themselves live in a relay object at PUT
/// /v1/users/<uid>/attachments/<object_key>. Goes on the DISCRETE_PAGES
/// stream lane — attachments piggyback on page traffic since they're
/// typically referenced from a page that just synced.
///
/// ORDER IS LOAD-BEARING: `object_key` is a required argument precisely
/// so this cannot be called before the object exists. A peer that pulls
/// a reference whose object was never uploaded sits at `has_local = 0`
/// forever. The only caller is
/// `attachments::backfill::object_upload_with`, after its PUT returned.
///
/// `object_epoch` is required for the same reason and is the epoch the
/// UPLOADER SEALED UNDER — passed in, never re-read here. It is
/// deliberately not the same value as the epoch this op gets stamped
/// with (`OpLogEngine::apply` reads `get_current_epoch` itself): a
/// rotation between the PUT and this call moves the op's epoch forward
/// while the bytes on the relay stay sealed under the older one.
///
/// `hlc_ts` in the built payload is a placeholder zero; `OpLogEngine::
/// apply` overwrites it with the actual stamp before persisting.
/// UNLIKE every other `emit_*` in this module, this one PROPAGATES its
/// failure instead of swallowing it at warn level. The others describe a
/// mutation that already committed, so a lost op is a sync gap and
/// nothing worse. This one describes an object that already exists on
/// the relay: if the op is lost, the row still carries `object_key`, so
/// nothing re-uploads it, no peer ever hears about it, and the bytes are
/// paid for forever with no reference. The caller runs the row UPDATE
/// and this emit in ONE transaction and rolls both back together — see
/// `attachments::backfill::object_upload_with`.
pub fn emit_attachment_blob(
    engine: &OpLog,
    conn: &rusqlite::Connection,
    blob_hash: &str,
    mime_type: Option<&str>,
    size_bytes: i64,
    object_key: &str,
    object_epoch: i64,
) -> Result<(), String> {
    let mut payload = crate::sync::wire::attachment_blob::build_reference_payload(
        blob_hash,
        mime_type,
        size_bytes,
        object_key,
        object_epoch,
        0,
    );
    // Carry the user-facing name so the receiving device shows it instead of
    // the blob_hash. The name lives on the row this op is being emitted for;
    // read it here rather than thread it through the upload path. A missing
    // row or a NULL name simply leaves `filename` None, which the receiver
    // already handles by falling back to the hash.
    payload.filename = conn
        .query_row(
            "SELECT filename FROM attachments WHERE blob_hash = ?1",
            rusqlite::params![blob_hash],
            |r| r.get::<_, Option<String>>(0),
        )
        .ok()
        .flatten()
        .filter(|f| !f.is_empty());
    apply_attachment_payload(engine, conn, blob_hash, payload)
}

/// Retract the reference this device published for `blob_hash`.
///
/// The op log is append-only: the reference op that told every peer to
/// GET `object_key` cannot be removed, only superseded. Emitted on the
/// on→off edge of the sync toggle, in the same transaction that clears
/// the row's `object_key`, and before the relay DELETE — so a peer
/// learns the object is gone rather than 404-ing on it every tick for
/// the life of the account.
///
/// Fallible for the same reason as [`emit_attachment_blob`]: if this op
/// is lost, the retraction never happens and the 404 loop is exactly the
/// bug it exists to prevent, so the caller rolls the whole toggle back
/// rather than proceeding to delete the object peers still believe in.
pub fn emit_attachment_revocation(
    engine: &OpLog,
    conn: &rusqlite::Connection,
    blob_hash: &str,
    mime_type: Option<&str>,
    size_bytes: i64,
    object_key: &str,
) -> Result<(), String> {
    let payload = crate::sync::wire::attachment_blob::build_revocation_payload(
        blob_hash,
        mime_type,
        size_bytes,
        object_key,
        0,
    );
    apply_attachment_payload(engine, conn, blob_hash, payload)
}

fn apply_attachment_payload(
    engine: &OpLog,
    conn: &rusqlite::Connection,
    blob_hash: &str,
    payload: crate::sync::wire::attachment_blob::AttachmentBlobPayload,
) -> Result<(), String> {
    let value = serde_json::to_value(&payload)
        .map_err(|e| format!("attachment_blob payload serialize failed: {e}"))?;
    let kind = OpKind::new("attachment_blob")
        .map_err(|e| format!("attachment_blob OpKind invalid: {e}"))?;
    engine
        .apply(
            conn,
            Op {
                kind,
                doc_id: Some(blob_hash.to_string()),
                stream_id: stream::DISCRETE_PAGES,
                payload: value,
            },
        )
        .map(|_| ())
        .map_err(|e| format!("attachment_blob op_log apply failed: {e}"))
}

/// Call-site sugar for setting mutations.
pub fn emit_setting(
    engine: &OpLog,
    conn: &rusqlite::Connection,
    key: &str,
    value: Option<&str>,
) {
    engine.try_apply(
        conn,
        Op {
            kind: OpKind::setting_op(),
            doc_id: None,
            stream_id: stream::SETTINGS_LINEAGES_PINS,
            payload: serde_json::json!({
                "op": "set",
                "key": key,
                "value": value,
            }),
        },
    );
}

#[cfg(test)]
mod emit_tests {
    use super::*;
    use crate::test_helpers::test_db;

    /// emit_page_yjs writes a row of kind `page_yjs` on the CONTINUOUS
    /// stream, with a payload carrying both base64 update bytes and a
    /// content_json snapshot. This is the wire shape merge_page_yjs
    /// expects on the receive side.
    #[test]
    fn emit_page_yjs_writes_payload_with_update_and_snapshot() {
        use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
        let db = test_db();
        let conn = db.lock().unwrap();
        let engine: OpLog = std::sync::Arc::new(OpLogEngine::load(&conn).unwrap());

        let update = vec![0x42_u8, 0x43, 0x44, 0x45];
        let snapshot = r#"{"type":"doc","content":[]}"#;
        emit_page_yjs(&engine, &conn, "p-emit", &update, snapshot);

        let (kind, stream_id, payload_blob): (String, i64, Vec<u8>) = conn
            .query_row(
                "SELECT op_kind, stream_id, payload_blob FROM op_log
                 WHERE doc_id = 'p-emit' ORDER BY hlc_ts DESC LIMIT 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(kind, "page_yjs");
        assert_eq!(stream_id, stream::CONTINUOUS_YJS as i64);

        let parsed: serde_json::Value = serde_json::from_slice(&payload_blob).unwrap();
        assert_eq!(parsed["op"], "yjs_update");
        assert_eq!(parsed["page_id"], "p-emit");
        assert_eq!(
            parsed["fields"]["update"].as_str().unwrap(),
            B64.encode(&update)
        );
        assert_eq!(parsed["fields"]["content_json"].as_str().unwrap(), snapshot);
        // dispatch.rs injects hlc_ts into payload.
        assert!(parsed["hlc_ts"].as_i64().is_some());
    }

    /// emit_page_yjs followed by merge::apply on the same connection
    /// is a full round-trip: the persisted page_yjs op decodes back
    /// into yjs_state on the page row. Proves the emit shape matches
    /// the receive parser without any wire-format drift.
    #[test]
    fn emit_then_merge_round_trips_into_yjs_state() {
        use yrs::{ReadTxn, StateVector, Text, Transact};
        let db = test_db();
        let conn = db.lock().unwrap();
        let engine: OpLog = std::sync::Arc::new(OpLogEngine::load(&conn).unwrap());

        conn.execute(
            "INSERT INTO pages (id, date, page_number, content_json, created_at, updated_at)
             VALUES ('p-rt', '2026-05-20', 1, '{}', '0', '0')",
            [],
        )
        .unwrap();

        // Build a yjs update.
        let doc = yrs::Doc::new();
        let text = doc.get_or_insert_text("body");
        {
            let mut tx = doc.transact_mut();
            text.insert(&mut tx, 0, "roundtrip");
        }
        let update = doc
            .transact()
            .encode_state_as_update_v2(&StateVector::default());
        let snapshot = r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"roundtrip"}]}]}"#;

        // Local emit lands a row in op_log (state='local_only') AND
        // stamps applied_hlc_ts on the page row (via dispatch.rs's
        // symmetry helper). It does NOT touch yjs_state — that's the
        // receive side's job. Sender owns content_json directly.
        emit_page_yjs(&engine, &conn, "p-rt", &update, snapshot);

        // Pull the payload back out as if we'd received it from a peer
        // and replay through merge::apply.
        let payload_blob: Vec<u8> = conn
            .query_row(
                "SELECT payload_blob FROM op_log WHERE doc_id = 'p-rt'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let out = crate::sync::merge::apply(&conn, "page_yjs", &payload_blob).unwrap();
        assert_eq!(out, crate::sync::merge::MergeOutcome::Applied);

        // yjs_state is now populated.
        let stored: Option<Vec<u8>> = conn
            .query_row("SELECT yjs_state FROM pages WHERE id='p-rt'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(
            stored.map(|v| !v.is_empty()).unwrap_or(false),
            "yjs_state must be populated after emit + merge round-trip"
        );
    }
}
