//! Sync configuration + key persistence.
//!
//! Two tables back this module (migration 017_sync_state):
//!
//!   - `sync_state` — single-row table holding relay URL, assigned
//!     user_id / device_id, the enabled flag, last_seen_user_seq for
//!     pull resumption, and last-sync diagnostics. Bootstrapped lazily
//!     on first read.
//!
//!   - `sync_keys` — role-keyed BLOB storage. Holds the BIP-39 phrase
//!     (the recovery contract), the four derived user keys (cached so
//!     we don't re-run PBKDF2+HKDF every launch), and the random
//!     device_sign_priv (which is NOT recoverable from the phrase and
//!     MUST survive across launches).
//!
//! Both tables live inside the SQLCipher-encrypted DB when at-rest
//! encryption is enabled. On unencrypted DBs, the secrets are written
//! in the clear — the keyring-based passphrase flow is the user's
//! gate against that.

use rusqlite::{params, Connection, OptionalExtension};

/// Roles we persist in `sync_keys.role`. Keep these strings stable —
/// changing one mid-flight orphans the existing row.
pub const ROLE_BIP39_PHRASE: &str = "bip39_phrase";
pub const ROLE_USER_SIGN_PRIV: &str = "user_sign_priv";
pub const ROLE_USER_KEX_PRIV: &str = "user_kex_priv";
pub const ROLE_CONTENT_MASTER_KEY: &str = "content_master_key";
pub const ROLE_META_KEY: &str = "meta_key";
pub const ROLE_DEVICE_SIGN_PRIV: &str = "device_sign_priv";

/// A read-only snapshot of `sync_state`. Returned by `load`.
#[derive(Debug, Clone, Default)]
pub struct SyncConfig {
    pub relay_url: Option<String>,
    pub user_id: Option<String>,
    pub device_id: Option<String>,
    pub enrolled_at_ms: Option<i64>,
    pub last_seen_user_seq: i64,
    pub enabled: bool,
    pub last_sync_at_ms: Option<i64>,
    pub last_error: Option<String>,
}

impl SyncConfig {
    /// True once enrollment has populated user_id + device_id AND the
    /// user has flipped `enabled`. The upload / pull pipelines gate on
    /// this — anything false means the engine stays silent.
    pub fn is_active(&self) -> bool {
        self.enabled
            && self.relay_url.is_some()
            && self.user_id.is_some()
            && self.device_id.is_some()
    }
}

/// Load the single sync_state row. If the row is missing (fresh DB),
/// inserts a zero-default row and returns it.
pub fn load(conn: &Connection) -> rusqlite::Result<SyncConfig> {
    let row = conn
        .query_row(
            "SELECT relay_url, user_id, device_id, enrolled_at_ms,
                    last_seen_user_seq, enabled, last_sync_at_ms, last_error
             FROM sync_state WHERE id = 1",
            [],
            |r| {
                Ok(SyncConfig {
                    relay_url: r.get(0)?,
                    user_id: r.get(1)?,
                    device_id: r.get(2)?,
                    enrolled_at_ms: r.get(3)?,
                    last_seen_user_seq: r.get(4)?,
                    enabled: {
                        let v: i64 = r.get(5)?;
                        v != 0
                    },
                    last_sync_at_ms: r.get(6)?,
                    last_error: r.get(7)?,
                })
            },
        )
        .optional()?;

    if let Some(cfg) = row {
        return Ok(cfg);
    }

    conn.execute(
        "INSERT INTO sync_state (id, last_seen_user_seq, enabled) VALUES (1, 0, 0)",
        [],
    )?;
    Ok(SyncConfig::default())
}

/// Validate a relay URL before it is stored or used. Enforces HTTPS so
/// signed request headers, device/user ids, op metadata, blob hashes, and
/// the age-wrapped pairing bundle never traverse cleartext (security audit
/// H1). Plain `http://` is permitted ONLY for loopback hosts, for local
/// development and same-machine self-hosting.
pub fn validate_relay_url(url: &str) -> Result<(), String> {
    let url = url.trim();
    if let Some(rest) = url.strip_prefix("https://") {
        if rest.is_empty() {
            return Err("relay url has no host".into());
        }
        return Ok(());
    }
    if let Some(rest) = url.strip_prefix("http://") {
        // Host runs up to the first ':' (port), '/' (path), or end.
        let host = rest.split([':', '/']).next().unwrap_or("");
        if matches!(host, "localhost" | "127.0.0.1" | "::1" | "[::1]") {
            return Ok(());
        }
        return Err(
            "relay url must use https:// (plain http:// is allowed only for localhost)".into(),
        );
    }
    Err("relay url must start with https://".into())
}

