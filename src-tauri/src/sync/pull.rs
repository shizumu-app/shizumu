//! Pull-pass orchestrator: walks the relay's per-user log forward
//! from `last_seen_user_seq`, fetches each blob, decrypts it, and
//! parks the result in op_log with state='received'.
//!
//! Phase 14.7 scope is a SKELETON. `apply_remote_op` is wired up but
//! only writes received rows to op_log — it does NOT fold the
//! decrypted payload back into pages / lineages / pins / settings
//! tables. The real merge surface (CRDT-aware, idempotent by user_seq
//! and by content) is its own slice; this commit gives the wire path
//! the place to live and proves end-to-end transit.
//!
//! Re-entrant: a crash mid-pass leaves `last_seen_user_seq` un-bumped
//! for any op that didn't make it all the way to a 'received' row, so
//! the next pass picks up from the right place.

use crate::db::Db;
use crate::sync::config::{self, SyncConfig};
use crate::sync::keys::{DeviceKeys, UserKeys};
use crate::sync::wire::pull::{get_blob, get_ops, RemoteOp};
use crate::sync::wire::WireError;
use rusqlite::{params, Connection};

/// How many ops per GET /ops batch. Spec §5.4 caps `limit` at 500; we
/// pick a smaller value so a single failure has less to re-pull.
pub const PULL_BATCH_LIMIT: i64 = 100;

#[derive(Debug, Default, Clone)]
pub struct PullStats {
    pub batches: usize,
    pub ops_fetched: usize,
    pub ops_received: usize,
    pub ops_skipped_duplicate: usize,
    pub ops_skipped_decrypt_error: usize,
}

#[derive(Debug)]
pub enum PullError {
    Db(String),
    Wire(WireError),
}

