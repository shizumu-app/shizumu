use rusqlite::{params, Connection};

use super::hlc::{Hlc, HlcGenerator};
use super::op_kind::OpKind;

/// Stream-ID lanes (matches the relay's bandwidth-prioritization scheme).
pub mod stream {
    pub const SETTINGS_LINEAGES_PINS: i32 = 0;
    pub const DISCRETE_PAGES: i32 = 1;
    pub const CONTINUOUS_YJS: i32 = 2;
}

/// One mutation-as-event. Built by the command layer, handed to
/// `OpLogEngine::apply` together with the same connection that runs
/// the row-level mutation, so the op_log INSERT lands inside the same
/// SQLite transaction.
#[derive(Debug, Clone)]
pub struct Op {
    pub kind: OpKind,
    pub doc_id: Option<String>,
    pub stream_id: i32,
    pub payload: serde_json::Value,
}

/// Result of a successful `apply`. Returned mainly for test
/// inspection and for callers that want to thread the op_id through
/// downstream telemetry.
#[derive(Debug, Clone)]
pub struct AppliedOp {
    pub op_id: String,
    pub hlc: Hlc,
}

/// Bundles the HLC generator with the apply-op surface. One instance
/// per app, held as Tauri state by 13.4+.
pub struct OpLogEngine {
    hlc: HlcGenerator,
}

impl OpLogEngine {
    pub fn load(conn: &Connection) -> rusqlite::Result<Self> {
        Ok(Self {
            hlc: HlcGenerator::load(conn)?,
        })
    }

    /// Append `op` to the op_log. Caller passes the same connection
    /// that ran the mutation — both writes commit together, so a
    /// rollback drops the op_log row alongside the row it described.
    ///
    /// The op's HLC is generated here AND injected into the JSON
    /// payload (`hlc_ts` top-level field) so receivers can extract it
    /// from the encrypted plaintext alone — no separate envelope
    /// header needed. After the op_log INSERT we also stamp the
    /// affected domain row's `applied_hlc_ts`, so the same gate that
    /// merge.rs uses on remote ops also protects local writes from a
    /// stale-but-later-arriving remote overwrite.
    ///
    /// v0.3 uses a random UUID for `op_id`. v0.4 will switch to
    /// `blake3(ciphertext)` once the wire envelope is encrypted; the
    /// schema accepts either since `op_id` is just a TEXT primary key.
    pub fn apply(&self, conn: &Connection, op: Op) -> rusqlite::Result<AppliedOp> {
        let hlc = self.hlc.next(conn)?;
        let op_id = uuid::Uuid::new_v4().to_string();
        let hlc_packed = hlc.pack();

        // Inject hlc_ts into the payload so receivers can read it out
        // of the decrypted plaintext alongside `op` / `page_id`. The
        // helper preserves caller-supplied keys; emit_* never sets it.
        let mut payload = op.payload.clone();
        if let serde_json::Value::Object(obj) = &mut payload {
            obj.insert("hlc_ts".into(), serde_json::Value::from(hlc_packed));
        }
        let payload_bytes =
            serde_json::to_vec(&payload).expect("serde_json value always serializable");
        let now_ms = wall_clock_ms() as i64;

        // Stamp the op with the account's current key epoch (key rotation).
        // New ops are emitted under the current epoch's keys; until the
        // first rotation this is 0 (the phrase-derived keyring).
        let epoch = crate::sync::config::get_current_epoch(conn).unwrap_or(0);

        conn.execute(
            "INSERT INTO op_log (
                 op_id, op_kind, doc_id, stream_id, payload_blob,
                 hlc_ts, state, applied_at, created_at, epoch
             ) VALUES (?, ?, ?, ?, ?, ?, 'local_only', ?, ?, ?)",
            params![
                &op_id,
                op.kind.as_str(),
                &op.doc_id,
                op.stream_id,
                payload_bytes,
                hlc_packed,
                now_ms,
                now_ms,
                epoch,
            ],
        )?;

        // Mirror the HLC onto the domain row this op touches. The
        // domain mutation itself already ran in commands.rs above us;
        // this stamp closes the loop so a later remote op carrying an
        // older HLC for the same row gets gated out by merge.rs.
        stamp_applied_hlc(conn, &op, hlc_packed)?;

        Ok(AppliedOp { op_id, hlc })
    }
}

