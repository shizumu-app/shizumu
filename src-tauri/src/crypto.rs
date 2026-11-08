use crate::key_mirror::{self, MirrorState, Mirrored, SecretSlot};
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use zeroize::Zeroize;

#[cfg_attr(not(all(desktop, not(test))), allow(dead_code))]
const KEYRING_SERVICE: &str = "app.shizumu.Shizumu";
/// The one slot every profile was meant to share until 2026-10-15. No build
/// ever persisted anything in it (keyring 3 had no platform backend until
/// 0.8.2), so it is no longer read: reading it now could only return another
/// profile's key. Kept so the test below holds new keys out of it.
#[cfg(test)]
const LEGACY_KEYRING_USER: &str = "db-key";

/// This profile's keyring slot, named after its key file, which already
/// lives in the profile's own data folder. One shared name meant that turning
/// encryption on in a second profile (a test profile, a Flatpak beside a
/// native install) overwrote the first one's key, and the first could no
/// longer open its database at launch.
#[cfg_attr(not(desktop), allow(dead_code))]
fn keyring_user_for(key_file: &Path) -> String {
    format!("db-key:{}", key_file.display())
}

/// Whether this process may touch the OS keyring. False under Flatpak:
/// the `keyring` crate would talk directly to `org.freedesktop.secrets`,
/// which Flathub disallows (apps must use the Secret portal instead), so the
/// key file under XDG_DATA_HOME is the store there. False on iOS and Android,
/// which do not compile the `keyring` crate and keep to their file. See
/// `key_mirror::keyring_allowed`.
fn use_keyring() -> bool {
    key_mirror::keyring_allowed(cfg!(desktop), std::env::var_os("FLATPAK_ID").is_some())
}

/// Check if the database file is encrypted by trying to open it without a key.
pub fn check_db_encrypted(path: &Path) -> bool {
    if !path.exists() {
        return false;
    }
    // Try opening without a key — if sqlite_master is readable, it's plaintext
    match Connection::open(path) {
        Ok(conn) => conn
            .execute_batch("SELECT count(*) FROM sqlite_master;")
            .is_err(),
        Err(_) => true,
    }
}

/// Open a database with SQLCipher encryption.
pub fn open_encrypted(path: &Path, passphrase: &str) -> Result<Connection, rusqlite::Error> {
    let conn = Connection::open(path)?;
    // Set the encryption key via PRAGMA key
    conn.pragma_update(None, "key", passphrase)?;
    // Verify the key works by reading sqlite_master
    conn.execute_batch("SELECT count(*) FROM sqlite_master;")?;
    Ok(conn)
}

/// Open an existing plaintext database.
/// With bundled-sqlcipher, opening without PRAGMA key reads plaintext SQLite files normally.
pub fn open_unencrypted(path: &Path) -> Result<Connection, rusqlite::Error> {
    let conn = Connection::open(path)?;
    // Just try to read — SQLCipher without a key treats the db as plaintext
    conn.execute_batch("SELECT count(*) FROM sqlite_master;")?;
    Ok(conn)
}