impl std::fmt::Display for PullError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PullError::Db(s) => write!(f, "db: {s}"),
            PullError::Wire(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for PullError {}

impl From<rusqlite::Error> for PullError {
    fn from(e: rusqlite::Error) -> Self {
        PullError::Db(e.to_string())
    }
}

impl From<WireError> for PullError {
    fn from(e: WireError) -> Self {
        PullError::Wire(e)
    }
}

/// Run one pull pass. Returns when the relay reports `has_more=false`
/// or a wire error stops progress.
pub fn run_pass(
    db: &Db,
    cfg: &SyncConfig,
    user_keys: &UserKeys,
    device_keys: &DeviceKeys,
) -> Result<PullStats, PullError> {
    if !cfg.is_active() {
        return Ok(PullStats::default());
    }
    let relay = cfg
        .relay_url
        .as_deref()
        .expect("is_active() guarantees relay_url");
    let user_id = cfg
        .user_id
        .as_deref()
        .expect("is_active() guarantees user_id");

    let mut stats = PullStats::default();
    let mut cursor = cfg.last_seen_user_seq;

    loop {
        // GET /ops is HTTP — no lock held.
        let resp = get_ops(relay, device_keys, user_id, cursor, Some(PULL_BATCH_LIMIT), None)?;
        if resp.ops.is_empty() {
            break;
        }
        stats.batches += 1;
        stats.ops_fetched += resp.ops.len();

        // Process in user_seq order so the cursor advances
        // monotonically even if a mid-batch fetch fails.
        // Secondary sort: lineage_op before page_blob before pin_op
        // so create ops land before the content ops that depend on them.
        let mut sorted = resp.ops;
        sorted.sort_by(|a, b| {
            a.user_seq.cmp(&b.user_seq).then_with(|| {
                fn kind_order(k: &str) -> u8 {
                    match k {
                        "setting_op" => 0,
                        "lineage_op" => 1,
                        "page_blob" => 2,
                        "pin_op" => 3,
                        "page_yjs" => 4,
                        "tombstone" => 5,
                        _ => 6,
                    }
                }
                kind_order(&a.op_kind).cmp(&kind_order(&b.op_kind))
            })
        });

        let mut merge_blocked = false;
        for op in sorted {
            let seq = op.user_seq;
            // ingest_one releases the lock around its own HTTP blob fetch.
            let outcome = ingest_one(db, user_keys, relay, device_keys, user_id, &op)?;
            let advance = match outcome {
                IngestOutcome::Stored => {
                    stats.ops_received += 1;
                    true
                }
                IngestOutcome::DuplicateSkipped => {
                    stats.ops_skipped_duplicate += 1;
                    true
                }
                IngestOutcome::DecryptError => {
                    stats.ops_skipped_decrypt_error += 1;
                    true
                }
                IngestOutcome::MergeFailed => {
                    // The op_log row is parked with a non-null
                    // merge_error. replay_failed_merges runs at the
                    // start of every worker tick — it picks the row
                    // back up and clears the error on success, which
                    // unblocks cursor advancement on a later pass.
                    false
                }
            };
            // Only advance the cursor for ops we successfully handled
            // (including duplicates and decrypt-errors — those are
            // terminal, retry won't change them). Merge failures hold
            // the cursor so the op stays at the head of the queue
            // until replay_failed_merges clears it.
            if advance && seq > cursor {
                cursor = seq;
                let conn = db.lock().map_err(|e| PullError::Db(e.to_string()))?;
                config::set_last_seen_user_seq(&conn, cursor)?;
            } else if !advance {
                // Stop processing this batch AND this pass — the
                // cursor is parked until merge_error clears. Continuing
                // past this op would skip later ops that may depend on
                // the parked one's state (e.g. an update_pin_content
                // op after a failed create_pin).
                merge_blocked = true;
                break;
            }
        }

        if merge_blocked || !resp.has_more {
            break;
        }
    }
    Ok(stats)
}

#[derive(Debug)]
enum IngestOutcome {
    Stored,
    DuplicateSkipped,
    DecryptError,
    /// The op_log row was written but the domain-table merge failed
    /// (handler returned Err or SkippedMalformed). The row carries a
    /// non-null `merge_error` so `replay_failed_merges` can retry.
    MergeFailed,
}

fn ingest_one(
    db: &Db,
    user_keys: &UserKeys,
    relay: &str,
    device_keys: &DeviceKeys,
    user_id: &str,
    op: &RemoteOp,
) -> Result<IngestOutcome, PullError> {
    // Dedup by user_seq — the relay's monotonic identifier. If we
    // already have a row for this seq (because we uploaded it, or a
    // prior pass landed it), don't re-ingest. Quick lock + release
    // before the slow blob fetch.
    // Same short lock: dedup by user_seq AND resolve the content key for
    // this op's epoch (epoch >= 1 keys live in the DB, so this must happen
    // under the lock, before the lock-free blob fetch/decrypt below).
    // Same short lock: dedup by user_seq AND resolve the content key + the
    // epoch's user-signing pubkey (both from the epoch secret in the DB, so
    // resolve under the lock before the lock-free blob fetch/decrypt below).
    let (already_have, content_key, epoch_sign_pub) = {
        let conn = db.lock().map_err(|e| PullError::Db(e.to_string()))?;
        let have: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM op_log WHERE user_seq = ?)",
                params![op.user_seq],
                |r| r.get::<_, i64>(0).map(|v| v != 0),
            )
            .map_err(|e| PullError::Db(e.to_string()))?;
        let key = crate::sync::epoch::content_master_key_for_epoch(&conn, user_keys, op.epoch)
            .map_err(PullError::Db)?;
        let sign_pub = crate::sync::epoch::user_sign_pub_for_epoch(&conn, user_keys, op.epoch)
            .map_err(PullError::Db)?;
        (have, key, sign_pub)
    };
    if already_have {
        return Ok(IngestOutcome::DuplicateSkipped);
    }
    // No key for this epoch -> this device isn't entitled to read it (e.g.
    // it was revoked before the rotation that produced this epoch). Skip
    // without poisoning the cursor; the op stays unreadable by design.
    let Some(content_key) = content_key else {
        log::warn!(
            "pull: no content key for epoch {} (user_seq={}) — skipping (not entitled)",
            op.epoch,
            op.user_seq
        );
        return Ok(IngestOutcome::DecryptError);
    };

    // Fetch + decrypt — NO LOCK during this HTTP call. Decrypt is CPU
    // only. A decrypt failure means the blob is corrupt or not for us;
    // log and skip rather than poison the cursor.
    let ciphertext = get_blob(relay, device_keys, user_id, &op.blob_hash)?;
    let opened = match crate::sync::op_auth::open_authored(&content_key, &ciphertext) {
        Ok(o) => o,
        Err(e) => {
            log::warn!(
                "pull: open failed for user_seq={} blob_hash={} ({e:?}) — skipping",
                op.user_seq,
                op.blob_hash
            );
            return Ok(IngestOutcome::DecryptError);
        }
    };
    let op_id = opened.op_id;
    // Verify per-op authorship (key rotation plan 5 / C1). Authored ops must
    // verify against the epoch's user-signing key (derived locally from our
    // epoch secret). Legacy unsigned ops (pre-plan-5) are accepted as before
    // — they still required the content key to decrypt.
    if let Some(authored) = &opened.authored {
        match &epoch_sign_pub {
            Some(pk) if crate::sync::op_auth::verify_authored(&op_id, authored, &opened.payload, pk) => {}
            _ => {
                log::warn!(
                    "pull: op author verification failed for user_seq={} (epoch {}) — skipping",
                    op.user_seq,
                    op.epoch
                );
                return Ok(IngestOutcome::DecryptError);
            }
        }
    }
    let plaintext = opened.payload;

    // Re-acquire the lock to write op_log + apply the merge.
    let merge_ok = {
        let conn = db.lock().map_err(|e| PullError::Db(e.to_string()))?;
        // Dedup by op_id (content identity) in addition to user_seq. The
        // relay assigns user_seq, so a blob replayed under a fresh user_seq
        // slips past the early user_seq check; op_id is inside the AEAD
        // plaintext and is the op_log PRIMARY KEY, so checking it here makes
        // a replay an explicit no-op instead of a redundant re-merge that
        // would re-run merge side-effects (security audit C1, replay).
        let op_id_str = op_id.to_string();
        let seen: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM op_log WHERE op_id = ?)",
                params![op_id_str],
                |r| r.get::<_, i64>(0).map(|v| v != 0),
            )
            .map_err(|e| PullError::Db(e.to_string()))?;
        if seen {
            return Ok(IngestOutcome::DuplicateSkipped);
        }
        apply_remote_op(&conn, op, &op_id_str, &ciphertext, &plaintext)?
    };
    if merge_ok {
        Ok(IngestOutcome::Stored)
    } else {
        Ok(IngestOutcome::MergeFailed)
    }
}

