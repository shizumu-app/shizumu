//! System-keyring storage for user-level sync secrets.
//!
//! The BIP-39 recovery phrase + the four derived user keys
//! (`user_sign_priv`, `user_kex_priv`, `content_master_key`,
//! `meta_key`) are the sync identity. Possession of any of them
//! lets an attacker impersonate the user against the relay: read
//! every encrypted op, write ops as you, pair fresh devices into the
//! account silently.
//!
//! v0.4 moves these out of the SQLite `sync_keys` table and into the
//! desktop secret store (libsecret / kwallet via the `keyring` crate),
//! so a home-directory read no longer hands over the sync identity.
//! Device-scoped material (`device_sign_priv`, `device_id`) stays in
//! `sync_keys` — it's per-device, not part of the recovery contract,
//! and needs to be loadable before the keyring is unlocked so the
//! worker can spawn at boot.
//!
//! Wire format inside the keyring entry: a single JSON object
//! `{phrase, user_sign_priv, user_kex_priv, content_master_key,
//! meta_key}`, with raw 32-byte secrets base64-encoded. The phrase
//! is `null` on paired devices (they never see it).
//!
//! Flatpak sandboxes can't use `org.freedesktop.secrets` directly per
//! Flathub policy; `is_available()` returns `false` inside Flatpak so
//! setup paths can refuse to enable sync rather than silently storing
//! secrets in the database again.

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

// Only the production backend actually reaches the keyring crate; the
// in-process backend used under `cfg(test)` and non-desktop ignores
// these. `allow(dead_code)` keeps the constants visible to humans
// without warning in test builds.
#[allow(dead_code)]
const KEYRING_SERVICE: &str = "app.shizumu.Shizumu";
#[allow(dead_code)]
const KEYRING_USER: &str = "sync-user-keys";

/// Plaintext form of the secrets stored under the keyring entry.
/// `phrase` is `Some` on devices that ran `sync_setup` with a
/// mnemonic; paired devices receive only the derived keys and leave
/// `phrase` as `None`.
#[derive(Debug)]
pub struct StoredUserKeys {
    pub phrase: Option<String>,
    pub user_sign_priv: [u8; 32],
    pub user_kex_priv: [u8; 32],
    pub content_master_key: [u8; 32],
    pub meta_key: [u8; 32],
}

impl Drop for StoredUserKeys {
    fn drop(&mut self) {
        self.user_sign_priv.zeroize();
        self.user_kex_priv.zeroize();
        self.content_master_key.zeroize();
        self.meta_key.zeroize();
        if let Some(p) = self.phrase.as_mut() {
            p.zeroize();
        }
    }
}

#[derive(Debug)]
pub enum SecretStoreError {
    /// The desktop secret store is not reachable in this environment
    /// (Flatpak sandbox without the Secret portal, headless box, etc.).
    Unavailable(String),
    /// The keyring is present but rejected a read or write.
    Io(String),
    /// The stored payload exists but couldn't be parsed back into a
    /// `StoredUserKeys` — corruption, downgrade, or the user wrote
    /// garbage into the entry manually.
    Corrupted(String),
}

impl std::fmt::Display for SecretStoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SecretStoreError::Unavailable(s) => write!(f, "secret store unavailable: {s}"),
            SecretStoreError::Io(s) => write!(f, "secret store io: {s}"),
            SecretStoreError::Corrupted(s) => write!(f, "secret store payload corrupted: {s}"),
        }
    }
}

impl std::error::Error for SecretStoreError {}

/// True when the secret store backend is the right path to take.
/// Mirrors the gate used by `crate::crypto::use_keyring` so the two
/// secret tracks (DB passphrase + sync keys) stay consistent about
/// the Flatpak sandbox.
pub fn is_available() -> bool {
    backend::is_available()
}

/// Store the user-key bundle. Overwrites any existing value. The
/// caller is responsible for keeping the in-memory `StoredUserKeys`
/// zeroized.
pub fn store(keys: &StoredUserKeys) -> Result<(), SecretStoreError> {
    let mut payload = serialize(keys);
    let result = backend::set(&payload);
    payload.zeroize();
    result
}

