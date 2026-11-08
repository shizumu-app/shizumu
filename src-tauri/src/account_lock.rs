//! One lock for the account (docs/superpowers/specs/2026-11-07-account-lock-design.md).
//!
//! The lock is a synced settings row, `account_lock`, holding
//! `{"on": true, "passphrase": "..."}` or `{"on": false}`. Settings sync
//! last-writer-wins by HLC inside sealed ops, so the relay never reads it.
//! Each device follows the row with its OWN file: it encrypts, re-keys or
//! decrypts the database it opens, here, after a sync tick.
//!
//! `encryption_enabled` stays what it was made in 6460fbe4: a local-only
//! fact about this device's file. A phone used to read the laptop's copy of
//! it and ask for a passphrase its plain file never had.

use crate::db::Db;
use rusqlite::{params, OptionalExtension};

pub const SETTING_KEY: &str = "account_lock";

/// What the account says about the lock.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LockRow {
    pub on: bool,
    pub passphrase: Option<String>,
}

impl LockRow {
    pub fn on(passphrase: &str) -> Self {
        Self { on: true, passphrase: Some(passphrase.to_string()) }
    }
    pub fn off() -> Self {
        Self { on: false, passphrase: None }
    }
    pub fn to_value(&self) -> String {
        match (&self.passphrase, self.on) {
            (Some(p), true) => serde_json::json!({ "on": true, "passphrase": p }).to_string(),
            _ => serde_json::json!({ "on": false }).to_string(),
        }
    }
    /// None for a value that is not a lock record: an unreadable row is
    /// treated as no row, never as "on" with no passphrase.
    pub fn parse(value: &str) -> Option<Self> {
        let v: serde_json::Value = serde_json::from_str(value).ok()?;
        let on = v.get("on")?.as_bool()?;
        if !on {
            return Some(Self::off());
        }
        let p = v.get("passphrase")?.as_str()?;
        if p.is_empty() {
            return None;
        }
        Some(Self::on(p))
    }
}

/// What this device must do to its own file to follow the account.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LockAction {
    Nothing,
    /// The file is plain and the account is locked: encrypt it with this.
    Encrypt(String),
    /// The file is keyed with `from`; the account's passphrase is `to`.
    Rekey { from: String, to: String },
    /// The account's lock is off; the file is keyed with `from`.
    Decrypt { from: String },
    /// No account lock yet, and this file is locked with `key`: share it.
    /// A laptop locked before 0.8.2 shares its lock the first time 0.8.2
    /// opens it (the spec's last row).
    Publish(String),
}

/// The spec's table. `key` is the passphrase this device opens its file
/// with, when it knows it (its key file, or the passphrase it was last
/// unlocked with). A file keyed with a passphrase this device does not know
/// is left alone: it asks at the lock screen, and follows after unlock.
pub fn lock_action(row: Option<&LockRow>, file_encrypted: bool, key: Option<&str>) -> LockAction {
    match (row, file_encrypted, key) {
        (Some(r), false, _) if r.on => LockAction::Encrypt(r.passphrase.clone().unwrap_or_default()),
        (Some(r), true, Some(k)) if r.on => match r.passphrase.as_deref() {
            Some(p) if p != k => LockAction::Rekey { from: k.to_string(), to: p.to_string() },
            _ => LockAction::Nothing,
        },
        (Some(r), true, Some(k)) if !r.on => LockAction::Decrypt { from: k.to_string() },
        (None, true, Some(k)) => LockAction::Publish(k.to_string()),
        // Encrypted with a key this device does not know: wait for unlock.
        // Plain with the lock off or absent: already following.
        _ => LockAction::Nothing,
    }
}

/// Where this device keeps the key it opens its file with. The app's is the
/// key file (crypto::store_key); tests keep it in memory, so no test reaches
/// the system keyring or the writer's own key file.
pub trait KeyStore {
    fn get(&self, db_path: &std::path::Path) -> Option<String>;
    fn put(&self, passphrase: &str) -> Result<(), String>;
    fn delete(&self) -> Result<(), String>;
}

pub struct AppKeys;