/// Write the received op into op_log with state='received', then
/// fold the decrypted payload into the local domain tables via
/// `sync::merge::apply`. The op_log row is written FIRST so a merge
/// failure leaves an audit trail with the failure reason stamped
/// into `merge_error`; `replay_failed_merges` retries those rows on
/// every worker tick.
///
/// Returns `Ok(true)` when the merge succeeded (or was skipped for a
/// known-benign reason like stale-HLC / unknown-op), `Ok(false)` when
/// the merge reported a real failure that should hold the pull cursor.
fn apply_remote_op(
    conn: &Connection,
    op: &RemoteOp,
    op_id: &str,
    ciphertext: &[u8],
    plaintext: &[u8],
) -> rusqlite::Result<bool> {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    // doc_id_ct on the wire is base64; we store as raw bytes for the
    // existing op_log column. doc_id (plaintext) is unknown receiver-
    // side and stays NULL.
    let doc_id_ct_bytes = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &op.doc_id_ct,
    )
    .unwrap_or_default();

    // Extract the op's HLC from the decrypted payload — the sender
    // injected it via op_log/dispatch.rs::OpLogEngine::apply. Absent
    // hlc_ts is treated as 0 (pre-14.17 ops) so merge.rs falls back
    // to "any existing row wins". A bad payload still writes the
    // op_log row but the merge call below will skip it.
    let raw_hlc_ts: i64 = serde_json::from_slice::<serde_json::Value>(plaintext)
        .ok()
        .and_then(|v| v.get("hlc_ts").and_then(|v| v.as_i64()))
        .unwrap_or(0);
    // Bound a relay/peer-controlled HLC. The physical-clock component packs
    // into the high bits (hlc.rs: physical_ms << 16 | logical). A value far
    // in the future would win every LWW comparison forever and permanently
    // block legitimate edits to that row (security audit M2). Demote an
    // implausible timestamp to 0 ("any existing row wins") rather than trust
    // it; 24h of skew is generous for any legitimate device clock.
    const MAX_HLC_SKEW_MS: i64 = 24 * 60 * 60 * 1000;
    let hlc_ts = if raw_hlc_ts < 0 || (raw_hlc_ts >> 16) > now_ms + MAX_HLC_SKEW_MS {
        log::warn!(
            "pull: implausible hlc_ts {} (now_ms {}) for user_seq={} — demoting to 0",
            raw_hlc_ts,
            now_ms,
            op.user_seq
        );
        0
    } else {
        raw_hlc_ts
    };

    conn.execute(
        "INSERT OR IGNORE INTO op_log (
             op_id, op_kind, doc_id, doc_id_ct, stream_id,
             payload_blob, ciphertext,
             hlc_ts, device_id, state, user_seq,
             applied_at, created_at
         ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 'received', ?, ?, ?)",
        params![
            op_id,
            op.op_kind,
            doc_id_ct_bytes,
            op.stream_id,
            plaintext,
            ciphertext,
            hlc_ts,
            op.device_id,
            op.user_seq,
            now_ms,
            op.created_at,
        ],
    )?;

    // Fold the decrypted payload into the local domain tables. A
    // hard failure (Err or SkippedMalformed) is recorded in
    // op_log.merge_error so replay_failed_merges can retry; benign
    // outcomes (Applied / SkippedStaleHlc / SkippedUnknownKind /
    // SkippedUnknownOp) clear any prior error and let the cursor
    // advance.
    use crate::sync::merge::MergeOutcome;
    let (merge_ok, err_text): (bool, Option<String>) =
        match crate::sync::merge::apply(conn, &op.op_kind, plaintext) {
            Ok(MergeOutcome::Applied)
            | Ok(MergeOutcome::SkippedStaleHlc)
            | Ok(MergeOutcome::SkippedUnknownKind)
            | Ok(MergeOutcome::SkippedUnknownOp) => (true, None),
            Ok(MergeOutcome::SkippedMalformed) => {
                let msg = format!(
                    "skipped_malformed (op_kind={}, user_seq={})",
                    op.op_kind, op.user_seq
                );
                log::warn!("pull: merge {msg}");
                (false, Some(msg))
            }
            Err(e) => {
                let msg = format!(
                    "merge error (op_kind={}, user_seq={}): {e}",
                    op.op_kind, op.user_seq, e = e
                );
                log::warn!("pull: {msg}");
                (false, Some(msg))
            }
        };
    // Stamp / clear merge_error on the row we just inserted. A
    // subsequent successful replay will clear it; a subsequent failure
    // will overwrite with the new message.
    conn.execute(
        "UPDATE op_log SET merge_error = ? WHERE op_id = ?",
        params![err_text, op_id],
    )?;
    Ok(merge_ok)
}