/// Load the user-key bundle. Returns `Ok(None)` when the entry is
/// absent (fresh install before `sync_setup`).
pub fn load() -> Result<Option<StoredUserKeys>, SecretStoreError> {
    match backend::get()? {
        None => Ok(None),
        Some(payload) => {
            let parsed = deserialize(&payload);
            // Defensive: zero the intermediate payload String even on
            // the error path. Backend may not expose a zeroizing
            // accessor (the `keyring` crate doesn't).
            let mut p = payload;
            p.zeroize();
            parsed.map(Some)
        }
    }
}

/// Remove the entry. Idempotent — succeeds whether or not an entry
/// was present.
pub fn delete() -> Result<(), SecretStoreError> {
    backend::delete()
}

// ────────────────────────────────────────────────────────────────────
// Backend dispatch. Production hits the system keyring via the
// `keyring` crate; cargo test builds and non-desktop targets use an
// in-process static so unit tests don't pollute the user's keyring
// (and so tests aren't gated on D-Bus being reachable).
// ────────────────────────────────────────────────────────────────────

#[cfg(all(desktop, not(test)))]
mod backend {
    use super::{SecretStoreError, KEYRING_SERVICE, KEYRING_USER};

    pub fn is_available() -> bool {
        if std::env::var_os("FLATPAK_ID").is_some() {
            return false;
        }
        keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).is_ok()
    }

    pub fn set(payload: &str) -> Result<(), SecretStoreError> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
            .map_err(|e| SecretStoreError::Unavailable(e.to_string()))?;
        entry
            .set_password(payload)
            .map_err(|e| SecretStoreError::Io(e.to_string()))
    }

    pub fn get() -> Result<Option<String>, SecretStoreError> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
            .map_err(|e| SecretStoreError::Unavailable(e.to_string()))?;
        match entry.get_password() {
            Ok(s) => Ok(Some(s)),
            Err(e) => {
                // `keyring` folds "entry not found" into a typed error
                // variant; match on its Display string since the public
                // enum may add variants between minor versions.
                let msg = e.to_string();
                if msg.contains("No matching entry") || msg.contains("NoEntry") {
                    Ok(None)
                } else {
                    Err(SecretStoreError::Io(msg))
                }
            }
        }
    }

    pub fn delete() -> Result<(), SecretStoreError> {
        let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
            .map_err(|e| SecretStoreError::Unavailable(e.to_string()))?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("No matching entry") || msg.contains("NoEntry") {
                    Ok(())
                } else {
                    Err(SecretStoreError::Io(msg))
                }
            }
        }
    }
}

#[cfg(any(test, all(not(desktop), not(target_os = "android"))))]
mod backend {
    //! In-process backend. Used in two situations:
    //!   - `cfg(test)` so unit tests don't touch the user's keyring
    //!     and don't fail on machines without D-Bus.
    //!   - non-desktop targets that aren't Android (i.e. iOS), where the
    //!     `keyring` crate isn't compiled in and no file backend is wired
    //!     yet. Android has its own file backend below.
    //!
    //! State is process-local. Tests that need an empty slate between
    //! cases call `super::reset_for_tests()`.

    use super::SecretStoreError;
    use std::sync::Mutex;

    static SLOT: Mutex<Option<String>> = Mutex::new(None);

    pub fn is_available() -> bool {
        true
    }

    pub fn set(payload: &str) -> Result<(), SecretStoreError> {
        let mut slot = SLOT
            .lock()
            .map_err(|e| SecretStoreError::Io(format!("in-memory backend poisoned: {e}")))?;
        *slot = Some(payload.to_string());
        Ok(())
    }

    pub fn get() -> Result<Option<String>, SecretStoreError> {
        let slot = SLOT
            .lock()
            .map_err(|e| SecretStoreError::Io(format!("in-memory backend poisoned: {e}")))?;
        Ok(slot.clone())
    }

    pub fn delete() -> Result<(), SecretStoreError> {
        let mut slot = SLOT
            .lock()
            .map_err(|e| SecretStoreError::Io(format!("in-memory backend poisoned: {e}")))?;
        *slot = None;
        Ok(())
    }
}

// ────────────────────────────────────────────────────────────────────
// Android file backend. The `keyring` crate has no Android provider, so
// the user-key bundle is written as a mode-0600 JSON file inside the
// app's per-package private data dir (`app_local_data_dir`). The Android
// sandbox isolates that directory per package; this is not OS-keystore
// grade but is the realistic v1-mobile tradeoff. See
// docs/v0.4-sync-mobile.md for the limitation.
// ────────────────────────────────────────────────────────────────────