/// Set the relay URL the engine should talk to. Independent of
/// enrollment — you can stage a URL before enrolling. Rejects any
/// non-HTTPS (non-loopback) URL via `validate_relay_url`.
pub fn set_relay_url(conn: &Connection, url: &str) -> Result<(), String> {
    validate_relay_url(url)?;
    ensure_row(conn).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE sync_state SET relay_url = ? WHERE id = 1",
        params![url.trim()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Stamp the user_id + device_id + enrollment timestamp after the
/// relay returns from POST /v1/devices/enroll. Called once per device.
pub fn set_enrollment(
    conn: &Connection,
    user_id: &str,
    device_id: &str,
    enrolled_at_ms: i64,
) -> rusqlite::Result<()> {
    ensure_row(conn)?;
    conn.execute(
        "UPDATE sync_state
            SET user_id = ?, device_id = ?, enrolled_at_ms = ?
            WHERE id = 1",
        params![user_id, device_id, enrolled_at_ms],
    )?;
    Ok(())
}

/// Flip the gating flag. The op_log keeps accruing local_only rows
/// regardless; this only controls whether the upload / pull pipelines
/// run.
pub fn set_enabled(conn: &Connection, enabled: bool) -> rusqlite::Result<()> {
    ensure_row(conn)?;
    conn.execute(
        "UPDATE sync_state SET enabled = ? WHERE id = 1",
        params![if enabled { 1 } else { 0 }],
    )?;
    Ok(())
}

/// Read an integer setting from the `settings` key/value table. Used
/// by command handlers that need a numeric knob without pulling in
/// the whole settings module. Returns None if the row is missing or
/// the stored value doesn't parse as i64.
pub fn get_setting_i64(conn: &Connection, key: &str) -> Option<i64> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?",
            params![key],
            |r| r.get(0),
        )
        .ok();
    raw.and_then(|s| s.parse::<i64>().ok())
}

/// Advance the resume cursor after a successful pull batch. The
/// pull pipeline calls this after each batch with the max user_seq
/// it observed.
pub fn set_last_seen_user_seq(conn: &Connection, seq: i64) -> rusqlite::Result<()> {
    ensure_row(conn)?;
    conn.execute(
        "UPDATE sync_state SET last_seen_user_seq = ? WHERE id = 1",
        params![seq],
    )?;
    Ok(())
}

/// Record a successful sync round-trip. last_error is cleared so the
/// UI can show "all green" without inspecting timestamps.
pub fn mark_sync_ok(conn: &Connection, now_ms: i64) -> rusqlite::Result<()> {
    ensure_row(conn)?;
    conn.execute(
        "UPDATE sync_state SET last_sync_at_ms = ?, last_error = NULL WHERE id = 1",
        params![now_ms],
    )?;
    Ok(())
}

/// Record a sync failure. Last successful timestamp is preserved so
/// the UI can show "last green N minutes ago".
///
/// Also appends a row to `sync_error_history` so the status pill can
/// open a popover with the last N errors (kind + relative time +
/// message). The history table is capped at 50 rows — older entries
/// are pruned on insert so a long-running broken relay can't grow
/// the DB without bound.
pub fn mark_sync_error(conn: &Connection, msg: &str) -> rusqlite::Result<()> {
    ensure_row(conn)?;
    conn.execute(
        "UPDATE sync_state SET last_error = ? WHERE id = 1",
        params![msg],
    )?;
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    conn.execute(
        "INSERT INTO sync_error_history (error_at_ms, error_kind, error_message) \
         VALUES (?, ?, ?)",
        params![now_ms, classify_kind(msg), msg],
    )?;
    // Keep at most 50 rows. Subquery picks the 50 newest by id (id is
    // monotonic with error_at_ms because AUTOINCREMENT only advances).
    conn.execute(
        "DELETE FROM sync_error_history WHERE id NOT IN \
         (SELECT id FROM sync_error_history ORDER BY error_at_ms DESC LIMIT 50)",
        [],
    )?;
    Ok(())
}