impl KeyStore for AppKeys {
    fn get(&self, db_path: &std::path::Path) -> Option<String> {
        crate::crypto::retrieve_key(db_path)
    }
    fn put(&self, passphrase: &str) -> Result<(), String> {
        crate::crypto::store_key(passphrase)
    }
    fn delete(&self) -> Result<(), String> {
        crate::crypto::delete_key()
    }
}

/// The passphrase this process last opened the file with: an unlock, a
/// setup, a change, or a reconcile. A device whose key file is missing (the
/// keyring lost it) still follows a change once the writer has unlocked it.
static OPENED_WITH: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

pub fn remember_opened_with(passphrase: Option<&str>) {
    if let Ok(mut k) = OPENED_WITH.lock() {
        *k = passphrase.map(|p| p.to_string());
    }
}

fn opened_with() -> Option<String> {
    OPENED_WITH.lock().ok().and_then(|k| k.clone())
}

pub fn read_row(conn: &rusqlite::Connection) -> Option<LockRow> {
    let v: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", params![SETTING_KEY], |r| r.get(0))
        .optional()
        .ok()
        .flatten();
    v.as_deref().and_then(LockRow::parse)
}

/// Write the account's lock on this device and send it to the others.
pub fn write_row(conn: &rusqlite::Connection, engine: Option<&crate::op_log::OpLog>, row: &LockRow) -> Result<(), String> {
    let value = row.to_value();
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        params![SETTING_KEY, &value],
    )
    .map_err(|e| e.to_string())?;
    if let Some(engine) = engine {
        crate::op_log::emit_setting(engine, conn, SETTING_KEY, Some(&value));
    }
    Ok(())
}

/// Blank the passphrase from this device's earlier lock ops once the lock is
/// off: the file is plain from here, and the old passphrase must not stay in
/// it. The ops stay (their HLC still orders the setting); only the secret
/// goes. Sealed copies on the relay are unreadable to it.
pub fn scrub_old_passphrases(conn: &rusqlite::Connection) -> Result<usize, String> {
    let rows: Vec<(String, Vec<u8>)> = {
        let mut stmt = conn
            .prepare("SELECT op_id, payload_blob FROM op_log WHERE op_kind = 'setting_op'")
            .map_err(|e| e.to_string())?;
        let it = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Vec<u8>>(1)?)))
            .map_err(|e| e.to_string())?;
        it.filter_map(Result::ok).collect()
    };
    let mut n = 0;
    for (id, blob) in rows {
        let Ok(mut v) = serde_json::from_slice::<serde_json::Value>(&blob) else { continue };
        if v.get("key").and_then(|k| k.as_str()) != Some(SETTING_KEY) {
            continue;
        }
        let holds = v.get("value").and_then(|x| x.as_str()).and_then(LockRow::parse).map_or(false, |r| r.passphrase.is_some());
        if !holds {
            continue;
        }
        v["value"] = serde_json::Value::String(LockRow::off().to_value());
        let out = serde_json::to_vec(&v).map_err(|e| e.to_string())?;
        conn.execute("UPDATE op_log SET payload_blob = ?1 WHERE op_id = ?2", params![out, id])
            .map_err(|e| e.to_string())?;
        n += 1;
    }
    Ok(n)
}

fn set_flag(conn: &rusqlite::Connection, on: bool) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('encryption_enabled', ?1)",
        params![if on { "true" } else { "false" }],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Follow the account's lock with this device's own file. Returns what was
