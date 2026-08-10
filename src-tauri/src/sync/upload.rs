//! Upload-pass orchestrator: walks `op_log` rows in state='local_only',
//! encrypts each one's payload, posts metadata, uploads missing blobs,
//! and updates the row to 'committed' with the assigned user_seq.
//!
//! Designed to be re-entrant: a crash in the middle leaves rows in
//! `pending_upload`, which the next pass picks up. The relay's
//! content-addressed POST/PUT is idempotent — re-running with the
//! same op_id reproduces the same ciphertext + same blake3 hash, so
//! the relay correctly maps duplicates to the existing pending row.

use crate::db::Db;
use crate::sync::config::SyncConfig;
use crate::sync::envelope::{blob_hash_hex, doc_id_ct_from_bytes};
use crate::sync::keys::{DeviceKeys, UserKeys};
use crate::sync::wire::upload::{post_ops, put_blob, OpMetadata};
use crate::sync::wire::WireError;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use rusqlite::{params, Connection};

/// Wire-format batch size. Spec §5.4 caps `ops` at 200; we pick a
/// smaller batch so a single failure has less to retry.
pub const UPLOAD_BATCH_SIZE: usize = 50;

#[derive(Debug, Default, Clone)]
pub struct UploadStats {
    pub batches: usize,
    pub ops_posted: usize,
    pub blobs_uploaded: usize,
    pub blobs_acked: usize,
}

#[derive(Debug)]
pub enum UploadError {
    Db(String),
    Wire(WireError),
}

