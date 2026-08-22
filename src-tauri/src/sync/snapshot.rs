//! A snapshot is the whole synced state of one device as a single blob.
//!
//! Why it exists: a new device used to replay every op since the account
//! began — one HTTPS round trip per op, sequentially, on a 30 s tick with
//! exponential backoff after any blip. Hundreds of round trips on a phone.
//! A snapshot is one blob: apply it, set the cursor to the seq it was taken
//! at, and pull only what came after.
//!
//! What it is NOT: a merge. `apply` refuses a device that already holds
//! writing. Ops are the only thing that may change a non-empty device,
//! because ops carry the HLC stamps the merge rules gate on.
//!
//! Encoding is column-generic on purpose: rows are read with `SELECT *`
//! and written back by column name, intersected with the receiving
//! schema, so a migration that adds a column never breaks an older
//! snapshot and a newer snapshot never breaks an older app. BLOBs ride as
//! `{"$b64": "…"}` so yjs_state survives the JSON hop intact.

use std::collections::BTreeMap;
use std::io::{Read, Write};

use rusqlite::types::ValueRef;
use rusqlite::{params_from_iter, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub const SNAPSHOT_V: u32 = 1;
pub const SNAPSHOT_TABLES: &[&str] = &["lineages", "pages", "shared_objects", "settings"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Snapshot {
    pub v: u32,
    pub user_seq: i64,
    pub taken_at_ms: i64,
    pub tables: BTreeMap<String, Vec<Map<String, Value>>>,
}

pub fn is_empty(conn: &Connection) -> rusqlite::Result<bool> {
    for t in ["lineages", "pages", "shared_objects"] {
        let n: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM {t}"), [], |r| r.get(0))?;
        if n > 0 {
            return Ok(false);
        }
    }
    Ok(true)
}

fn cell_to_json(v: ValueRef<'_>) -> Value {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Value::from(i),
        ValueRef::Real(f) => Value::from(f),
        ValueRef::Text(t) => Value::from(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => serde_json::json!({ "$b64": B64.encode(b) }),
    }
}

fn json_to_cell(v: &Value) -> rusqlite::types::Value {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    use rusqlite::types::Value as Sv;
    match v {
        Value::Null => Sv::Null,
        Value::Bool(b) => Sv::Integer(*b as i64),
        Value::Number(n) => n
            .as_i64()
            .map(Sv::Integer)
            .or_else(|| n.as_f64().map(Sv::Real))
            .unwrap_or(Sv::Null),
        Value::String(s) => Sv::Text(s.clone()),
        // `unwrap_or_default()` here would silently turn a corrupted $b64
        // payload into an empty blob. That's fine only because `decode`
        // (the sole path bytes take before reaching `apply`) already
        // validated every $b64 payload in the snapshot via
        // `validate_base64` and refused the whole snapshot on failure.
        Value::Object(o) => match o.get("$b64").and_then(Value::as_str) {
            Some(b) => Sv::Blob(B64.decode(b).unwrap_or_default()),
            None => Sv::Text(v.to_string()),
        },
        Value::Array(_) => Sv::Text(v.to_string()),
    }
}

/// Walks every cell of every table and confirms any `{"$b64": "…"}`
/// payload actually decodes. Called from `decode` so a corrupted or
/// tampered snapshot is refused before `apply` ever runs — `json_to_cell`
/// itself stays infallible and defaults a bad payload to an empty blob,
/// which is safe only because this check already ran.
fn validate_base64(s: &Snapshot) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    for (table, rows) in &s.tables {
        for row in rows {
            for (col, val) in row {
                if let Some(b) = val.as_object().and_then(|o| o.get("$b64")).and_then(Value::as_str)
                {
                    if B64.decode(b).is_err() {
                        return Err(format!("snapshot: invalid base64 in {table}.{col}"));
                    }
                }
            }
        }
    }
    Ok(())
}

fn columns_of(conn: &Connection, table: &str) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let cols = stmt
        .query_map([], |r| r.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(cols)
}

pub fn capture(conn: &Connection, user_seq: i64) -> Result<Snapshot, String> {
    let mut tables = BTreeMap::new();
    for &t in SNAPSHOT_TABLES {
        let mut stmt = conn
            .prepare(&format!("SELECT * FROM {t}"))
            .map_err(|e| e.to_string())?;
        let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        let mut rows = Vec::new();
        let mut q = stmt.query([]).map_err(|e| e.to_string())?;
        while let Some(row) = q.next().map_err(|e| e.to_string())? {
            let mut m = Map::new();
            for (i, name) in names.iter().enumerate() {
                m.insert(
                    name.clone(),
                    cell_to_json(row.get_ref(i).map_err(|e| e.to_string())?),
                );
            }
            if t == "settings" {
                let key = m.get("key").and_then(Value::as_str).unwrap_or("");
                if crate::op_log::LOCAL_ONLY_SETTINGS.contains(&key) {
                    continue;
                }
            }
            rows.push(m);
        }
        tables.insert(t.to_string(), rows);
    }
    Ok(Snapshot {
        v: SNAPSHOT_V,
        user_seq,
        taken_at_ms: chrono::Utc::now().timestamp_millis(),
        tables,
    })
}

pub fn encode(s: &Snapshot) -> Result<Vec<u8>, String> {
    let json = serde_json::to_vec(s).map_err(|e| e.to_string())?;
    let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    enc.write_all(&json).map_err(|e| e.to_string())?;
    enc.finish().map_err(|e| e.to_string())
}

pub fn decode(bytes: &[u8]) -> Result<Snapshot, String> {
    let mut dec = flate2::read::GzDecoder::new(bytes);
    let mut json = Vec::new();
    dec.read_to_end(&mut json)
        .map_err(|e| format!("snapshot gunzip: {e}"))?;
    let s: Snapshot = serde_json::from_slice(&json).map_err(|e| format!("snapshot json: {e}"))?;
    if s.v != SNAPSHOT_V {
        return Err(format!(
            "snapshot version {} not understood (this app reads v{SNAPSHOT_V})",
            s.v
        ));
    }
    validate_base64(&s)?;
    Ok(s)
}

/// Returns rows written. Refuses a non-empty device outright.
///
/// Tables and cursor commit together, or not at all: the `sync_state.
/// last_seen_user_seq` write happens inside this same transaction, right
/// before `COMMIT`, rather than as a separate later write a crash could
/// land between. A crash before this function returns leaves the device
/// exactly as it was before `apply` was called — empty tables, cursor 0 —
/// never tables-populated-but-cursor-0, which would otherwise make the
/// next run's `is_empty` check see a non-empty device and fall through to
/// a full, non-deduped op replay from 0.
pub fn apply(conn: &mut Connection, s: &Snapshot) -> Result<usize, String> {
    if !is_empty(conn).map_err(|e| e.to_string())? {
        return Err(
            "snapshot refused: this device already holds writing; ops merge, snapshots do not"
                .into(),
        );
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    // lineages.parent_id and pages.parent_id self-reference their own
    // table (nested trails, nested pages), so `SELECT * FROM t` — which
    // returns rows in storage order, not creation order — can hand back a
    // child row before its parent within the same table's insert loop.
    // Deferring FK checks to COMMIT means every row in the transaction
    // exists by the time any FK is actually checked, so order within a
    // table stops mattering; a genuinely dangling reference still fails,
    // just at commit instead of at the offending INSERT.
    tx.execute_batch("PRAGMA defer_foreign_keys = ON;")
        .map_err(|e| e.to_string())?;
    let mut written = 0usize;
    // Insert in dependency order: pages reference lineages, pins reference both.
    for &t in SNAPSHOT_TABLES {
        let Some(rows) = s.tables.get(t) else {
            continue;
        };
        let local_cols = columns_of(&tx, t).map_err(|e| e.to_string())?;
        for row in rows {
            let cols: Vec<&String> = local_cols.iter().filter(|c| row.contains_key(*c)).collect();
            if cols.is_empty() {
                continue;
            }
            let placeholders = vec!["?"; cols.len()].join(",");
            let sql = format!(
                "INSERT OR IGNORE INTO {t} ({}) VALUES ({placeholders})",
                cols.iter().map(|c| c.as_str()).collect::<Vec<_>>().join(",")
            );
            let vals = cols.iter().map(|c| json_to_cell(&row[*c]));
            written += tx
                .execute(&sql, params_from_iter(vals))
                .map_err(|e| format!("{t}: {e}"))?;
        }
    }
    // Upsert rather than plain UPDATE: a device that reaches `apply` via
    // `bootstrap` already has a `sync_state` row (its `cfg` was loaded to
    // get here), but a caller that applies a snapshot directly — as the
    // round-trip test does — may not have one yet. Either way only
    // `last_seen_user_seq` is touched; an existing row's other columns
    // (relay_url, enabled, ...) are left alone.
    tx.execute(
        "INSERT INTO sync_state (id, last_seen_user_seq, enabled) VALUES (1, ?1, 0)
         ON CONFLICT(id) DO UPDATE SET last_seen_user_seq = excluded.last_seen_user_seq",
        rusqlite::params![s.user_seq],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(written)
}

/// A snapshot is worth publishing once this many ops have landed since
/// the last one — frequent enough that a bootstrapping device never
/// replays more than ~50 ops after applying it, infrequent enough that a
/// quiet 30 s tick doesn't re-upload the whole account.
pub const SNAPSHOT_EVERY_OPS: i64 = 50;

/// Upload a snapshot of this device's synced tables if enough has changed
/// since the last one. Returns `Ok(true)` when one was uploaded.
///
/// Callers run this only from a tick that uploaded nothing and pulled
/// nothing, so the local tables are exactly the state at
/// `cfg.last_seen_user_seq` — that is the seq the snapshot claims, and the
/// seq a bootstrapping device will set its cursor to (Task 6). This
/// function double-checks that invariant itself (no pending local_only /
/// pending_upload rows) rather than trusting the caller, since a wrong
/// claim here would hand a bootstrapping device a cursor ahead of what it
/// actually received.
///
/// PUT the blob before POSTing the op that lists it: the relay must have
/// the ciphertext before anything can reference its hash. Doing the PUT
/// unconditionally (rather than waiting for a `need_upload` response, as
/// the ordinary op-upload pipeline does) keeps this single-blob flow
/// deterministic — the relay dedups a re-PUT of the same content-addressed
/// hash for free.
pub fn publish(
    db: &crate::db::Db,
    cfg: &crate::sync::config::SyncConfig,
    user_keys: &crate::sync::keys::UserKeys,
    device_keys: &crate::sync::keys::DeviceKeys,
) -> Result<bool, String> {
    if !cfg.is_active() {
        return Ok(false);
    }
    let relay = cfg.relay_url.as_deref().ok_or("no relay url")?;
    let user_id = cfg.user_id.as_deref().ok_or("no user id")?;
    let cursor = cfg.last_seen_user_seq;

    let (bytes, epoch, content_key, meta_key, sign_priv) = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        let last: i64 = conn
            .query_row(
                "SELECT value FROM settings WHERE key='snapshot_last_seq'",
                [],
                |r| r.get::<_, String>(0),
            )
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(-1);
        if last >= 0 && cursor - last < SNAPSHOT_EVERY_OPS {
            return Ok(false);
        }
        // The snapshot claims `cursor` as the seq it was taken at. That
        // claim is only true if every synced table already reflects
        // everything up to `cursor` — i.e. nothing is still in flight.
        let pending: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM op_log WHERE state IN ('local_only','pending_upload')",
                [],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if pending > 0 {
            return Ok(false);
        }
        let epoch = crate::sync::config::get_current_epoch(&conn).map_err(|e| e.to_string())?;
        let snap = capture(&conn, cursor)?;
        let bytes = encode(&snap)?;
        let ck = crate::sync::epoch::content_master_key_for_epoch(&conn, user_keys, epoch)?
            .ok_or("no content key for the current epoch")?;
        let mk = crate::sync::epoch::meta_key_for_epoch(&conn, user_keys, epoch)?
            .ok_or("no meta key for the current epoch")?;
        let sp = crate::sync::epoch::user_sign_priv_for_epoch(&conn, user_keys, epoch)?
            .ok_or("no signing key for the current epoch")?;
        (bytes, epoch, ck, mk, sp)
    };

    let op_id = uuid::Uuid::new_v4();
    let ct = crate::sync::op_auth::seal_authored(&content_key, &op_id, &bytes, device_keys, &sign_priv);
    let hash = crate::sync::envelope::blob_hash_hex(&ct);
    let doc_id_ct = {
        use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
        B64.encode(crate::sync::envelope::doc_id_ct_from_bytes(&meta_key, b"snapshot"))
    };
    let size = ct.len() as u64;

    crate::sync::wire::upload::put_blob(relay, device_keys, user_id, &hash, ct)
        .map_err(|e| e.to_string())?;
    crate::sync::wire::upload::post_ops(
        relay,
        device_keys,
        user_id,
        &[crate::sync::wire::upload::OpMetadata {
            blob_hash: hash,
            blob_size: size,
            doc_id_ct,
            op_kind: crate::op_log::OpKind::SNAPSHOT.to_string(),
            stream_id: crate::op_log::stream::SNAPSHOT,
            epoch,
        }],
    )
    .map_err(|e| e.to_string())?;

    // Recorded only now that both the PUT and the POST succeeded — a
    // failure partway through must leave the old snapshot_last_seq in
    // place so the next tick's gate re-evaluates honestly instead of
    // believing a publish happened when the relay never got it.
    let conn = db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('snapshot_last_seq', ?)",
        rusqlite::params![cursor.to_string()],
    )
    .map_err(|e| e.to_string())?;
    log::info!("snapshot: published at seq {cursor} ({size} bytes)");
    Ok(true)
}

/// One-time bootstrap for a device with nothing in it: take the newest
/// snapshot on stream 3 and start the cursor there. Returns the seq the
/// cursor was moved to, or None when: the device is not empty; the cursor
/// has already moved; no snapshot exists; the entitled content key for the
/// snapshot's epoch is missing; or the snapshot blob fails to open, decode,
/// or apply (tampered, corrupt, or truncated). Every one of those None
/// cases falls through to the same place — the caller replays ops from 0,
/// exactly as before this existed — which is always safe because every op
/// is individually authenticated on the way in: a bad or unreadable
/// snapshot can never be worse than skipping it, only slower. A device
/// must not be strandable by one bad blob.
pub fn bootstrap(
    db: &crate::db::Db,
    cfg: &crate::sync::config::SyncConfig,
    user_keys: &crate::sync::keys::UserKeys,
    device_keys: &crate::sync::keys::DeviceKeys,
) -> Result<Option<i64>, crate::sync::pull::PullError> {
    use crate::sync::pull::PullError;
    if cfg.last_seen_user_seq != 0 {
        return Ok(None);
    }
    {
        let conn = db.lock().map_err(|e| PullError::Db(e.to_string()))?;
        if !is_empty(&conn).map_err(|e| PullError::Db(e.to_string()))? {
            return Ok(None);
        }
    }
    let relay = cfg.relay_url.as_deref().expect("is_active() guarantees relay_url");
    let user_id = cfg.user_id.as_deref().expect("is_active() guarantees user_id");

    // Newest snapshot = last snapshot-kind item of the stream-3 listing
    // (ascending seq). The relay is asked to filter to stream 3, but the
    // listing is otherwise untrusted wire input, so `newest` only ever
    // tracks an item that is actually `op_kind == "snapshot"` — pagination
    // still advances on the page's real last item regardless of kind.
    let mut newest = None;
    let mut since = 0;
    loop {
        let page = crate::sync::wire::pull::get_ops(relay, device_keys, user_id, since, Some(500), Some(crate::op_log::stream::SNAPSHOT))?;
        if let Some(last) = page.ops.last() {
            since = last.user_seq;
        }
        if let Some(snap) = page.ops.iter().rev().find(|o| o.op_kind == crate::op_log::OpKind::SNAPSHOT) {
            newest = Some(snap.clone());
        }
        if !page.has_more || page.ops.is_empty() {
            break;
        }
    }
    let Some(op) = newest else { return Ok(None) };

    let content_key = {
        let conn = db.lock().map_err(|e| PullError::Db(e.to_string()))?;
        crate::sync::epoch::content_master_key_for_epoch(&conn, user_keys, op.epoch).map_err(PullError::Db)?
    };
    let Some(content_key) = content_key else {
        log::warn!("snapshot bootstrap: no content key for epoch {} — falling back to op replay", op.epoch);
        return Ok(None);
    };
    let ct = crate::sync::wire::pull::get_blob(relay, device_keys, user_id, &op.blob_hash)?;

    // A snapshot that fails to open, decode, or apply (tampered, corrupt,
    // truncated, or otherwise bad) must not strand the device or poison
    // every subsequent tick with the same failure. Every op the normal
    // pull loop would replay is individually authenticated, so falling
    // back to plain op replay from 0 is never worse than trusting a
    // snapshot that didn't verify — log and return Ok(None), exactly like
    // the missing-content-key branch above, rather than propagating an
    // Err that would abort this whole pull pass and retry the identical
    // bad blob forever.
    let opened = match crate::sync::op_auth::open_authored(&content_key, &ct) {
        Ok(o) => o,
        Err(e) => {
            log::warn!("snapshot bootstrap: open failed ({e:?}) — falling back to op replay");
            return Ok(None);
        }
    };
    let snap = match decode(&opened.payload) {
        Ok(s) => s,
        Err(e) => {
            log::warn!("snapshot bootstrap: decode failed ({e}) — falling back to op replay");
            return Ok(None);
        }
    };

    let mut conn = db.lock().map_err(|e| PullError::Db(e.to_string()))?;
    let n = match apply(&mut conn, &snap) {
        Ok(n) => n,
        Err(e) => {
            log::warn!("snapshot bootstrap: apply failed ({e}) — falling back to op replay");
            return Ok(None);
        }
    };
    // apply() commits last_seen_user_seq inside its own transaction, so
    // there is no separate cursor write here to crash between.
    log::info!("snapshot bootstrap: applied {n} rows, cursor -> {}", snap.user_seq);
    Ok(Some(snap.user_seq))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::test_db;

    fn seed(conn: &rusqlite::Connection) {
        conn.execute("INSERT INTO lineages (id, name, created_at, mode) VALUES ('ln-1','kamae','2026-08-22T00:00:00Z','discrete')", []).unwrap();
        conn.execute(
            "INSERT INTO pages (id, date, page_number, lineage_id, what_matters_now, content_json, created_at, updated_at, applied_hlc_ts, hlc_content, hlc_focus, hlc_lineage)
             VALUES ('pg-1','2026-08-22',1,'ln-1','review stage 2b', ?, '2026-08-22T01:00:00Z','2026-08-22T01:00:00Z', 500, 500, 400, 300)",
            rusqlite::params![r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"hello"}]}]}"#],
        ).unwrap();
        conn.execute(
            "INSERT INTO shared_objects (id, lineage_id, source_page_id, object_type, title, content, status, position, created_at, updated_at, applied_hlc_ts)
             VALUES ('pin-1','ln-1','pg-1','note','t','{}','open',1,'2026-08-22T01:00:00Z','2026-08-22T01:00:00Z',450)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('theme','dark')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('snapshot_last_seq','12')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('sync_revoked','1')",
            [],
        )
        .unwrap();
    }

    #[test]
    fn publish_uploads_one_sealed_blob_on_stream_3_and_records_the_seq() {
        use httpmock::prelude::*;
        let server = MockServer::start();
        let db = test_db();
        { let c = db.lock().unwrap(); seed(&c);
          crate::sync::config::set_relay_url(&c, &server.base_url()).unwrap();
          crate::sync::config::set_enrollment(&c, "u", "d", 1).unwrap();
          crate::sync::config::set_enabled(&c, true).unwrap();
          crate::sync::config::set_last_seen_user_seq(&c, 120).unwrap(); }
        let (uk, dk) = crate::sync::test_keys();
        let cfg = { let c = db.lock().unwrap(); crate::sync::config::load(&c).unwrap() };

        // The blob's hash is only known after sealing, so the PUT mock
        // accepts any 64-hex hash. publish PUTs first, then POSTs the
        // listing, so both mocks can be plain and the flow is deterministic.
        let put = server.mock(|when, then| {
            when.method(PUT).path_matches(Regex::new(r"^/v1/users/u/blobs/[0-9a-f]{64}$").unwrap());
            // PutBlobResponse requires user_seq; its value doesn't matter here
            // — this test checks the upload happened, not what seq it got.
            then.status(200).json_body(serde_json::json!({"user_seq": 999}));
        });
        let post = server.mock(|when, then| {
            when.method(POST).path("/v1/users/u/ops")
                .body_contains("\"op_kind\":\"snapshot\"")
                .body_contains("\"stream_id\":3");
            then.status(200).json_body(serde_json::json!({"need_upload": [], "ack": []}));
        });

        assert!(publish(&db, &cfg, &uk, &dk).unwrap());
        assert_eq!(put.hits(), 1, "exactly one blob, uploaded before it is listed");
        post.assert();
        let rec: String = db.lock().unwrap().query_row(
            "SELECT value FROM settings WHERE key='snapshot_last_seq'", [], |r| r.get(0)).unwrap();
        assert_eq!(rec, "120");
    }

    #[test]
    fn publish_is_a_no_op_within_the_interval() {
        // The gate, stated: a snapshot is only worth its upload when enough
        // has happened since the last one. Re-publishing at every quiet
        // tick would upload the whole account every 30 s.
        use httpmock::prelude::*;
        let server = MockServer::start();
        let db = test_db();
        { let c = db.lock().unwrap(); seed(&c);
          crate::sync::config::set_relay_url(&c, &server.base_url()).unwrap();
          crate::sync::config::set_enrollment(&c, "u", "d", 1).unwrap();
          crate::sync::config::set_enabled(&c, true).unwrap();
          crate::sync::config::set_last_seen_user_seq(&c, 130).unwrap();
          c.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('snapshot_last_seq','120')", []).unwrap(); }
        let (uk, dk) = crate::sync::test_keys();
        let cfg = { let c = db.lock().unwrap(); crate::sync::config::load(&c).unwrap() };
        let post = server.mock(|when, then| { when.method(POST); then.status(500); });
        assert!(!publish(&db, &cfg, &uk, &dk).unwrap());
        assert_eq!(post.hits(), 0, "130 - 120 < SNAPSHOT_EVERY_OPS: no network at all");
    }

    #[test]
    fn capture_encode_decode_apply_round_trips_into_an_empty_device() {
        let src = test_db();
        let snap = {
            let c = src.lock().unwrap();
            seed(&c);
            capture(&c, 77).unwrap()
        };
        assert_eq!(snap.user_seq, 77);
        let bytes = encode(&snap).unwrap();
        let back = decode(&bytes).unwrap();

        let dst = test_db();
        let mut c = dst.lock().unwrap();
        let n = apply(&mut c, &back).unwrap();
        assert_eq!(
            n, 4,
            "1 lineage + 1 page + 1 pin + 1 non-local-only setting (theme), got {n}"
        );
        let (focus, content, lin, hf): (String, String, String, i64) = c
            .query_row(
                "SELECT what_matters_now, content_json, lineage_id, hlc_focus FROM pages WHERE id='pg-1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(focus, "review stage 2b");
        assert!(content.contains("hello"));
        assert_eq!(lin, "ln-1");
        assert_eq!(hf, 400, "per-field stamps travel with the row, so later ops gate correctly");
        let pins: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM shared_objects WHERE source_page_id='pg-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(pins, 1);
        // Tables and cursor commit together, inside apply's own transaction
        // — not as a separate later write the caller might crash between.
        let cursor = crate::sync::config::load(&c).unwrap().last_seen_user_seq;
        assert_eq!(cursor, 77);
    }

    #[test]
    fn local_only_settings_never_leave_the_device() {
        // sync_revoked means "this device was kicked"; snapshot_last_seq is
        // this device's own bookkeeping. Neither describes the account.
        let src = test_db();
        let snap = {
            let c = src.lock().unwrap();
            seed(&c);
            capture(&c, 1).unwrap()
        };
        let keys: Vec<String> = snap.tables["settings"]
            .iter()
            .map(|r| r["key"].as_str().unwrap().to_string())
            .collect();
        assert!(keys.contains(&"theme".to_string()));
        assert!(!keys.contains(&"sync_revoked".to_string()));
        assert!(!keys.contains(&"snapshot_last_seq".to_string()));
    }

    #[test]
    fn apply_refuses_a_device_that_already_has_writing() {
        // Not a no-op assertion: applying a snapshot over existing rows
        // would be a merge with no conflict rules, and merges are what ops
        // are for. A non-empty device must take the op path.
        let src = test_db();
        let snap = {
            let c = src.lock().unwrap();
            seed(&c);
            capture(&c, 1).unwrap()
        };
        let dst = test_db();
        let mut c = dst.lock().unwrap();
        c.execute(
            "INSERT INTO pages (id, date, page_number, created_at, updated_at) VALUES ('mine','2026-08-01',1,'0','0')",
            [],
        )
        .unwrap();
        assert!(apply(&mut c, &snap).is_err());
        let n: i64 = c.query_row("SELECT COUNT(*) FROM pages", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1, "nothing was written");
    }

    #[test]
    fn blob_columns_survive_the_json_hop() {
        let src = test_db();
        let snap = {
            let c = src.lock().unwrap();
            c.execute(
                "INSERT INTO pages (id, date, page_number, created_at, updated_at, yjs_state) VALUES ('y','2026-08-22',1,'0','0', X'0001FF')",
                [],
            )
            .unwrap();
            capture(&c, 1).unwrap()
        };
        let back = decode(&encode(&snap).unwrap()).unwrap();
        let dst = test_db();
        let mut c = dst.lock().unwrap();
        apply(&mut c, &back).unwrap();
        let blob: Vec<u8> = c
            .query_row("SELECT yjs_state FROM pages WHERE id='y'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(blob, vec![0x00, 0x01, 0xFF]);
    }

    #[test]
    fn nested_trails_apply_regardless_of_row_order() {
        // lineages.parent_id self-references lineages. Insert the child
        // before its parent (FKs off, as a real capture could see either
        // order since SELECT * has no ORDER BY) and prove `apply` — which
        // runs with FKs on — still lands both rows via deferred FK checks.
        let src = test_db();
        let snap = {
            let c = src.lock().unwrap();
            c.execute("PRAGMA foreign_keys = OFF", []).unwrap();
            c.execute(
                "INSERT INTO lineages (id, name, created_at, mode, parent_id) VALUES ('ln-child','child','0','discrete','ln-parent')",
                [],
            )
            .unwrap();
            c.execute(
                "INSERT INTO lineages (id, name, created_at, mode, parent_id) VALUES ('ln-parent','parent','0','discrete',NULL)",
                [],
            )
            .unwrap();
            c.execute("PRAGMA foreign_keys = ON", []).unwrap();
            capture(&c, 1).unwrap()
        };
        let dst = test_db();
        let mut c = dst.lock().unwrap();
        apply(&mut c, &snap).unwrap();
        let parent: String = c
            .query_row("SELECT parent_id FROM lineages WHERE id='ln-child'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(parent, "ln-parent");
    }

    #[test]
    fn decode_refuses_corrupted_base64() {
        // A tampered $b64 payload must be caught here, not silently turned
        // into an empty blob by json_to_cell inside apply.
        let mut tables = BTreeMap::new();
        tables.insert(
            "pages".to_string(),
            vec![serde_json::json!({"yjs_state": {"$b64": "not-valid-base64!!"}})
                .as_object()
                .unwrap()
                .clone()],
        );
        let snap = Snapshot { v: SNAPSHOT_V, user_seq: 1, taken_at_ms: 0, tables };
        assert!(decode(&encode(&snap).unwrap()).is_err());
    }
}
