use rusqlite::Connection;
use std::path::Path;
use zeroize::Zeroize;

const KEYRING_SERVICE: &str = "app.shizumu.Shizumu";
const KEYRING_USER: &str = "db-key";

/// Inside a Flatpak sandbox the `keyring` crate would talk directly to
/// `org.freedesktop.secrets`, which Flathub disallows (apps must use the
/// Secret portal instead). The file fallback under XDG_DATA_HOME — already
/// the canonical store on every platform — provides the same protection
/// inside the sandbox, so we simply skip the keyring branch.
///
/// Phase 11.8: mobile platforms (iOS, Android) don't compile the
/// `keyring` crate at all — `keyring` isn't part of the target-specific
/// dependencies. `use_keyring()` returns `false` on mobile so the
/// guarded call sites are never invoked at runtime either. The encryption
/// story for mobile is then the file fallback only; replacing it with
/// real Keychain / Keystore integration is tracked in
/// docs/v0.4-mobile-blockers.md.
#[cfg(desktop)]
fn use_keyring() -> bool {
    std::env::var_os("FLATPAK_ID").is_none()
}
#[cfg(not(desktop))]
fn use_keyring() -> bool {
    false
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

/// Store the database passphrase. Tries system keyring first, falls back to file.
/// Always verifies the store succeeded by reading back. On mobile (iOS,
/// Android) the keyring crate isn't compiled in — `keyring_ok` is set
/// directly to `false` and the file path becomes the only store.
pub fn store_key(passphrase: &str) -> Result<(), String> {
    // Try system keyring (libsecret / kwallet / Keychain / Credential Manager).
    // Skipped inside Flatpak — see `use_keyring`.
    let keyring_ok: bool;
    #[cfg(desktop)]
    {
        keyring_ok = if !use_keyring() {
            false
        } else if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
            if entry.set_password(passphrase).is_ok() {
                // Verify it actually persisted by reading back
                if let Ok(readback) = entry.get_password() {
                    if readback == passphrase {
                        log::info!("stored encryption key in system keyring (verified)");
                        true
                    } else {
                        log::warn!("keyring readback mismatch");
                        false
                    }
                } else {
                    log::warn!("keyring store succeeded but readback failed");
                    false
                }
            } else {
                false
            }
        } else {
            false
        };
    }
    #[cfg(not(desktop))]
    {
        keyring_ok = false;
    }

    // Always write the file as well — keyring may not persist across restarts
    let file_result = store_key_to_file(passphrase);

    if keyring_ok || file_result.is_ok() {
        return Ok(());
    }

    file_result
}

/// Retrieve the database passphrase. Tries system keyring first, falls back to file.
pub fn retrieve_key() -> Option<String> {
    #[cfg(desktop)]
    if use_keyring() {
        if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
            if let Ok(pw) = entry.get_password() {
                return Some(pw);
            }
        }
    }
    // Fallback: read from file (the only store on mobile).
    let key_path = key_file_path();
    std::fs::read_to_string(&key_path).ok()
}

fn store_key_to_file(passphrase: &str) -> Result<(), String> {
    let key_path = key_file_path();
    if let Some(parent) = key_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    std::fs::write(&key_path, passphrase)
        .map_err(|e| format!("failed to store key: {e}"))
}

/// Delete the stored passphrase from both keyring and file.
pub fn delete_key() -> Result<(), String> {
    #[cfg(desktop)]
    if use_keyring() {
        if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
            let _ = entry.delete_credential();
        }
    }
    let key_path = key_file_path();
    let _ = std::fs::remove_file(&key_path);
    Ok(())
}

fn key_file_path() -> std::path::PathBuf {
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