/// Android-only: the directory under which the sync-secrets file lives.
/// Populated once at app setup from `app_handle.path().app_local_data_dir()`
/// because the backend functions are zero-arg and have no `AppHandle` to
/// resolve the sandbox path themselves. Desktop/iOS/test builds don't read
/// it. `dead_code` is allowed because under `cfg(test)` on an Android
/// target the file backend is replaced by the in-process one, leaving this
/// unread.
#[cfg(target_os = "android")]
#[allow(dead_code)]
static ANDROID_SECRETS_DIR: std::sync::OnceLock<std::path::PathBuf> = std::sync::OnceLock::new();

/// Android-only: record the per-package private data directory used for
/// the sync-secrets file. Call once during app setup, before any sync
/// command runs. Idempotent — a second call is a no-op (the first value
/// wins).
#[cfg(target_os = "android")]
#[allow(dead_code)]
pub fn init_android_secrets_dir(dir: std::path::PathBuf) {
    let _ = ANDROID_SECRETS_DIR.set(dir);
}

/// Directory-scoped file I/O for the secret bundle. Factored out of the
/// Android backend so the read / write / chmod logic is exercised by host
/// unit tests (the `target_os = "android"` backend can't run on the dev
/// box). Unix-only: it relies on `0o600` permission bits.
#[cfg(all(unix, any(target_os = "android", test)))]
mod file_io {
    use super::SecretStoreError;
    use std::io::{Read, Write};
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    use std::path::{Path, PathBuf};

    const SECRETS_FILE: &str = "sync-user-keys.json";

    fn path_in(dir: &Path) -> PathBuf {
        dir.join(SECRETS_FILE)
    }

    pub fn set_in(dir: &Path, payload: &str) -> Result<(), SecretStoreError> {
        std::fs::create_dir_all(dir)
            .map_err(|e| SecretStoreError::Io(format!("create secrets dir: {e}")))?;
        let path = path_in(dir);
        // Create (or truncate) with owner-only bits from the outset so the
        // bundle is never briefly group/world-readable on a fresh write.
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&path)
            .map_err(|e| SecretStoreError::Io(format!("open secrets file: {e}")))?;
        f.write_all(payload.as_bytes())
            .map_err(|e| SecretStoreError::Io(format!("write secrets file: {e}")))?;
        // `.mode()` only applies when the file is newly created; overwriting
        // an existing file keeps its old bits. Re-assert 0600 every write so
        // a pre-existing looser-permissioned file is tightened.
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| SecretStoreError::Io(format!("chmod secrets file: {e}")))?;
        Ok(())
    }

    pub fn get_in(dir: &Path) -> Result<Option<String>, SecretStoreError> {
        let path = path_in(dir);
        match std::fs::File::open(&path) {
            Ok(mut f) => {
                let mut s = String::new();
                f.read_to_string(&mut s)
                    .map_err(|e| SecretStoreError::Io(format!("read secrets file: {e}")))?;
                Ok(Some(s))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(SecretStoreError::Io(format!("open secrets file: {e}"))),
        }
    }

    pub fn delete_in(dir: &Path) -> Result<(), SecretStoreError> {
        match std::fs::remove_file(path_in(dir)) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(SecretStoreError::Io(format!("remove secrets file: {e}"))),
        }
    }
}

#[cfg(all(target_os = "android", not(test)))]
mod backend {
    use super::{file_io, SecretStoreError, ANDROID_SECRETS_DIR};
    use std::path::PathBuf;

    fn secrets_dir() -> Result<PathBuf, SecretStoreError> {
        ANDROID_SECRETS_DIR.get().cloned().ok_or_else(|| {
            SecretStoreError::Unavailable(
                "android secrets dir not initialized — app setup did not run".into(),
            )
        })
    }

    pub fn is_available() -> bool {
        // The file store is usable as soon as setup recorded the sandbox
        // dir; nothing OS-level can revoke it the way a locked keyring can.
        ANDROID_SECRETS_DIR.get().is_some()
    }

    pub fn set(payload: &str) -> Result<(), SecretStoreError> {
        file_io::set_in(&secrets_dir()?, payload)
    }