/// Update `applied_hlc_ts` on whichever domain row the op describes.
/// MAX(...) keeps the column monotonic across concurrent applies. The
/// match is intentionally narrow — only the op_kinds the sync engine
/// gates on receive get stamped; unknown kinds (forward-compat) are
/// no-ops. Errors propagate so the surrounding transaction rolls back
/// if the stamp fails.
fn stamp_applied_hlc(conn: &Connection, op: &Op, hlc_ts: i64) -> rusqlite::Result<()> {
    let kind = op.kind.as_str();
    match kind {
        "page_blob" | "page_yjs" => {
            if let Some(id) = op.doc_id.as_deref() {
                conn.execute(
                    "UPDATE pages SET applied_hlc_ts = MAX(applied_hlc_ts, ?) WHERE id = ?",
                    params![hlc_ts, id],
                )?;
            }
        }
        "lineage_op" => {
            if let Some(id) = op.doc_id.as_deref() {
                conn.execute(
                    "UPDATE lineages SET applied_hlc_ts = MAX(applied_hlc_ts, ?) WHERE id = ?",
                    params![hlc_ts, id],
                )?;
            }
        }
        "pin_op" => {
            if let Some(id) = op.doc_id.as_deref() {
                conn.execute(
                    "UPDATE shared_objects SET applied_hlc_ts = MAX(applied_hlc_ts, ?) WHERE id = ?",
                    params![hlc_ts, id],
                )?;
            }
        }
        "setting_op" => {
            if let Some(key) = op.payload.get("key").and_then(|v| v.as_str()) {
                conn.execute(
                    "UPDATE settings SET applied_hlc_ts = MAX(applied_hlc_ts, ?) WHERE key = ?",
                    params![hlc_ts, key],
                )?;
            }
        }
        "tombstone" => {
            // Tombstones delete rows, so there's nothing to stamp. The
            // receive-side gate uses the existing row's applied_hlc_ts
            // to decide whether to honour the delete; if the row is
            // already gone we don't need a tombstone marker for v0.4.
        }
        _ => {
            // Unknown kind — forward-compat. Do not stamp.
        }
    }
    Ok(())
}