/// Bucket an error string into a coarse kind for the popover icon /
/// label. Substring-match because the wire-error chain string-formats
/// the relay's classifier verbatim and we don't want to depend on a
/// specific WireError variant shape (rate-limit replies change format
/// between relay versions).
fn classify_kind(error: &str) -> &'static str {
    let lower = error.to_lowercase();
    if lower.contains("quota") || lower.contains("storage") {
        return "quota";
    }
    if lower.contains("429") || lower.contains("rate") {
        return "rate_limit";
    }
    if lower.contains("decrypt") {
        return "decrypt";
    }
    if lower.contains("connect") || lower.contains("timeout") || lower.contains("network") {
        return "network";
    }
    if lower.contains("401") || lower.contains("signature") || lower.contains("auth") {
        return "auth";
    }
    "other"
}

fn ensure_row(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO sync_state (id, last_seen_user_seq, enabled) VALUES (1, 0, 0)",
        [],
    )?;
    Ok(())
}

// ---------- sync_keys helpers ----------

/// Upsert a key row. Idempotent — re-running with the same role
/// overwrites. created_at is set to the caller-supplied epoch ms so
/// tests can be deterministic.
pub fn put_key(
    conn: &Connection,
    role: &str,
    data: &[u8],
    created_at_ms: i64,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO sync_keys (role, key_data, created_at) VALUES (?, ?, ?)
         ON CONFLICT(role) DO UPDATE SET key_data = excluded.key_data,
                                         created_at = excluded.created_at",
        params![role, data, created_at_ms],
    )?;
    Ok(())
}

/// Fetch a key row by role. Returns None if absent — fresh installs
/// see this for every role until enrollment writes them.
pub fn get_key(conn: &Connection, role: &str) -> rusqlite::Result<Option<Vec<u8>>> {
    conn.query_row(
        "SELECT key_data FROM sync_keys WHERE role = ?",
        params![role],
        |r| r.get::<_, Vec<u8>>(0),
    )
    .optional()
}

/// Remove a key row by role. Returns Ok(()) whether or not a row was
/// present — callers use this for idempotent cleanup (e.g. after
/// migrating a row out of `sync_keys` into the system keyring).
pub fn delete_key(conn: &Connection, role: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM sync_keys WHERE role = ?", params![role])?;
    Ok(())
}

// ---------- key-rotation epoch state (plan 3) ----------

fn epoch_secret_role(epoch: i64) -> String {
    format!("epoch_secret_{epoch}")
}

/// Persist the 32-byte secret for `epoch` (epoch >= 1) in `sync_keys`.
/// Epoch 0 has no secret row — it derives from the phrase keyring.
pub fn put_epoch_secret(conn: &Connection, epoch: i64, es: &[u8; 32]) -> rusqlite::Result<()> {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    put_key(conn, &epoch_secret_role(epoch), es, now_ms)
}

/// Load the stored epoch secret for `epoch`, if present.
pub fn get_epoch_secret(conn: &Connection, epoch: i64) -> rusqlite::Result<Option<[u8; 32]>> {
    Ok(get_key(conn, &epoch_secret_role(epoch))?.and_then(|b| {
        if b.len() == 32 {
            let mut es = [0u8; 32];
            es.copy_from_slice(&b);
            Some(es)
        } else {
            None
        }
    }))
}

/// The account's current key epoch (new ops are emitted under this).
/// Defaults to 0 on a fresh / pre-rotation DB.
pub fn get_current_epoch(conn: &Connection) -> rusqlite::Result<i64> {
    ensure_row(conn)?;
    conn.query_row(
        "SELECT current_epoch FROM sync_state WHERE id = 1",
        [],
        |r| r.get(0),
    )
}