/// Migrate an existing unencrypted database to encrypted.
/// Uses SQLCipher's sqlcipher_export to create an encrypted copy,
/// then replaces the original.
pub fn migrate_to_encrypted(path: &Path, passphrase: &str) -> Result<(), String> {
    let encrypted_path = path.with_extension("db.encrypted");

    // Remove any leftover encrypted file from a previous failed attempt
    let _ = std::fs::remove_file(&encrypted_path);

    // Open the unencrypted source
    let conn =
        open_unencrypted(path).map_err(|e| format!("failed to open unencrypted db: {e}"))?;

    // Switch to DELETE journal mode for migration (WAL can interfere with ATTACH)
    conn.execute_batch("PRAGMA journal_mode=DELETE;")
        .map_err(|e| format!("failed to set journal mode: {e}"))?;

    // Attach a new encrypted database
    conn.execute_batch(&format!(
        "ATTACH DATABASE '{}' AS encrypted KEY '{}';",
        encrypted_path.display(),
        passphrase.replace('\'', "''")
    ))
    .map_err(|e| format!("failed to attach encrypted db: {e}"))?;

    // Export all data to the encrypted database
    conn.execute_batch("SELECT sqlcipher_export('encrypted');")
        .map_err(|e| format!("sqlcipher_export failed: {e}"))?;

    conn.execute_batch("DETACH DATABASE encrypted;")
        .map_err(|e| format!("failed to detach: {e}"))?;

    drop(conn);

    // Back up original then replace with encrypted version
    let backup_path = path.with_extension("db.bak");
    std::fs::rename(path, &backup_path)
        .map_err(|e| format!("failed to back up original db: {e}"))?;
    std::fs::rename(&encrypted_path, path)
        .map_err(|e| format!("failed to replace db file: {e}"))?;

    // Verify the encrypted db works before deleting backup
    match open_encrypted(path, passphrase) {
        Ok(_) => {
            let _ = std::fs::remove_file(&backup_path);
            Ok(())
        }
        Err(e) => {
            // Restore backup
            let _ = std::fs::rename(&backup_path, path);
            Err(format!("encrypted db verification failed: {e}"))
        }
    }
}

/// Re-key an encrypted database file under `next`, or write it out as plain
/// SQLite when `next` is None (the lock turned off).
///
/// Same shape as `migrate_to_encrypted`: export to a sibling file, swap it in,
/// and keep the original as `.db.bak` until the swapped file opens with the
/// key it should open with. The caller must have released its own connection
/// first, because switching the source to DELETE journal mode (which folds
/// any write-ahead log into the file, so no stale `-wal` is left beside the
/// new one) needs the file to itself.
pub fn rekey_file(path: &Path, current: &str, next: Option<&str>) -> Result<(), String> {
    let staged_path = path.with_extension("db.rekeyed");
    let _ = std::fs::remove_file(&staged_path);

    let conn = open_encrypted(path, current)
        .map_err(|e| format!("failed to open encrypted db: {e}"))?;
    conn.execute_batch("PRAGMA journal_mode=DELETE;")
        .map_err(|e| format!("failed to set journal mode: {e}"))?;
    // An empty KEY attaches a plaintext database: SQLCipher's documented way
    // to decrypt with sqlcipher_export.
    conn.execute_batch(&format!(
        "ATTACH DATABASE '{}' AS staged KEY '{}';",
        staged_path.display().to_string().replace('\'', "''"),
        next.unwrap_or("").replace('\'', "''")
    ))
    .map_err(|e| format!("failed to attach the new db: {e}"))?;
    conn.execute_batch("SELECT sqlcipher_export('staged');")
        .map_err(|e| format!("sqlcipher_export failed: {e}"))?;
    conn.execute_batch("DETACH DATABASE staged;")
        .map_err(|e| format!("failed to detach: {e}"))?;
    drop(conn);

    let backup_path = path.with_extension("db.bak");
    std::fs::rename(path, &backup_path)
        .map_err(|e| format!("failed to back up original db: {e}"))?;
    if let Err(e) = std::fs::rename(&staged_path, path) {
        let _ = std::fs::rename(&backup_path, path);
        return Err(format!("failed to replace db file: {e}"));
    }

    let opens = match next {
        Some(key) => open_encrypted(path, key).map(|_| ()),
        None if check_db_encrypted(path) => Err(rusqlite::Error::InvalidQuery),
        None => open_unencrypted(path).map(|_| ()),
    };
    match opens {
        Ok(()) => {
            let _ = std::fs::remove_file(&backup_path);
            Ok(())
        }
        Err(e) => {
            let _ = std::fs::rename(&backup_path, path);
            Err(format!("the re-keyed db did not open: {e}"))
        }
    }
}

