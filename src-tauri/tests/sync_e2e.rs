//! End-to-end sync roundtrip against a real shizumu-relay subprocess.
//!
//! The test boots the relay binary in `single_user` mode against a
//! temporary directory on a random localhost port, then drives:
//!
//!   1. `init-user --pub <user_sign_pub>` → harvest enrollment_token
//!   2. `enroll()` → receive (user_id, device_id), persist sync_state
//!   3. Seed three op_log rows (page / lineage / setting)
//!   4. `upload::run_pass` → assert all rows land as state='committed'
//!      with user_seq stamped
//!   5. Fresh second-device DB → `pull::run_pass` → assert the relay
//!      serves the ops back, they decrypt under the same content_master,
//!      and land as state='received' with payload_blob intact
//!
//! Gate: requires `SHIZUMU_E2E_RELAY_BIN` pointing at the relay
//! binary. When unset, the test prints a skip line and returns Ok so
//! `cargo test` stays green on machines without the relay built.

use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use rusqlite::Connection;
use shizumu_lib::op_log::{stream as op_stream, Op, OpKind, OpLogEngine};
use shizumu_lib::sync::{config, envelope, epoch as sync_epoch, keys, pull, rotation, upload, wire};
use shizumu_lib::test_helpers::test_db;

/// Pick a random unused localhost port by binding and immediately
/// releasing — the relay will bind to the same address moments later.
/// Tiny race window in theory; in practice it has been fine for ~30y.
fn pick_free_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral");
    listener.local_addr().unwrap().port()
}

