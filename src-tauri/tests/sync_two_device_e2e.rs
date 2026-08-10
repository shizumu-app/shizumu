//! Two-device convergence + relay-loss recovery against a real
//! shizumu-relay subprocess.
//!
//! Builds on the scaffolding in `sync_e2e.rs` but covers two scenarios
//! the original test does not exercise:
//!
//!   1. Two DISTINCT device identities (A and B) under the same user
//!      account, with B self-enrolling against the same user pubkey
//!      after A's enrollment_token has been consumed. Proves the
//!      same-pubkey self-enroll path adds a second device row rather
//!      than 409ing, and proves B converges on A's writes after a pull.
//!
//!   2. Relay-loss recovery via `sync_force_reupload`: A uploads, the
//!      relay forgets (DB deleted), A clears its committed-state cache
//!      and re-enrolls against a fresh relay. The next upload pass
//!      republishes every op. Proves the recovery contract for the
//!      "self-hosted relay restored from no backup" case.
//!
//! Gate: requires `SHIZUMU_E2E_RELAY_BIN` pointing at the relay
//! binary. When unset, both tests print a skip line and return so
//! `cargo test` stays green on machines without the relay built.

use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use rusqlite::Connection;
use shizumu_lib::op_log::{stream as op_stream, Op, OpKind, OpLogEngine};
use shizumu_lib::sync::{config, keys, pull, rotation, upload, wire};
use shizumu_lib::test_helpers::test_db;

/// Pick a random unused localhost port — bind and immediately release.
/// Same trick as `sync_e2e.rs`; tiny race window in theory, fine in
/// practice.
fn pick_free_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral");
    listener.local_addr().unwrap().port()
}

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
    bind: String,
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
        Self::start_at(bin, &bind, db_path, blob_root)
    }

    /// Start the relay at an explicit bind / DB / blob layout. Used by
    /// the relay-loss recovery test to restart on the SAME port (so
    /// the client config doesn't need to change mid-test) after the DB
    /// file was deleted.
    fn start_at(
        bin: PathBuf,
        bind: &str,
        db_path: PathBuf,
        blob_root: PathBuf,
    ) -> Relay {
        std::fs::create_dir_all(&blob_root).unwrap();
        let nonexistent_cfg = db_path
            .parent()
            .unwrap_or_else(|| std::path::Path::new("/tmp"))
            .join("no-config.toml");
        let child = Command::new(&bin)
            .arg("--config")
            .arg(&nonexistent_cfg)
            .arg("serve")
            .env("SHIZUMU_BIND", bind)
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
            bind: bind.to_string(),
        }
    }

    fn shutdown(mut self) -> (PathBuf, PathBuf, PathBuf, String) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        (
            self.bin.clone(),
            self.db_path.clone(),
            self.blob_root.clone(),
            self.bind.clone(),
        )
    }

    /// Run `init-user --pub <b64>` and parse out (user_id, token). Same
    /// shape as `sync_e2e.rs::init_user`.
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

fn locate_relay_bin() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("SHIZUMU_E2E_RELAY_BIN") {
        return Some(PathBuf::from(p));
    }
    None
}

/// Bootstrap a fresh device DB with sync configured to a specific
/// (user_id, device_id) pair on a specific relay URL.
fn fresh_device_db(
    relay_url: &str,
    user_id: &str,
    device_id: &str,
) -> std::sync::Arc<std::sync::Mutex<Connection>> {
    let db = test_db();
    {
        let conn = db.lock().unwrap();
        config::set_relay_url(&conn, relay_url).unwrap();
        config::set_enrollment(&conn, user_id, device_id, 1).unwrap();
        config::set_enabled(&conn, true).unwrap();
    }
    db
}

