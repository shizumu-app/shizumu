use crate::db::Db;
use rusqlite::params;
use std::collections::HashMap;
use tauri::{AppHandle, Manager};
use zbus::interface;
use zbus::zvariant::Value;

pub struct GnomeSearchProvider {
    app_handle: AppHandle,
    db: Db,
}

impl GnomeSearchProvider {
    pub fn new(app_handle: AppHandle, db: Db) -> Self {
        Self { app_handle, db }
    }

    fn search_pages(&self, terms: &[String]) -> Vec<String> {
        let query = terms.join(" ");
        if query.is_empty() {
            return vec![];
        }

        let conn = match self.db.lock() {
            Ok(c) => c,
            Err(_) => return vec![],
        };

        // Use FTS5 to search
        let fts_query = terms
            .iter()
            .map(|t| format!("\"{}\"", t.replace('"', "\"\"")))
            .collect::<Vec<_>>()
            .join(" ");

        let mut stmt = match conn.prepare(
            "SELECT page_id FROM pages_fts WHERE pages_fts MATCH ?1 ORDER BY rank LIMIT 20",
        ) {
            Ok(s) => s,
            Err(_) => return vec![],
        };

        stmt.query_map(params![&fts_query], |row| row.get::<_, String>(0))
            .ok()
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .unwrap_or_default()
    }
}

#[interface(name = "org.gnome.Shell.SearchProvider2")]
impl GnomeSearchProvider {
    #[zbus(name = "GetInitialResultSet")]
    async fn get_initial_result_set(&self, terms: Vec<String>) -> zbus::fdo::Result<Vec<String>> {
        Ok(self.search_pages(&terms))
    }

    #[zbus(name = "GetSubsearchResultSet")]
    async fn get_subsearch_result_set(
        &self,
        _previous_results: Vec<String>,
        terms: Vec<String>,
    ) -> zbus::fdo::Result<Vec<String>> {
        Ok(self.search_pages(&terms))
    }

    #[zbus(name = "GetResultMetas")]
    async fn get_result_metas(
        &self,
        ids: Vec<String>,
    ) -> zbus::fdo::Result<Vec<HashMap<String, Value<'_>>>> {
        let conn = self.db.lock().map_err(|e| {
            zbus::fdo::Error::Failed(format!("database lock error: {e}"))
        })?;

        let mut results = Vec::new();

        for id in &ids {
            let meta: Option<(String, i64, Option<String>)> = conn
                .query_row(
                    "SELECT date, page_number, what_matters_now FROM pages WHERE id = ?1",
                    params![id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .ok();

            if let Some((date, page_num, wmn)) = meta {
                let mut map = HashMap::new();
                map.insert("id".to_string(), Value::from(id.clone()));
                map.insert(
                    "name".to_string(),
                    Value::from(format!("{date} #{page_num}")),
                );
                let desc = wmn.unwrap_or_default();
                map.insert("description".to_string(), Value::from(desc));
                map.insert(
                    "gicon".to_string(),
                    Value::from("app.shizumu.Shizumu".to_string()),
                );
                results.push(map);
            }
        }

        Ok(results)
    }

    #[zbus(name = "ActivateResult")]
    async fn activate_result(
        &self,
        id: String,
        _terms: Vec<String>,
        _timestamp: u32,
    ) -> zbus::fdo::Result<()> {
        if let Some(window) = self.app_handle.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
            let _ = window.eval(&format!(
                "window.__shizumu_navigate_to_page?.('{}')",
                id.replace('\'', "\\'")
            ));
        }
        Ok(())
    }

    #[zbus(name = "LaunchSearch")]
    async fn launch_search(
        &self,
        terms: Vec<String>,
        _timestamp: u32,
    ) -> zbus::fdo::Result<()> {
        if let Some(window) = self.app_handle.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
            let query = terms.join(" ").replace('\'', "\\'");
            let _ = window.eval(&format!(
                "window.__shizumu_open_search?.('{query}')"
            ));
        }
        Ok(())
    }
}

pub fn create_search_provider(app_handle: AppHandle, db: Db) -> GnomeSearchProvider {
    GnomeSearchProvider::new(app_handle, db)
}