/// Block until the relay's /healthz endpoint returns 200 or the
/// timeout elapses (whichever first).
fn wait_for_relay(base_url: &str, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(1))
        .build()
        .unwrap();
    while Instant::now() < deadline {
        if let Ok(r) = client.get(format!("{base_url}/healthz")).send() {
            if r.status().is_success() {
                return true;
            }
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    false
}

struct Relay {
    child: Child,
    base_url: String,
    bin: PathBuf,
    db_path: PathBuf,
    blob_root: PathBuf,
}

impl Drop for Relay {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Relay {
    fn start(bin: PathBuf, tmp: &PathBuf) -> Relay {
        let port = pick_free_port();
        let bind = format!("127.0.0.1:{port}");
        let db_path = tmp.join("relay.db");
        let blob_root = tmp.join("blobs");
        std::fs::create_dir_all(&blob_root).unwrap();

        let nonexistent_cfg = tmp.join("no-config.toml");
        let child = Command::new(&bin)
            .arg("--config")
            .arg(&nonexistent_cfg)
            .arg("serve")
            .env("SHIZUMU_BIND", &bind)
            .env("SHIZUMU_MODE", "single_user")
            .env("SHIZUMU_DB", &db_path)
            .env(
                "SHIZUMU_STORAGE",
                format!("fs:///{}", blob_root.display().to_string().trim_start_matches('/')),
            )
            .env("SHIZUMU_LOG_LEVEL", "warn")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn relay");

        let base_url = format!("http://{bind}");
        if !wait_for_relay(&base_url, Duration::from_secs(10)) {
            panic!("relay did not become healthy at {base_url} within 10s");
        }

        Relay {
            child,
            base_url,
            bin,
            db_path,
            blob_root,
        }
    }

    /// Run `init-user --pub <b64>` and parse the enrollment_token line
    /// from stdout. The relay's CLI prints:
    ///
    ///   user_id:           <uuid>
    ///   enrollment_token:  <hex>
    ///   expires_at:        <ms>
    fn init_user(&self, user_sign_pub_b64: &str) -> (String, String) {
        let nonexistent_cfg = self.db_path.parent().unwrap().join("no-config.toml");
        let out = Command::new(&self.bin)
            .arg("--config")
            .arg(&nonexistent_cfg)
            .arg("init-user")
            .arg("--pub")
            .arg(user_sign_pub_b64)
            .env("SHIZUMU_MODE", "single_user")
            .env("SHIZUMU_DB", &self.db_path)
            .env(
                "SHIZUMU_STORAGE",
                format!("fs:///{}", self.blob_root.display().to_string().trim_start_matches('/')),
            )
            .output()
            .expect("run init-user");
        assert!(
            out.status.success(),
            "init-user failed: stderr={}",
            String::from_utf8_lossy(&out.stderr)
        );
        let stdout = String::from_utf8(out.stdout).expect("utf8");
        let mut user_id = None;
        let mut token = None;
        for line in stdout.lines() {
            if let Some(rest) = line.strip_prefix("user_id:") {
                user_id = Some(rest.trim().to_string());
            }
            if let Some(rest) = line.strip_prefix("enrollment_token:") {
                token = Some(rest.trim().to_string());
            }
        }
        (
            user_id.expect("init-user printed user_id"),
            token.expect("init-user printed enrollment_token"),
        )
    }
}

/// Locate the relay binary or return None (test skips with a notice).
fn locate_relay_bin() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("SHIZUMU_E2E_RELAY_BIN") {
        return Some(PathBuf::from(p));
    }
    None
}

/// Helper: bootstrap a fresh in-memory DB with sync configured and
/// the user_keys + device_keys persisted into sync_keys.
fn fresh_device_db(
    relay_url: &str,
    user_id: &str,
    device_id: &str,
) -> std::sync::Arc<std::sync::Mutex<Connection>> {
    configure_device_db(test_db(), relay_url, user_id, device_id)
}

/// File-backed sibling of [`fresh_device_db`]. Needed by any test whose
/// receive path writes to the blob store: `merge_attachment_blob` resolves
/// `<app_data>` from the connection's own file path, so an in-memory
/// device has nowhere to put an attachment's bytes and skips the write.
/// The DB file is placed directly in `app_dir`, which is what makes
/// `app_dir` the app-data directory as far as the merge is concerned.
fn fresh_device_db_at(
    app_dir: &std::path::Path,
    relay_url: &str,
    user_id: &str,
    device_id: &str,
) -> std::sync::Arc<std::sync::Mutex<Connection>> {
    std::fs::create_dir_all(app_dir).unwrap();
    configure_device_db(
        shizumu_lib::test_helpers::test_db_at(&app_dir.join("shizumu.db")),
        relay_url,
        user_id,
        device_id,
    )
}

fn configure_device_db(
    db: std::sync::Arc<std::sync::Mutex<Connection>>,
    relay_url: &str,
    user_id: &str,
    device_id: &str,
) -> std::sync::Arc<std::sync::Mutex<Connection>> {
    {
        let conn = db.lock().unwrap();
        config::set_relay_url(&conn, relay_url).unwrap();
        config::set_enrollment(&conn, user_id, device_id, 1).unwrap();
        config::set_enabled(&conn, true).unwrap();
    }
    db
}

#[test]
fn end_to_end_roundtrip_against_real_relay() {
    let Some(bin) = locate_relay_bin() else {
        eprintln!(
            "SKIPPING sync_e2e: set SHIZUMU_E2E_RELAY_BIN to the relay binary path"
        );
        return;
    };

    let tmp = tempdir_for_test();
    let relay = Relay::start(bin, &tmp);

    // -- Generate fresh user + device keys, run init-user, run enroll --
    let mnemonic = keys::generate_seed_phrase();
    let user_keys = keys::user_keys_from_phrase(&mnemonic);
    let device_keys = keys::generate_device_keys();
    let user_sign_pub_b64 = B64.encode(user_keys.user_sign_pub_bytes());

    let (expected_user_id, token) = relay.init_user(&user_sign_pub_b64);

    let enroll_resp = wire::enroll::enroll(
        &relay.base_url,
        &user_keys,
        &device_keys,
        &token,
        "test-device",
    )
    .expect("enroll succeeds");
    assert_eq!(enroll_resp.user_id, expected_user_id);
    assert_eq!(enroll_resp.device_id, device_keys.device_id.to_string());

    // -- Device A: seed op_log rows with the emit_*-shaped payloads
    // the real command surface produces, run upload pass --
    let db_a = fresh_device_db(&relay.base_url, &enroll_resp.user_id, &enroll_resp.device_id);
    let payloads = {
        let conn = db_a.lock().unwrap();
        let engine = OpLogEngine::load(&conn).unwrap();

        // create_new_page: lays down the pages row receivers will fold.
        let create_page = engine
            .apply(
                &conn,
                Op {
                    kind: OpKind::page_blob(),
                    doc_id: Some("page-1".into()),
                    stream_id: op_stream::DISCRETE_PAGES,
                    payload: serde_json::json!({
                        "op": "create_new_page",
                        "page_id": "page-1",
                        "fields": {"date": "2026-05-16", "page_number": 1}
                    }),
                },
            )
            .unwrap();

        // save_page_content: the bulk write merge folds into pages.content_json.
        let save_page = engine
            .apply(
                &conn,
                Op {
                    kind: OpKind::page_blob(),
                    doc_id: Some("page-1".into()),
                    stream_id: op_stream::DISCRETE_PAGES,
                    payload: serde_json::json!({
                        "op": "save_page_content",
                        "page_id": "page-1",
                        "fields": {"content_json": r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"hello"}]}]}"#}
                    }),
                },
            )
            .unwrap();

        // create_lineage: merge folds into lineages.
        let create_lineage = engine
            .apply(
                &conn,
                Op {
                    kind: OpKind::lineage_op(),
                    doc_id: Some("lin-1".into()),
                    stream_id: op_stream::SETTINGS_LINEAGES_PINS,
                    payload: serde_json::json!({
                        "op": "create_lineage",
                        "lineage_id": "lin-1",
                        "fields": {"name": "drafts", "mode": "discrete"}
                    }),
                },
            )
            .unwrap();

        // setting set: merge folds into settings (flat shape — emit_setting).
        let set_setting = engine
            .apply(
                &conn,
                Op {
                    kind: OpKind::setting_op(),
                    doc_id: None,
                    stream_id: op_stream::SETTINGS_LINEAGES_PINS,
                    payload: serde_json::json!({
                        "op": "set",
                        "key": "lock_timeout",
                        "value": "30m"
                    }),
                },
            )
            .unwrap();

        // 14.12 surface: create_pin → update_pin_status → delete_pin (tombstone).
        let create_pin = engine
            .apply(
                &conn,
                Op {
                    kind: OpKind::pin_op(),
                    doc_id: Some("pin-keep".into()),
                    stream_id: op_stream::SETTINGS_LINEAGES_PINS,
                    payload: serde_json::json!({
                        "op": "create_pin",
                        "pin_id": "pin-keep",
                        "fields": {
                            "lineage_id": "lin-1",
                            "source_page_id": "page-1",
                            "object_type": "note",
                            "content": "the pinned slice is the artifact",
                            "title": null
                        }
                    }),
                },
            )
            .unwrap();
        let update_status = engine
            .apply(
                &conn,
                Op {
                    kind: OpKind::pin_op(),
                    doc_id: Some("pin-keep".into()),
                    stream_id: op_stream::SETTINGS_LINEAGES_PINS,
                    payload: serde_json::json!({
                        "op": "update_pin_status",
                        "pin_id": "pin-keep",
                        "fields": {"status": "closed"}
                    }),
                },
            )
            .unwrap();
        // A pin that will be deleted via tombstone.
        let create_pin_doomed = engine
            .apply(
                &conn,
                Op {
                    kind: OpKind::pin_op(),
                    doc_id: Some("pin-doomed".into()),
                    stream_id: op_stream::SETTINGS_LINEAGES_PINS,
                    payload: serde_json::json!({
                        "op": "create_pin",
                        "pin_id": "pin-doomed",
                        "fields": {
                            "lineage_id": "lin-1",
                            "source_page_id": "page-1",
                            "object_type": "note",
                            "content": "this will sink",
                            "title": null
                        }
                    }),
                },
            )
            .unwrap();
        let delete_pin = engine
            .apply(
                &conn,
                Op {
                    kind: OpKind::tombstone(),
                    doc_id: Some("pin-doomed".into()),
                    stream_id: op_stream::SETTINGS_LINEAGES_PINS,
                    payload: serde_json::json!({
                        "op": "delete_pin",
                        "pin_id": "pin-doomed"
                    }),
                },
            )
            .unwrap();

        vec![
            create_page.op_id,
            save_page.op_id,
            create_lineage.op_id,
            set_setting.op_id,
            create_pin.op_id,
            update_status.op_id,
            create_pin_doomed.op_id,
            delete_pin.op_id,
        ]
    };

    let cfg_a = {
        let conn = db_a.lock().unwrap();
        config::load(&conn).unwrap()
    };
    assert!(cfg_a.is_active());

    let upload_stats =
        upload::run_pass(&db_a, &cfg_a, &user_keys, &device_keys).expect("upload pass");
    assert_eq!(upload_stats.ops_posted, payloads.len());
    assert_eq!(upload_stats.blobs_uploaded, payloads.len());

    // All three rows should be state='committed' with monotonic user_seq.
    let seqs: Vec<i64> = {
        let conn = db_a.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT user_seq FROM op_log WHERE state = 'committed' ORDER BY user_seq ASC")
            .unwrap();
        stmt.query_map([], |r| r.get::<_, i64>(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect()
    };
    assert_eq!(seqs.len(), payloads.len(), "every uploaded row committed");
    for w in seqs.windows(2) {
        assert!(w[1] > w[0], "user_seq must be monotonic: {seqs:?}");
    }

    // -- Device B: fresh DB, same keys (single_user invariant), run pull --
    let db_b = fresh_device_db(&relay.base_url, &enroll_resp.user_id, &enroll_resp.device_id);
    let cfg_b = {
        let conn = db_b.lock().unwrap();
        config::load(&conn).unwrap()
    };
    let pull_stats =
        pull::run_pass(&db_b, &cfg_b, &user_keys, &device_keys).expect("pull pass");
    assert_eq!(pull_stats.ops_fetched, payloads.len());
    assert_eq!(pull_stats.ops_received, payloads.len());
    assert_eq!(pull_stats.ops_skipped_duplicate, 0);
    assert_eq!(pull_stats.ops_skipped_decrypt_error, 0);

    // Decrypted payloads round-trip byte-for-byte.
    let rows: Vec<(String, Vec<u8>)> = {
        let conn = db_b.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT op_kind, payload_blob FROM op_log
                 WHERE state = 'received' ORDER BY user_seq ASC",
            )
            .unwrap();
        stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Vec<u8>>(1)?)))
            .unwrap()
            .map(|r| r.unwrap())
            .collect()
    };
    assert_eq!(rows.len(), payloads.len());
    let kinds: Vec<&str> = rows.iter().map(|(k, _)| k.as_str()).collect();
    assert_eq!(kinds.iter().filter(|k| **k == "page_blob").count(), 2);
    assert!(kinds.contains(&"lineage_op"));
    assert!(kinds.contains(&"setting_op"));
    assert_eq!(kinds.iter().filter(|k| **k == "pin_op").count(), 3);
    assert!(kinds.contains(&"tombstone"));

    // ---- the merge surface (phase 14.11) folded each received op
    // into its real local table. This is the contract that turns
    // sync from "moves ciphertext around" into "two devices see the
    // same writing." ----
    {
        let conn = db_b.lock().unwrap();

        // page_blob create_new_page + save_page_content collapsed into one row.
        let (date, page_number, content_json): (String, i64, String) = conn
            .query_row(
                "SELECT date, page_number, content_json FROM pages WHERE id = 'page-1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(date, "2026-05-16");
        assert_eq!(page_number, 1);
        assert!(
            content_json.contains("hello"),
            "save_page_content should have folded content_json onto the page row"
        );

        // lineage_op create_lineage → lineages row.
        let (name, mode): (String, String) = conn
            .query_row(
                "SELECT name, mode FROM lineages WHERE id = 'lin-1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(name, "drafts");
        assert_eq!(mode, "discrete");

        // setting_op set → settings row.
        let v: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'lock_timeout'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(v, "30m");

        // 14.12 round-trips: pin create + status update survived;
        // pin tombstone removed the doomed pin.
        let (status, content): (String, String) = conn
            .query_row(
                "SELECT status, content FROM shared_objects WHERE id = 'pin-keep'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(status, "closed", "update_pin_status folded into row");
        assert!(content.contains("artifact"));
        let doomed: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM shared_objects WHERE id = 'pin-doomed'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(doomed, 0, "tombstone delete_pin removed the row");
    }

    // -- A second pull pass is idempotent: every row dedups by user_seq --
    let pull_again = {
        let cfg = {
            let conn = db_b.lock().unwrap();
            config::load(&conn).unwrap()
        };
        pull::run_pass(&db_b, &cfg, &user_keys, &device_keys).expect("second pull pass")
    };
    assert_eq!(pull_again.ops_received, 0);

    // Sanity: doc_id_ct is deterministic across devices — encrypt-side
    // and decrypt-side independently agree on the bucket for "lin-1".
    let lin1_doc_id_a = envelope::doc_id_ct_from_bytes(&user_keys.meta_key, b"lin-1");
    let lin1_doc_id_b = envelope::doc_id_ct_from_bytes(&user_keys.meta_key, b"lin-1");
    assert_eq!(lin1_doc_id_a, lin1_doc_id_b);
}

// ─────────────────────────────────────────────────────────────────────
//  Attachments as out-of-band objects
//
//  An attachment's bytes used to ride INSIDE its `attachment_blob` op:
//  256KB-chunked, base64'd, every chunk in one payload. A 1.28 MB file
//  became a ~1.7 MB single request the relay refused with 413 on every
//  tick, forever, and could never be deleted because deleting it meant
//  deleting an op from an append-only log. The op now carries only a
//  reference — hash, size, mime — and the bytes belong to their own
//  object at PUT/GET/DELETE /v1/users/<uid>/attachments/<hash>.
//
//  Everything below drives the real relay binary through the same
//  helpers the roundtrip test above uses. Where a test cannot reach the
//  real relay for a step, it says so at the call site and names what it
//  substituted.
// ─────────────────────────────────────────────────────────────────────

use shizumu_lib::attachments::{commands::attachment_set_sync_inner, store};
use shizumu_lib::db::Db;

/// Bytes with no exploitable structure, so nothing anywhere in the
/// pipeline can quietly compress the payload down and make a size
/// assertion pass for the wrong reason. xorshift64 keeps it
/// deterministic — a failure reproduces byte for byte.
fn incompressible_bytes(len: usize, seed: u64) -> Vec<u8> {
    let mut x = seed | 1;
    let mut out = Vec::with_capacity(len + 8);
    while out.len() < len {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        out.extend_from_slice(&x.to_le_bytes());
    }
    out.truncate(len);
    out
}

fn engine_for(db: &Db) -> shizumu_lib::op_log::OpLog {
    let conn = db.lock().unwrap();
    std::sync::Arc::new(OpLogEngine::load(&conn).unwrap())
}

/// Register an attachment the way `insert_attachment` does — bytes into
/// the content-addressed blob store, one `attachments` row, `sync = 0`.
/// Not a call to `insert_attachment` itself: that takes a `tauri::
/// AppHandle`, which an integration test cannot construct. Everything
/// downstream of it (the toggle, the emit, the upload) IS the real code.
fn seed_local_attachment(db: &Db, app_dir: &PathBuf, bytes: &[u8], filename: &str) -> String {
    let hash = store::hash_hex(bytes);
    store::write_blob(app_dir, &hash, bytes).expect("write blob");
    insert_attachment_row(db, &hash, filename, bytes.len() as i64, false);
    hash
}

fn insert_attachment_row(db: &Db, hash: &str, filename: &str, size_bytes: i64, sync: bool) {
    let conn = db.lock().unwrap();
    conn.execute(
        "INSERT INTO attachments \
            (blob_hash, filename, mime_type, size_bytes, sync, has_local, created_at, last_seen_at) \
         VALUES (?1, ?2, 'application/octet-stream', ?3, ?4, 1, '2026-08-08T00:00:00Z', '2026-08-08T00:00:00Z')",
        rusqlite::params![hash, filename, size_bytes, sync as i64],
    )
    .unwrap();
}

fn attachment_row(db: &Db, hash: &str) -> Option<(bool, bool, i64)> {
    let conn = db.lock().unwrap();
    conn.query_row(
        "SELECT sync, has_local, size_bytes FROM attachments WHERE blob_hash = ?1",
        rusqlite::params![hash],
        |r| {
            Ok((
                r.get::<_, i64>(0)? != 0,
                r.get::<_, i64>(1)? != 0,
                r.get::<_, i64>(2)?,
            ))
        },
    )
    .ok()
}

/// The single `attachment_blob` row: (state, user_seq, payload_blob,
/// ciphertext length).
fn the_attachment_op(db: &Db) -> (String, Option<i64>, Vec<u8>, i64) {
    let conn = db.lock().unwrap();
    conn.query_row(
        "SELECT state, user_seq, payload_blob, COALESCE(LENGTH(ciphertext), 0) \
         FROM op_log WHERE op_kind = 'attachment_blob'",
        [],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )
    .unwrap()
}

/// Same as [`the_attachment_op`] but `None` when no `attachment_blob`
/// op has been emitted at all — used to assert that the reference does
/// NOT exist before its object is uploaded.
fn the_attachment_op_opt(db: &Db) -> Option<(String, Option<i64>, Vec<u8>, i64)> {
    let conn = db.lock().unwrap();
    conn.query_row(
        "SELECT state, user_seq, payload_blob, COALESCE(LENGTH(ciphertext), 0) \
         FROM op_log WHERE op_kind = 'attachment_blob'",
        [],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )
    .ok()
}

/// init-user + enroll, the four lines every test below opens with.
fn enroll_device(relay: &Relay) -> (keys::UserKeys, keys::DeviceKeys, wire::enroll::EnrollResponse) {
    let mnemonic = keys::generate_seed_phrase();
    let user_keys = keys::user_keys_from_phrase(&mnemonic);
    let device_keys = keys::generate_device_keys();
    let (_user_id, token) = relay.init_user(&B64.encode(user_keys.user_sign_pub_bytes()));
    let resp = wire::enroll::enroll(
        &relay.base_url,
        &user_keys,
        &device_keys,
        &token,
        "attachment-device",
    )
    .expect("enroll succeeds");
    (user_keys, device_keys, resp)
}

fn config_of(db: &Db) -> config::SyncConfig {
    let conn = db.lock().unwrap();
    config::load(&conn).unwrap()
}

/// The production upload sweep: read the local plaintext, seal it,
/// `blake3(ciphertext)`, PUT it, and only then emit the reference op.
/// This is the code path that did not exist before task 10 — every test
/// below drives it rather than staging an object by hand.
fn upload_objects(
    db: &Db,
    app_dir: &PathBuf,
    relay: &Relay,
    user_id: &str,
    device_keys: &keys::DeviceKeys,
    user_keys: &keys::UserKeys,
) -> usize {
    shizumu_lib::attachments::backfill::run_object_upload_at(
        db,
        app_dir,
        &relay.base_url,
        user_id,
        device_keys,
        user_keys,
        &engine_for(db),
    )
    .expect("object upload sweep")
}

/// The `object_key` recorded on an attachments row — where its bytes
/// actually landed on the relay.
fn row_object_key(db: &Db, hash: &str) -> Option<String> {
    let conn = db.lock().unwrap();
    conn.query_row(
        "SELECT object_key FROM attachments WHERE blob_hash = ?1",
        rusqlite::params![hash],
        |r| r.get::<_, Option<String>>(0),
    )
    .ok()
    .flatten()
}

/// The account's relay-side storage total.
fn used_bytes(relay: &Relay, device_keys: &keys::DeviceKeys, user_id: &str) -> i64 {
    wire::quota::get_quota(&relay.base_url, device_keys, user_id)
        .expect("quota")
        .used
}

/// Printed at the end of every gated test so a run can be shown to have
/// EXECUTED rather than skipped. A skipped test is otherwise
/// indistinguishable from a passing one in cargo's output.
fn ran(name: &str) {
    eprintln!("E2E-RAN {name}");
}

/// THE SIZE CASE — the failure that started this, end to end.
///
/// 2 MB of non-compressible bytes: comfortably past the ~1.7 MB point
/// where the old inline op was refused with 413 on every tick. Driven
/// through the real toggle (`attachment_set_sync_inner`, the off→on
/// edge that is the user's consent), the real object-upload sweep, and
/// the real op upload pass, against the real relay binary.
///
/// Two load-bearing assertions:
///
///   1. The OBJECT lands on the relay. A PUT at the wrong address is
///      refused with `400 attachment_hash_mismatch` ("blake3(body) ≠ URL
///      hash"), so a green PUT here IS the proof that the client and the
///      relay agree on what an object is addressed by. The account's
///      storage accounting grows by the object's size, which is the
///      other thing an append-only op could never do.
///   2. The op PAYLOAD is a few hundred bytes. An inline op for this
///      file would be ~2.8 MB (base64's 4/3 plus the JSON frame). The
///      bound is absolute, not relative — a loose one would pass for an
///      op that shrank for any other reason and would prove nothing
///      about where the bytes went.
#[test]
fn a_two_megabyte_attachment_uploads_its_object_and_commits_a_reference() {
    let Some(bin) = locate_relay_bin() else {
        eprintln!("SKIPPING sync_e2e: set SHIZUMU_E2E_RELAY_BIN to the relay binary path");
        return;
    };
    let tmp = tempdir_for_test();
    let relay = Relay::start(bin, &tmp);
    let (user_keys, device_keys, enrolled) = enroll_device(&relay);
    let uid = enrolled.user_id.clone();

    let app_dir = tmp.join("device-a");
    std::fs::create_dir_all(&app_dir).unwrap();
    let db = fresh_device_db_at(&app_dir, &relay.base_url, &uid, &enrolled.device_id);

    let bytes = incompressible_bytes(2 * 1024 * 1024, 0x5EED_1234);
    let hash = seed_local_attachment(&db, &app_dir, &bytes, "big.bin");
    let engine = engine_for(&db);

    // The user flips the switch. That edge, and only that edge, is what
    // puts an attachment on the wire.
    attachment_set_sync_inner(&db, &engine, &hash, true).expect("toggle sync on");

    // Nothing is referenced yet: the op must not exist before the object.
    assert!(
        the_attachment_op_opt(&db).is_none(),
        "the toggle must not emit a reference before the object is uploaded"
    );

    let used_before = used_bytes(&relay, &device_keys, &uid);
    let n = upload_objects(&db, &app_dir, &relay, &uid, &device_keys, &user_keys);
    assert_eq!(n, 1, "one attachment, one object");

    // The relay took the object at the address the client chose — the
    // PUT would have 400'd with attachment_hash_mismatch otherwise.
    let object_key = row_object_key(&db, &hash).expect("the row records where it landed");
    let served =
        wire::attachment_object::get_attachment(&relay.base_url, &device_keys, &uid, &object_key)
            .expect("the relay is holding the object");
    assert_eq!(
        envelope::blob_hash_hex(&served),
        object_key,
        "the object's address is blake3 of its body, which is what the relay enforces"
    );

    let used_after = used_bytes(&relay, &device_keys, &uid);
    let grew = used_after - used_before;
    assert_eq!(
        grew,
        served.len() as i64,
        "the account's storage grew by exactly the object the relay is holding"
    );
    assert!(
        grew >= bytes.len() as i64 && grew < bytes.len() as i64 + 1024,
        "the object is the file plus a small envelope: {grew} bytes stored for a {} byte file",
        bytes.len()
    );

    // The relay holds CIPHERTEXT. It is zero-knowledge; a body it could
    // read would be a product failure, not just a crypto one.
    assert!(
        served != bytes,
        "the relay is holding the plaintext — the object body must be sealed"
    );
    let (_id, opened) = envelope::decrypt_op(&user_keys.content_master_key, &served)
        .expect("an account key holder can open it");
    assert!(opened == bytes, "and what it opens to is the file, byte for byte");

    // Only now the op.
    let stats = upload::run_pass(&db, &config_of(&db), &user_keys, &device_keys)
        .expect("upload pass");
    assert_eq!(stats.ops_posted, 1, "exactly one op for one attachment");

    let (state, user_seq, payload, ciphertext_len) = the_attachment_op(&db);
    assert_eq!(state, "committed", "the relay accepted the op");
    assert!(user_seq.unwrap_or(0) > 0, "committed rows carry the relay's user_seq");

    // The whole point, in one number.
    assert!(
        payload.len() < 512,
        "the stored op payload is {} bytes for a {} byte file — a reference op is a few \
         hundred bytes; an inline one would be ~{} (base64 4/3 + framing), which is what \
         the relay refused with 413",
        payload.len(),
        bytes.len(),
        bytes.len() * 4 / 3,
    );
    assert!(
        ciphertext_len < 1024,
        "the sealed ciphertext is {ciphertext_len} bytes — encryption must not be hiding \
         a payload that is still carrying the file"
    );

    // And the payload really is the reference shape, pointing at the
    // object that was actually uploaded.
    let parsed: wire::attachment_blob::AttachmentBlobPayload =
        serde_json::from_slice(&payload).expect("payload is an AttachmentBlobPayload");
    assert!(
        wire::attachment_blob::payload_is_reference(&parsed),
        "chunks_b64 must be empty: the bytes belong in the object, not the op"
    );
    assert_eq!(parsed.blob_hash, hash, "sha256(plaintext): what a receiver verifies against");
    assert_eq!(
        parsed.object_key.as_deref(),
        Some(object_key.as_str()),
        "blake3(ciphertext): what a receiver fetches by"
    );
    assert_eq!(parsed.size_bytes, bytes.len() as i64);
    ran("a_two_megabyte_attachment_uploads_its_object_and_commits_a_reference");
}

/// The three endpoints themselves, at the wire layer: PUT grows the
/// account's storage, GET serves the body back, DELETE frees it and the
/// object 404s afterwards.
///
/// Deliberately NOT going through the app path — this is the test that
/// pins the endpoint contract (`blake3(body)` addressing, quota
/// accounting, idempotent delete) independently of how the client
/// happens to produce a body today. The body here is opaque bytes; that
/// the production body is a sealed envelope is asserted in the size case
/// above.
#[test]
fn the_relay_stores_serves_and_frees_an_attachment_object() {
    let Some(bin) = locate_relay_bin() else {
        eprintln!("SKIPPING sync_e2e: set SHIZUMU_E2E_RELAY_BIN to the relay binary path");
        return;
    };
    let tmp = tempdir_for_test();
    let relay = Relay::start(bin, &tmp);
    let (_user_keys, device_keys, enrolled) = enroll_device(&relay);
    let uid = enrolled.user_id.as_str();

    let bytes = incompressible_bytes(2 * 1024 * 1024, 0xA11CE);
    let object_hash = envelope::blob_hash_hex(&bytes);

    let used_before = used_bytes(&relay, &device_keys, uid);

    let put = wire::attachment_object::put_attachment(
        &relay.base_url,
        &device_keys,
        uid,
        &object_hash,
        bytes.clone(),
    )
    .expect("put_attachment");
    assert_eq!(put.stored_bytes, bytes.len() as i64);

    let used_after = used_bytes(&relay, &device_keys, uid);
    assert_eq!(
        used_after - used_before,
        bytes.len() as i64,
        "the relay's accounting grew by the object's real size"
    );

    let fetched =
        wire::attachment_object::get_attachment(&relay.base_url, &device_keys, uid, &object_hash)
            .expect("get_attachment");
    assert!(
        fetched == bytes,
        "the relay served back {} bytes, expected {}",
        fetched.len(),
        bytes.len()
    );

    let del = wire::attachment_object::delete_attachment(
        &relay.base_url,
        &device_keys,
        uid,
        &object_hash,
    )
    .expect("delete_attachment");
    assert!(del.deleted);
    assert_eq!(del.freed_bytes, bytes.len() as i64);

    let err =
        wire::attachment_object::get_attachment(&relay.base_url, &device_keys, uid, &object_hash)
            .expect_err("the object is gone");
    match err {
        wire::WireError::Wire { status, body } => {
            assert_eq!(status, 404);
            assert_eq!(body.code, "attachment_not_found");
        }
        other => panic!("expected a 404 Wire error, got {other:?}"),
    }
    let used_final = used_bytes(&relay, &device_keys, uid);
    assert_eq!(
        used_final, used_before,
        "deleting the object gave the storage back — the thing an append-only op could never do"
    );
    ran("the_relay_stores_serves_and_frees_an_attachment_object");
}

/// A PUT at the LOCAL content address is refused by the relay.
///
/// This is why the reference op carries two hashes. `blob_hash` is
/// sha256 of the plaintext — the address every page node and the blob
/// store use — and the relay verifies `blake3(body)` against whatever is
/// in the URL. Sending the object to the sha256 path is not a near miss
/// that happens to work; it is a 400, every time.
#[test]
fn the_relay_refuses_an_object_put_at_the_local_content_address() {
    let Some(bin) = locate_relay_bin() else {
        eprintln!("SKIPPING sync_e2e: set SHIZUMU_E2E_RELAY_BIN to the relay binary path");
        return;
    };
    let tmp = tempdir_for_test();
    let relay = Relay::start(bin, &tmp);
    let (_user_keys, device_keys, enrolled) = enroll_device(&relay);

    let bytes = incompressible_bytes(64 * 1024, 0x00_15_0BAD);
    let sha256_key = store::hash_hex(&bytes);

    let err = wire::attachment_object::put_attachment(
        &relay.base_url,
        &device_keys,
        &enrolled.user_id,
        &sha256_key,
        bytes.clone(),
    )
    .expect_err("sha256(plaintext) is not an object address");
    match err {
        wire::WireError::Wire { status, body } => {
            assert_eq!(status, 400);
            assert_eq!(body.code, "attachment_hash_mismatch");
        }
        other => panic!("expected 400 attachment_hash_mismatch, got {other:?}"),
    }
    ran("the_relay_refuses_an_object_put_at_the_local_content_address");
}

/// THE DELETE CASE — un-syncing is a statement about the relay, never
/// about the user's own disk.
///
/// Nothing here is staged by hand any more: the object gets onto the
/// relay through the real upload sweep, and the on→off edge of the real
/// toggle takes it off again. Afterwards the local file is still there
/// and still reads back byte-identical.
#[test]
fn unsyncing_an_attachment_deletes_the_relay_object_and_leaves_the_local_file() {
    let Some(bin) = locate_relay_bin() else {
        eprintln!("SKIPPING sync_e2e: set SHIZUMU_E2E_RELAY_BIN to the relay binary path");
        return;
    };
    let tmp = tempdir_for_test();
    let relay = Relay::start(bin, &tmp);
    let (user_keys, device_keys, enrolled) = enroll_device(&relay);
    let uid = enrolled.user_id.clone();

    let app_dir = tmp.join("device-a");
    std::fs::create_dir_all(&app_dir).unwrap();
    let db = fresh_device_db_at(&app_dir, &relay.base_url, &uid, &enrolled.device_id);
    {
        // The toggle's relay call signs with the device keys it loads from
        // the DB, so they have to be there — `enroll` alone doesn't persist
        // them.
        let conn = db.lock().unwrap();
        keys::persist_device_keys(&conn, &device_keys).unwrap();
    }

    let bytes = incompressible_bytes(512 * 1024, 0xDEADBEEF);
    let hash = seed_local_attachment(&db, &app_dir, &bytes, "kept.bin");
    let local_path = store::path_for(&app_dir, &hash).unwrap();
    let engine = engine_for(&db);

    attachment_set_sync_inner(&db, &engine, &hash, true).expect("toggle sync on");
    assert_eq!(
        upload_objects(&db, &app_dir, &relay, &uid, &device_keys, &user_keys),
        1
    );
    let object_key = row_object_key(&db, &hash).expect("the object landed");
    let used_synced = used_bytes(&relay, &device_keys, &uid);
    wire::attachment_object::get_attachment(&relay.base_url, &device_keys, &uid, &object_key)
        .expect("the relay is holding it before the un-sync");

    attachment_set_sync_inner(&db, &engine, &hash, false).expect("toggle sync off");

    // The relay no longer has it, and gave the storage back.
    let err =
        wire::attachment_object::get_attachment(&relay.base_url, &device_keys, &uid, &object_key)
            .expect_err("the on->off edge deletes the object from the relay");
    match err {
        wire::WireError::Wire { status, .. } => assert_eq!(status, 404),
        other => panic!("expected 404, got {other:?}"),
    }
    assert!(
        used_bytes(&relay, &device_keys, &uid) < used_synced,
        "un-syncing freed the account's storage"
    );

    // The device still does. Un-syncing never touches the user's disk.
    let (sync, has_local, _) = attachment_row(&db, &hash).expect("row survives");
    assert!(!sync, "the flag is off");
    assert!(has_local, "the row still claims the bytes are here");
    assert!(
        row_object_key(&db, &hash).is_none(),
        "and it no longer claims an object on the relay"
    );
    let on_disk = std::fs::read(&local_path).expect("the local file is still readable");
    assert!(
        on_disk == bytes,
        "the local file changed: {} bytes on disk, {} expected",
        on_disk.len(),
        bytes.len()
    );
    ran("unsyncing_an_attachment_deletes_the_relay_object_and_leaves_the_local_file");
}

/// THE FETCH CASE — a second device pulls the reference, resolves it
/// against the real relay, and ends up with byte-identical content.
///
/// Every hop is production code against the relay binary: device A's
/// object upload + reference op, device B's pull + merge, device B's
/// `run_object_fetch_at` → GET → decrypt → sha256 check →
/// `store::write_blob`. The httpmock stand-in that used to serve the
/// object is gone; it only existed because nothing uploaded one.
///
/// The substitution attempt at the end is the security half: a relay is
/// untrusted, so bytes that don't hash to what the op claimed must never
/// reach the disk — even when they decrypt perfectly, which is exactly
/// the case a relay can construct by serving one of the account's own
/// objects for another one's key.
#[test]
fn a_second_device_resolves_a_reference_and_fetches_byte_identical_bytes() {
    let Some(bin) = locate_relay_bin() else {
        eprintln!("SKIPPING sync_e2e: set SHIZUMU_E2E_RELAY_BIN to the relay binary path");
        return;
    };
    let tmp = tempdir_for_test();
    let relay = Relay::start(bin, &tmp);
    let (user_keys, device_keys, enrolled) = enroll_device(&relay);
    let uid = enrolled.user_id.clone();

    // -- device A: 1.28 MB, the exact size of the file that 413'd four
    //    times on the live relay.
    let dir_a = tmp.join("device-a");
    std::fs::create_dir_all(&dir_a).unwrap();
    let db_a = fresh_device_db_at(&dir_a, &relay.base_url, &uid, &enrolled.device_id);
    let bytes = incompressible_bytes(1_284_326, 0xC0FFEE);
    let hash = seed_local_attachment(&db_a, &dir_a, &bytes, "icon-sized.bin");
    let engine_a = engine_for(&db_a);
    attachment_set_sync_inner(&db_a, &engine_a, &hash, true).expect("toggle sync on");
    assert_eq!(
        upload_objects(&db_a, &dir_a, &relay, &uid, &device_keys, &user_keys),
        1
    );
    upload::run_pass(&db_a, &config_of(&db_a), &user_keys, &device_keys).expect("upload");

    // -- device B: pull, and merge the reference.
    let dir_b = tmp.join("device-b");
    let db_b = fresh_device_db_at(&dir_b, &relay.base_url, &uid, &enrolled.device_id);
    let pulled = pull::run_pass(&db_b, &config_of(&db_b), &user_keys, &device_keys)
        .expect("pull pass");
    assert_eq!(pulled.ops_received, 1);

    let (sync, has_local, size_bytes) =
        attachment_row(&db_b, &hash).expect("the reference created a row");
    assert!(sync, "a peer that synced it authorised it");
    assert!(!has_local, "the op carried no bytes, so nothing here is local yet");
    assert_eq!(size_bytes, bytes.len() as i64);
    assert_eq!(
        row_object_key(&db_b, &hash),
        row_object_key(&db_a, &hash),
        "the reference carried the object's address across, which is the only way \
         device B can ever ask for it"
    );
    // Nothing on disk yet — asserted because the alternative failure is
    // silent and nasty: a merge that treats an empty chunk list as a
    // zero-byte file writes a corrupt blob the user can open and find empty.
    assert!(
        !store::has_local(&dir_b, &hash),
        "a reference op must not fabricate a local file"
    );

    // -- the object fetch, against the real relay.
    let fetched = shizumu_lib::attachments::backfill::run_object_fetch_at(
        &db_b,
        &dir_b,
        &relay.base_url,
        &uid,
        &device_keys,
        &user_keys,
    )
    .expect("object fetch");
    assert_eq!(fetched, 1);

    let landed = store::read_blob(&dir_b, &hash).unwrap().expect("the bytes landed");
    assert!(
        landed == bytes,
        "device B holds {} bytes, device A wrote {}",
        landed.len(),
        bytes.len()
    );
    let (_, has_local, size_after) = attachment_row(&db_b, &hash).unwrap();
    assert!(has_local, "the row is only local once the bytes actually arrived");
    assert_eq!(size_after, bytes.len() as i64);

    // -- the relay is untrusted: a substituted body never reaches disk.
    //
    // The substitution is the strongest one a relay can actually mount:
    // a REAL object of this account, sealed with this account's key, so
    // it fetches and decrypts without a murmur. Only the sha256 check
    // separates it from the file that was asked for.
    let other = incompressible_bytes(4096, 0xBAD);
    let other_ct = envelope::encrypt_op(&user_keys.content_master_key, &uuid::Uuid::new_v4(), &other);
    let other_key = envelope::blob_hash_hex(&other_ct);
    wire::attachment_object::put_attachment(
        &relay.base_url,
        &device_keys,
        &uid,
        &other_key,
        other_ct,
    )
    .expect("stage a real object of this account");

    let claimed = store::hash_hex(&incompressible_bytes(4096, 0x600D));
    insert_attachment_row(&db_b, &claimed, "substituted.bin", 4096, true);
    {
        let conn = db_b.lock().unwrap();
        conn.execute(
            "UPDATE attachments SET has_local = 0, object_key = ?1 WHERE blob_hash = ?2",
            rusqlite::params![&other_key, &claimed],
        )
        .unwrap();
    }

    let fetched = shizumu_lib::attachments::backfill::run_object_fetch_at(
        &db_b,
        &dir_b,
        &relay.base_url,
        &uid,
        &device_keys,
        &user_keys,
    )
    .expect("object fetch with a lying relay");
    assert_eq!(fetched, 0, "bytes that don't hash to the request are not a fetch");
    assert!(
        !store::has_local(&dir_b, &claimed),
        "the hash is verified BEFORE the write — a relay must not be able to substitute content"
    );
    let (_, has_local, _) = attachment_row(&db_b, &claimed).unwrap();
    assert!(!has_local, "the row stays pending so the next tick can retry");
    ran("a_second_device_resolves_a_reference_and_fetches_byte_identical_bytes");
}

/// THE LEGACY CASE — an attachment committed as an old-style INLINE op
/// must still reassemble and land on a second device.
///
/// One of these is on the live relay right now (`user_seq 524`,
/// `icon.png`) and older clients keep producing them, so this branch can
/// never be dropped. Produced here by emitting the op with
/// `attachment_blob::build_payload` — the same builder the old client
/// used — and pushing it through the real upload/pull/merge path.
#[test]
fn a_legacy_inline_attachment_op_still_lands_on_a_second_device() {
    let Some(bin) = locate_relay_bin() else {
        eprintln!("SKIPPING sync_e2e: set SHIZUMU_E2E_RELAY_BIN to the relay binary path");
        return;
    };
    let tmp = tempdir_for_test();
    let relay = Relay::start(bin, &tmp);
    let (user_keys, device_keys, enrolled) = enroll_device(&relay);

    let dir_a = tmp.join("device-a");
    std::fs::create_dir_all(&dir_a).unwrap();
    let db_a = fresh_device_db_at(&dir_a, &relay.base_url, &enrolled.user_id, &enrolled.device_id);

    // 400 KB: two 256KB chunks, so the chunk list is genuinely a list.
    let bytes = incompressible_bytes(400 * 1024, 0x1C0DE);
    let hash = store::hash_hex(&bytes);
    let legacy = wire::attachment_blob::build_payload(&hash, Some("image/png"), &bytes, 0);
    assert!(legacy.chunks_b64.len() >= 2, "a real multi-chunk inline op");

    {
        let conn = db_a.lock().unwrap();
        let engine = OpLogEngine::load(&conn).unwrap();
        engine
            .apply(
                &conn,
                Op {
                    kind: OpKind::new("attachment_blob").unwrap(),
                    doc_id: Some(hash.clone()),
                    stream_id: op_stream::DISCRETE_PAGES,
                    payload: serde_json::to_value(&legacy).unwrap(),
                },
            )
            .unwrap();
    }

    // The contrast that gives the reference test's bound its teeth: this
    // is what an attachment op used to weigh.
    let (_, _, payload, _) = the_attachment_op(&db_a);
    assert!(
        payload.len() as f64 > bytes.len() as f64 * 1.3,
        "an inline op is ~1.37x the file ({} bytes here for {}), which is exactly why the \
         reference op's payload assertion is bounded at a few hundred bytes",
        payload.len(),
        bytes.len()
    );

    upload::run_pass(&db_a, &config_of(&db_a), &user_keys, &device_keys).expect("upload");
    let (state, _, _, _) = the_attachment_op(&db_a);
    assert_eq!(state, "committed");

    // -- device B pulls it and the legacy branch reassembles.
    let dir_b = tmp.join("device-b");
    let db_b = fresh_device_db_at(&dir_b, &relay.base_url, &enrolled.user_id, &enrolled.device_id);
    let pulled =
        pull::run_pass(&db_b, &config_of(&db_b), &user_keys, &device_keys).expect("pull pass");
    assert_eq!(pulled.ops_received, 1);

    let landed = store::read_blob(&dir_b, &hash)
        .unwrap()
        .expect("the legacy op's bytes were reassembled to disk");
    assert!(
        landed == bytes,
        "reassembled {} bytes, expected {}",
        landed.len(),
        bytes.len()
    );
    let (_, has_local, size_bytes) = attachment_row(&db_b, &hash).expect("index row");
    assert!(has_local, "an inline op arrives complete — it is local immediately");
    assert_eq!(size_bytes, bytes.len() as i64);
    ran("a_legacy_inline_attachment_op_still_lands_on_a_second_device");
}

/// The `object_epoch` recorded on an attachments row — which epoch key
/// opens the object at `object_key`.
fn row_object_epoch(db: &Db, hash: &str) -> Option<i64> {
    let conn = db.lock().unwrap();
    conn.query_row(
        "SELECT object_epoch FROM attachments WHERE blob_hash = ?1",
        rusqlite::params![hash],
        |r| r.get::<_, Option<i64>>(0),
    )
    .ok()
    .flatten()
}

/// The parsed reference payload for one attachment.
fn reference_payload_for(db: &Db, hash: &str) -> wire::attachment_blob::AttachmentBlobPayload {
    let conn = db.lock().unwrap();
    let blob: Vec<u8> = conn
        .query_row(
            "SELECT payload_blob FROM op_log WHERE op_kind = 'attachment_blob' AND doc_id = ?1",
            rusqlite::params![hash],
            |r| r.get(0),
        )
        .expect("the reference op exists");
    serde_json::from_slice(&blob).expect("payload parses")
}

/// THE ROTATION CASE — an attachment uploaded AFTER a key rotation is
/// sealed under the new epoch, and the revoked device's key does not
/// open it.
///
/// The defect this pins: attachment objects were sealed with
/// `user_keys.content_master_key` — the phrase-derived, epoch-0 key —
/// no matter how many rotations had happened. Ops were never like that
/// (`sync/upload.rs` resolves the key for the op's own epoch). A device
/// revoked at epoch N keeps the epoch-0 key forever, so it could
/// decrypt every attachment uploaded after its revocation. Rotation
/// exists to end that access; for attachments it did not.
///
/// Everything here is production code against the relay binary: the
/// real toggle, the real `rotate_after_revoke` (revoke B, wrap ES_1 to
/// A and C, publish, adopt), the real upload sweep, the real pull +
/// merge, and the real object fetch. The security assertion is made
/// against the ciphertext the relay is ACTUALLY holding, fetched back
/// over HTTP — not against a locally-computed one.
///
/// Both epochs are exercised on purpose: the pre-rotation attachment
/// (epoch 0) must keep opening, or the fix would have traded a security
/// hole for a data-loss one.
#[test]
fn an_attachment_uploaded_after_a_rotation_is_sealed_under_the_new_epoch() {
    let Some(bin) = locate_relay_bin() else {
        eprintln!("SKIPPING sync_e2e: set SHIZUMU_E2E_RELAY_BIN to the relay binary path");
        return;
    };
    let tmp = tempdir_for_test();
    let relay = Relay::start(bin, &tmp);

    // One account, three devices. B is the one that gets revoked; C is a
    // remaining device that has to keep working across the rotation.
    let mnemonic = keys::generate_seed_phrase();
    let user_keys = keys::user_keys_from_phrase(&mnemonic);
    let dk_a = keys::generate_device_keys();
    let dk_b = keys::generate_device_keys();
    let dk_c = keys::generate_device_keys();
    let (user_id, token) = relay.init_user(&B64.encode(user_keys.user_sign_pub_bytes()));
    wire::enroll::enroll(&relay.base_url, &user_keys, &dk_a, &token, "device-a").expect("enroll A");
    wire::enroll::self_enroll(&relay.base_url, &user_keys, &dk_b, "device-b").expect("enroll B");
    wire::enroll::self_enroll(&relay.base_url, &user_keys, &dk_c, "device-c").expect("enroll C");

    let dir_a = tmp.join("device-a");
    let db_a = fresh_device_db_at(&dir_a, &relay.base_url, &user_id, &dk_a.device_id.to_string());
    {
        let conn = db_a.lock().unwrap();
        keys::persist_device_keys(&conn, &dk_a).unwrap();
    }
    let engine_a = engine_for(&db_a);

    // ── epoch 0: an attachment that exists BEFORE the rotation.
    let before_bytes = incompressible_bytes(300 * 1024, 0xBE_F0_2E);
    let before_hash = seed_local_attachment(&db_a, &dir_a, &before_bytes, "before.bin");
    attachment_set_sync_inner(&db_a, &engine_a, &before_hash, true).expect("toggle on");
    assert_eq!(
        upload_objects(&db_a, &dir_a, &relay, &user_id, &dk_a, &user_keys),
        1
    );
    upload::run_pass(&db_a, &config_of(&db_a), &user_keys, &dk_a).expect("upload the reference");
    assert_eq!(
        row_object_epoch(&db_a, &before_hash),
        Some(0),
        "before any rotation the account is on epoch 0"
    );

    // ── the rotation: revoke B, wrap a fresh epoch secret to A and C.
    let device_b_id = dk_b.device_id.to_string();
    wire::devices::revoke_device(&relay.base_url, &dk_a, &user_id, &device_b_id).expect("revoke B");
    let new_epoch =
        rotation::rotate_after_revoke(&db_a, &dk_a, &relay.base_url, &user_id, &device_b_id)
            .expect("rotate after revoke");
    assert_eq!(new_epoch, 1);
    {
        let conn = db_a.lock().unwrap();
        assert_eq!(config::get_current_epoch(&conn).unwrap(), 1, "A adopts epoch 1");
    }

    // ── epoch 1: an attachment uploaded AFTER the rotation. This is the
    //    one a revoked device must not be able to read.
    let after_bytes = incompressible_bytes(700 * 1024, 0xAF_7E_12);
    let after_hash = seed_local_attachment(&db_a, &dir_a, &after_bytes, "after.bin");
    attachment_set_sync_inner(&db_a, &engine_a, &after_hash, true).expect("toggle on");
    assert_eq!(
        upload_objects(&db_a, &dir_a, &relay, &user_id, &dk_a, &user_keys),
        1
    );
    upload::run_pass(&db_a, &config_of(&db_a), &user_keys, &dk_a).expect("upload the reference");

    assert_eq!(
        row_object_epoch(&db_a, &after_hash),
        Some(1),
        "an object sealed after the rotation records the epoch it was sealed under"
    );
    let after_ref = reference_payload_for(&db_a, &after_hash);
    assert_eq!(
        wire::attachment_blob::object_epoch_of(&after_ref),
        1,
        "and the reference op carries it, which is the only way a peer learns it"
    );

    // ★ THE SECURITY ASSERTION, against the bytes the relay is holding.
    //
    // The revoked device B still has the account phrase's content key —
    // it is phrase-derived, it was never rotated away, and nothing can
    // take it back. If it opens this object, revoking B did not revoke
    // B's access to attachments uploaded after the revocation.
    let after_key = row_object_key(&db_a, &after_hash).expect("the object landed");
    let served =
        wire::attachment_object::get_attachment(&relay.base_url, &dk_a, &user_id, &after_key)
            .expect("the relay is holding the post-rotation object");
    assert!(
        envelope::decrypt_op(&user_keys.content_master_key, &served).is_err(),
        "the post-rotation attachment object opened with the EPOCH-0 key — a device revoked \
         at epoch 1 can still read attachments uploaded after its revocation"
    );
    // …and an entitled device's epoch-1 key does open it.
    let epoch1_key = {
        let conn = db_a.lock().unwrap();
        sync_epoch::content_master_key_for_epoch(&conn, &user_keys, 1)
            .unwrap()
            .expect("A holds the epoch-1 secret it just generated")
    };
    let (_id, opened) = envelope::decrypt_op(&epoch1_key, &served).expect("epoch 1 opens it");
    assert!(opened == after_bytes, "and it is the file, byte for byte");

    // The pre-rotation object is still epoch-0 sealed and still opens
    // with the phrase key — the fix must not have orphaned old data.
    let before_key = row_object_key(&db_a, &before_hash).expect("the first object landed");
    let served_before =
        wire::attachment_object::get_attachment(&relay.base_url, &dk_a, &user_id, &before_key)
            .expect("the relay still has the pre-rotation object");
    let (_id, opened_before) = envelope::decrypt_op(&user_keys.content_master_key, &served_before)
        .expect("an epoch-0 object still opens with the epoch-0 key");
    assert!(opened_before == before_bytes);

    // ── device C: still entitled. Picks up ES_1, pulls both references,
    //    and fetches BOTH objects — one sealed at epoch 0, one at
    //    epoch 1 — through the real fetch sweep.
    let dir_c = tmp.join("device-c");
    let db_c = fresh_device_db_at(&dir_c, &relay.base_url, &user_id, &dk_c.device_id.to_string());
    let stored = rotation::fetch_and_store_epoch_keys(&db_c, &dk_c, &relay.base_url, &user_id)
        .expect("C fetches epoch keys");
    assert!(stored >= 1, "C adopts the new epoch secret");

    let pulled = pull::run_pass(&db_c, &config_of(&db_c), &user_keys, &dk_c).expect("pull");
    assert_eq!(pulled.ops_received, 2, "two references, one per attachment");
    assert_eq!(
        row_object_epoch(&db_c, &after_hash),
        Some(1),
        "the epoch crossed the wire onto C's row"
    );
    assert_eq!(row_object_epoch(&db_c, &before_hash), Some(0));

    let fetched = shizumu_lib::attachments::backfill::run_object_fetch_at(
        &db_c,
        &dir_c,
        &relay.base_url,
        &user_id,
        &dk_c,
        &user_keys,
    )
    .expect("object fetch");
    assert_eq!(fetched, 2, "both attachments, across both epochs");

    for (hash, expected) in [(&before_hash, &before_bytes), (&after_hash, &after_bytes)] {
        let landed = store::read_blob(&dir_c, hash)
            .unwrap()
            .unwrap_or_else(|| panic!("{hash} never landed on C"));
        assert!(
            landed == *expected,
            "C holds {} bytes for {hash}, device A wrote {}",
            landed.len(),
            expected.len()
        );
    }
    ran("an_attachment_uploaded_after_a_rotation_is_sealed_under_the_new_epoch");
}

/// C1 — UN-SYNC IS NOT A ONE-WAY DOOR, AND PEERS STOP 404-ING.
///
/// The whole cycle against the real relay: A syncs a file, B pulls the
/// reference and sits at `has_local = 0`, A un-syncs, A re-syncs.
///
/// Two things were permanently broken here and both are asserted:
///
///   1. B held `(sync = 1, has_local = 0, object_key = K)` — exactly
///      what `pending_object_fetch` selects — against an object the
///      relay had deleted. Every 30s tick was a GET and a 404, forever,
///      for the life of the account. The retraction op has to reach B
///      and take the row out of that set.
///   2. A could never put the file back. The reference op is in an
///      append-only log and the upload gate treated its existence as
///      proof of an object on the relay, so `pending_object_upload`
///      excluded the row permanently — no path re-uploaded it, not the
///      toggle, not the tick, not a restart.
///
/// The re-upload lands under a DIFFERENT object key (a fresh per-object
/// UUID seals it), which is why B has to learn the new address from the
/// second reference op rather than reusing the one it already had.
#[test]
fn un_syncing_then_re_syncing_puts_the_object_back_and_stops_the_peers_404_loop() {
    let Some(bin) = locate_relay_bin() else {
        eprintln!("SKIPPING sync_e2e: set SHIZUMU_E2E_RELAY_BIN to the relay binary path");
        return;
    };
    let tmp = tempdir_for_test();
    let relay = Relay::start(bin, &tmp);
    let (user_keys, device_keys, enrolled) = enroll_device(&relay);
    let uid = enrolled.user_id.clone();

    // -- device A publishes.
    let dir_a = tmp.join("device-a");
    std::fs::create_dir_all(&dir_a).unwrap();
    let db_a = fresh_device_db_at(&dir_a, &relay.base_url, &uid, &enrolled.device_id);
    {
        let conn = db_a.lock().unwrap();
        keys::persist_device_keys(&conn, &device_keys).unwrap();
    }
    let bytes = incompressible_bytes(700 * 1024, 0x5EC0_11DE);
    let hash = seed_local_attachment(&db_a, &dir_a, &bytes, "twice.bin");
    let engine_a = engine_for(&db_a);

    attachment_set_sync_inner(&db_a, &engine_a, &hash, true).expect("toggle sync on");
    assert_eq!(upload_objects(&db_a, &dir_a, &relay, &uid, &device_keys, &user_keys), 1);
    let first_key = row_object_key(&db_a, &hash).expect("the object landed");
    upload::run_pass(&db_a, &config_of(&db_a), &user_keys, &device_keys).expect("upload");

    // -- device B pulls the reference and is now waiting on the object.
    let dir_b = tmp.join("device-b");
    let db_b = fresh_device_db_at(&dir_b, &relay.base_url, &uid, &enrolled.device_id);
    pull::run_pass(&db_b, &config_of(&db_b), &user_keys, &device_keys).expect("pull");
    assert_eq!(
        row_object_key(&db_b, &hash).as_deref(),
        Some(first_key.as_str())
    );
    assert_eq!(
        shizumu_lib::attachments::backfill::pending_object_fetch(&db_b).unwrap().len(),
        1,
        "B is waiting on the object, which is the state the 404 loop lives in"
    );

    // -- A un-syncs: the object is deleted and the reference retracted.
    attachment_set_sync_inner(&db_a, &engine_a, &hash, false).expect("toggle sync off");
    let err =
        wire::attachment_object::get_attachment(&relay.base_url, &device_keys, &uid, &first_key)
            .expect_err("the object really is gone from the relay");
    match err {
        wire::WireError::Wire { status, .. } => assert_eq!(status, 404),
        other => panic!("expected 404, got {other:?}"),
    }
    upload::run_pass(&db_a, &config_of(&db_a), &user_keys, &device_keys).expect("upload retraction");

    // -- B pulls the retraction and stops asking. Without it, B keeps a
    //    row pointing at a 404 and re-GETs it on every tick forever —
    //    the op log is append-only, so the reference that put it there
    //    can only be superseded, never removed.
    pull::run_pass(&db_b, &config_of(&db_b), &user_keys, &device_keys).expect("pull retraction");
    assert!(
        row_object_key(&db_b, &hash).is_none(),
        "B still points at a deleted object"
    );
    assert!(
        shizumu_lib::attachments::backfill::pending_object_fetch(&db_b).unwrap().is_empty(),
        "B is still queued to GET an object the relay 404s"
    );
    let fetched = shizumu_lib::attachments::backfill::run_object_fetch_at(
        &db_b, &dir_b, &relay.base_url, &uid, &device_keys, &user_keys,
    )
    .expect("fetch sweep");
    // Nothing to fetch is the POINT here, not an incidental zero: the
    // whole finding is that this sweep used to send a doomed GET on
    // every tick for the life of the account.
    assert_eq!(fetched, 0);

    // -- A re-syncs. This is what no path could do before.
    assert!(
        attachment_set_sync_inner(&db_a, &engine_a, &hash, true).expect("toggle sync on again"),
        "re-enabling sync must queue the upload again"
    );
    assert_eq!(
        upload_objects(&db_a, &dir_a, &relay, &uid, &device_keys, &user_keys),
        1,
        "the worker's own sweep has to find it too, not just the toggle"
    );
    let second_key = row_object_key(&db_a, &hash).expect("the object landed again");
    assert_ne!(
        second_key, first_key,
        "a fresh per-object UUID seals each upload, so the address is new"
    );
    wire::attachment_object::get_attachment(&relay.base_url, &device_keys, &uid, &second_key)
        .expect("the relay is holding the new object");
    upload::run_pass(&db_a, &config_of(&db_a), &user_keys, &device_keys).expect("upload reference");

    // -- and B resolves it at the new address, byte for byte.
    pull::run_pass(&db_b, &config_of(&db_b), &user_keys, &device_keys).expect("pull new reference");
    assert_eq!(row_object_key(&db_b, &hash).as_deref(), Some(second_key.as_str()));
    let fetched = shizumu_lib::attachments::backfill::run_object_fetch_at(
        &db_b, &dir_b, &relay.base_url, &uid, &device_keys, &user_keys,
    )
    .expect("object fetch");
    assert_eq!(fetched, 1);
    let landed = store::read_blob(&dir_b, &hash).unwrap().expect("bytes landed on B");
    assert!(landed == bytes, "B holds {} bytes, A wrote {}", landed.len(), bytes.len());
    ran("un_syncing_then_re_syncing_puts_the_object_back_and_stops_the_peers_404_loop");
}

/// Create a unique temp dir for this test run. We don't pull in the
/// `tempfile` crate because it isn't a dev-dep yet; `std::env::temp_dir`
/// + a UUID is sufficient.
fn tempdir_for_test() -> PathBuf {
    let p = std::env::temp_dir().join(format!("shizumu-e2e-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&p).unwrap();
    p
}