    pub fn get() -> Result<Option<String>, SecretStoreError> {
        file_io::get_in(&secrets_dir()?)
    }

    pub fn delete() -> Result<(), SecretStoreError> {
        file_io::delete_in(&secrets_dir()?)
    }
}

/// Test-only helper: empty the in-process backend so each test starts
/// from a known-empty state. Compiles only under `cfg(test)`; never
/// reachable from production code paths.
#[cfg(test)]
pub fn reset_for_tests() {
    // Best-effort — if the lock is poisoned the test will see the
    // poison error on the next access and fail loudly enough.
    let _ = backend::delete();
}

// ────────────────────────────────────────────────────────────────────
// Internal: JSON serde + base64 marshalling. Pulled out so the unit
// tests can cover the wire shape without touching a real keyring.
// ────────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
struct OnDisk {
    /// Schema marker so a future bundle layout can be distinguished
    /// from a v1 bundle without ambiguity.
    v: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    phrase: Option<String>,
    user_sign_priv: String,
    user_kex_priv: String,
    content_master_key: String,
    meta_key: String,
}

const ON_DISK_VERSION: u8 = 1;

fn serialize(keys: &StoredUserKeys) -> String {
    let payload = OnDisk {
        v: ON_DISK_VERSION,
        phrase: keys.phrase.clone(),
        user_sign_priv: B64.encode(keys.user_sign_priv),
        user_kex_priv: B64.encode(keys.user_kex_priv),
        content_master_key: B64.encode(keys.content_master_key),
        meta_key: B64.encode(keys.meta_key),
    };
    // unwrap: serializing a fixed struct of strings into JSON cannot fail.
    serde_json::to_string(&payload).expect("serialize secret bundle")
}

fn deserialize(payload: &str) -> Result<StoredUserKeys, SecretStoreError> {
    let parsed: OnDisk = serde_json::from_str(payload)
        .map_err(|e| SecretStoreError::Corrupted(format!("not valid JSON: {e}")))?;
    if parsed.v != ON_DISK_VERSION {
        return Err(SecretStoreError::Corrupted(format!(
            "unsupported bundle version {}",
            parsed.v
        )));
    }
    Ok(StoredUserKeys {
        phrase: parsed.phrase,
        user_sign_priv: decode_32(&parsed.user_sign_priv, "user_sign_priv")?,
        user_kex_priv: decode_32(&parsed.user_kex_priv, "user_kex_priv")?,
        content_master_key: decode_32(&parsed.content_master_key, "content_master_key")?,
        meta_key: decode_32(&parsed.meta_key, "meta_key")?,
    })
}