/// Store the database passphrase.
///
/// The key file is where the key lives, so its write must succeed: until
/// 0.8.2 a failed file write still answered Ok when the keyring accepted the
/// key, and the keyring as built never kept anything, so the next launch
/// found no key. On desktop outside Flatpak the keyring copy then follows in
/// the background (`key_mirror`): a locked keyring or an unanswered prompt
/// cannot hold up the command, and the file is never removed for it.
pub fn store_key(passphrase: &str) -> Result<(), String> {
    let key_path = key_file_path();
    write_key_file(&key_path, passphrase)?;
    if use_keyring() {
        schedule_mirror(key_path);
    }
    Ok(())
}

/// The key launch opens `db_path` with. See `launch_key_at`.
pub fn retrieve_key(db_path: &Path) -> Option<String> {
    let key_path = key_file_path();
    let user = keyring_user_for(&key_path);
    launch_key_at(
        &key_path,
        use_keyring(),
        || check_db_encrypted(db_path),
        || os::read_with_timeout(user, KEYRING_LAUNCH_WAIT),
    )
}

/// The file when there is one, and then the keyring is not touched at all,
/// not even to check the copy (a locked Secret Service asks to be unlocked
/// for a read too). The keyring only when the file is gone and the database
/// is encrypted, once, for at most `KEYRING_LAUNCH_WAIT`, and not again
/// after a read that came back empty until the key is next written; then
/// the lock screen asks for the passphrase as it always has.
/// (`key_mirror::resolve_launch_key` decides; this reads and records.)
fn launch_key_at(
    key_path: &Path,
    allowed: bool,
    db_encrypted: impl FnOnce() -> bool,
    read_keyring: impl FnOnce() -> Option<String>,
) -> Option<String> {
    let file = std::fs::read_to_string(key_path).ok();
    if file.is_some() {
        restrict_key_file(key_path);
    }
    if !allowed {
        return file;
    }
    let found = read_mirror_state(key_path);
    let state = key_mirror::settle_at_launch(found);
    if let Some(settled) = state.filter(|s| Some(*s) != found) {
        write_mirror_state(key_path, settled);
    }
    let encrypted = file.is_none() && db_encrypted();
    let out = key_mirror::resolve_launch_key(file, encrypted, state, read_keyring);
    if let Some(record) = out.record {
        write_mirror_state(key_path, record);
    }
    out.key
}

/// How long launch waits on the keyring when the key file is missing.
///
/// Three seconds: an unlocked keyring answers in milliseconds, and a cold
/// start of the Secret Service (gnome-keyring or KWallet activated over
/// D-Bus on the first call of the session) in one to two, so a keyring that
/// can answer does. It is too short for a person to type a keyring
/// password, on purpose: a keyring that prompts at launch is a locked one,
/// and the lock screen asks for the same kind of thing in the app's own
/// window. Twenty seconds (0.8.2's first cut) was long enough that the app
/// looked like it never opened, with the dialog possibly behind other
/// windows (review #3). The window opens after this wait, so it is kept
/// under what reads as a hang.
#[cfg_attr(not(desktop), allow(dead_code))]
const KEYRING_LAUNCH_WAIT: std::time::Duration = std::time::Duration::from_secs(3);

/// The non-secret marker beside the key file that says what is known about
/// the keyring copy (`key_mirror::MirrorState`). It never holds key material.
fn mirror_marker_path(key_path: &Path) -> PathBuf {
    key_path.with_file_name(".dbkey.keyring")
}

fn read_mirror_state(key_path: &Path) -> Option<MirrorState> {
    std::fs::read_to_string(mirror_marker_path(key_path))
        .ok()
        .map(|s| MirrorState::parse(&s))
}

fn write_mirror_state(key_path: &Path, state: MirrorState) {
    if let Err(e) = std::fs::write(mirror_marker_path(key_path), state.as_str()) {
        log::warn!("could not record the keyring state: {e}");
    }
}

