use crate::db::Db;
use tauri::{AppHandle, Manager};
use zbus::interface;

pub struct ShizumuDbusService {
    app_handle: AppHandle,
    db: Db,
}

#[interface(name = "app.shizumu.Shizumu")]
impl ShizumuDbusService {
    async fn show_window(&self) -> zbus::fdo::Result<()> {
        if let Some(window) = self.app_handle.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
        Ok(())
    }

    async fn new_page(&self) -> zbus::fdo::Result<()> {
        if let Some(window) = self.app_handle.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
            let _ = window.eval("window.__shizumu_new_page?.()");
        }
        Ok(())
    }

    async fn export_pages(&self, format: String, path: String) -> zbus::fdo::Result<()> {
        let conn = self.db.lock().map_err(|e| {
            zbus::fdo::Error::Failed(format!("database lock error: {e}"))
        })?;

        let mut stmt = conn
            .prepare("SELECT id, date, page_number, what_matters_now, what_shifted, content_json FROM pages ORDER BY date ASC, page_number ASC")
            .map_err(|e| zbus::fdo::Error::Failed(format!("query error: {e}")))?;

        let rows: Vec<(String, String, i64, Option<String>, Option<String>, Option<String>)> = stmt
            .query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            })
            .map_err(|e| zbus::fdo::Error::Failed(format!("query error: {e}")))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| zbus::fdo::Error::Failed(format!("row error: {e}")))?;

        let output = match format.as_str() {
            "json" => {
                let pages: Vec<serde_json::Value> = rows
                    .iter()
                    .map(|(id, date, num, wmn, ws, content)| {
                        serde_json::json!({
                            "id": id,
                            "date": date,
                            "page_number": num,
                            "what_matters_now": wmn,
                            "what_shifted": ws,
                            "content": content,
                        })
                    })
                    .collect();
                serde_json::to_string_pretty(&pages)
                    .map_err(|e| zbus::fdo::Error::Failed(format!("json error: {e}")))?
            }
            "txt" | _ => {
                let mut out = String::new();
                for (_, date, num, wmn, ws, content) in &rows {
                    out.push_str(&format!("--- {date} #{num} ---\n"));
                    if let Some(w) = wmn {
                        out.push_str(&format!("what matters now: {w}\n"));
                    }
                    if let Some(c) = content {
                        out.push_str(c);
                        out.push('\n');
                    }
                    if let Some(s) = ws {
                        out.push_str(&format!("what shifted: {s}\n"));
                    }
                    out.push('\n');
                }
                out
            }
        };

        std::fs::write(&path, output)
            .map_err(|e| zbus::fdo::Error::Failed(format!("write error: {e}")))?;

        Ok(())
    }

    async fn get_status(&self) -> zbus::fdo::Result<(u32, String)> {
        let conn = self.db.lock().map_err(|e| {
            zbus::fdo::Error::Failed(format!("database lock error: {e}"))
        })?;

        let page_count: u32 = conn
            .query_row("SELECT COUNT(*) FROM pages", [], |row| row.get(0))
            .unwrap_or(0);

        let last_written: String = conn
            .query_row(
                "SELECT updated_at FROM pages ORDER BY updated_at DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .unwrap_or_else(|_| "never".to_string());

        Ok((page_count, last_written))
    }
}

pub async fn start_dbus_service(app_handle: AppHandle, db: Db) -> Result<(), zbus::Error> {
    let service = ShizumuDbusService {
        app_handle: app_handle.clone(),
        db: db.clone(),
    };

    let search_provider =
        crate::gnome_search::create_search_provider(app_handle.clone(), db.clone());
    let krunner_plugin = crate::krunner::create_krunner_plugin(app_handle, db);

    let _conn = zbus::connection::Builder::session()?
        .name("app.shizumu.Shizumu")?
        .serve_at("/app/shizumu/Shizumu", service)?
        .serve_at("/app/shizumu/Shizumu/SearchProvider", search_provider)?
        .serve_at("/app/shizumu/Shizumu/KRunner", krunner_plugin)?
        .build()
        .await?;

    // Keep the connection alive — pending() never resolves, so the
    // task (and the zbus connection it owns) stays alive forever.
    std::future::pending::<()>().await;
    unreachable!()
}
