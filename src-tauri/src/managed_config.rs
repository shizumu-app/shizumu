use serde::Deserialize;
use std::path::Path;

#[cfg(target_os = "linux")]
const SYSTEM_CONFIG_PATH: &str = "/etc/shizumu/config.json";

#[cfg(target_os = "macos")]
const SYSTEM_CONFIG_PATH: &str = "/Library/Application Support/app.shizumu.Shizumu/config.json";

#[cfg(target_os = "windows")]
const SYSTEM_CONFIG_PATH: &str = "C:\\ProgramData\\shizumu\\config.json";

#[derive(Debug, Deserialize, Default)]
#[allow(dead_code)]
pub struct ManagedConfig {
    /// Default theme: "cream", "white", or "dark"
    pub default_theme: Option<String>,
    /// Lock timeout in minutes (0 = never)
    pub lock_timeout_minutes: Option<u32>,
    /// Policies that cannot be overridden by the user
    #[serde(default)]
    pub forced_policies: ForcedPolicies,
}

#[derive(Debug, Deserialize, Default)]
#[allow(dead_code)]
pub struct ForcedPolicies {
    /// If set, user cannot change the theme
    pub theme: Option<String>,
    /// If set, user cannot change lock timeout
    pub lock_timeout_minutes: Option<u32>,
}

impl ManagedConfig {
    /// Load system-wide managed config from /etc/shizumu/config.json.
    /// Returns default (empty) config if the file does not exist or is unreadable.
    pub fn load() -> Self {
        Self::load_from(Path::new(SYSTEM_CONFIG_PATH))
    }

    fn load_from(path: &Path) -> Self {
        if !path.exists() {
            return Self::default();
        }

        match std::fs::read_to_string(path) {
            Ok(contents) => match serde_json::from_str(&contents) {
                Ok(config) => {
                    log::info!("loaded managed config from {}", path.display());
                    config
                }
                Err(e) => {
                    log::warn!(
                        "failed to parse managed config at {}: {e}",
                        path.display()
                    );
                    Self::default()
                }
            },
            Err(e) => {
                log::warn!(
                    "failed to read managed config at {}: {e}",
                    path.display()
                );
                Self::default()
            }
        }
    }

    /// Apply managed defaults to the database settings.
    /// User settings take precedence unless a forced policy overrides them.
    pub fn apply(&self, db: &crate::db::Db) {
        let conn = match db.lock() {
            Ok(c) => c,
            Err(e) => {
                log::warn!("failed to lock db for managed config: {e}");
                return;
            }
        };

        // Apply default_theme if user hasn't set one. The app reads the
        // canvas tone from the "canvas_tone" settings key (App.svelte,
        // Settings.svelte) — writing a "theme" row here was silently dead.
        if let Some(ref theme) = self.default_theme {
            set_default_setting(&conn, "canvas_tone", theme);
        }

        // Apply default lock_timeout_minutes if user hasn't set one
        if let Some(timeout) = self.lock_timeout_minutes {
            set_default_setting(&conn, "lock_timeout_minutes", &timeout.to_string());
        }

        // Apply forced policies (these always override user settings)
        if let Some(ref theme) = self.forced_policies.theme {
            force_setting(&conn, "canvas_tone", theme);
        }

        if let Some(timeout) = self.forced_policies.lock_timeout_minutes {
            force_setting(&conn, "lock_timeout_minutes", &timeout.to_string());
        }
    }
}

/// Set a setting only if it doesn't already exist (user default)
fn set_default_setting(conn: &rusqlite::Connection, key: &str, value: &str) {
    let existing: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            rusqlite::params![key],
            |row| row.get(0),
        )
        .ok();

    if existing.is_none() {
        let _ = conn.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)",
            rusqlite::params![key, value],
        );
    }
}

/// Force a setting regardless of user preference
fn force_setting(conn: &rusqlite::Connection, key: &str, value: &str) {
    let _ = conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        rusqlite::params![key, value],
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config_when_no_file() {
        let config = ManagedConfig::load_from(Path::new("/nonexistent/path/config.json"));
        assert!(config.default_theme.is_none());
        assert!(config.lock_timeout_minutes.is_none());
        assert!(config.forced_policies.theme.is_none());
    }
}