/// One mirror pass: make the keyring hold what the key file holds NOW (read
/// at run time, so passes queued in any order converge on the latest key).
/// `Pending` is recorded before the keyring is touched, so a pass that never
/// returns (a prompt left open, a hung D-Bus call) is not repeated at the
/// next launch. Returns None when there is no file to copy.
fn mirror_pass(key_path: &Path, slot: &dyn SecretSlot) -> Option<Mirrored> {
    let mut file = std::fs::read_to_string(key_path).ok()?;
    write_mirror_state(key_path, MirrorState::Pending);
    let m = key_mirror::mirror_into(slot, &file);
    file.zeroize();
    write_mirror_state(key_path, m.state());
    match &m {
        Mirrored::InStep => {}
        Mirrored::Written => log::info!("database key copied into the system keyring (the file stays)"),
        Mirrored::Rewritten => log::warn!("the keyring held a different database key; rewrote it from the key file"),
        Mirrored::Unavailable(e) => log::info!("system keyring not used for the database key ({e}); the key file remains its store"),
    }
    Some(m)
}

/// After the lock is turned off: drop the keyring copy, unless a key file
/// has appeared again since (the lock turned back on), in which case mirror
/// that instead.
fn forget_pass(key_path: &Path, slot: &dyn SecretSlot) {
    if key_path.exists() {
        mirror_pass(key_path, slot);
        return;
    }
    if let Err(e) = slot.delete() {
        log::info!("could not remove the keyring copy of the database key: {e}");
    }
    let _ = std::fs::remove_file(mirror_marker_path(key_path));
}

fn schedule_mirror(key_path: PathBuf) {
    let user = keyring_user_for(&key_path);
    os::run_in_background(Box::new(move || {
        if let Some(slot) = os::slot_for(&user) {
            mirror_pass(&key_path, &slot);
        }
    }));
}

/// Best effort, at every startup: a key file written before owner-only
/// permissions existed is otherwise only tightened when encryption is set
/// up again or the passphrase changes, which for most writers is never.
fn restrict_key_file(key_path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Err(e) = std::fs::set_permissions(key_path, std::fs::Permissions::from_mode(0o600)) {
            log::warn!("could not restrict the key file: {e}");
        }
    }
    #[cfg(not(unix))]
    let _ = key_path;
}

fn write_key_file(key_path: &Path, passphrase: &str) -> Result<(), String> {
    if let Some(parent) = key_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    std::fs::write(key_path, passphrase)
        .map_err(|e| format!("failed to store key: {e}"))?;
    // Owner-only. Set after the write so a file an older version left 0644
    // is tightened too; on Windows the profile folder's ACL does this job.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(key_path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("failed to restrict the key file: {e}"))?;
    }
    Ok(())
}

/// Delete the stored passphrase: the lock was turned off, or the database
/// turned out to be plain SQLite. The key file goes (it opens nothing now);
/// the keyring copy follows in the background.
pub fn delete_key() -> Result<(), String> {
    let key_path = key_file_path();
    let _ = std::fs::remove_file(&key_path);
    if use_keyring() {
        let user = keyring_user_for(&key_path);
        os::run_in_background(Box::new(move || {
            if let Some(slot) = os::slot_for(&user) {
                forget_pass(&key_path, &slot);
            }
        }));
    }
    Ok(())
}

/// The real keyring. Only a shipped desktop build reaches the keyring crate:
/// test builds and phones get the inert module below, so no test can write
/// the system keyring of the machine it runs on.
#[cfg(all(desktop, not(test)))]
mod os {
    use super::KEYRING_SERVICE;
    use crate::key_mirror::SecretSlot;
    use std::sync::mpsc;
    use std::sync::{Mutex, OnceLock};

    pub struct KeyringSlot(keyring::Entry);