fn wall_clock_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fresh_conn() -> Connection {
        // Apply the full migration chain so stamp_applied_hlc can touch
        // pages / lineages / shared_objects / settings without ENOENT
        // failures. Mirrors the production db.rs path; the in-memory
        // connection is otherwise identical to test_helpers::test_db().
        let conn = Connection::open_in_memory().unwrap();
        let migrations = [
            include_str!("../../migrations/001_initial.sql"),
            include_str!("../../migrations/002_settings.sql"),
            include_str!("../../migrations/003_focus_model.sql"),
            include_str!("../../migrations/004_session_markers.sql"),
            include_str!("../../migrations/005_blocks.sql"),
            include_str!("../../migrations/006_lineage.sql"),
            include_str!("../../migrations/007_content_json.sql"),
            include_str!("../../migrations/008_shared_objects.sql"),
            include_str!("../../migrations/009_shukonin_sessions.sql"),
            include_str!("../../migrations/010_trail_modes.sql"),
            include_str!("../../migrations/011_global_pins.sql"),
            include_str!("../../migrations/012_pin_auto_insert.sql"),
            include_str!("../../migrations/013_pin_pointer_semantics.sql"),
            include_str!("../../migrations/014_page_refs.sql"),
            include_str!("../../migrations/015_pin_refs.sql"),
            include_str!("../../migrations/016_op_log.sql"),
            include_str!("../../migrations/017_sync_state.sql"),
            include_str!("../../migrations/018_applied_hlc_ts.sql"),
            include_str!("../../migrations/019_pages_yjs_state.sql"),
            include_str!("../../migrations/024_epochs.sql"),
        ];
        for sql in migrations {
            for stmt in sql.split(';') {
                let trimmed = stmt.trim();
                if !trimmed.is_empty() {
                    let r = conn.execute_batch(trimmed);
                    if let Err(e) = r {
                        let msg = e.to_string();
                        if !(msg.contains("duplicate column") || msg.contains("already exists")) {
                            panic!("migration error: {msg}");
                        }
                    }
                }
            }
        }
        conn
    }

    fn count_op_log(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM op_log", [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn apply_writes_one_row() {
        let conn = fresh_conn();
        let engine = OpLogEngine::load(&conn).unwrap();

        let op = Op {
            kind: OpKind::page_blob(),
            doc_id: Some("page-1".into()),
            stream_id: stream::DISCRETE_PAGES,
            payload: json!({"text": "hello"}),
        };
        let applied = engine.apply(&conn, op).unwrap();

        assert_eq!(count_op_log(&conn), 1);

        let (kind, doc_id, stream_id, payload_blob, hlc_ts, state): (
            String,
            Option<String>,
            i64,
            Vec<u8>,
            i64,
            String,
        ) = conn
            .query_row(
                "SELECT op_kind, doc_id, stream_id, payload_blob, hlc_ts, state
                 FROM op_log WHERE op_id = ?",
                params![&applied.op_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
            )
            .unwrap();

        assert_eq!(kind, OpKind::PAGE_BLOB);
        assert_eq!(doc_id.as_deref(), Some("page-1"));
        assert_eq!(stream_id, stream::DISCRETE_PAGES as i64);
        assert_eq!(state, "local_only");
        assert_eq!(hlc_ts, applied.hlc.pack());
        let parsed: serde_json::Value = serde_json::from_slice(&payload_blob).unwrap();
        assert_eq!(parsed["text"], "hello");
    }

    #[test]
    fn hlc_is_strictly_monotonic_across_applies() {
        let conn = fresh_conn();
        let engine = OpLogEngine::load(&conn).unwrap();
        let mut prev = i64::MIN;
        for i in 0..16 {
            let op = Op {
                kind: OpKind::pin_op(),
                doc_id: Some(format!("pin-{i}")),
                stream_id: stream::SETTINGS_LINEAGES_PINS,
                payload: json!({"i": i}),
            };
            let applied = engine.apply(&conn, op).unwrap();
            let packed = applied.hlc.pack();
            assert!(
                packed > prev,
                "hlc must strictly increase across applies (prev={prev}, packed={packed})"
            );
            prev = packed;
        }
        assert_eq!(count_op_log(&conn), 16);
    }

    #[test]
    fn rolled_back_transaction_drops_op_log_row() {
        let mut conn = fresh_conn();
        let engine = OpLogEngine::load(&conn).unwrap();

        {
            let tx = conn.transaction().unwrap();
            engine
                .apply(
                    &tx,
                    Op {
                        kind: OpKind::lineage_op(),
                        doc_id: Some("lin-1".into()),
                        stream_id: stream::SETTINGS_LINEAGES_PINS,
                        payload: json!({"name": "drafts"}),
                    },
                )
                .unwrap();
            // Drop without commit — implicit rollback.
        }

        assert_eq!(
            count_op_log(&conn),
            0,
            "rolled-back transaction must drop the op_log INSERT alongside the mutation"
        );
    }

    #[test]
    fn doc_id_can_be_null_for_settings() {
        let conn = fresh_conn();
        let engine = OpLogEngine::load(&conn).unwrap();

        let applied = engine
            .apply(
                &conn,
                Op {
                    kind: OpKind::setting_op(),
                    doc_id: None,
                    stream_id: stream::SETTINGS_LINEAGES_PINS,
                    payload: json!({"key": "lock_timeout", "value": "30m"}),
                },
            )
            .unwrap();

        let doc_id: Option<String> = conn
            .query_row(
                "SELECT doc_id FROM op_log WHERE op_id = ?",
                params![&applied.op_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(doc_id, None);
    }

    #[test]
    fn forward_compat_kind_round_trips() {
        // A v0.4 peer might emit a kind v0.3 doesn't know. The engine
        // must still store it verbatim (kind comes through OpKind::new
        // which only enforces the wire-format regex).
        let conn = fresh_conn();
        let engine = OpLogEngine::load(&conn).unwrap();
        let future = OpKind::new("attachment_blob").unwrap();
        let applied = engine
            .apply(
                &conn,
                Op {
                    kind: future,
                    doc_id: Some("att-1".into()),
                    stream_id: stream::DISCRETE_PAGES,
                    payload: json!({"sha": "deadbeef"}),
                },
            )
            .unwrap();
        let kind: String = conn
            .query_row(
                "SELECT op_kind FROM op_log WHERE op_id = ?",
                params![&applied.op_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(kind, "attachment_blob");
    }
}