fn tempdir_for_test() -> PathBuf {
    let p = std::env::temp_dir().join(format!("shizumu-e2e-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&p).unwrap();
    p
}

/// Seed three ops on a device DB: create_lineage, create_new_page,
/// save_page_content. Returns the op_ids in apply order. The shapes
/// mirror what the real command surface emits — see `sync_e2e.rs` for
/// the canonical examples this is modelled on.
fn seed_three_ops(db: &std::sync::Arc<std::sync::Mutex<Connection>>) -> Vec<String> {
    let conn = db.lock().unwrap();
    let engine = OpLogEngine::load(&conn).unwrap();

    let lineage = engine
        .apply(
            &conn,
            Op {
                kind: OpKind::lineage_op(),
                doc_id: Some("lin-conv".into()),
                stream_id: op_stream::SETTINGS_LINEAGES_PINS,
                payload: serde_json::json!({
                    "op": "create_lineage",
                    "lineage_id": "lin-conv",
                    "fields": {"name": "convergence", "mode": "discrete"}
                }),
            },
        )
        .unwrap();

    let create_page = engine
        .apply(
            &conn,
            Op {
                kind: OpKind::page_blob(),
                doc_id: Some("page-conv".into()),
                stream_id: op_stream::DISCRETE_PAGES,
                payload: serde_json::json!({
                    "op": "create_new_page",
                    "page_id": "page-conv",
                    "fields": {"date": "2026-05-29", "page_number": 1, "lineage_id": "lin-conv"}
                }),
            },
        )
        .unwrap();

    let save_page = engine
        .apply(
            &conn,
            Op {
                kind: OpKind::page_blob(),
                doc_id: Some("page-conv".into()),
                stream_id: op_stream::DISCRETE_PAGES,
                payload: serde_json::json!({
                    "op": "save_page_content",
                    "page_id": "page-conv",
                    "fields": {"content_json": r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"convergence body"}]}]}"#}
                }),
            },
        )
        .unwrap();

    vec![lineage.op_id, create_page.op_id, save_page.op_id]
}

// ============================================================
// Task 1: two-device convergence
// ============================================================