    impl SecretSlot for KeyringSlot {
        fn get(&self) -> Result<Option<String>, String> {
            match self.0.get_password() {
                Ok(s) => Ok(Some(s)),
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(e) => Err(e.to_string()),
            }
        }
        fn set(&self, value: &str) -> Result<(), String> {
            self.0.set_password(value).map_err(|e| e.to_string())
        }
        fn delete(&self) -> Result<(), String> {
            match self.0.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(e) => Err(e.to_string()),
            }
        }
    }

    pub fn slot_for(user: &str) -> Option<KeyringSlot> {
        match keyring::Entry::new(KEYRING_SERVICE, user) {
            Ok(e) => Some(KeyringSlot(e)),
            Err(e) => {
                log::info!("system keyring entry unavailable: {e}");
                None
            }
        }
    }

    type Job = Box<dyn FnOnce() + Send>;

    /// One worker thread runs every keyring job in the order queued, off the
    /// launch path and off the command thread. A job stuck on a prompt holds
    /// up only later keyring jobs, never the app.
    pub fn run_in_background(job: Job) {
        static QUEUE: OnceLock<Option<Mutex<mpsc::Sender<Job>>>> = OnceLock::new();
        let queue = QUEUE.get_or_init(|| {
            let (tx, rx) = mpsc::channel::<Job>();
            std::thread::Builder::new()
                .name("keyring-mirror".into())
                .spawn(move || {
                    for job in rx {
                        job();
                    }
                })
                .map_err(|e| log::warn!("keyring worker did not start: {e}"))
                .ok()
                .map(|_| Mutex::new(tx))
        });
        if let Some(q) = queue {
            if let Ok(tx) = q.lock() {
                let _ = tx.send(job);
            }
        }
    }

    /// Read the keyring on its own thread and give up after `wait`, so a
    /// hung D-Bus call or an ignored prompt ends in the lock screen, not a
    /// window that never opens.
    pub fn read_with_timeout(user: String, wait: std::time::Duration) -> Option<String> {
        let (tx, rx) = mpsc::channel();
        let spawned = std::thread::Builder::new()
            .name("keyring-read".into())
            .spawn(move || {
                let got = slot_for(&user).and_then(|s| s.get().ok().flatten());
                let _ = tx.send(got);
            });
        if spawned.is_err() {
            return None;
        }
        match rx.recv_timeout(wait) {
            Ok(v) => v,
            Err(_) => {
                log::warn!("the system keyring did not answer; asking for the passphrase instead");
                None
            }
        }
    }
}

/// Test builds and phones: no keyring. `slot_for` finds nothing, so every
/// job is a no-op and the key file is the only store.
#[cfg(not(all(desktop, not(test))))]
mod os {
    use crate::key_mirror::SecretSlot;

    pub struct NoSlot;
    impl SecretSlot for NoSlot {
        fn get(&self) -> Result<Option<String>, String> {
            Err("no keyring in this build".into())
        }
        fn set(&self, _value: &str) -> Result<(), String> {
            Err("no keyring in this build".into())
        }
        fn delete(&self) -> Result<(), String> {
            Err("no keyring in this build".into())
        }
    }

    pub fn slot_for(_user: &str) -> Option<NoSlot> {
        None
    }

    #[cfg(test)]
    thread_local! {
        /// Keyring jobs queued on this thread, so a test can see that launch
        /// queued none.
        pub static QUEUED: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    }

    pub fn run_in_background(job: Box<dyn FnOnce() + Send>) {
        #[cfg(test)]
        QUEUED.with(|q| q.set(q.get() + 1));
        job();
    }
    pub fn read_with_timeout(_user: String, _wait: std::time::Duration) -> Option<String> {
        None
    }
}

/// Where the key file lives when the app says so: on mobile, the app's own
/// data directory beside the database (lib.rs setup). The phone never
/// stored a key before the account lock (it had no lock), and the paths
/// below have no Android branch, so it fell back to "." in the process's
/// working directory. Desktop never sets this, so no existing key moves
/// (Windows' Tauri data dir differs from LOCALAPPDATA below).
static KEY_DIR: std::sync::OnceLock<std::path::PathBuf> = std::sync::OnceLock::new();

pub fn set_key_dir(dir: std::path::PathBuf) {
    let _ = KEY_DIR.set(dir);
}

fn key_file_path() -> std::path::PathBuf {
    if let Some(dir) = KEY_DIR.get() {
        return dir.join(".dbkey");
    }
    let data_dir = dirs_data_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    data_dir.join("app.shizumu.Shizumu").join(".dbkey")
}