impl std::fmt::Display for UploadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UploadError::Db(s) => write!(f, "db: {s}"),
            UploadError::Wire(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for UploadError {}

impl From<rusqlite::Error> for UploadError {
    fn from(e: rusqlite::Error) -> Self {
        UploadError::Db(e.to_string())
    }
}

impl From<WireError> for UploadError {
    fn from(e: WireError) -> Self {
        UploadError::Wire(e)
    }
}

/// One pending op in memory while the pass is in flight.
struct PendingOp {
    op_id: String,
    op_kind: String,
    doc_id: Option<String>,
    stream_id: i32,
    payload_blob: Vec<u8>,
    ciphertext: Option<Vec<u8>>,
    epoch: i64,
}

/// Run one upload pass. Returns when there are no more local_only rows
/// or a wire error stops progress. Idempotent — safe to call as often
/// as the background scheduler likes.
///
/// Caller has already confirmed `cfg.is_active()`; if not, the pass
/// returns immediately with zero stats.
pub fn run_pass(
    db: &Db,
    cfg: &SyncConfig,
    user_keys: &UserKeys,
    device_keys: &DeviceKeys,
) -> Result<UploadStats, UploadError> {
    if !cfg.is_active() {
        return Ok(UploadStats::default());
    }
    let relay = cfg
        .relay_url
        .as_deref()
        .expect("is_active() guarantees relay_url is set");
    let user_id = cfg
        .user_id
        .as_deref()
        .expect("is_active() guarantees user_id is set");

    let mut stats = UploadStats::default();
    loop {
        let pending = {
            let conn = db.lock().map_err(|e| UploadError::Db(e.to_string()))?;
            load_local_only_batch(&conn, UPLOAD_BATCH_SIZE)?
        };
        if pending.is_empty() {
            break;
        }
        stats.batches += 1;
        let processed = process_batch(db, relay, user_id, user_keys, device_keys, pending)?;
        stats.ops_posted += processed.ops_posted;
        stats.blobs_uploaded += processed.blobs_uploaded;
        stats.blobs_acked += processed.blobs_acked;
        // Defensive: a non-empty batch that committed nothing (neither
        // acked nor uploaded) made no progress — the rows are still
        // local_only and would re-load forever. This happens if the relay's
        // ack/need_upload reference blob hashes we didn't send (a broken or
        // hostile relay). Break rather than spin; the next tick retries.
        if processed.blobs_acked + processed.blobs_uploaded == 0 {
            break;
        }
    }
    Ok(stats)
}

fn load_local_only_batch(conn: &Connection, limit: usize) -> rusqlite::Result<Vec<PendingOp>> {
    let mut stmt = conn.prepare(
        "SELECT op_id, op_kind, doc_id, stream_id, payload_blob, ciphertext, epoch
         FROM op_log
         WHERE state = 'local_only'
         ORDER BY hlc_ts ASC
         LIMIT ?",
    )?;
    let rows = stmt
        .query_map(params![limit as i64], |r| {
            Ok(PendingOp {
                op_id: r.get(0)?,
                op_kind: r.get(1)?,
                doc_id: r.get(2)?,
                stream_id: r.get(3)?,
                payload_blob: r.get(4)?,
                ciphertext: r.get(5)?,
                epoch: r.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[derive(Default)]
struct BatchOutcome {
    ops_posted: usize,
    blobs_uploaded: usize,
    blobs_acked: usize,
}

fn process_batch(
    db: &Db,
    relay: &str,
    user_id: &str,
    user_keys: &UserKeys,
    device_keys: &DeviceKeys,
    mut batch: Vec<PendingOp>,
) -> Result<BatchOutcome, UploadError> {
    // 1. Materialise ciphertext for any rows that don't have it yet.
    //    Deterministic so retries reproduce identical blob_hash.
    //    Encryption is CPU-only; persisting ciphertext is a quick local
    //    write — both run inside a single short-lived lock so the UI
    //    isn't blocked during the upcoming HTTP call.
    //    We also resolve each epoch's meta_key here (under the lock, since
    //    epoch >= 1 keys come from the DB) into a map for step 2's doc_id_ct.
    let meta_keys: std::collections::HashMap<i64, crate::sync::keys::SecretKey32> = {
        let conn = db.lock().map_err(|e| UploadError::Db(e.to_string()))?;
        for op in batch.iter_mut() {
            if op.ciphertext.is_none() {
                let op_uuid = uuid::Uuid::parse_str(&op.op_id).map_err(|e| {
                    UploadError::Db(format!("op_id {} is not a valid UUID: {e}", op.op_id))
                })?;
                // Encrypt under the op's epoch key (key rotation). Epoch 0
                // resolves to the phrase-derived content key, so pre-rotation
                // ops are unaffected. A missing epoch key on EMIT is a real
                // error — the device must hold the key for any epoch it stamps.
                let content_key = crate::sync::epoch::content_master_key_for_epoch(
                    &conn, user_keys, op.epoch,
                )
                .map_err(UploadError::Db)?
                .ok_or_else(|| {
                    UploadError::Db(format!("no content key for epoch {} on emit", op.epoch))
                })?;
                // Author-sign the op under the epoch's user-signing key so
                // receivers can verify the author (key rotation plan 5 / C1).
                let epoch_sign = crate::sync::epoch::user_sign_priv_for_epoch(
                    &conn, user_keys, op.epoch,
                )
                .map_err(UploadError::Db)?
                .ok_or_else(|| {
                    UploadError::Db(format!("no user-sign key for epoch {} on emit", op.epoch))
                })?;
                let ct = crate::sync::op_auth::seal_authored(
                    &content_key,
                    &op_uuid,
                    &op.payload_blob,
                    device_keys,
                    &epoch_sign,
                );
                persist_ciphertext(&conn, &op.op_id, &ct)?;
                op.ciphertext = Some(ct);
            }
        }
        let mut map = std::collections::HashMap::new();
        for op in batch.iter() {
            if !map.contains_key(&op.epoch) {
                let mk = crate::sync::epoch::meta_key_for_epoch(&conn, user_keys, op.epoch)
                    .map_err(UploadError::Db)?
                    .ok_or_else(|| {
                        UploadError::Db(format!("no meta key for epoch {} on emit", op.epoch))
                    })?;
                map.insert(op.epoch, mk);
            }
        }
        map
    };

    // 2. Build the OpMetadata array. doc_id_ct hashes whichever bytes
    //    the row carries — UUID string for page/lineage/pin/tombstone,
    //    op_id as a stable fallback when doc_id is NULL (settings) — under
    //    the op's epoch meta_key resolved above.
    let mut metadata: Vec<OpMetadata> = Vec::with_capacity(batch.len());
    for op in &batch {
        let ct = op
            .ciphertext
            .as_ref()
            .expect("ciphertext materialised at step 1");
        let doc_seed = op
            .doc_id
            .as_deref()
            .map(|s| s.as_bytes().to_vec())
            .unwrap_or_else(|| op.op_id.as_bytes().to_vec());
        let meta_key = meta_keys
            .get(&op.epoch)
            .expect("meta key resolved for every batch epoch in step 1");
        let id_ct = doc_id_ct_from_bytes(meta_key, &doc_seed);
        metadata.push(OpMetadata {
            blob_hash: blob_hash_hex(ct),
            blob_size: ct.len() as u64,
            doc_id_ct: B64.encode(id_ct),
            op_kind: op.op_kind.clone(),
            stream_id: op.stream_id,
            epoch: op.epoch,
        });
    }

    // 3. POST /ops — relay sorts each hash into ack vs need_upload.
    //    NO LOCK during this HTTP call: that was the v0.4 freeze bug.
    let resp = post_ops(relay, device_keys, user_id, &metadata)?;
    let mut outcome = BatchOutcome::default();
    outcome.ops_posted = batch.len();

    // 4. ACK rows go straight to committed with the relay's user_seq.
    //    Re-acquire the lock briefly for the writes; release before
    //    the next HTTP burst in step 5.
    {
        let conn = db.lock().map_err(|e| UploadError::Db(e.to_string()))?;
        for ack in &resp.ack {
            if let Some(op) = batch.iter().find(|o| {
                o.ciphertext
                    .as_ref()
                    .map(|c| blob_hash_hex(c) == ack.blob_hash)
                    .unwrap_or(false)
            }) {
                mark_committed(&conn, &op.op_id, ack.user_seq)?;
                outcome.blobs_acked += 1;
            }
        }
    }

    // 5. need_upload rows: mark as pending_upload, then PUT each blob.
    //    Each PUT is its own HTTP call, so the lock-around-DB-write
    //    pattern repeats per op rather than wrapping the whole loop.
    let need: std::collections::HashSet<&str> =
        resp.need_upload.iter().map(|s| s.as_str()).collect();
    for op in &batch {
        let ct = op.ciphertext.as_ref().unwrap();
        let hash_hex = blob_hash_hex(ct);
        if !need.contains(hash_hex.as_str()) {
            continue;
        }
        {
            let conn = db.lock().map_err(|e| UploadError::Db(e.to_string()))?;
            mark_pending_upload(&conn, &op.op_id)?;
        }
        let put = put_blob(relay, device_keys, user_id, &hash_hex, ct.clone())?;
        {
            let conn = db.lock().map_err(|e| UploadError::Db(e.to_string()))?;
            mark_committed(&conn, &op.op_id, put.user_seq)?;
        }
        outcome.blobs_uploaded += 1;
    }

    Ok(outcome)
}

fn persist_ciphertext(conn: &Connection, op_id: &str, ct: &[u8]) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE op_log SET ciphertext = ? WHERE op_id = ?",
        params![ct, op_id],
    )?;
    Ok(())
}

fn mark_pending_upload(conn: &Connection, op_id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE op_log SET state = 'pending_upload' WHERE op_id = ? AND state = 'local_only'",
        params![op_id],
    )?;
    Ok(())
}

fn mark_committed(conn: &Connection, op_id: &str, user_seq: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE op_log SET state = 'committed', user_seq = ? WHERE op_id = ?",
        params![user_seq, op_id],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::op_log::{stream as op_stream, Op, OpKind, OpLogEngine};
    use crate::sync::keys::{generate_device_keys, generate_seed_phrase, user_keys_from_phrase};
    use crate::test_helpers::test_db;
    use httpmock::prelude::*;
    use serde_json::json;

    fn fresh_keys() -> (UserKeys, DeviceKeys) {
        let m = generate_seed_phrase();
        (user_keys_from_phrase(&m), generate_device_keys())
    }

    fn active_cfg(server_base: &str) -> SyncConfig {
        SyncConfig {
            relay_url: Some(server_base.to_string()),
            user_id: Some("u-test".into()),
            device_id: Some("d-test".into()),
            enrolled_at_ms: Some(1),
            last_seen_user_seq: 0,
            enabled: true,
            last_sync_at_ms: None,
            last_error: None,
        }
    }

    fn seed_op(conn: &Connection, engine: &OpLogEngine, kind: OpKind, doc_id: Option<String>) -> String {
        engine
            .apply(
                conn,
                Op {
                    kind,
                    doc_id,
                    stream_id: op_stream::DISCRETE_PAGES,
                    payload: json!({"hello": "world"}),
                },
            )
            .unwrap()
            .op_id
    }

    /// Inactive config short-circuits — nothing in flight, nothing on
    /// the wire. The op_log's silent-engine invariant holds even if
    /// `run_pass` is wired into a startup hook.
    #[test]
    fn run_pass_is_a_noop_when_config_is_inactive() {
        let db = test_db();
        let (uk, dk) = fresh_keys();
        let cfg = SyncConfig::default();
        let stats = run_pass(&db, &cfg, &uk, &dk).unwrap();
        assert_eq!(stats.batches, 0);
        assert_eq!(stats.ops_posted, 0);
    }

    /// Happy path: one local_only op flows through POST /ops →
    /// PUT /blobs → committed, with user_seq stamped on the row.
    /// The relay-side state machine is mocked.
    #[test]
    fn run_pass_uploads_one_op_end_to_end() {
        let server = MockServer::start();
        let (uk, dk) = fresh_keys();
        let db = test_db();
        let (op_id, hash) = {
            let conn = db.lock().unwrap();
            let engine = OpLogEngine::load(&conn).unwrap();
            let op_id = seed_op(&conn, &engine, OpKind::page_blob(), Some("p-1".into()));
            let hash = hash_of(&conn, &op_id, &uk, &dk);
            (op_id, hash)
        };

        // The relay reports the blob as new (need_upload).
        let post_mock = server.mock(|when, then| {
            when.method(POST).path("/v1/users/u-test/ops");
            then.status(200).json_body(json!({
                "need_upload": [hash],
                "ack": []
            }));
        });
        let put_mock = server.mock(|when, then| {
            when.method(PUT)
                .path_contains("/v1/users/u-test/blobs/");
            then.status(200).json_body(json!({"user_seq": 11}));
        });

        let cfg = active_cfg(&server.base_url());
        let stats = run_pass(&db, &cfg, &uk, &dk).unwrap();
        post_mock.assert();
        put_mock.assert();
        assert_eq!(stats.ops_posted, 1);
        assert_eq!(stats.blobs_uploaded, 1);

        // Row landed in committed state with user_seq stamped.
        let conn = db.lock().unwrap();
        let (state, user_seq, ciphertext_some): (String, Option<i64>, bool) = conn
            .query_row(
                "SELECT state, user_seq, ciphertext IS NOT NULL FROM op_log WHERE op_id = ?",
                params![&op_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get::<_, i64>(2)? != 0)),
            )
            .unwrap();
        assert_eq!(state, "committed");
        assert_eq!(user_seq, Some(11));
        assert!(ciphertext_some, "ciphertext cached on the row");
    }

    /// Idempotent retry: if the relay already has the blob committed,
    /// POST /ops returns it in `ack` and the orchestrator skips the
    /// PUT but still stamps state='committed' + user_seq.
    #[test]
    fn run_pass_handles_acked_op_without_put() {
        let server = MockServer::start();
        let (uk, dk) = fresh_keys();
        let db = test_db();
        let (op_id, hash) = {
            let conn = db.lock().unwrap();
            let engine = OpLogEngine::load(&conn).unwrap();
            let op_id = seed_op(&conn, &engine, OpKind::lineage_op(), Some("lin-1".into()));
            let hash = hash_of(&conn, &op_id, &uk, &dk);
            (op_id, hash)
        };

        let post_mock = server.mock(|when, then| {
            when.method(POST).path("/v1/users/u-test/ops");
            then.status(200).json_body(json!({
                "need_upload": [],
                "ack": [{"blob_hash": &hash, "user_seq": 99}]
            }));
        });
        let cfg = active_cfg(&server.base_url());
        let stats = run_pass(&db, &cfg, &uk, &dk).unwrap();
        post_mock.assert();
        assert_eq!(stats.blobs_acked, 1);
        assert_eq!(stats.blobs_uploaded, 0);

        let conn = db.lock().unwrap();
        let (state, user_seq): (String, Option<i64>) = conn
            .query_row(
                "SELECT state, user_seq FROM op_log WHERE op_id = ?",
                params![&op_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(state, "committed");
        assert_eq!(user_seq, Some(99));
    }

    /// Settings ops carry doc_id = NULL. The orchestrator must still
    /// produce a non-empty doc_id_ct (it falls back to op_id). The op
    /// still uploads cleanly.
    #[test]
    fn run_pass_handles_settings_with_null_doc_id() {
        let server = MockServer::start();
        let (uk, dk) = fresh_keys();
        let db = test_db();
        let hash = {
            let conn = db.lock().unwrap();
            let engine = OpLogEngine::load(&conn).unwrap();
            let op_id = seed_op(&conn, &engine, OpKind::setting_op(), None);
            hash_of(&conn, &op_id, &uk, &dk)
        };

        server.mock(|when, then| {
            when.method(POST).path("/v1/users/u-test/ops");
            then.status(200).json_body(json!({
                "need_upload": [hash],
                "ack": []
            }));
        });
        server.mock(|when, then| {
            when.method(PUT)
                .path_contains("/v1/users/u-test/blobs/");
            then.status(200).json_body(json!({"user_seq": 3}));
        });

        let cfg = active_cfg(&server.base_url());
        let stats = run_pass(&db, &cfg, &uk, &dk).unwrap();
        assert_eq!(stats.blobs_uploaded, 1);
    }

    /// Wire errors propagate. A transport failure aborts the pass and
    /// leaves the row untouched (still local_only) so the next pass
    /// retries it.
    #[test]
    fn run_pass_propagates_wire_errors() {
        let (uk, dk) = fresh_keys();
        let db = test_db();
        let op_id = {
            let conn = db.lock().unwrap();
            let engine = OpLogEngine::load(&conn).unwrap();
            seed_op(&conn, &engine, OpKind::page_blob(), Some("p-1".into()))
        };

        let mut cfg = active_cfg("http://127.0.0.1:1");
        cfg.relay_url = Some("http://127.0.0.1:1".into());
        let err = run_pass(&db, &cfg, &uk, &dk).unwrap_err();
        assert!(matches!(err, UploadError::Wire(WireError::Transport(_))), "got {err:?}");

        let conn = db.lock().unwrap();
        let state: String = conn
            .query_row(
                "SELECT state FROM op_log WHERE op_id = ?",
                params![&op_id],
                |r| r.get(0),
            )
            .unwrap();
        // Ciphertext was persisted, but state may have advanced to
        // pending_upload only if POST succeeded. On transport failure
        // before POST returns, state stays local_only.
        assert_eq!(state, "local_only");
    }

    /// Helper: compute the blob hash for an already-seeded op by
    /// reproducing the encrypt step the orchestrator runs.
    fn hash_of(conn: &Connection, op_id: &str, uk: &UserKeys, dk: &DeviceKeys) -> String {
        let payload: Vec<u8> = conn
            .query_row(
                "SELECT payload_blob FROM op_log WHERE op_id = ?",
                params![op_id],
                |r| r.get(0),
            )
            .unwrap();
        let uuid = uuid::Uuid::parse_str(op_id).unwrap();
        // Match production: ops are sealed as authored envelopes (epoch 0
        // uses the phrase-derived user-sign key), so the blob hash must be
        // computed the same way the relay will see it.
        let ct = crate::sync::op_auth::seal_authored(
            &uk.content_master_key,
            &uuid,
            &payload,
            dk,
            &uk.user_sign_priv,
        );
        blob_hash_hex(&ct)
    }
}