/// Retry every op_log row that previously failed merge. Called at
/// the start of each worker tick so transient failures (e.g. an op
/// arriving before its dependency, a row temporarily locked by a
/// concurrent write) self-heal without manual intervention. Returns
/// the number of rows whose merge_error was cleared on this pass.
pub fn replay_failed_merges(conn: &Connection) -> Result<usize, String> {
    let mut stmt = conn
        .prepare("SELECT op_id, op_kind, payload_blob FROM op_log WHERE merge_error IS NOT NULL")
        .map_err(|e| e.to_string())?;
    let rows: Vec<(String, String, Vec<u8>)> = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Vec<u8>>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut recovered = 0;
    use crate::sync::merge::MergeOutcome;
    for (op_id, op_kind, payload) in rows {
        let recovered_this = matches!(
            crate::sync::merge::apply(conn, &op_kind, &payload),
            Ok(MergeOutcome::Applied)
                | Ok(MergeOutcome::SkippedStaleHlc)
                | Ok(MergeOutcome::SkippedUnknownKind)
                | Ok(MergeOutcome::SkippedUnknownOp)
        );
        if recovered_this {
            conn.execute(
                "UPDATE op_log SET merge_error = NULL WHERE op_id = ?",
                params![op_id],
            )
            .map_err(|e| e.to_string())?;
            recovered += 1;
        }
    }
    Ok(recovered)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::envelope::{blob_hash_hex, encrypt_op};
    use crate::sync::keys::{generate_device_keys, generate_seed_phrase, user_keys_from_phrase};
    use crate::test_helpers::test_db;
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    use httpmock::prelude::*;
    use serde_json::json;

    fn fresh_keys() -> (UserKeys, DeviceKeys) {
        let m = generate_seed_phrase();
        (user_keys_from_phrase(&m), generate_device_keys())
    }

    fn active_cfg(server_base: &str) -> SyncConfig {
        SyncConfig {
            relay_url: Some(server_base.to_string()),
            user_id: Some("u".into()),
            device_id: Some("d".into()),
            enrolled_at_ms: Some(1),
            last_seen_user_seq: 0,
            enabled: true,
            last_sync_at_ms: None,
            last_error: None,
        }
    }

    /// Inactive config: the engine stays silent.
    #[test]
    fn pull_pass_is_a_noop_when_config_is_inactive() {
        let db = test_db();
        let (uk, dk) = fresh_keys();
        let cfg = SyncConfig::default();
        let stats = run_pass(&db, &cfg, &uk, &dk).unwrap();
        assert_eq!(stats.batches, 0);
        assert_eq!(stats.ops_fetched, 0);
    }

    /// Happy path: relay serves one op + its blob; we decrypt and
    /// store it as state='received'. The cursor advances to the op's
    /// user_seq.
    #[test]
    fn pull_pass_ingests_one_received_op() {
        let server = MockServer::start();
        let (uk, dk) = fresh_keys();
        let db = test_db();

        // Pretend a peer device emitted this op: encrypt with our
        // content_master_key (single_user mode = same keys across
        // devices), publish to the mock relay's /ops + /blobs.
        let payload = br#"{"op":"create","page_id":"p-1"}"#;
        let op_uuid = uuid::Uuid::new_v4();
        let ciphertext = encrypt_op(&uk.content_master_key, &op_uuid, payload);
        let hash = blob_hash_hex(&ciphertext);

        server.mock(|when, then| {
            when.method(GET).path("/v1/users/u/ops");
            then.status(200).json_body(json!({
                "ops": [{
                    "user_seq": 5,
                    "blob_hash": &hash,
                    "blob_size": ciphertext.len() as i64,
                    "doc_id_ct": B64.encode([7u8; 32]),
                    "op_kind": "page_blob",
                    "stream_id": 1,
                    "device_id": "peer-device",
                    "created_at": 1715000000000_i64
                }],
                "has_more": false
            }));
        });
        server.mock(|when, then| {
            when.method(GET).path(format!("/v1/users/u/blobs/{hash}"));
            then.status(200).body(ciphertext.clone());
        });

        let cfg = active_cfg(&server.base_url());
        let stats = run_pass(&db, &cfg, &uk, &dk).unwrap();
        assert_eq!(stats.ops_fetched, 1);
        assert_eq!(stats.ops_received, 1);

        // op_log carries a 'received' row with the decrypted payload
        // and the relay's user_seq stamped.
        let conn = db.lock().unwrap();
        let (state, user_seq, decrypted, kind): (String, Option<i64>, Vec<u8>, String) = conn
            .query_row(
                "SELECT state, user_seq, payload_blob, op_kind FROM op_log WHERE user_seq = 5",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(state, "received");
        assert_eq!(user_seq, Some(5));
        assert_eq!(decrypted, payload);
        assert_eq!(kind, "page_blob");

        // Cursor advanced.
        let cfg2 = config::load(&conn).unwrap();
        assert_eq!(cfg2.last_seen_user_seq, 5);
    }

    /// An already-known user_seq (e.g. our own committed upload
    /// coming back through pull) is skipped rather than duplicated.
    #[test]
    fn pull_pass_skips_user_seqs_we_already_have() {
        let server = MockServer::start();
        let (uk, dk) = fresh_keys();
        let db = test_db();

        // Pre-seed a committed row at user_seq=5 (simulating one we
        // already uploaded).
        {
            let conn = db.lock().unwrap();
            conn.execute(
                "INSERT INTO op_log (op_id, op_kind, payload_blob, hlc_ts, state, user_seq, applied_at, created_at)
                 VALUES ('pre-existing', 'page_blob', X'00', 0, 'committed', 5, 0, 0)",
                [],
            )
            .unwrap();
        }

        let payload = b"irrelevant - we should skip this one";
        let op_uuid = uuid::Uuid::new_v4();
        let ciphertext = encrypt_op(&uk.content_master_key, &op_uuid, payload);
        let hash = blob_hash_hex(&ciphertext);

        server.mock(|when, then| {
            when.method(GET).path("/v1/users/u/ops");
            then.status(200).json_body(json!({
                "ops": [{
                    "user_seq": 5,
                    "blob_hash": &hash,
                    "blob_size": ciphertext.len() as i64,
                    "doc_id_ct": "AAAA",
                    "op_kind": "page_blob",
                    "stream_id": 1,
                    "device_id": "self",
                    "created_at": 1
                }],
                "has_more": false
            }));
        });

        let cfg = active_cfg(&server.base_url());
        let stats = run_pass(&db, &cfg, &uk, &dk).unwrap();
        assert_eq!(stats.ops_fetched, 1);
        assert_eq!(stats.ops_skipped_duplicate, 1);
        assert_eq!(stats.ops_received, 0);

        let conn = db.lock().unwrap();
        let row_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM op_log WHERE user_seq = 5", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(row_count, 1, "no duplicate row inserted");
    }

    /// A ciphertext encrypted with a different content_master_key (a
    /// non-shizumu byte sequence, an attacker, a wrong-tenant op) is
    /// dropped on the floor rather than poisoning the cursor.
    #[test]
    fn pull_pass_skips_undecryptable_ops() {
        let server = MockServer::start();
        let (uk, dk) = fresh_keys();
        let (other_uk, _) = fresh_keys();
        let db = test_db();

        let bad_ct = encrypt_op(
            &other_uk.content_master_key,
            &uuid::Uuid::new_v4(),
            b"not for us",
        );
        let hash = blob_hash_hex(&bad_ct);

        server.mock(|when, then| {
            when.method(GET).path("/v1/users/u/ops");
            then.status(200).json_body(json!({
                "ops": [{
                    "user_seq": 3,
                    "blob_hash": &hash,
                    "blob_size": bad_ct.len() as i64,
                    "doc_id_ct": "AAAA",
                    "op_kind": "page_blob",
                    "stream_id": 1,
                    "device_id": "rogue",
                    "created_at": 1
                }],
                "has_more": false
            }));
        });
        server.mock(|when, then| {
            when.method(GET).path(format!("/v1/users/u/blobs/{hash}"));
            then.status(200).body(bad_ct.clone());
        });

        let cfg = active_cfg(&server.base_url());
        let stats = run_pass(&db, &cfg, &uk, &dk).unwrap();
        assert_eq!(stats.ops_skipped_decrypt_error, 1);
        assert_eq!(stats.ops_received, 0);

        let conn = db.lock().unwrap();
        let inserted: i64 = conn
            .query_row("SELECT COUNT(*) FROM op_log WHERE user_seq = 3", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(inserted, 0, "undecryptable op must not land in op_log");
    }

    /// `replay_failed_merges` re-runs merge for every op_log row that
    /// carries a non-null `merge_error`, and clears the error on the
    /// rows whose merge now succeeds. This is the S3 fix: the pull
    /// pipeline parks the cursor on a merge failure, and the worker
    /// calls `replay_failed_merges` at the start of every tick so a
    /// transient failure (an op arriving before its dependency, a
    /// row temporarily locked by a concurrent write) self-heals.
    ///
    /// Setup: hand-craft two received rows.
    ///   - Row A is a valid `setting_op` whose merge succeeds. We
    ///     stamp it with `merge_error = 'simulated transient'` to
    ///     simulate a prior failed-but-now-recoverable merge.
    ///   - Row B is a `setting_op` with a malformed payload (missing
    ///     the `key` field). It returns `SkippedMalformed`, which the
    ///     replay surface treats as recoverable — there's nothing
    ///     more we can do with it and clearing the error keeps the
    ///     row from being retried forever.
    /// After `replay_failed_merges` both rows should have
    /// `merge_error IS NULL` and the function should return `2`.
    #[test]
    fn replay_failed_merges_clears_errors_on_recoverable_rows() {
        let db = test_db();
        let conn = db.lock().unwrap();

        let payload_a = br#"{"op":"set","key":"replay_marker_a","value":"a","hlc_ts":1}"#;
        let payload_b = br#"{"op":"set","value":"missing-key","hlc_ts":2}"#;

        // Park two rows in 'received' with merge_error populated.
        // payload_b is malformed (no `key`); the merge handler returns
        // SkippedMalformed which the replay surface treats as
        // recoverable (matches the Ok(SkippedMalformed) branch is
        // intentionally absent — only Applied / SkippedStaleHlc /
        // SkippedUnknownKind / SkippedUnknownOp count as recovered).
        // We use this asymmetry below to assert the contract.
        conn.execute(
            "INSERT INTO op_log (op_id, op_kind, payload_blob, hlc_ts, state, applied_at, created_at, merge_error)
             VALUES ('row-a', 'setting_op', ?, 1, 'received', 0, 0, 'simulated transient')",
            rusqlite::params![&payload_a[..]],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO op_log (op_id, op_kind, payload_blob, hlc_ts, state, applied_at, created_at, merge_error)
             VALUES ('row-b', 'setting_op', ?, 2, 'received', 0, 0, 'simulated malformed')",
            rusqlite::params![&payload_b[..]],
        )
        .unwrap();

        let recovered = replay_failed_merges(&conn).expect("replay runs");
        // Row A is the only one whose merge can succeed (Applied).
        // Row B stays parked because SkippedMalformed is not in the
        // recovered set — a malformed payload won't become valid on
        // retry, but the cursor stays blocked so the user / operator
        // can investigate.
        assert_eq!(
            recovered, 1,
            "exactly one row should have its merge_error cleared (the valid setting_op)"
        );

        let err_a: Option<String> = conn
            .query_row(
                "SELECT merge_error FROM op_log WHERE op_id = 'row-a'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(
            err_a.is_none(),
            "row-a's merge_error should be cleared after a successful replay"
        );

        let err_b: Option<String> = conn
            .query_row(
                "SELECT merge_error FROM op_log WHERE op_id = 'row-b'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(
            err_b.is_some(),
            "row-b stays parked: malformed payload is not recoverable"
        );

        // Domain table picked up row-a's setting.
        let v: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'replay_marker_a'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(v, "a");
    }

    /// has_more drives the loop. Two batches → both processed.
    #[test]
    fn pull_pass_follows_has_more_pagination() {
        let server = MockServer::start();
        let (uk, dk) = fresh_keys();
        let db = test_db();

        // Each op must merge to a benign outcome so the cursor advances
        // and `has_more` actually drives a second batch. A bare {"seq":N}
        // page_blob has no page_id, so merge returns SkippedMalformed,
        // which parks the cursor (the deliberate S3 behaviour exercised by
        // replay_failed_merges_clears_errors_on_recoverable_rows) and the
        // loop would stop after one batch. Use a valid create_new_page op.
        let make_op = |seq: i64| {
            let payload = format!(
                r#"{{"op":"create_new_page","page_id":"p-{seq}","fields":{{"date":"2026-05-20","page_number":{seq}}},"hlc_ts":{seq}}}"#
            )
            .into_bytes();
            let uuid = uuid::Uuid::new_v4();
            let ct = encrypt_op(&uk.content_master_key, &uuid, &payload);
            let hash = blob_hash_hex(&ct);
            (seq, ct, hash)
        };
        let (s1, ct1, h1) = make_op(10);
        let (s2, ct2, h2) = make_op(11);

        server.mock(|when, then| {
            when.method(GET)
                .path("/v1/users/u/ops")
                .query_param("since", "0");
            then.status(200).json_body(json!({
                "ops": [{
                    "user_seq": s1,
                    "blob_hash": &h1,
                    "blob_size": ct1.len() as i64,
                    "doc_id_ct": "AAAA",
                    "op_kind": "page_blob",
                    "stream_id": 1,
                    "device_id": "x",
                    "created_at": 1
                }],
                "has_more": true
            }));
        });
        server.mock(|when, then| {
            when.method(GET)
                .path("/v1/users/u/ops")
                .query_param("since", "10");
            then.status(200).json_body(json!({
                "ops": [{
                    "user_seq": s2,
                    "blob_hash": &h2,
                    "blob_size": ct2.len() as i64,
                    "doc_id_ct": "AAAA",
                    "op_kind": "page_blob",
                    "stream_id": 1,
                    "device_id": "x",
                    "created_at": 2
                }],
                "has_more": false
            }));
        });
        server.mock(|when, then| {
            when.method(GET).path(format!("/v1/users/u/blobs/{h1}"));
            then.status(200).body(ct1.clone());
        });
        server.mock(|when, then| {
            when.method(GET).path(format!("/v1/users/u/blobs/{h2}"));
            then.status(200).body(ct2.clone());
        });

        let cfg = active_cfg(&server.base_url());
        let stats = run_pass(&db, &cfg, &uk, &dk).unwrap();
        assert_eq!(stats.batches, 2);
        assert_eq!(stats.ops_received, 2);
        let conn = db.lock().unwrap();
        assert_eq!(config::load(&conn).unwrap().last_seen_user_seq, 11);
    }
}