fn dirs_data_dir() -> Option<std::path::PathBuf> {
    #[cfg(target_os = "linux")]
    {
        if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
            return Some(std::path::PathBuf::from(xdg));
        }
        if let Ok(home) = std::env::var("HOME") {
            return Some(std::path::PathBuf::from(home).join(".local").join("share"));
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            return Some(std::path::PathBuf::from(home).join("Library").join("Application Support"));
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("LOCALAPPDATA") {
            return Some(std::path::PathBuf::from(appdata));
        }
    }
    None
}

/// Wrapper that zeroizes a passphrase string when done.
pub struct SecurePassphrase(pub String);

#[cfg(test)]
mod tests {
    use super::*;

    // ─── the keyring copy (key_mirror) ──────────────────────────────────
    // Every test here uses key_mirror::memory::MemorySlot and a temp dir:
    // nothing reaches the system keyring or the writer's own key file.

    use crate::key_mirror::memory::MemorySlot;

    fn temp_key(contents: Option<&str>) -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!("shizumu-keyring-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let key = dir.join(".dbkey");
        if let Some(c) = contents {
            write_key_file(&key, c).unwrap();
        }
        (dir, key)
    }

    #[test]
    fn first_run_copies_the_key_into_the_keyring_and_keeps_the_file() {
        let (dir, key) = temp_key(Some("the-key"));
        let slot = MemorySlot::default();
        assert_eq!(mirror_pass(&key, &slot), Some(Mirrored::Written));
        assert_eq!(slot.value.borrow().as_deref(), Some("the-key"));
        assert_eq!(std::fs::read_to_string(&key).unwrap(), "the-key", "the file is never removed");
        assert_eq!(read_mirror_state(&key), Some(MirrorState::InStep));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_keyring_that_disagrees_is_rewritten_from_the_file() {
        let (dir, key) = temp_key(Some("current"));
        let slot = MemorySlot::holding("from-an-unfinished-write");
        assert_eq!(mirror_pass(&key, &slot), Some(Mirrored::Rewritten));
        assert_eq!(slot.value.borrow().as_deref(), Some("current"));
        assert_eq!(std::fs::read_to_string(&key).unwrap(), "current", "the file wins and is untouched");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn an_unavailable_keyring_leaves_the_file_and_is_not_asked_again_at_launch() {
        let (dir, key) = temp_key(Some("the-key"));
        let slot = MemorySlot::default();
        slot.unavailable.set(true);
        assert!(matches!(mirror_pass(&key, &slot), Some(Mirrored::Unavailable(_))));
        assert_eq!(std::fs::read_to_string(&key).unwrap(), "the-key");
        assert_eq!(read_mirror_state(&key), Some(MirrorState::Unavailable));
        std::fs::remove_dir_all(&dir).ok();
    }

    /// A slot that hangs forever is modelled by one that looks at the marker
    /// when it is first touched: the marker must already say Pending, so a
    /// launch after a prompt nobody answered does not prompt again.
    struct PeekingSlot<'a> {
        key: &'a Path,
        seen: std::cell::RefCell<Option<Option<MirrorState>>>,
    }
    impl SecretSlot for PeekingSlot<'_> {
        fn get(&self) -> Result<Option<String>, String> {
            self.seen.borrow_mut().get_or_insert(read_mirror_state(self.key));
            Ok(None)
        }
        fn set(&self, _v: &str) -> Result<(), String> {
            Err("refused".into())
        }
        fn delete(&self) -> Result<(), String> {
            Ok(())
        }
    }