/// done; `Nothing` most ticks. The connection is swapped under the mutex the
/// way `setup_encryption` and `rekey_inner` do it, so no command reads or
/// writes mid-change, and whatever happens the app is left on a real
/// connection to the file.
pub fn reconcile(db: &Db, engine: Option<&crate::op_log::OpLog>, keys: &dyn KeyStore) -> Result<LockAction, String> {
    let mut conn = db.lock().map_err(|e| e.to_string())?;
    let path: String = conn
        .query_row("PRAGMA database_list", [], |r| r.get::<_, String>(2))
        .map_err(|e| e.to_string())?;
    // Locked by inactivity (an in-memory stand-in) or a launch that could
    // not open the file: nothing to follow until it is open again.
    if path.is_empty() {
        return Ok(LockAction::Nothing);
    }
    let path = std::path::PathBuf::from(path);
    let row = read_row(&conn);
    let encrypted = crate::crypto::check_db_encrypted(&path);
    // The key this file opens with: the one this process last opened it
    // with, else the stored one, and only one that really opens it. A
    // remembered passphrase can be out of date (the file re-keyed since),
    // and acting on a wrong key would re-key from it, or share it with the
    // account as the lock.
    let key = if encrypted {
        [opened_with(), keys.get(&path)]
            .into_iter()
            .flatten()
            .find(|k| crate::crypto::open_encrypted(&path, k).is_ok())
    } else {
        None
    };
    let action = lock_action(row.as_ref(), encrypted, key.as_deref());

    let reopen = |key: Option<&str>| -> Result<rusqlite::Connection, String> {
        let c = match key {
            Some(k) => crate::crypto::open_encrypted(&path, k),
            None => crate::crypto::open_unencrypted(&path),
        }
        .map_err(|e| format!("failed to reopen the db: {e}"))?;
        c.execute_batch("PRAGMA journal_mode=WAL;").map_err(|e| e.to_string())?;
        Ok(c)
    };

    match &action {
        LockAction::Nothing => {}
        LockAction::Publish(k) => {
            write_row(&conn, engine, &LockRow::on(k))?;
        }
        LockAction::Encrypt(p) => {
            *conn = rusqlite::Connection::open_in_memory().map_err(|e| e.to_string())?;
            let done = crate::crypto::migrate_to_encrypted(&path, p);
            *conn = reopen(if done.is_ok() { Some(p) } else { None })?;
            done?;
            keys.put(p)?;
            remember_opened_with(Some(p));
            set_flag(&conn, true)?;
        }
        LockAction::Rekey { from, to } => {
            *conn = rusqlite::Connection::open_in_memory().map_err(|e| e.to_string())?;
            let done = crate::crypto::rekey_file(&path, from, Some(to));
            *conn = reopen(Some(if done.is_ok() { to } else { from }))?;
            done?;
            keys.put(to)?;
            remember_opened_with(Some(to));
        }
        LockAction::Decrypt { from } => {
            *conn = rusqlite::Connection::open_in_memory().map_err(|e| e.to_string())?;
            let done = crate::crypto::rekey_file(&path, from, None);
            *conn = reopen(if done.is_ok() { None } else { Some(from) })?;
            done?;
            keys.delete()?;
            remember_opened_with(None);
            set_flag(&conn, false)?;
            scrub_old_passphrases(&conn)?;
        }
    }
    Ok(action)
}

/// What a successful unlock does beyond opening the file.
#[derive(Debug, PartialEq, Eq)]
pub struct UnlockFollowUp {
    /// Save the passphrase as this device's key: launch could not open the
    /// file with the one stored, so the stored one is stale (a sync re-key
    /// interrupted between swapping the file and saving its key, or a key
    /// file lost). Left stale, every launch fails the same way.
    pub store_key: bool,
    /// Start the sync worker: launch spawns none on a file it cannot open.
    pub spawn_worker: bool,
}

/// `launch_failed`: the file was opened by this unlock, not at launch.
pub fn unlock_follow_up(launch_failed: bool, worker_running: bool) -> UnlockFollowUp {
    UnlockFollowUp { store_key: launch_failed, spawn_worker: launch_failed && !worker_running }
}

#[cfg(test)]
mod tests {
    // A launch that could not open the file with the stored key (the A16,
    // 2026-11-08: killed in the seconds between a sync re-key's file swap
    // and saving the new key) used to stay that way: the unlock opened the
    // writing, but the stale key stayed stored, so every launch failed the
    // same way, and the sync worker, never spawned at launch, never ran.
    #[test]
    fn an_unlock_after_a_failed_launch_saves_the_key_and_starts_sync() {
        let f = super::unlock_follow_up(true, false);
        assert!(f.store_key, "the stored key did not open the file; this passphrase did");
        assert!(f.spawn_worker, "launch spawned no worker on a file it could not open");
        // A worker already running (a launch that did open) is not doubled.
        assert!(!super::unlock_follow_up(true, true).spawn_worker);
    }

    #[test]
    fn an_unlock_of_the_gate_after_a_good_launch_changes_nothing() {
        // The stored key opened the file at launch, and the worker runs:
        // the gate is the only thing the passphrase answered.
        let f = super::unlock_follow_up(false, true);
        assert!(!f.store_key && !f.spawn_worker);
    }
    use super::*;

