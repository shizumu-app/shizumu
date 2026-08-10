use crate::db::Db;
use rusqlite::params;
use tauri::{AppHandle, Manager};
use zbus::interface;

pub struct KRunnerPlugin {
    app_handle: AppHandle,
    db: Db,
}

impl KRunnerPlugin {
    pub fn new(app_handle: AppHandle, db: Db) -> Self {
        Self { app_handle, db }
    }
}

// KRunner match tuple: (id, text, icon_name, type, relevance)
// type: 100 = ExactMatch, 50 = PossibleMatch, 30 = InformationalMatch
type KRunnerMatch = (String, String, String, i32, f64);

// KRunner action tuple: (id, text, icon_name)
type KRunnerAction = (String, String, String);

#[interface(name = "org.kde.krunner1")]
impl KRunnerPlugin {
    #[zbus(name = "Actions")]
    async fn actions(&self) -> zbus::fdo::Result<Vec<KRunnerAction>> {
        Ok(vec![(
            "open".to_string(),
            "open page".to_string(),
            "app.shizumu.Shizumu".to_string(),
        )])
    }

    #[zbus(name = "Match")]
    async fn match_query(&self, query: String) -> zbus::fdo::Result<Vec<KRunnerMatch>> {
        // Only respond to queries that start with "shizumu" or "sz"
        let search_term = if let Some(rest) = query.strip_prefix("shizumu ") {
            rest.trim().to_string()
        } else if let Some(rest) = query.strip_prefix("sz ") {
            rest.trim().to_string()
        } else {
            return Ok(vec![]);
        };

        if search_term.is_empty() {
            return Ok(vec![]);
        }

        let conn = self.db.lock().map_err(|e| {
            zbus::fdo::Error::Failed(format!("database lock error: {e}"))
        })?;

        let fts_query = format!("\"{}\"", search_term.replace('"', "\"\""));

        let mut stmt = conn
            .prepare(
                "SELECT p.id, p.date, p.page_number, p.what_matters_now \
                 FROM pages_fts AS f \
                 JOIN pages AS p ON p.id = f.page_id \
                 WHERE pages_fts MATCH ?1 \
                 ORDER BY rank \
                 LIMIT 10",
            )
            .map_err(|e| zbus::fdo::Error::Failed(format!("query error: {e}")))?;

        let matches: Vec<KRunnerMatch> = stmt
            .query_map(params![&fts_query], |row| {
                let id: String = row.get(0)?;
                let date: String = row.get(1)?;
                let page_num: i64 = row.get(2)?;
                let wmn: Option<String> = row.get(3)?;
                let text = match wmn {
                    Some(w) if !w.is_empty() => format!("{date} #{page_num} - {w}"),
                    _ => format!("{date} #{page_num}"),
                };
                Ok((
                    id,
                    text,
                    "app.shizumu.Shizumu".to_string(),
                    50i32, // PossibleMatch
                    0.8f64,
                ))
            })
            .map_err(|e| zbus::fdo::Error::Failed(format!("query error: {e}")))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| zbus::fdo::Error::Failed(format!("row error: {e}")))?;

        Ok(matches)
    }

    #[zbus(name = "Run")]
    async fn run(&self, match_id: String, _action_id: String) -> zbus::fdo::Result<()> {
        if let Some(window) = self.app_handle.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
            let _ = window.eval(&format!(
                "window.__shizumu_navigate_to_page?.('{}')",
                match_id.replace('\'', "\\'")
            ));
        }
        Ok(())
    }
}

pub fn create_krunner_plugin(app_handle: AppHandle, db: Db) -> KRunnerPlugin {
    KRunnerPlugin::new(app_handle, db)
}