    #[test]
    fn the_marker_says_pending_before_the_keyring_is_touched() {
        let (dir, key) = temp_key(Some("the-key"));
        let slot = PeekingSlot { key: &key, seen: Default::default() };
        mirror_pass(&key, &slot);
        assert_eq!(*slot.seen.borrow(), Some(Some(MirrorState::Pending)));
        // and a launch after it records that attempt as not kept
        assert_eq!(key_mirror::settle_at_launch(Some(MirrorState::Pending)), Some(MirrorState::Unavailable));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_marker_never_holds_the_key() {
        let (dir, key) = temp_key(Some("the-key"));
        mirror_pass(&key, &MemorySlot::default());
        let marker = std::fs::read_to_string(mirror_marker_path(&key)).unwrap();
        assert!(!marker.contains("the-key"));
        assert_eq!(marker, "in-step");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn no_file_means_nothing_to_copy_and_the_keyring_is_left_alone() {
        // Launch never removes a keyring copy because the file is missing:
        // the keyring may be the last copy of the key the writer has.
        let (dir, key) = temp_key(None);
        let slot = MemorySlot::holding("last-copy");
        assert_eq!(mirror_pass(&key, &slot), None);
        assert_eq!(slot.value.borrow().as_deref(), Some("last-copy"));
        assert_eq!(slot.calls.get(), 0);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn turning_the_lock_off_drops_the_keyring_copy_unless_it_came_back_on() {
        let (dir, key) = temp_key(None);
        let slot = MemorySlot::holding("old");
        forget_pass(&key, &slot);
        assert_eq!(*slot.value.borrow(), None);

        // The lock was turned on again before the queued forget ran.
        write_key_file(&key, "new").unwrap();
        let slot = MemorySlot::holding("old");
        forget_pass(&key, &slot);
        assert_eq!(slot.value.borrow().as_deref(), Some("new"));
        std::fs::remove_dir_all(&dir).ok();
    }

    // ─── launch (review #2, #3 and the unfinished first copy) ──────────

    fn marker(key: &Path, state: MirrorState) {
        write_mirror_state(key, state);
    }

    #[test]
    fn launch_with_the_file_never_touches_the_keyring_whatever_the_marker_says() {
        for state in [None, Some(MirrorState::InStep), Some(MirrorState::Pending), Some(MirrorState::Unavailable)] {
            let (dir, key) = temp_key(Some("the-key"));
            if let Some(s) = state {
                marker(&key, s);
            }
            let before = os::QUEUED.with(|q| q.get());
            let got = launch_key_at(&key, true, || panic!("an encrypted check is not needed with a file"), || {
                panic!("the keyring is read at launch while the key file exists ({state:?})")
            });
            assert_eq!(got.as_deref(), Some("the-key"));
            // Nothing queued either: a background check of the copy asks a
            // locked Secret Service to unlock, which put a dialog up at
            // every launch for a writer whose keyring starts locked.
            assert_eq!(os::QUEUED.with(|q| q.get()), before, "launch queued a keyring job ({state:?})");
            assert_eq!(std::fs::read_to_string(&key).unwrap(), "the-key", "the file is never removed");
            std::fs::remove_dir_all(&dir).ok();
        }
    }

    #[test]
    fn launch_without_the_file_asks_the_keyring_once_and_not_again_after_nothing() {
        let (dir, key) = temp_key(None);
        let mut reads = 0;
        assert_eq!(launch_key_at(&key, true, || true, || { reads += 1; None }), None);
        assert_eq!(reads, 1);
        assert_eq!(read_mirror_state(&key), Some(MirrorState::Unavailable));
        // The next launch goes straight to the lock screen.
        assert_eq!(launch_key_at(&key, true, || true, || { reads += 1; Some("k".into()) }), None);
        assert_eq!(reads, 1, "a keyring that came back empty is asked again only after the key is written");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn launch_without_the_file_opens_with_the_keyring_copy() {
        let (dir, key) = temp_key(None);
        marker(&key, MirrorState::InStep);
        assert_eq!(launch_key_at(&key, true, || true, || Some("kept".into())).as_deref(), Some("kept"));
        assert_eq!(read_mirror_state(&key), Some(MirrorState::InStep));
        // Not encrypted, or not allowed (flatpak, phones): never asked.
        assert_eq!(launch_key_at(&key, true, || false, || panic!("plain database")), None);
        assert_eq!(launch_key_at(&key, false, || true, || panic!("keyring not allowed")), None);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_copy_the_last_run_never_finished_is_recorded_unavailable_at_launch() {
        let (dir, key) = temp_key(Some("the-key"));
        marker(&key, MirrorState::Pending);
        launch_key_at(&key, true, || true, || panic!("not read with a file"));
        assert_eq!(read_mirror_state(&key), Some(MirrorState::Unavailable));
        std::fs::remove_dir_all(&dir).ok();

        let (dir, key) = temp_key(None);
        marker(&key, MirrorState::Pending);
        assert_eq!(launch_key_at(&key, true, || true, || panic!("an unfinished copy is not asked for")), None);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn launch_waits_on_the_keyring_no_longer_than_three_seconds() {
        // The window opens after this wait (lib.rs setup). Twenty seconds
        // read as an app that never opened.
        assert!(KEYRING_LAUNCH_WAIT <= std::time::Duration::from_secs(3));
    }

    /// The text guard: `keyring::Entry` is reached only from the module that
    /// test builds and phones do not compile.
    #[test]
    fn only_a_shipped_desktop_build_reaches_the_system_keyring() {
        let all = include_str!("crypto.rs");
        let src = &all[..all.find("#[cfg(test)]\nmod tests {").expect("test module")];
        let start = src.find("pub struct KeyringSlot(keyring::Entry);").expect("real slot exists");
        let module = src[..start].rfind("mod os {").unwrap();
        let cfg = src[..module].lines().last().unwrap().trim();
        assert_eq!(cfg, "#[cfg(all(desktop, not(test)))]", "test builds must not compile the real keyring");
        let end = module + src[module..].find("\n}\n").unwrap();
        for (i, _) in src.match_indices("keyring::") {
            assert!((module..end).contains(&i), "keyring:: reached outside the desktop-only module at byte {i}");
        }
    }

    #[test]
    fn each_profile_has_its_own_keyring_slot() {
        // Named for the key file, which sits in the profile's data folder.
        let a = keyring_user_for(Path::new("/home/w/.local/share/app.shizumu.Shizumu/.dbkey"));
        let b = keyring_user_for(Path::new("/tmp/test-profile/app.shizumu.Shizumu/.dbkey"));
        assert_ne!(a, b);
        assert_ne!(a, LEGACY_KEYRING_USER, "a new key never lands in the shared slot");
    }

    // The key file is the store the database key actually lives in (the
    // keyring branch is best effort), so it must not be readable by other
    // accounts on the machine: written with the default umask it was 0644.
    #[cfg(unix)]
    #[test]
    fn key_file_is_readable_by_its_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("shizumu-test-{}", uuid::Uuid::new_v4()));
        let path = dir.join(".dbkey");

        write_key_file(&path, "first").unwrap();
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);

        // a key file left 0644 by an older version is tightened on the next write
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        write_key_file(&path, "second").unwrap();
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "second");

        // and one that is only ever read, never rewritten, is tightened at startup
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        restrict_key_file(&path);
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn encrypted_db_roundtrip() {
        let dir = std::env::temp_dir().join(format!("shizumu-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test.db");
        let passphrase = "test-passphrase-shizumu-42";

        // create encrypted db and write data
        {
            let conn = open_encrypted(&path, passphrase).expect("failed to open encrypted db");
            conn.execute_batch("CREATE TABLE t (v TEXT NOT NULL); INSERT INTO t VALUES ('the invariant is simple.');")
                .unwrap();
        }

        // reopen with correct passphrase — data must be readable
        {
            let conn = open_encrypted(&path, passphrase).expect("failed to reopen encrypted db");
            let val: String = conn
                .query_row("SELECT v FROM t", [], |r| r.get(0))
                .unwrap();
            assert_eq!(val, "the invariant is simple.");
        }

        // open with wrong passphrase — must fail
        let wrong = open_encrypted(&path, "wrong-passphrase");
        assert!(wrong.is_err(), "wrong passphrase must not open encrypted db");

        std::fs::remove_dir_all(&dir).ok();
    }
}

impl Drop for SecurePassphrase {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}