    // ─── the table ──────────────────────────────────────────────────────

    #[test]
    fn a_plain_file_on_a_locked_account_is_encrypted_with_the_accounts_passphrase() {
        assert_eq!(lock_action(Some(&LockRow::on("heron")), false, None), LockAction::Encrypt("heron".into()));
    }

    #[test]
    fn a_file_already_keyed_with_the_accounts_passphrase_is_left_alone() {
        // Not a no-op by accident: this is every tick on a device that is
        // already following, and re-keying it would rewrite the whole file.
        assert_eq!(lock_action(Some(&LockRow::on("heron")), true, Some("heron")), LockAction::Nothing);
    }

    #[test]
    fn a_changed_passphrase_re_keys_the_file_from_the_one_it_has() {
        assert_eq!(
            lock_action(Some(&LockRow::on("egret")), true, Some("heron")),
            LockAction::Rekey { from: "heron".into(), to: "egret".into() }
        );
    }

    #[test]
    fn a_lock_turned_off_decrypts_the_file() {
        assert_eq!(lock_action(Some(&LockRow::off()), true, Some("heron")), LockAction::Decrypt { from: "heron".into() });
    }

    #[test]
    fn a_file_keyed_with_a_passphrase_this_device_does_not_know_waits_for_unlock() {
        // Nothing yet, and that is the safe answer: without the file's key
        // there is nothing to re-key from, and guessing would lock it for
        // good. The lock screen asks; unlock remembers; the next tick follows.
        assert_eq!(lock_action(Some(&LockRow::on("egret")), true, None), LockAction::Nothing);
        assert_eq!(lock_action(Some(&LockRow::off()), true, None), LockAction::Nothing);
    }

    #[test]
    fn a_plain_file_with_the_lock_off_or_never_set_is_already_following() {
        // The common case for every account without a lock: no work.
        assert_eq!(lock_action(Some(&LockRow::off()), false, None), LockAction::Nothing);
        assert_eq!(lock_action(None, false, None), LockAction::Nothing);
    }

    #[test]
    fn a_device_locked_before_the_account_had_a_lock_shares_it() {
        assert_eq!(lock_action(None, true, Some("heron")), LockAction::Publish("heron".into()));
    }

