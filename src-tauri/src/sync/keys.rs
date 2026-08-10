//! Key material for the sync engine.
//!
//! Two layers of secrets:
//!
//!   - **User keys** are deterministically derived from a BIP-39 seed
//!     phrase. They live on every device belonging to one user and are
//!     the recovery contract — losing every device but keeping the
//!     phrase reconstructs the full keyring.
//!
//!   - **Device keys** are a per-device random Ed25519 keypair plus a
//!     UUID. Each device gets its own identity at enroll/pair time;
//!     they are NOT recoverable from the seed phrase. Loss of every
//!     device means re-enrolling fresh devices from the phrase, which
//!     reconstructs user keys but creates fresh device identities.
//!
//! The derivation pipeline:
//!
//! ```text
//! BIP-39 mnemonic + empty passphrase
//!     └─ PBKDF2-HMAC-SHA512 → 64-byte seed         (BIP-39 §5)
//!         └─ HKDF-SHA256(seed, salt=b"")           (RFC 5869)
//!             ├─ info="shizumu.user_sign.v1"   → 32 → Ed25519
//!             ├─ info="shizumu.user_kex.v1"    → 32 → X25519
//!             ├─ info="shizumu.content_master.v1" → 32
//!             └─ info="shizumu.meta_key.v1"    → 32
//! ```
//!
//! The four info tags are versioned so a future v2 derivation can
//! cohabit. Changing any tag breaks recovery from existing phrases.

use bip39::Mnemonic;
use ed25519_dalek::SigningKey;
use hkdf::Hkdf;
use rand_core::{OsRng, RngCore};
use rusqlite::Connection;
use sha2::Sha256;
use x25519_dalek::StaticSecret;
use zeroize::Zeroize;

use crate::sync::config;

const INFO_USER_SIGN: &[u8] = b"shizumu.user_sign.v1";
const INFO_USER_KEX: &[u8] = b"shizumu.user_kex.v1";
const INFO_CONTENT_MASTER: &[u8] = b"shizumu.content_master.v1";
const INFO_META_KEY: &[u8] = b"shizumu.meta_key.v1";

/// sync_keys.role for the locally-stored 24-word BIP-39 phrase. The
/// recovery contract — losing every other secret but keeping this
/// row regenerates UserKeys.
const ROLE_BIP39_PHRASE: &str = "bip39_phrase";
/// 32 raw bytes of the device's Ed25519 signing seed.
const ROLE_DEVICE_SIGN_PRIV: &str = "device_sign_priv";
const ROLE_DEVICE_KEX_PRIV: &str = "device_kex_priv";
/// 16 raw bytes of the device's locally-generated UUID. Persisted
/// here so the device can sign requests before enrollment confirms
/// it; sync_state.device_id mirrors this once enrollment lands.
const ROLE_DEVICE_ID: &str = "device_id";

// ----- raw user-key roles (used by paired devices, which receive
// derived keys via the wrapped bundle and DO NOT have the BIP-39
// phrase). 32 raw bytes each. `load_user_keys` prefers these over
// re-deriving from the phrase.
const ROLE_USER_SIGN_PRIV: &str = "user_sign_priv";
const ROLE_USER_KEX_PRIV: &str = "user_kex_priv";
const ROLE_CONTENT_MASTER: &str = "content_master_key";
const ROLE_META_KEY: &str = "meta_key";

/// User-level keys derived from the BIP-39 seed phrase. Cloning would
/// duplicate the secret material; the type is intentionally not Clone.
/// `user_id` is None until the relay assigns one at enrollment time.
pub struct UserKeys {
    pub user_id: Option<uuid::Uuid>,
    pub user_sign_priv: SigningKey,
    pub user_kex_priv: StaticSecret,
    pub content_master_key: SecretKey32,
    pub meta_key: SecretKey32,
}

/// 32-byte secret bytes wrapped in a zeroize-on-drop newtype. Used for
/// content_master_key and meta_key.
pub struct SecretKey32([u8; 32]);

impl SecretKey32 {
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    /// Construct from raw 32 bytes. Used by the pairing flow when the
    /// new device unwraps content_master_key / meta_key from the age
    /// envelope. Crate-private so external callers go through the
    /// BIP-39 derivation pipeline.
    pub(crate) fn from_bytes(bytes: [u8; 32]) -> Self {
        SecretKey32(bytes)
    }
}