#[test]
fn two_devices_converge_via_self_enroll() {
    let Some(bin) = locate_relay_bin() else {
        eprintln!(
            "SKIPPING sync_two_device_e2e: set SHIZUMU_E2E_RELAY_BIN to the relay binary path"
        );
        return;
    };

    let tmp = tempdir_for_test();
    let relay = Relay::start(bin, &tmp);

    // ONE phrase → ONE user. Derive user keys once; both devices share
    // them (single-user invariant). Each device gets its own random
    // Ed25519 signing keypair.
    let mnemonic = keys::generate_seed_phrase();
    let user_keys = keys::user_keys_from_phrase(&mnemonic);
    let device_keys_a = keys::generate_device_keys();
    let device_keys_b = keys::generate_device_keys();
    assert_ne!(
        device_keys_a.device_id, device_keys_b.device_id,
        "two devices must have distinct device_ids"
    );

    let user_sign_pub_b64 = B64.encode(user_keys.user_sign_pub_bytes());

    // -- Enroll device A via the init-user → enroll() token flow --
    let (expected_user_id, token) = relay.init_user(&user_sign_pub_b64);
    let enroll_a = wire::enroll::enroll(
        &relay.base_url,
        &user_keys,
        &device_keys_a,
        &token,
        "device-a",
    )
    .expect("enroll A");
    assert_eq!(enroll_a.user_id, expected_user_id);
    assert_eq!(enroll_a.device_id, device_keys_a.device_id.to_string());

    // -- Enroll device B via self_enroll. The user already exists,
    // signed by the same user_sign_pub — the relay's same-pubkey
    // branch adds device B rather than returning 409. --
    let enroll_b = wire::enroll::self_enroll(
        &relay.base_url,
        &user_keys,
        &device_keys_b,
        "device-b",
    )
    .expect(
        "self_enroll B against same user_sign_pub should add a second device, not 409. \
         If this fails with relay_already_claimed, the same-pubkey branch in the relay \
         is not implemented (or this build pre-dates that fix).",
    );
    assert_eq!(
        enroll_b.user_id, expected_user_id,
        "device B joins the same user account"
    );
    assert_eq!(enroll_b.device_id, device_keys_b.device_id.to_string());

    // -- Device A: seed three ops, run upload pass --
    let db_a = fresh_device_db(&relay.base_url, &enroll_a.user_id, &enroll_a.device_id);
    let seeded = seed_three_ops(&db_a);
    assert_eq!(seeded.len(), 3);

    let cfg_a = {
        let conn = db_a.lock().unwrap();
        config::load(&conn).unwrap()
    };
    assert!(cfg_a.is_active());

    let upload_stats =
        upload::run_pass(&db_a, &cfg_a, &user_keys, &device_keys_a).expect("upload A");
    assert_eq!(upload_stats.ops_posted, 3, "all three ops uploaded");

    // -- Device B: fresh DB with its own device_id, run pull --
    let db_b = fresh_device_db(&relay.base_url, &enroll_b.user_id, &enroll_b.device_id);
    let cfg_b = {
        let conn = db_b.lock().unwrap();
        config::load(&conn).unwrap()
    };
    let pull_stats =
        pull::run_pass(&db_b, &cfg_b, &user_keys, &device_keys_b).expect("pull B");
    assert_eq!(pull_stats.ops_fetched, 3, "B fetches A's three ops");
    assert_eq!(pull_stats.ops_received, 3, "all three stored on B");
    assert_eq!(pull_stats.ops_skipped_decrypt_error, 0);

    // -- Convergence: the lineage row, the page row, and the content
    // body all show up on B with values that match what A emitted --
    let conn_b = db_b.lock().unwrap();

    let (lin_name, lin_mode): (String, String) = conn_b
        .query_row(
            "SELECT name, mode FROM lineages WHERE id = 'lin-conv'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .expect("lineage row landed on B");
    assert_eq!(lin_name, "convergence");
    assert_eq!(lin_mode, "discrete");

    let (date_b, page_number_b, content_b): (String, i64, String) = conn_b
        .query_row(
            "SELECT date, page_number, content_json FROM pages WHERE id = 'page-conv'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .expect("page row landed on B");
    assert_eq!(date_b, "2026-05-29");
    assert_eq!(page_number_b, 1);
    assert!(
        content_b.contains("convergence body"),
        "content_json from A's save_page_content should have folded onto B's row, got: {content_b}"
    );

    // The content_json B sees IS the JSON A sent — same bytes when
    // routed through the same merge handler. We don't have A's exact
    // serialised form readily available (the merge handler stores
    // whatever the payload's "content_json" field contained), so the
    // substring assertion above is the practical convergence check.
}

// ============================================================
// Task 2: relay-loss recovery via sync_force_reupload
// ============================================================

/// Helper: count committed rows in the relay's log table. Opens the
/// relay's SQLite DB directly because there isn't a wire endpoint
/// that surfaces this. Read-only — does not interfere with a running
/// relay (we either query while it's down, or with WAL it would be
/// safe to query while up too).
fn relay_log_count(db_path: &std::path::Path) -> i64 {
    let conn = Connection::open(db_path).expect("open relay db");
    conn.query_row(
        "SELECT COUNT(*) FROM log WHERE state = 'committed'",
        [],
        |r| r.get::<_, i64>(0),
    )
    .expect("count log")
}

fn seed_five_ops(db: &std::sync::Arc<std::sync::Mutex<Connection>>) -> Vec<String> {
    let conn = db.lock().unwrap();
    let engine = OpLogEngine::load(&conn).unwrap();
    let mut ids = Vec::new();

    let lin = engine
        .apply(
            &conn,
            Op {
                kind: OpKind::lineage_op(),
                doc_id: Some("lin-recovery".into()),
                stream_id: op_stream::SETTINGS_LINEAGES_PINS,
                payload: serde_json::json!({
                    "op": "create_lineage",
                    "lineage_id": "lin-recovery",
                    "fields": {"name": "recovery", "mode": "discrete"}
                }),
            },
        )
        .unwrap();
    ids.push(lin.op_id);

    for i in 0..3 {
        let page_id = format!("page-rec-{i}");
        let p = engine
            .apply(
                &conn,
                Op {
                    kind: OpKind::page_blob(),
                    doc_id: Some(page_id.clone()),
                    stream_id: op_stream::DISCRETE_PAGES,
                    payload: serde_json::json!({
                        "op": "create_new_page",
                        "page_id": page_id,
                        "fields": {
                            "date": "2026-05-29",
                            "page_number": i + 1,
                            "lineage_id": "lin-recovery"
                        }
                    }),
                },
            )
            .unwrap();
        ids.push(p.op_id);
    }

    let setting = engine
        .apply(
            &conn,
            Op {
                kind: OpKind::setting_op(),
                doc_id: None,
                stream_id: op_stream::SETTINGS_LINEAGES_PINS,
                payload: serde_json::json!({
                    "op": "set",
                    "key": "recovery_marker",
                    "value": "before_loss"
                }),
            },
        )
        .unwrap();
    ids.push(setting.op_id);

    assert_eq!(ids.len(), 5);
    ids
}

/// Apply the equivalent of `sync_force_reupload`: clear cached
/// ciphertext + reset state to local_only on every committed /
/// pending_upload row, drop the cursor. We replicate the command
/// inline instead of going through the Tauri State surface so the
/// test stays self-contained.
fn force_reupload(conn: &Connection) {
    conn.execute_batch(
        "UPDATE op_log SET ciphertext = NULL, state = 'local_only', user_seq = NULL \
         WHERE state IN ('committed', 'pending_upload'); \
         UPDATE sync_state SET last_seen_user_seq = 0;",
    )
    .expect("force_reupload");
    // op_log_meta may not exist in older migration sets; ignore.
    let _ = conn.execute(
        "DELETE FROM op_log_meta WHERE key = 'backfill_complete'",
        [],
    );
}

#[test]
fn relay_loss_recovery_via_force_reupload() {
    let Some(bin) = locate_relay_bin() else {
        eprintln!(
            "SKIPPING sync_two_device_e2e: set SHIZUMU_E2E_RELAY_BIN to the relay binary path"
        );
        return;
    };

    let tmp = tempdir_for_test();
    let relay = Relay::start(bin.clone(), &tmp);
    let relay_db_path_initial = relay.db_path.clone();
    let relay_blob_root_initial = relay.blob_root.clone();
    let _relay_bind_initial = relay.bind.clone();
    let relay_base_url_initial = relay.base_url.clone();

    // -- One user, one device (the only device on the account) --
    let mnemonic = keys::generate_seed_phrase();
    let user_keys = keys::user_keys_from_phrase(&mnemonic);
    let device_keys_a = keys::generate_device_keys();
    let user_sign_pub_b64 = B64.encode(user_keys.user_sign_pub_bytes());

    let (user_id_v1, token_v1) = relay.init_user(&user_sign_pub_b64);
    let enroll_v1 = wire::enroll::enroll(
        &relay.base_url,
        &user_keys,
        &device_keys_a,
        &token_v1,
        "device-a",
    )
    .expect("enroll A v1");

    // -- Seed + upload five ops --
    let db_a = fresh_device_db(&relay.base_url, &enroll_v1.user_id, &enroll_v1.device_id);
    let seeded = seed_five_ops(&db_a);
    assert_eq!(seeded.len(), 5);

    let cfg_a = {
        let conn = db_a.lock().unwrap();
        config::load(&conn).unwrap()
    };
    let upload_stats =
        upload::run_pass(&db_a, &cfg_a, &user_keys, &device_keys_a).expect("upload v1");
    assert_eq!(upload_stats.ops_posted, 5);

    // -- Relay has five committed rows --
    assert_eq!(
        relay_log_count(&relay_db_path_initial),
        5,
        "relay should hold five committed log rows after upload"
    );

    // Capture the committed ciphertext lengths from the client so we
    // can later assert the re-upload produced fresh ciphertext (each
    // encrypt_op picks a random nonce, so byte-for-byte equality
    // would actively be wrong — but the count + sizes round-trip).
    let pre_loss_byte_lens: Vec<i64> = {
        let conn = db_a.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT LENGTH(ciphertext) FROM op_log \
                 WHERE state = 'committed' ORDER BY user_seq ASC",
            )
            .unwrap();
        stmt.query_map([], |r| r.get::<_, i64>(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect()
    };
    assert_eq!(pre_loss_byte_lens.len(), 5);

    // -- SHUTDOWN the relay, delete its DB + blob storage, restart --
    let (bin2, db_path_old, blob_root_old, bind_v2) = relay.shutdown();
    let _ = std::fs::remove_file(&db_path_old);
    let _ = std::fs::remove_dir_all(&blob_root_old);

    // The fresh relay reuses the same bind (so the client config
    // doesn't need to change) and a fresh DB + blob dir.
    let relay_v2 = Relay::start_at(
        bin2,
        &bind_v2,
        relay_db_path_initial.clone(),
        relay_blob_root_initial.clone(),
    );
    assert_eq!(relay_v2.base_url, relay_base_url_initial);
    assert_eq!(
        relay_log_count(&relay_v2.db_path),
        0,
        "fresh relay has no log rows after loss"
    );

    // -- Re-init the user on the fresh relay + clear client cache --
    // The relay generates a fresh user_id UUID on each init-user
    // (the old one is gone with the DB). The client must re-stamp
    // sync_state with the new user_id before re-running upload.
    let (user_id_v2, token_v2) = relay_v2.init_user(&user_sign_pub_b64);
    let _ = user_id_v1;
    let _ = enroll_v1.user_id.as_str(); // we no longer expect equality

    // The new enrollment uses a new device_id assignment (the relay
    // generates one fresh; the client's existing device_keys are
    // reused so signed-request verification still works).
    let device_keys_v2 = keys::generate_device_keys();
    let enroll_v2 = wire::enroll::enroll(
        &relay_v2.base_url,
        &user_keys,
        &device_keys_v2,
        &token_v2,
        "device-a-recovered",
    )
    .expect("enroll A v2 (post-recovery)");
    assert_eq!(enroll_v2.user_id, user_id_v2);

    // Update the client's sync_state to point at the new enrollment
    // identity, then force the local ciphertext cache to be cleared.
    {
        let conn = db_a.lock().unwrap();
        config::set_enrollment(&conn, &enroll_v2.user_id, &enroll_v2.device_id, 2).unwrap();
        force_reupload(&conn);
    }

    // After force_reupload every previously-committed row is back to
    // local_only with no ciphertext cached and no user_seq stamped.
    let local_only_count: i64 = {
        let conn = db_a.lock().unwrap();
        conn.query_row(
            "SELECT COUNT(*) FROM op_log WHERE state = 'local_only'",
            [],
            |r| r.get(0),
        )
        .unwrap()
    };
    assert_eq!(
        local_only_count, 5,
        "force_reupload should have flipped all five committed rows back to local_only"
    );

    // -- Re-run upload against the fresh relay --
    let cfg_a2 = {
        let conn = db_a.lock().unwrap();
        config::load(&conn).unwrap()
    };
    let upload_stats_v2 =
        upload::run_pass(&db_a, &cfg_a2, &user_keys, &device_keys_v2).expect("upload v2");
    assert_eq!(
        upload_stats_v2.ops_posted, 5,
        "all five ops should re-upload onto the fresh relay"
    );

    // -- Relay holds five rows again --
    assert_eq!(
        relay_log_count(&relay_v2.db_path),
        5,
        "fresh relay should hold all five rows after re-upload pass"
    );

    // -- And the client's cached ciphertext is back with the same
    // per-op byte lengths (plaintext sizes are identical, nonce is
    // always 24 bytes, AEAD tag is always 16 bytes; only the nonce
    // and tag bytes themselves differ between encrypt calls) --
    let post_recovery_lens: Vec<i64> = {
        let conn = db_a.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT LENGTH(ciphertext) FROM op_log \
                 WHERE state = 'committed' ORDER BY user_seq ASC",
            )
            .unwrap();
        stmt.query_map([], |r| r.get::<_, i64>(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect()
    };
    assert_eq!(
        post_recovery_lens, pre_loss_byte_lens,
        "ciphertext byte-lengths should match across the loss boundary \
         (plaintext sizes are deterministic; only the random nonce + AEAD tag bytes change)"
    );
}

// ============================================================
// Key rotation: revoke a device, rotate the epoch, prove the
// revoked device is locked out of post-rotation content while a
// remaining device picks up the new epoch and keeps reading.
// ============================================================

/// Apply one post-rotation `save_page_content` op on `page-conv`. It is
/// stamped with the device's current epoch (1 after rotation) by the op-log
/// engine, so it gets encrypted under the new epoch's keys.
fn seed_post_rotation_op(db: &std::sync::Arc<std::sync::Mutex<Connection>>) -> String {
    let conn = db.lock().unwrap();
    let engine = OpLogEngine::load(&conn).unwrap();
    engine
        .apply(
            &conn,
            Op {
                kind: OpKind::page_blob(),
                doc_id: Some("page-conv".into()),
                stream_id: op_stream::DISCRETE_PAGES,
                payload: serde_json::json!({
                    "op": "save_page_content",
                    "page_id": "page-conv",
                    "fields": {"content_json": r#"{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"post-rotation body"}]}]}"#}
                }),
            },
        )
        .unwrap()
        .op_id
}

#[test]
fn revoked_device_locked_out_after_rotation() {
    let Some(bin) = locate_relay_bin() else {
        eprintln!(
            "SKIPPING sync_two_device_e2e: set SHIZUMU_E2E_RELAY_BIN to the relay binary path"
        );
        return;
    };

    let tmp = tempdir_for_test();
    let relay = Relay::start(bin, &tmp);

    // One phrase -> one user; three devices, each its own signing + kex key.
    let mnemonic = keys::generate_seed_phrase();
    let user_keys = keys::user_keys_from_phrase(&mnemonic);
    let dk_a = keys::generate_device_keys();
    let dk_b = keys::generate_device_keys();
    let dk_c = keys::generate_device_keys();

    let user_sign_pub_b64 = B64.encode(user_keys.user_sign_pub_bytes());
    let (user_id, token) = relay.init_user(&user_sign_pub_b64);
    wire::enroll::enroll(&relay.base_url, &user_keys, &dk_a, &token, "device-a").expect("enroll A");
    wire::enroll::self_enroll(&relay.base_url, &user_keys, &dk_b, "device-b").expect("enroll B");
    wire::enroll::self_enroll(&relay.base_url, &user_keys, &dk_c, "device-c").expect("enroll C");

    let db_a = fresh_device_db(&relay.base_url, &user_id, &dk_a.device_id.to_string());
    let db_c = fresh_device_db(&relay.base_url, &user_id, &dk_c.device_id.to_string());

    // Epoch 0: A seeds + uploads three ops; C converges.
    seed_three_ops(&db_a);
    {
        let cfg = {
            let conn = db_a.lock().unwrap();
            config::load(&conn).unwrap()
        };
        upload::run_pass(&db_a, &cfg, &user_keys, &dk_a).expect("epoch-0 upload A");
    }
    {
        let cfg = {
            let conn = db_c.lock().unwrap();
            config::load(&conn).unwrap()
        };
        let p = pull::run_pass(&db_c, &cfg, &user_keys, &dk_c).expect("epoch-0 pull C");
        assert_eq!(p.ops_received, 3, "C converges on A's epoch-0 ops");
    }

    // Revoke B from A, then rotate the account keys (epoch 0 -> 1). ES_1 is
    // wrapped to A and C (both have published kex keys via enroll) but NOT B.
    let device_b_id = dk_b.device_id.to_string();
    wire::devices::revoke_device(&relay.base_url, &dk_a, &user_id, &device_b_id).expect("revoke B");
    let new_epoch =
        rotation::rotate_after_revoke(&db_a, &dk_a, &relay.base_url, &user_id, &device_b_id)
            .expect("rotate after revoke");
    assert_eq!(new_epoch, 1, "rotation advances to epoch 1");
    {
        let conn = db_a.lock().unwrap();
        assert_eq!(config::get_current_epoch(&conn).unwrap(), 1, "A adopts epoch 1");
    }

    // A writes a post-rotation op (epoch 1) and uploads it.
    seed_post_rotation_op(&db_a);
    {
        let cfg = {
            let conn = db_a.lock().unwrap();
            config::load(&conn).unwrap()
        };
        upload::run_pass(&db_a, &cfg, &user_keys, &dk_a).expect("epoch-1 upload A");
    }

    // C picks up the new epoch key, then pulls + decrypts the epoch-1 op.
    let stored = rotation::fetch_and_store_epoch_keys(&db_c, &dk_c, &relay.base_url, &user_id)
        .expect("C fetches epoch keys");
    assert!(stored >= 1, "C adopts the new epoch secret");
    {
        let cfg = {
            let conn = db_c.lock().unwrap();
            assert_eq!(config::get_current_epoch(&conn).unwrap(), 1, "C adopts epoch 1");
            config::load(&conn).unwrap()
        };
        let p = pull::run_pass(&db_c, &cfg, &user_keys, &dk_c).expect("epoch-1 pull C");
        assert_eq!(
            p.ops_skipped_decrypt_error, 0,
            "C holds the epoch-1 key, so nothing is skipped"
        );
    }
    {
        let conn = db_c.lock().unwrap();
        let content: String = conn
            .query_row(
                "SELECT content_json FROM pages WHERE id = 'page-conv'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(
            content.contains("post-rotation body"),
            "C sees the post-rotation content: {content}"
        );
    }

    // B is revoked: its signed pull is refused by the relay.
    let db_b = fresh_device_db(&relay.base_url, &user_id, &device_b_id);
    let cfg_b = {
        let conn = db_b.lock().unwrap();
        config::load(&conn).unwrap()
    };
    let res_b = pull::run_pass(&db_b, &cfg_b, &user_keys, &dk_b);
    assert!(res_b.is_err(), "revoked device B's pull must be refused");

    // And cryptographically: B holds no epoch-1 secret, so even handed the
    // blob it could not decrypt the post-rotation op.
    {
        let conn = db_b.lock().unwrap();
        let k = shizumu_lib::sync::epoch::content_master_key_for_epoch(&conn, &user_keys, 1)
            .unwrap();
        assert!(k.is_none(), "B has no epoch-1 content key (locked out)");
    }
}