    #[test]
    fn a_lock_value_that_does_not_parse_is_no_lock_at_all() {
        // Never "on" without a passphrase: that row would lock a file with
        // an empty key nobody can type.
        assert_eq!(LockRow::parse(r#"{"on":true}"#), None);
        assert_eq!(LockRow::parse(r#"{"on":true,"passphrase":""}"#), None);
        assert_eq!(LockRow::parse("true"), None);
        assert_eq!(LockRow::parse(&LockRow::on("heron").to_value()), Some(LockRow::on("heron")));
        assert_eq!(LockRow::parse(&LockRow::off().to_value()), Some(LockRow::off()));
    }

    // ─── on a real file ─────────────────────────────────────────────────

    struct MemKeys(std::sync::Mutex<Option<String>>);
    impl KeyStore for MemKeys {
        fn get(&self, _: &std::path::Path) -> Option<String> { self.0.lock().unwrap().clone() }
        fn put(&self, p: &str) -> Result<(), String> { *self.0.lock().unwrap() = Some(p.into()); Ok(()) }
        fn delete(&self) -> Result<(), String> { *self.0.lock().unwrap() = None; Ok(()) }
    }

    /// reconcile reads OPENED_WITH, which is process-wide: tests that touch
    /// it take turns.
    static TURN: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn plain_db_with_writing() -> (std::path::PathBuf, Db) {
        let dir = std::env::temp_dir().join(format!("shizumu-acctlock-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settles.db");
        let db = crate::test_helpers::test_db_at(&path);
        db.lock().unwrap().execute_batch("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('kept');").unwrap();
        (path, db)
    }

    fn kept(db: &Db) -> String {
        db.lock().unwrap().query_row("SELECT v FROM t", [], |r| r.get(0)).unwrap()
    }

    fn set_row(db: &Db, row: &LockRow) {
        write_row(&db.lock().unwrap(), None, row).unwrap();
    }

    #[test]
    fn a_phone_that_receives_the_lock_encrypts_its_own_file_and_keeps_writing() {
        let _t = TURN.lock().unwrap_or_else(|e| e.into_inner());
        remember_opened_with(None);
        let (path, db) = plain_db_with_writing();
        let keys = MemKeys(Default::default());
        set_row(&db, &LockRow::on("heron over the weir"));

        assert_eq!(reconcile(&db, None, &keys).unwrap(), LockAction::Encrypt("heron over the weir".into()));
        assert!(crate::crypto::check_db_encrypted(&path), "the phone's own file is locked now");
        assert!(crate::crypto::open_encrypted(&path, "heron over the weir").is_ok(), "with the laptop's passphrase");
        assert_eq!(kept(&db), "kept", "the app keeps writing without a restart");
        assert_eq!(keys.get(&path).as_deref(), Some("heron over the weir"), "the next launch opens it");
        assert_eq!(reconcile(&db, None, &keys).unwrap(), LockAction::Nothing, "and the next tick has nothing to do");
        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    #[test]
    fn a_change_made_elsewhere_re_keys_this_file_and_the_old_passphrase_stops_opening_it() {
        let _t = TURN.lock().unwrap_or_else(|e| e.into_inner());
        remember_opened_with(None);
        let (path, db) = plain_db_with_writing();
        let keys = MemKeys(Default::default());
        set_row(&db, &LockRow::on("heron over the weir"));
        reconcile(&db, None, &keys).unwrap();

        set_row(&db, &LockRow::on("second heron, upstream"));
        assert!(matches!(reconcile(&db, None, &keys).unwrap(), LockAction::Rekey { .. }));
        assert!(crate::crypto::open_encrypted(&path, "heron over the weir").is_err());
        assert!(crate::crypto::open_encrypted(&path, "second heron, upstream").is_ok());
        assert_eq!(kept(&db), "kept");
        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    #[test]
    fn the_lock_turned_off_elsewhere_leaves_this_file_plain_and_forgets_the_passphrase() {
        let _t = TURN.lock().unwrap_or_else(|e| e.into_inner());
        remember_opened_with(None);
        let (path, db) = plain_db_with_writing();
        let keys = MemKeys(Default::default());
        set_row(&db, &LockRow::on("heron over the weir"));
        reconcile(&db, None, &keys).unwrap();

        set_row(&db, &LockRow::off());
        assert!(matches!(reconcile(&db, None, &keys).unwrap(), LockAction::Decrypt { .. }));
        assert!(!crate::crypto::check_db_encrypted(&path), "plain again");
        assert_eq!(keys.get(&path), None);
        assert_eq!(kept(&db), "kept");
        let flag: String = db.lock().unwrap().query_row("SELECT value FROM settings WHERE key='encryption_enabled'", [], |r| r.get(0)).unwrap();
        assert_eq!(flag, "false", "the next launch does not ask");
        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    #[test]
    fn a_file_whose_key_was_lost_waits_for_unlock_then_follows() {
        let _t = TURN.lock().unwrap_or_else(|e| e.into_inner());
        remember_opened_with(None);
        let (path, db) = plain_db_with_writing();
        let keys = MemKeys(Default::default());
        set_row(&db, &LockRow::on("heron over the weir"));
        reconcile(&db, None, &keys).unwrap();
        keys.delete().unwrap();
        remember_opened_with(None);

        set_row(&db, &LockRow::on("second heron, upstream"));
        assert_eq!(reconcile(&db, None, &keys).unwrap(), LockAction::Nothing, "no key to re-key from: it waits");
        assert!(crate::crypto::open_encrypted(&path, "heron over the weir").is_ok(), "and still opens with the one it had");

        remember_opened_with(Some("heron over the weir")); // the writer unlocked
        assert!(matches!(reconcile(&db, None, &keys).unwrap(), LockAction::Rekey { .. }));
        assert!(crate::crypto::open_encrypted(&path, "second heron, upstream").is_ok());
        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    #[test]
    fn a_device_locked_before_the_account_lock_shares_its_passphrase() {
        let _t = TURN.lock().unwrap_or_else(|e| e.into_inner());
        remember_opened_with(None);
        let (path, db) = plain_db_with_writing();
        let keys = MemKeys(Default::default());
        // Locked the 0.8.1 way: the file only, no account row.
        {
            let mut c = db.lock().unwrap();
            *c = rusqlite::Connection::open_in_memory().unwrap();
            crate::crypto::migrate_to_encrypted(&path, "heron over the weir").unwrap();
            *c = crate::crypto::open_encrypted(&path, "heron over the weir").unwrap();
        }
        keys.put("heron over the weir").unwrap();
        assert_eq!(reconcile(&db, None, &keys).unwrap(), LockAction::Publish("heron over the weir".into()));
        assert_eq!(read_row(&db.lock().unwrap()), Some(LockRow::on("heron over the weir")));
        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    #[test]
    fn a_remembered_passphrase_that_no_longer_opens_the_file_is_not_shared() {
        let _t = TURN.lock().unwrap_or_else(|e| e.into_inner());
        let (path, db) = plain_db_with_writing();
        let keys = MemKeys(Default::default());
        {
            let mut c = db.lock().unwrap();
            *c = rusqlite::Connection::open_in_memory().unwrap();
            crate::crypto::migrate_to_encrypted(&path, "heron over the weir").unwrap();
            *c = crate::crypto::open_encrypted(&path, "heron over the weir").unwrap();
        }
        keys.put("heron over the weir").unwrap();
        remember_opened_with(Some("a passphrase from before"));
        assert_eq!(reconcile(&db, None, &keys).unwrap(), LockAction::Publish("heron over the weir".into()));
        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    #[test]
    fn the_lock_set_on_one_device_travels_as_an_op_and_locks_the_other_devices_file() {
        // The whole path between two devices, minus the relay's transport:
        // the laptop's lock leaves as a setting op, the phone merges that
        // op's payload the way pull does, and the phone's reconcile locks
        // the phone's own file with the laptop's passphrase.
        let _t = TURN.lock().unwrap_or_else(|e| e.into_inner());
        remember_opened_with(None);
        let laptop = crate::test_helpers::test_db();
        let payload: Vec<u8> = {
            let conn = laptop.lock().unwrap();
            let engine: crate::op_log::OpLog = std::sync::Arc::new(crate::op_log::OpLogEngine::load(&conn).unwrap());
            write_row(&conn, Some(&engine), &LockRow::on("heron over the weir")).unwrap();
            conn.query_row("SELECT payload_blob FROM op_log WHERE op_kind = 'setting_op' ORDER BY rowid DESC LIMIT 1", [], |r| r.get(0)).unwrap()
        };
        let (path, phone) = plain_db_with_writing();
        {
            let conn = phone.lock().unwrap();
            let out = crate::sync::merge::apply(&conn, "setting_op", &payload).unwrap();
            assert_eq!(out, crate::sync::merge::MergeOutcome::Applied, "the lock is an account setting, not a local one");
        }
        let keys = MemKeys(Default::default());
        assert_eq!(reconcile(&phone, None, &keys).unwrap(), LockAction::Encrypt("heron over the weir".into()));
        assert!(crate::crypto::open_encrypted(&path, "heron over the weir").is_ok());
        assert_eq!(kept(&phone), "kept");
        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    #[test]
    fn turning_the_lock_off_blanks_the_passphrase_from_earlier_lock_ops() {
        let db = crate::test_helpers::test_db();
        let conn = db.lock().unwrap();
        let engine: crate::op_log::OpLog = std::sync::Arc::new(crate::op_log::OpLogEngine::load(&conn).unwrap());
        write_row(&conn, Some(&engine), &LockRow::on("heron over the weir")).unwrap();
        let before: i64 = conn.query_row("SELECT count(*) FROM op_log WHERE CAST(payload_blob AS TEXT) LIKE '%heron over the weir%'", [], |r| r.get(0)).unwrap();
        assert_eq!(before, 1, "the lock travels in its op");
        assert_eq!(scrub_old_passphrases(&conn).unwrap(), 1);
        let after: i64 = conn.query_row("SELECT count(*) FROM op_log WHERE CAST(payload_blob AS TEXT) LIKE '%heron over the weir%'", [], |r| r.get(0)).unwrap();
        assert_eq!(after, 0);
    }
}