impl Drop for SecretKey32 {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

/// Device-level keys: a random Ed25519 signing keypair (request auth), a
/// random X25519 kex keypair (the wrapping target for rotated epoch
/// secrets — key rotation plan 1), plus a UUID. Both private keys are
/// random per device and are NOT part of the phrase recovery contract.
pub struct DeviceKeys {
    pub device_id: uuid::Uuid,
    pub device_sign_priv: SigningKey,
    pub device_kex_priv: x25519_dalek::StaticSecret,
}

/// Generate a fresh 24-word BIP-39 mnemonic (256-bit entropy). 24 words
/// gives the user a generous safety margin and matches the BIP-39
/// recommendation for high-value secrets — the seed encodes every
/// keyring secret short of device identity.
pub fn generate_seed_phrase() -> Mnemonic {
    let mut entropy = [0u8; 32];
    OsRng.fill_bytes(&mut entropy);
    let m = Mnemonic::from_entropy(&entropy).expect("32-byte entropy is valid bip39");
    entropy.zeroize();
    m
}

/// Derive `UserKeys` from a BIP-39 phrase. `user_id` is left None;
/// callers fill it in after relay enrollment returns one.
pub fn user_keys_from_phrase(m: &Mnemonic) -> UserKeys {
    // BIP-39 §5: PBKDF2-HMAC-SHA512(phrase, "mnemonic" + passphrase, 2048 rounds)
    // produces a 64-byte seed. We use an empty passphrase — recovery is from
    // the phrase alone.
    let seed = m.to_seed("");
    let hk = Hkdf::<Sha256>::new(None, &seed);

    let mut sign_seed = [0u8; 32];
    hk.expand(INFO_USER_SIGN, &mut sign_seed)
        .expect("32 ≤ 32 * 255 — hkdf-sha256 max output");
    let user_sign_priv = SigningKey::from_bytes(&sign_seed);
    sign_seed.zeroize();

    let mut kex_seed = [0u8; 32];
    hk.expand(INFO_USER_KEX, &mut kex_seed).expect("hkdf");
    let user_kex_priv = StaticSecret::from(kex_seed);
    kex_seed.zeroize();

    let mut content_master_bytes = [0u8; 32];
    hk.expand(INFO_CONTENT_MASTER, &mut content_master_bytes)
        .expect("hkdf");
    let content_master_key = SecretKey32(content_master_bytes);

    let mut meta_bytes = [0u8; 32];
    hk.expand(INFO_META_KEY, &mut meta_bytes).expect("hkdf");
    let meta_key = SecretKey32(meta_bytes);

    UserKeys {
        user_id: None,
        user_sign_priv,
        user_kex_priv,
        content_master_key,
        meta_key,
    }
}

/// Random device keypair + UUID. Called once per device on first
/// enroll or pair.
pub fn generate_device_keys() -> DeviceKeys {
    let mut sign_seed = [0u8; 32];
    OsRng.fill_bytes(&mut sign_seed);
    let device_sign_priv = SigningKey::from_bytes(&sign_seed);
    sign_seed.zeroize();

    let mut kex_seed = [0u8; 32];
    OsRng.fill_bytes(&mut kex_seed);
    let device_kex_priv = x25519_dalek::StaticSecret::from(kex_seed);
    kex_seed.zeroize();

    DeviceKeys {
        device_id: uuid::Uuid::new_v4(),
        device_sign_priv,
        device_kex_priv,
    }
}

impl UserKeys {
    pub fn user_sign_pub_bytes(&self) -> [u8; 32] {
        self.user_sign_priv.verifying_key().to_bytes()
    }
    pub fn user_kex_pub_bytes(&self) -> [u8; 32] {
        x25519_dalek::PublicKey::from(&self.user_kex_priv).to_bytes()
    }
}

impl DeviceKeys {
    pub fn device_sign_pub_bytes(&self) -> [u8; 32] {
        self.device_sign_priv.verifying_key().to_bytes()
    }
    pub fn device_kex_pub_bytes(&self) -> [u8; 32] {
        x25519_dalek::PublicKey::from(&self.device_kex_priv).to_bytes()
    }
}

// ===== persistence =====
//
// UserKeys (BIP-39 phrase + 4 derived secrets) live in the system
// keyring via `crate::sync::secret_store`. Possession of any of them
// lets an attacker impersonate the user against the relay, so they
// must not sit on disk in the home directory next to the database.
// The keyring branch is gated on `secret_store::is_available()`;
// callers refuse to set up sync when the gate is false (Flatpak or
// headless environments without a Secret Service backend).
//
// DeviceKeys are random per-device, are NOT part of the recovery
// contract, and need to be loadable before the keyring is unlocked
// so the worker can spawn at boot — they stay in `sync_keys`.
//
// Pre-v0.4 dev builds wrote UserKeys into `sync_keys` too. `load_*`
// finds them there, migrates them to the keyring, and deletes the DB
// rows in one atomic step so the upgrade path leaves nothing behind.

/// Persist a freshly-set-up BIP-39 phrase. Derives the four user keys,
/// writes them to the system keyring, and falls back to `sync_keys`
/// ONLY when the keyring write fails or doesn't survive a round-trip
/// (the v0.4 keyring promise: secrets must not sit on disk next to
/// the database unless the platform's secret store is unreliable).
pub fn persist_user_phrase(conn: &Connection, m: &Mnemonic) -> Result<(), String> {
    let derived = user_keys_from_phrase(m);
    let stored = stored_from_user_keys(&derived, Some(m.to_string()));
    match super::secret_store::store(&stored) {
        Ok(_) => {
            // Keyring accepted the write — verify the round-trip
            // before clearing any legacy DB rows. KDE / Fedora and
            // some headless setups silently drop the entry, in which
            // case we must fall back to the DB so the user isn't
            // locked out of their own data.
            match super::secret_store::load() {
                Ok(Some(_)) => {
                    let _ = clear_legacy_user_key_rows(conn);
                }
                _ => {
                    log::warn!(
                        "keyring write succeeded but readback failed; using DB fallback"
                    );
                    write_user_keys_to_db(conn, &derived, Some(&m.to_string()))?;
                }
            }
        }
        Err(e) => {
            log::warn!("keyring write failed ({e}); user keys will live in sync_keys only");
            write_user_keys_to_db(conn, &derived, Some(&m.to_string()))?;
        }
    }
    Ok(())
}

/// Persist a derived user-key bundle from the pairing flow (paired
/// devices never see the BIP-39 phrase). Same storage policy as
/// `persist_user_phrase`: keyring first, DB fallback only when the
/// keyring write fails or the round-trip readback comes back empty.
pub fn persist_user_keys_raw(conn: &Connection, uk: &UserKeys) -> Result<(), String> {
    let stored = stored_from_user_keys(uk, None);
    match super::secret_store::store(&stored) {
        Ok(_) => {
            match super::secret_store::load() {
                Ok(Some(_)) => {
                    let _ = clear_legacy_user_key_rows(conn);
                }
                _ => {
                    log::warn!(
                        "keyring write succeeded but readback failed; using DB fallback"
                    );
                    write_user_keys_to_db(conn, uk, None)?;
                }
            }
        }
        Err(e) => {
            log::warn!("keyring write failed ({e}); user keys will live in sync_keys only");
            write_user_keys_to_db(conn, uk, None)?;
        }
    }
    Ok(())
}

fn write_user_keys_to_db(
    conn: &Connection,
    uk: &UserKeys,
    phrase: Option<&str>,
) -> Result<(), String> {
    let ts = now_ms();
    if let Some(p) = phrase {
        config::put_key(conn, ROLE_BIP39_PHRASE, p.as_bytes(), ts)
            .map_err(|e| e.to_string())?;
    }
    config::put_key(conn, ROLE_USER_SIGN_PRIV, &uk.user_sign_priv.to_bytes(), ts)
        .map_err(|e| e.to_string())?;
    config::put_key(conn, ROLE_USER_KEX_PRIV, &uk.user_kex_priv.to_bytes(), ts)
        .map_err(|e| e.to_string())?;
    config::put_key(conn, ROLE_CONTENT_MASTER, uk.content_master_key.as_bytes(), ts)
        .map_err(|e| e.to_string())?;
    config::put_key(conn, ROLE_META_KEY, uk.meta_key.as_bytes(), ts)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Load `UserKeys`. Resolution order:
///   1. Keyring (the v0.4 path).
///   2. Legacy `sync_keys` raw rows or BIP-39 phrase row, migrated up
///      to the keyring in the same call so subsequent loads take path
///      #1. Migration is best-effort: if the keyring is unavailable
///      (Flatpak / headless), the legacy rows are used in place and a
///      warning is logged so the user understands sync identity is
///      still on disk.
///
/// Returns `Ok(None)` only when no source has keys (fresh install).
static MIGRATION_ATTEMPTED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

pub fn load_user_keys(conn: &Connection) -> Result<Option<UserKeys>, String> {
    if let Some(stored) = super::secret_store::load().map_err(|e| e.to_string())? {
        return Ok(Some(fill_user_id(conn, user_keys_from_stored(&stored))?));
    }
    if let Some((keys, phrase)) = load_legacy_user_keys(conn)? {
        if !MIGRATION_ATTEMPTED.swap(true, std::sync::atomic::Ordering::Relaxed) {
            try_migrate_legacy(conn, &keys, phrase.as_deref());
        }
        return Ok(Some(fill_user_id(conn, keys)?));
    }
    Ok(None)
}

/// Whether the account secrets currently live UNPROTECTED at rest — i.e.
/// as plaintext rows in `sync_keys` rather than in the OS keyring. This is
/// the keyring-unavailable fallback path (common on KDE/Fedora per the
/// project's keyring note), and it means anyone with file-system access to
/// the database can recover the full sync identity (security audit H3). The
/// UI surfaces this so the user can react (enable full-disk encryption, move
/// to a build with a working keyring, etc.) instead of it being silent.
pub fn secrets_unprotected_at_rest(conn: &Connection) -> bool {
    match super::secret_store::load() {
        Ok(Some(_)) => false,
        _ => matches!(load_legacy_user_keys(conn), Ok(Some(_))),
    }
}

fn fill_user_id(conn: &Connection, mut keys: UserKeys) -> Result<UserKeys, String> {
    let cfg = config::load(conn).map_err(|e| e.to_string())?;
    if let Some(uid_str) = cfg.user_id.as_deref() {
        keys.user_id = uuid::Uuid::parse_str(uid_str).ok();
    }
    Ok(keys)
}

/// Read legacy user keys from `sync_keys`. Returns the reconstructed
/// `UserKeys` and (when present) the original BIP-39 phrase so the
/// migration step can preserve the recovery contract.
fn load_legacy_user_keys(
    conn: &Connection,
) -> Result<Option<(UserKeys, Option<String>)>, String> {
    if let Some(keys) = load_user_keys_from_raw(conn)? {
        let phrase = legacy_phrase_string(conn)?;
        return Ok(Some((keys, phrase)));
    }
    if let Some(phrase) = legacy_phrase_string(conn)? {
        let mnemonic = Mnemonic::parse_normalized(&phrase)
            .map_err(|e| format!("stored bip39 phrase is invalid: {e}"))?;
        let keys = user_keys_from_phrase(&mnemonic);
        return Ok(Some((keys, Some(phrase))));
    }
    Ok(None)
}

fn legacy_phrase_string(conn: &Connection) -> Result<Option<String>, String> {
    let bytes = match config::get_key(conn, ROLE_BIP39_PHRASE).map_err(|e| e.to_string())? {
        Some(b) => b,
        None => return Ok(None),
    };
    let phrase = std::str::from_utf8(&bytes)
        .map_err(|e| format!("bip39 phrase row is not UTF-8: {e}"))?
        .to_string();
    Ok(Some(phrase))
}

/// Best-effort: copy legacy user-key rows into the keyring and clear
/// them from `sync_keys` only after verifying the round-trip. Logs
/// and returns without erroring when the keyring is unavailable so
/// existing dev installs keep working.
fn try_migrate_legacy(conn: &Connection, keys: &UserKeys, phrase: Option<&str>) {
    if !super::secret_store::is_available() {
        log::warn!(
            "sync keys are still in the database — system keyring is not available, \
             so the sync identity remains readable to anyone with file-system access. \
             Run sync setup again on a build with a working keyring to migrate."
        );
        return;
    }
    let stored = stored_from_user_keys(keys, phrase.map(|s| s.to_string()));
    if let Err(e) = super::secret_store::store(&stored) {
        log::warn!("legacy sync-key migration: keyring write failed: {e}");
        return;
    }
    // Verify the keyring actually persisted before deleting the DB rows.
    match super::secret_store::load() {
        Ok(Some(_)) => {}
        _ => {
            log::warn!(
                "legacy sync-key migration: keyring write returned Ok but read-back \
                 failed — keeping sync_keys rows as fallback"
            );
            return;
        }
    }
    if let Err(e) = clear_legacy_user_key_rows(conn) {
        log::warn!(
            "legacy sync-key migration: keyring write succeeded but DB cleanup failed: {e}; \
             secrets now exist in BOTH places. Run sync setup again to recover."
        );
        return;
    }
    log::info!("sync keys migrated from database into system keyring");
}

/// Helper: extract the raw bytes a `UserKeys` carries into a
/// `StoredUserKeys` shaped for the keyring entry.
fn stored_from_user_keys(
    uk: &UserKeys,
    phrase: Option<String>,
) -> super::secret_store::StoredUserKeys {
    super::secret_store::StoredUserKeys {
        phrase,
        user_sign_priv: uk.user_sign_priv.to_bytes(),
        user_kex_priv: uk.user_kex_priv.to_bytes(),
        content_master_key: *uk.content_master_key.as_bytes(),
        meta_key: *uk.meta_key.as_bytes(),
    }
}

/// Helper: reconstruct a `UserKeys` from a keyring bundle.
fn user_keys_from_stored(stored: &super::secret_store::StoredUserKeys) -> UserKeys {
    let user_sign_priv = SigningKey::from_bytes(&stored.user_sign_priv);

    let mut kex_seed = stored.user_kex_priv;
    let user_kex_priv = StaticSecret::from(kex_seed);
    kex_seed.zeroize();

    let content_master_key = SecretKey32::from_bytes(stored.content_master_key);
    let meta_key = SecretKey32::from_bytes(stored.meta_key);

    UserKeys {
        user_id: None,
        user_sign_priv,
        user_kex_priv,
        content_master_key,
        meta_key,
    }
}

/// Drop every user-scoped row from `sync_keys`. Device rows
/// (`device_sign_priv`, `device_id`) stay — they're not migrated.
fn clear_legacy_user_key_rows(conn: &Connection) -> rusqlite::Result<()> {
    for role in [
        ROLE_BIP39_PHRASE,
        ROLE_USER_SIGN_PRIV,
        ROLE_USER_KEX_PRIV,
        ROLE_CONTENT_MASTER,
        ROLE_META_KEY,
    ] {
        config::delete_key(conn, role)?;
    }
    Ok(())
}

fn load_user_keys_from_raw(conn: &Connection) -> Result<Option<UserKeys>, String> {
    let sign_bytes = match config::get_key(conn, ROLE_USER_SIGN_PRIV).map_err(|e| e.to_string())? {
        Some(b) => b,
        None => return Ok(None),
    };
    let kex_bytes = match config::get_key(conn, ROLE_USER_KEX_PRIV).map_err(|e| e.to_string())? {
        Some(b) => b,
        None => return Ok(None),
    };
    let cm_bytes = match config::get_key(conn, ROLE_CONTENT_MASTER).map_err(|e| e.to_string())? {
        Some(b) => b,
        None => return Ok(None),
    };
    let mk_bytes = match config::get_key(conn, ROLE_META_KEY).map_err(|e| e.to_string())? {
        Some(b) => b,
        None => return Ok(None),
    };
    for (name, b) in [
        ("user_sign_priv", &sign_bytes),
        ("user_kex_priv", &kex_bytes),
        ("content_master_key", &cm_bytes),
        ("meta_key", &mk_bytes),
    ] {
        if b.len() != 32 {
            return Err(format!("{name} row is {} bytes, expected 32", b.len()));
        }
    }
    let mut sign_arr = [0u8; 32];
    sign_arr.copy_from_slice(&sign_bytes);
    let user_sign_priv = SigningKey::from_bytes(&sign_arr);
    sign_arr.zeroize();

    let mut kex_arr = [0u8; 32];
    kex_arr.copy_from_slice(&kex_bytes);
    let user_kex_priv = StaticSecret::from(kex_arr);
    // StaticSecret::from copies — explicit zeroize of our local.
    let mut kex_zero = [0u8; 32];
    kex_zero.copy_from_slice(&kex_bytes);
    kex_zero.zeroize();

    let mut cm_arr = [0u8; 32];
    cm_arr.copy_from_slice(&cm_bytes);
    let content_master_key = SecretKey32::from_bytes(cm_arr);

    let mut mk_arr = [0u8; 32];
    mk_arr.copy_from_slice(&mk_bytes);
    let meta_key = SecretKey32::from_bytes(mk_arr);

    Ok(Some(UserKeys {
        user_id: None,
        user_sign_priv,
        user_kex_priv,
        content_master_key,
        meta_key,
    }))
}

/// Persist `DeviceKeys` to `sync_keys`. Both rows (signing seed +
/// device UUID) overwrite any prior values — a re-setup is allowed,
/// just means a new local device identity.
pub fn persist_device_keys(conn: &Connection, keys: &DeviceKeys) -> rusqlite::Result<()> {
    config::put_key(
        conn,
        ROLE_DEVICE_SIGN_PRIV,
        &keys.device_sign_priv.to_bytes(),
        now_ms(),
    )?;
    config::put_key(conn, ROLE_DEVICE_ID, keys.device_id.as_bytes(), now_ms())?;
    config::put_key(
        conn,
        ROLE_DEVICE_KEX_PRIV,
        &keys.device_kex_priv.to_bytes(),
        now_ms(),
    )?;
    Ok(())
}

/// Load `DeviceKeys` from `sync_keys`. Returns `Ok(None)` if either
/// row is missing — partial state from a failed setup mid-way is
/// treated as "not configured" rather than corrupt.
pub fn load_device_keys(conn: &Connection) -> Result<Option<DeviceKeys>, String> {
    let priv_bytes = match config::get_key(conn, ROLE_DEVICE_SIGN_PRIV).map_err(|e| e.to_string())? {
        Some(b) => b,
        None => return Ok(None),
    };
    let id_bytes = match config::get_key(conn, ROLE_DEVICE_ID).map_err(|e| e.to_string())? {
        Some(b) => b,
        None => return Ok(None),
    };
    if priv_bytes.len() != 32 {
        return Err(format!(
            "device_sign_priv row is {} bytes, expected 32",
            priv_bytes.len()
        ));
    }
    if id_bytes.len() != 16 {
        return Err(format!(
            "device_id row is {} bytes, expected 16",
            id_bytes.len()
        ));
    }
    let mut seed = [0u8; 32];
    seed.copy_from_slice(&priv_bytes);
    let device_sign_priv = SigningKey::from_bytes(&seed);
    seed.zeroize();

    let mut uuid_bytes = [0u8; 16];
    uuid_bytes.copy_from_slice(&id_bytes);
    let device_id = uuid::Uuid::from_bytes(uuid_bytes);

    // Per-device kex key (key rotation plan 1). A device enrolled before
    // this existed has no row — mint one now and persist it so the device
    // self-heals on first load post-upgrade. The public half is published
    // to the relay by the worker's backfill step.
    let device_kex_priv = match config::get_key(conn, ROLE_DEVICE_KEX_PRIV).map_err(|e| e.to_string())? {
        Some(b) if b.len() == 32 => {
            let mut kseed = [0u8; 32];
            kseed.copy_from_slice(&b);
            let k = x25519_dalek::StaticSecret::from(kseed);
            kseed.zeroize();
            k
        }
        _ => {
            let mut kseed = [0u8; 32];
            OsRng.fill_bytes(&mut kseed);
            let k = x25519_dalek::StaticSecret::from(kseed);
            kseed.zeroize();
            config::put_key(conn, ROLE_DEVICE_KEX_PRIV, &k.to_bytes(), now_ms())
                .map_err(|e| e.to_string())?;
            k
        }
    };

    Ok(Some(DeviceKeys {
        device_id,
        device_sign_priv,
        device_kex_priv,
    }))
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    use std::sync::Mutex;

    /// Every test that touches the secret store (which is process-
    /// local static state in test builds) acquires this guard and
    /// resets the store before doing anything else. Without it,
    /// cargo's parallel test runner sees leftover bundles from
    /// concurrent tests and assertions about "fresh" or "after
    /// migration" state flake.
    static SECRET_STORE_GUARD: Mutex<()> = Mutex::new(());

    /// Lock + reset helper. Returns a guard the test must hold for
    /// the duration of its secret-store interaction. `_g` binding in
    /// the caller keeps it alive until drop at end-of-scope.
    fn guard_secret_store() -> std::sync::MutexGuard<'static, ()> {
        let g = SECRET_STORE_GUARD
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        super::super::secret_store::reset_for_tests();
        // `MIGRATION_ATTEMPTED` is a process-global one-shot latch: the
        // legacy-key migration runs at most once per process. Without a
        // reset, whichever guarded test hits the legacy path first leaves
        // it `true`, so a later test (e.g. legacy_raw_rows_migrate_*) finds
        // its own migration suppressed and the keyring empty. Clearing it
        // here restores per-test isolation for the whole guarded set.
        super::MIGRATION_ATTEMPTED.store(false, std::sync::atomic::Ordering::Relaxed);
        g
    }

    /// Same phrase → same user keys, always. This is the recovery
    /// contract — if any future change to the derivation pipeline
    /// breaks this test, existing users cannot recover from their
    /// phrase.
    #[test]
    fn user_keys_are_deterministic_from_phrase() {
        let m = Mnemonic::parse_normalized(
            "abandon abandon abandon abandon abandon abandon abandon abandon \
             abandon abandon abandon abandon abandon abandon abandon abandon \
             abandon abandon abandon abandon abandon abandon abandon art",
        )
        .unwrap();
        let a = user_keys_from_phrase(&m);
        let b = user_keys_from_phrase(&m);
        assert_eq!(a.user_sign_pub_bytes(), b.user_sign_pub_bytes());
        assert_eq!(a.user_kex_pub_bytes(), b.user_kex_pub_bytes());
        assert_eq!(
            a.content_master_key.as_bytes(),
            b.content_master_key.as_bytes()
        );
        assert_eq!(a.meta_key.as_bytes(), b.meta_key.as_bytes());
    }

    /// Different phrase → completely different keys. Sanity check
    /// against a derivation bug that ignores the seed.
    #[test]
    fn different_phrase_yields_different_keys() {
        let m1 = Mnemonic::parse_normalized(
            "abandon abandon abandon abandon abandon abandon abandon abandon \
             abandon abandon abandon abandon abandon abandon abandon abandon \
             abandon abandon abandon abandon abandon abandon abandon art",
        )
        .unwrap();
        let m2 = generate_seed_phrase();
        let a = user_keys_from_phrase(&m1);
        let b = user_keys_from_phrase(&m2);
        assert_ne!(a.user_sign_pub_bytes(), b.user_sign_pub_bytes());
        assert_ne!(a.meta_key.as_bytes(), b.meta_key.as_bytes());
    }

    /// The four derivation tags must produce distinct outputs — if
    /// info_user_sign and info_user_kex collided, an attacker who
    /// learned the kex secret could forge signatures.
    #[test]
    fn derivation_tags_separate_keys() {
        let m = generate_seed_phrase();
        let k = user_keys_from_phrase(&m);
        let sign_bytes = k.user_sign_priv.to_bytes();
        let kex_bytes = k.user_kex_priv.to_bytes();
        assert_ne!(sign_bytes, kex_bytes);
        assert_ne!(sign_bytes, *k.content_master_key.as_bytes());
        assert_ne!(sign_bytes, *k.meta_key.as_bytes());
        assert_ne!(kex_bytes, *k.content_master_key.as_bytes());
        assert_ne!(kex_bytes, *k.meta_key.as_bytes());
        assert_ne!(
            k.content_master_key.as_bytes(),
            k.meta_key.as_bytes()
        );
    }

    /// Device keys are random — every call is unique. This is the
    /// per-device-identity invariant; two devices accidentally sharing
    /// a device_sign_priv would let one impersonate the other against
    /// the relay.
    #[test]
    fn generate_device_keys_produces_unique_pairs() {
        let a = generate_device_keys();
        let b = generate_device_keys();
        assert_ne!(a.device_id, b.device_id);
        assert_ne!(a.device_sign_priv.to_bytes(), b.device_sign_priv.to_bytes());
    }

    /// 24-word phrases are valid BIP-39 (256-bit entropy). Sanity
    /// check that `generate_seed_phrase` produces a parseable mnemonic
    /// and that round-tripping through the textual form does not
    /// alter the derived keys.
    #[test]
    fn seed_phrase_round_trips_through_text() {
        let m = generate_seed_phrase();
        assert_eq!(m.word_count(), 24, "24-word phrase expected");
        let words = m.to_string();
        let m2 = Mnemonic::parse_normalized(&words).unwrap();
        let a = user_keys_from_phrase(&m);
        let b = user_keys_from_phrase(&m2);
        assert_eq!(a.user_sign_pub_bytes(), b.user_sign_pub_bytes());
        assert_eq!(a.meta_key.as_bytes(), b.meta_key.as_bytes());
    }

    /// Smoke check that public keys are 32 bytes and base64-roundtrip
    /// cleanly. The wire protocol's pubkey fields are exactly 32 bytes
    /// base64-encoded (see §5.3 enroll request).
    #[test]
    fn pubkeys_are_32_bytes_and_base64_safe() {
        let m = generate_seed_phrase();
        let k = user_keys_from_phrase(&m);
        let sp = k.user_sign_pub_bytes();
        let kp = k.user_kex_pub_bytes();
        assert_eq!(sp.len(), 32);
        assert_eq!(kp.len(), 32);
        let enc = B64.encode(sp);
        let dec = B64.decode(&enc).unwrap();
        assert_eq!(dec, sp);
    }

    // ===== persistence round-trips =====

    /// Fresh DB returns None for both keysets — load functions must
    /// not panic on an empty sync_keys table; that's the "not
    /// configured yet" signal.
    #[test]
    fn load_returns_none_on_fresh_db() {
        let _g = guard_secret_store();
        let db = crate::test_helpers::test_db();
        let conn = db.lock().unwrap();
        assert!(load_user_keys(&conn).unwrap().is_none());
        assert!(load_device_keys(&conn).unwrap().is_none());
    }

    /// A persisted phrase re-derives byte-identical UserKeys on load.
    /// This is the recovery contract under persistence.
    #[test]
    fn user_keys_round_trip_through_sync_keys() {
        let _g = guard_secret_store();
        let db = crate::test_helpers::test_db();
        let conn = db.lock().unwrap();
        let m = generate_seed_phrase();
        let original = user_keys_from_phrase(&m);

        persist_user_phrase(&conn, &m).unwrap();
        let loaded = load_user_keys(&conn).unwrap().expect("phrase persisted");
        assert_eq!(
            loaded.user_sign_pub_bytes(),
            original.user_sign_pub_bytes()
        );
        assert_eq!(loaded.user_kex_pub_bytes(), original.user_kex_pub_bytes());
        assert_eq!(
            loaded.content_master_key.as_bytes(),
            original.content_master_key.as_bytes()
        );
        assert_eq!(
            loaded.meta_key.as_bytes(),
            original.meta_key.as_bytes()
        );
        // user_id is None until enrollment stamps one into sync_state.
        assert!(loaded.user_id.is_none());
    }

    /// Once enrollment writes user_id into sync_state, load_user_keys
    /// surfaces it on the returned struct.
    #[test]
    fn load_user_keys_picks_up_user_id_from_sync_state() {
        let _g = guard_secret_store();
        let db = crate::test_helpers::test_db();
        let conn = db.lock().unwrap();
        let m = generate_seed_phrase();
        persist_user_phrase(&conn, &m).unwrap();

        let assigned = uuid::Uuid::new_v4();
        config::set_enrollment(&conn, &assigned.to_string(), "dev-1", 1).unwrap();

        let loaded = load_user_keys(&conn).unwrap().unwrap();
        assert_eq!(loaded.user_id, Some(assigned));
    }

    /// DeviceKeys persist as raw seed + raw UUID and round-trip
    /// byte-exact. Random per-device → MUST survive across launches
    /// because re-deriving from the phrase doesn't reproduce them.
    #[test]
    fn device_keys_round_trip_through_sync_keys() {
        let db = crate::test_helpers::test_db();
        let conn = db.lock().unwrap();
        let original = generate_device_keys();
        persist_device_keys(&conn, &original).unwrap();
        let loaded = load_device_keys(&conn).unwrap().expect("device keys persisted");
        assert_eq!(loaded.device_id, original.device_id);
        assert_eq!(
            loaded.device_sign_priv.to_bytes(),
            original.device_sign_priv.to_bytes()
        );
        assert_eq!(
            loaded.device_sign_pub_bytes(),
            original.device_sign_pub_bytes()
        );
    }

    /// Re-persisting overwrites cleanly. Supports re-setup flows
    /// (user generates a fresh phrase or re-pairs a device).
    #[test]
    fn persisting_again_overwrites_prior_rows() {
        let db = crate::test_helpers::test_db();
        let conn = db.lock().unwrap();
        let dk1 = generate_device_keys();
        let dk2 = generate_device_keys();
        persist_device_keys(&conn, &dk1).unwrap();
        persist_device_keys(&conn, &dk2).unwrap();
        let loaded = load_device_keys(&conn).unwrap().unwrap();
        assert_eq!(loaded.device_id, dk2.device_id);
        assert_ne!(loaded.device_id, dk1.device_id);
    }

    /// A paired device persists the four derived secrets directly
    /// (no phrase). `load_user_keys` must surface those secrets and
    /// produce a UserKeys with bit-identical pubkeys.
    #[test]
    fn raw_user_keys_round_trip_for_paired_devices() {
        let _g = guard_secret_store();
        let db = crate::test_helpers::test_db();
        let conn = db.lock().unwrap();
        let m = generate_seed_phrase();
        let original = user_keys_from_phrase(&m);

        persist_user_keys_raw(&conn, &original).unwrap();
        let loaded = load_user_keys(&conn).unwrap().expect("raw keys persisted");
        assert_eq!(
            loaded.user_sign_pub_bytes(),
            original.user_sign_pub_bytes()
        );
        assert_eq!(loaded.user_kex_pub_bytes(), original.user_kex_pub_bytes());
        assert_eq!(
            loaded.content_master_key.as_bytes(),
            original.content_master_key.as_bytes()
        );
        assert_eq!(loaded.meta_key.as_bytes(), original.meta_key.as_bytes());
    }

    /// Raw secrets take precedence over the BIP-39 phrase. If both
    /// rows exist (a phrase-setup device that later receives a
    /// pairing, hypothetically), the raw values are used — they're
    /// the more recent authority.
    #[test]
    fn raw_secrets_win_over_bip39_phrase_when_both_present() {
        let _g = guard_secret_store();
        let db = crate::test_helpers::test_db();
        let conn = db.lock().unwrap();
        let m_a = generate_seed_phrase();
        let m_b = generate_seed_phrase();
        let keys_a = user_keys_from_phrase(&m_a);
        let keys_b = user_keys_from_phrase(&m_b);

        // Phrase A persisted; raw secrets are from a different phrase B.
        persist_user_phrase(&conn, &m_a).unwrap();
        persist_user_keys_raw(&conn, &keys_b).unwrap();
        let loaded = load_user_keys(&conn).unwrap().unwrap();
        assert_eq!(
            loaded.user_sign_pub_bytes(),
            keys_b.user_sign_pub_bytes(),
            "raw secrets should win"
        );
        assert_ne!(
            loaded.user_sign_pub_bytes(),
            keys_a.user_sign_pub_bytes(),
        );
    }

    /// Legacy v0.4-dev installs that wrote user keys into `sync_keys`
    /// must transparently migrate to the keyring on first
    /// `load_user_keys` post-upgrade. After migration the secret store
    /// holds the keys and the legacy DB rows are gone, so subsequent
    /// loads take the keyring fast path.
    #[test]
    fn legacy_db_rows_migrate_to_secret_store_on_load() {
        let _g = guard_secret_store();
        let db = crate::test_helpers::test_db();
        let conn = db.lock().unwrap();

        // Seed the DB with the legacy phrase-row layout: bytes of the
        // mnemonic stored directly under ROLE_BIP39_PHRASE. This is
        // what every v0.4-dev install has today.
        let m = generate_seed_phrase();
        let phrase = m.to_string();
        config::put_key(&conn, ROLE_BIP39_PHRASE, phrase.as_bytes(), 1).unwrap();

        // First load: pulls keys from DB and migrates them.
        let loaded = load_user_keys(&conn)
            .unwrap()
            .expect("legacy phrase row recognized");

        // DB row is gone after migration — the secret has moved.
        assert!(
            config::get_key(&conn, ROLE_BIP39_PHRASE).unwrap().is_none(),
            "legacy bip39_phrase row removed after migration"
        );

        // Keyring (in-process backend during tests) holds the bundle.
        let stored = super::super::secret_store::load()
            .unwrap()
            .expect("keyring populated after migration");
        assert_eq!(stored.phrase.as_deref(), Some(phrase.as_str()));
        assert_eq!(
            stored.user_sign_priv,
            loaded.user_sign_priv.to_bytes(),
            "migrated bundle matches the derived UserKeys"
        );

        // Second load takes the fast path. No more DB rows, no errors.
        let again = load_user_keys(&conn)
            .unwrap()
            .expect("post-migration load reads from keyring");
        assert_eq!(again.user_sign_pub_bytes(), loaded.user_sign_pub_bytes());
    }

    /// Legacy raw-row layout (paired device that never wrote a phrase)
    /// migrates with phrase=None so the recovery contract isn't faked.
    #[test]
    fn legacy_raw_rows_migrate_without_phrase() {
        let _g = guard_secret_store();
        let db = crate::test_helpers::test_db();
        let conn = db.lock().unwrap();

        let m = generate_seed_phrase();
        let keys = user_keys_from_phrase(&m);
        // Write the four raw rows by hand (this is what a v0.4-dev
        // paired device looked like). No bip39_phrase row.
        config::put_key(&conn, ROLE_USER_SIGN_PRIV, &keys.user_sign_priv.to_bytes(), 1).unwrap();
        config::put_key(&conn, ROLE_USER_KEX_PRIV, &keys.user_kex_priv.to_bytes(), 1).unwrap();
        config::put_key(&conn, ROLE_CONTENT_MASTER, keys.content_master_key.as_bytes(), 1).unwrap();
        config::put_key(&conn, ROLE_META_KEY, keys.meta_key.as_bytes(), 1).unwrap();

        let _ = load_user_keys(&conn).unwrap().expect("legacy raw rows recognized");

        let stored = super::super::secret_store::load()
            .unwrap()
            .expect("keyring populated");
        assert!(stored.phrase.is_none(), "paired-device migration carries no phrase");
        // All four legacy rows are gone.
        for role in [
            ROLE_USER_SIGN_PRIV,
            ROLE_USER_KEX_PRIV,
            ROLE_CONTENT_MASTER,
            ROLE_META_KEY,
        ] {
            assert!(
                config::get_key(&conn, role).unwrap().is_none(),
                "legacy {role} row removed after migration"
            );
        }
    }

    /// Corrupted device_sign_priv length (e.g. partial write) fails
    /// the load rather than silently producing a bogus key.
    #[test]
    fn load_device_keys_rejects_wrong_length_rows() {
        let db = crate::test_helpers::test_db();
        let conn = db.lock().unwrap();
        // Write a 31-byte device_sign_priv — too short.
        config::put_key(&conn, "device_sign_priv", &[7u8; 31], 1).unwrap();
        config::put_key(&conn, "device_id", &[1u8; 16], 1).unwrap();
        match load_device_keys(&conn) {
            Err(e) => assert!(e.contains("32"), "error mentions expected size: {e}"),
            Ok(_) => panic!("expected error for wrong-length row"),
        }
    }

    #[test]
    fn device_kex_key_round_trips_and_backfills() {
        let db = crate::test_helpers::test_db();
        let conn = db.lock().unwrap();
        let keys = generate_device_keys();
        let pub_before = keys.device_kex_pub_bytes();
        persist_device_keys(&conn, &keys).unwrap();
        let loaded = load_device_keys(&conn).unwrap().unwrap();
        assert_eq!(
            loaded.device_kex_pub_bytes(),
            pub_before,
            "kex pub survives persist/load"
        );

        // Backfill path: drop the kex row (simulating a device enrolled
        // before per-device kex keys) and confirm load mints + persists one
        // without disturbing the sign identity.
        conn.execute("DELETE FROM sync_keys WHERE role = ?", [ROLE_DEVICE_KEX_PRIV])
            .unwrap();
        let healed = load_device_keys(&conn).unwrap().unwrap();
        let row_exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sync_keys WHERE role = ?)",
                [ROLE_DEVICE_KEX_PRIV],
                |r| r.get::<_, i64>(0).map(|v| v != 0),
            )
            .unwrap();
        assert!(row_exists, "load backfills the missing kex row");
        assert_eq!(
            healed.device_sign_pub_bytes(),
            keys.device_sign_pub_bytes(),
            "sign identity preserved across backfill"
        );
    }
}