fn decode_32(s: &str, label: &str) -> Result<[u8; 32], SecretStoreError> {
    let bytes = B64
        .decode(s)
        .map_err(|e| SecretStoreError::Corrupted(format!("{label} not base64: {e}")))?;
    if bytes.len() != 32 {
        return Err(SecretStoreError::Corrupted(format!(
            "{label} is {} bytes, expected 32",
            bytes.len()
        )));
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&bytes);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> StoredUserKeys {
        StoredUserKeys {
            phrase: Some("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about".into()),
            user_sign_priv: [1u8; 32],
            user_kex_priv: [2u8; 32],
            content_master_key: [3u8; 32],
            meta_key: [4u8; 32],
        }
    }

    #[test]
    fn round_trip_preserves_phrase_and_keys() {
        let k = sample();
        let s = serialize(&k);
        let back = deserialize(&s).expect("parse round-trip");
        assert_eq!(back.phrase, k.phrase);
        assert_eq!(back.user_sign_priv, k.user_sign_priv);
        assert_eq!(back.user_kex_priv, k.user_kex_priv);
        assert_eq!(back.content_master_key, k.content_master_key);
        assert_eq!(back.meta_key, k.meta_key);
    }

    #[test]
    fn round_trip_with_no_phrase_is_paired_device_shape() {
        let mut k = sample();
        k.phrase = None;
        let s = serialize(&k);
        // The on-disk shape skips the `phrase` field entirely on
        // paired devices, keeping the entry compact and signalling
        // unambiguously that no recovery contract is held locally.
        assert!(!s.contains("\"phrase\""), "phrase field elided: {s}");
        let back = deserialize(&s).expect("parse round-trip");
        assert!(back.phrase.is_none());
    }

    #[test]
    fn rejects_unknown_version() {
        let bad = r#"{"v":99,"user_sign_priv":"AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=","user_kex_priv":"AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=","content_master_key":"AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM=","meta_key":"BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ="}"#;
        let err = deserialize(bad).unwrap_err();
        match err {
            SecretStoreError::Corrupted(msg) => assert!(msg.contains("version")),
            other => panic!("expected Corrupted, got {other:?}"),
        }
    }

    #[test]
    fn rejects_malformed_base64() {
        let bad = r#"{"v":1,"user_sign_priv":"not-base64-!!","user_kex_priv":"AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=","content_master_key":"AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM=","meta_key":"BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ="}"#;
        let err = deserialize(bad).unwrap_err();
        assert!(matches!(err, SecretStoreError::Corrupted(_)));
    }

    // ── Android file backend logic (exercised on the host via file_io) ──
    // The `target_os = "android"` backend can't run on the dev box, but its
    // read/write/chmod logic lives in `file_io`, which is also compiled
    // under `cfg(test)`. These cover the file path directly.
    #[cfg(unix)]
    mod file_backend {
        use super::super::file_io;
        use std::os::unix::fs::PermissionsExt;

        fn tmp_dir(tag: &str) -> std::path::PathBuf {
            // No Date::now()/random in scope; the test name keeps tags unique.
            let d = std::env::temp_dir().join(format!("shizumu-secret-{tag}"));
            let _ = std::fs::remove_dir_all(&d);
            d
        }

        #[test]
        fn set_then_get_round_trips_payload() {
            let dir = tmp_dir("round-trip");
            assert!(file_io::get_in(&dir).unwrap().is_none(), "empty before write");
            file_io::set_in(&dir, "the-bundle").unwrap();
            assert_eq!(file_io::get_in(&dir).unwrap().as_deref(), Some("the-bundle"));
            std::fs::remove_dir_all(&dir).ok();
        }

        #[test]
        fn get_on_absent_dir_is_none_not_error() {
            let dir = tmp_dir("absent");
            assert!(file_io::get_in(&dir).unwrap().is_none());
        }

        #[test]
        fn delete_is_idempotent() {
            let dir = tmp_dir("delete");
            file_io::set_in(&dir, "x").unwrap();
            file_io::delete_in(&dir).unwrap();
            assert!(file_io::get_in(&dir).unwrap().is_none());
            // Second delete on an already-absent file still succeeds.
            file_io::delete_in(&dir).unwrap();
            std::fs::remove_dir_all(&dir).ok();
        }

        #[test]
        fn fresh_write_is_owner_only_0600() {
            let dir = tmp_dir("perms-fresh");
            file_io::set_in(&dir, "secret").unwrap();
            let mode = std::fs::metadata(dir.join("sync-user-keys.json"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o600, "fresh secrets file must be owner-only");
            std::fs::remove_dir_all(&dir).ok();
        }

        #[test]
        fn overwrite_tightens_loose_permissions() {
            let dir = tmp_dir("perms-overwrite");
            std::fs::create_dir_all(&dir).unwrap();
            let path = dir.join("sync-user-keys.json");
            // Pre-existing world-readable file (e.g. from a buggy older build).
            std::fs::write(&path, "old").unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
            file_io::set_in(&dir, "new").unwrap();
            let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600, "overwrite must re-assert 0600");
            assert_eq!(file_io::get_in(&dir).unwrap().as_deref(), Some("new"));
            std::fs::remove_dir_all(&dir).ok();
        }
    }

    #[test]
    fn rejects_short_key_bytes() {
        // Only 16 bytes of base64 in `user_sign_priv` — should reject
        // rather than zero-pad or truncate.
        let bad = r#"{"v":1,"user_sign_priv":"AQEBAQEBAQEBAQEBAQEBAQ==","user_kex_priv":"AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=","content_master_key":"AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM=","meta_key":"BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ="}"#;
        let err = deserialize(bad).unwrap_err();
        match err {
            SecretStoreError::Corrupted(msg) => assert!(msg.contains("32 bytes") || msg.contains("expected 32")),
            other => panic!("expected Corrupted, got {other:?}"),
        }
    }
}