/// Advance the current epoch. Monotonic: never moves backward.
pub fn set_current_epoch(conn: &Connection, epoch: i64) -> rusqlite::Result<()> {
    ensure_row(conn)?;
    conn.execute(
        "UPDATE sync_state SET current_epoch = ?1 WHERE id = 1 AND current_epoch < ?1",
        params![epoch],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::test_db;

    #[test]
    fn validate_relay_url_enforces_https_except_loopback() {
        // https is always fine.
        assert!(validate_relay_url("https://relay.example.com").is_ok());
        assert!(validate_relay_url("https://relay.example.com:8443/path").is_ok());
        // loopback http is allowed for local self-host / dev.
        assert!(validate_relay_url("http://127.0.0.1:8080").is_ok());
        assert!(validate_relay_url("http://localhost:1420").is_ok());
        assert!(validate_relay_url("  https://relay.example.com  ").is_ok());
        // plain http to a real host is rejected (security audit H1).
        assert!(validate_relay_url("http://relay.example.com").is_err());
        assert!(validate_relay_url("http://evil.example.com:8080/x").is_err());
        // non-http schemes and garbage are rejected.
        assert!(validate_relay_url("ftp://relay.example.com").is_err());
        assert!(validate_relay_url("relay.example.com").is_err());
        assert!(validate_relay_url("https://").is_err());
    }

    #[test]
    fn epoch_secret_and_current_epoch_round_trip() {
        let db = test_db();
        let conn = db.lock().unwrap();
        assert_eq!(get_current_epoch(&conn).unwrap(), 0);
        set_current_epoch(&conn, 2).unwrap();
        assert_eq!(get_current_epoch(&conn).unwrap(), 2);
        // Monotonic: a backward set is ignored.
        set_current_epoch(&conn, 1).unwrap();
        assert_eq!(get_current_epoch(&conn).unwrap(), 2);

        assert!(get_epoch_secret(&conn, 2).unwrap().is_none());
        let es = [5u8; 32];
        put_epoch_secret(&conn, 2, &es).unwrap();
        assert_eq!(get_epoch_secret(&conn, 2).unwrap().unwrap(), es);
    }

    #[test]
    fn set_relay_url_rejects_plain_http() {
        let db = test_db();
        let conn = db.lock().unwrap();
        assert!(set_relay_url(&conn, "http://relay.example.com").is_err());
        // and stores nothing on rejection.
        assert!(load(&conn).unwrap().relay_url.is_none());
    }

    #[test]
    fn load_on_fresh_db_returns_defaults_and_creates_row() {
        let db = test_db();
        let conn = db.lock().unwrap();
        let cfg = load(&conn).unwrap();
        assert!(cfg.relay_url.is_none());
        assert!(cfg.user_id.is_none());
        assert_eq!(cfg.last_seen_user_seq, 0);
        assert!(!cfg.enabled);
        assert!(!cfg.is_active());

        // Row now exists — a second load is idempotent.
        let cfg2 = load(&conn).unwrap();
        assert!(!cfg2.is_active());
    }

    #[test]
    fn enrollment_flow_makes_config_active() {
        let db = test_db();
        let conn = db.lock().unwrap();

        // Staging URL alone is not enough to be active.
        set_relay_url(&conn, "https://relay.example.com").unwrap();
        assert!(!load(&conn).unwrap().is_active());

        // Enrollment populates user_id + device_id but still gated by enabled.
        set_enrollment(&conn, "user-uuid", "device-uuid", 1_700_000_000_000).unwrap();
        let cfg = load(&conn).unwrap();
        assert_eq!(cfg.user_id.as_deref(), Some("user-uuid"));
        assert_eq!(cfg.device_id.as_deref(), Some("device-uuid"));
        assert!(!cfg.is_active());

        // Flipping the flag is the final step.
        set_enabled(&conn, true).unwrap();
        assert!(load(&conn).unwrap().is_active());

        // And it round-trips off.
        set_enabled(&conn, false).unwrap();
        assert!(!load(&conn).unwrap().is_active());
    }

    #[test]
    fn cursor_advance_and_sync_status_round_trip() {
        let db = test_db();
        let conn = db.lock().unwrap();
        set_last_seen_user_seq(&conn, 42).unwrap();
        assert_eq!(load(&conn).unwrap().last_seen_user_seq, 42);

        mark_sync_error(&conn, "boom").unwrap();
        assert_eq!(load(&conn).unwrap().last_error.as_deref(), Some("boom"));

        mark_sync_ok(&conn, 1_700_000_000_500).unwrap();
        let cfg = load(&conn).unwrap();
        assert_eq!(cfg.last_sync_at_ms, Some(1_700_000_000_500));
        assert!(cfg.last_error.is_none(), "ok wipes prior error");
    }

    #[test]
    fn put_and_get_key_round_trips_and_overwrites() {
        let db = test_db();
        let conn = db.lock().unwrap();

        assert!(get_key(&conn, ROLE_META_KEY).unwrap().is_none());

        let first = vec![1u8; 32];
        put_key(&conn, ROLE_META_KEY, &first, 1).unwrap();
        assert_eq!(get_key(&conn, ROLE_META_KEY).unwrap().as_deref(), Some(&first[..]));

        // Re-writing the same role overwrites — important for re-derivation flows.
        let second = vec![2u8; 32];
        put_key(&conn, ROLE_META_KEY, &second, 2).unwrap();
        assert_eq!(get_key(&conn, ROLE_META_KEY).unwrap().as_deref(), Some(&second[..]));
    }
}
