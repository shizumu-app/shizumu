use rusqlite::{params, Connection};
use serde::Serialize;
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy)]
pub enum ExportFormat {
    Markdown,
    Json,
    Text,
}

impl ExportFormat {
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s.to_lowercase().as_str() {
            "md" | "markdown" => Ok(Self::Markdown),
            "json" => Ok(Self::Json),
            "txt" | "text" => Ok(Self::Text),
            other => Err(format!("unknown export format: {other}")),
        }
    }

    pub fn extension(&self) -> &str {
        match self {
            Self::Markdown => "md",
            Self::Json => "json",
            Self::Text => "txt",
        }
    }
}

#[derive(Debug, Serialize)]
struct ExportPage {
    id: String,
    date: String,
    page_number: i64,
    what_matters_now: Option<String>,
    what_shifted: Option<String>,
    created_at: String,
    lines: Vec<ExportLine>,
}

#[derive(Debug, Serialize)]
struct ExportLine {
    position: i64,
    text: String,
    state: String,
}

fn load_page_for_export(conn: &Connection, page_id: &str) -> Result<ExportPage, String> {
    let page = conn
        .query_row(
            "SELECT id, date, page_number, what_matters_now, what_shifted, created_at FROM pages WHERE id = ?",
            params![page_id],
            |row| {
                Ok(ExportPage {
                    id: row.get(0)?,
                    date: row.get(1)?,
                    page_number: row.get(2)?,
                    what_matters_now: row.get(3)?,
                    what_shifted: row.get(4)?,
                    created_at: row.get(5)?,
                    lines: Vec::new(),
                })
            },
        )
        .map_err(|e| format!("failed to load page {page_id}: {e}"))?;

    let mut stmt = conn
        .prepare("SELECT position, text, state FROM lines WHERE page_id = ? ORDER BY position ASC")
        .map_err(|e| e.to_string())?;

    let lines: Vec<ExportLine> = stmt
        .query_map(params![page_id], |row| {
            Ok(ExportLine {
                position: row.get(0)?,
                text: row.get(1)?,
                state: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(ExportPage { lines, ..page })
}

pub fn export_page_markdown(conn: &Connection, page_id: &str) -> Result<String, String> {
    let page = load_page_for_export(conn, page_id)?;
    let mut out = String::new();

    out.push_str(&format!("# {} (page {})\n\n", page.date, page.page_number));

    if let Some(ref wmn) = page.what_matters_now {
        if !wmn.is_empty() {
            out.push_str(&format!("**what matters now:** {wmn}\n\n"));
        }
    }

    out.push_str("---\n\n");

    for line in &page.lines {
        match line.state.as_str() {
            "struck" => out.push_str(&format!("~~{}~~\n", line.text)),
            "open" => out.push_str(&format!("{} --\n", line.text)),
            _ => out.push_str(&format!("{}\n", line.text)),
        }
    }

    if let Some(ref ws) = page.what_shifted {
        if !ws.is_empty() {
            out.push_str(&format!("\n---\n\n**what shifted:** {ws}\n"));
        }
    }

    Ok(out)
}

pub fn export_page_json(conn: &Connection, page_id: &str) -> Result<String, String> {
    let page = load_page_for_export(conn, page_id)?;
    serde_json::to_string_pretty(&page).map_err(|e| format!("json serialization error: {e}"))
}

pub fn export_page_text(conn: &Connection, page_id: &str) -> Result<String, String> {
    let page = load_page_for_export(conn, page_id)?;
    let mut out = String::new();

    for line in &page.lines {
        out.push_str(&line.text);
        out.push('\n');
    }

    Ok(out)
}

/// Export all matching pages into a single zip file at `zip_path`.
/// Returns the number of pages written.
/// Resolve a save-dialog result to a filesystem path we can hand to
/// `std::fs`.
///
/// The dialog returns `FilePath`, which the fs plugin documents as "either
/// a filesystem path or a URI pointing to a file such as `file://` URIs or
/// Android `content://` URIs". Both call sites used `as_path()`, which is
/// `None` for the `Url` variant *by contract*:
///
/// ```text
/// pub fn as_path(&self) -> Option<&Path> {
///     match self { Self::Url(_) => None, Self::Path(p) => Some(p) }
/// }
/// ```
///
/// On Android the SAF always returns a `content://` URI, so export and
/// database backup failed with "invalid file path" every single time — not
/// a regression, they never worked there. Android no longer takes this path
/// at all (see `export_pages_gui`); it stages the file and hands it to the
/// share sheet.
///
/// Desktop still needs this, though, because a portal-backed GTK dialog can
/// return a `file://` URL rather than a bare path, and `as_path()` would
/// have said `None` for that too. `into_path()` converts it; anything that
/// is neither becomes a message naming what came back instead of the
/// uniformly unhelpful "invalid file path".
pub fn dialog_save_path(picked: tauri_plugin_dialog::FilePath) -> Result<PathBuf, String> {
    match picked {
        tauri_plugin_dialog::FilePath::Path(p) => Ok(p),
        other => {
            let shown = other.to_string();
            other
                .into_path()
                .map_err(|_| format!("the file picker returned {shown}, which cannot be written to directly"))
        }
    }
}

pub fn export_pages(
    conn: &Connection,
    format: ExportFormat,
    from: Option<&str>,
    to: Option<&str>,
    zip_path: &Path,
) -> Result<usize, String> {
    // Build query dynamically based on date filters
    let mut sql = String::from("SELECT id, date, page_number FROM pages WHERE 1=1");
    let mut bind_values: Vec<String> = Vec::new();

    if let Some(f) = from {
        sql.push_str(" AND date >= ?");
        bind_values.push(f.to_string());
    }
    if let Some(t) = to {
        sql.push_str(" AND date <= ?");
        bind_values.push(t.to_string());
    }
    sql.push_str(" ORDER BY date, page_number");

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = bind_values
        .iter()
        .map(|v| v as &dyn rusqlite::types::ToSql)
        .collect();

    let rows: Vec<(String, String, i64)> = stmt
        .query_map(param_refs.as_slice(), |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let file = std::fs::File::create(zip_path)
        .map_err(|e| format!("failed to create zip file: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let mut count = 0;

    for (page_id, date, page_number) in &rows {
        let content = match format {
            ExportFormat::Markdown => export_page_markdown(conn, page_id)?,
            ExportFormat::Json => export_page_json(conn, page_id)?,
            ExportFormat::Text => export_page_text(conn, page_id)?,
        };

        let entry_name = format!("{}-p{}.{}", date, page_number, format.extension());
        zip.start_file(&entry_name, options)
            .map_err(|e| format!("zip entry error for {entry_name}: {e}"))?;
        zip.write_all(content.as_bytes())
            .map_err(|e| format!("zip write error for {entry_name}: {e}"))?;

        count += 1;
    }

    zip.finish().map_err(|e| format!("zip finalize error: {e}"))?;

    Ok(count)
}

/// Back up by path: for the CLI, which has no open connection of its own.
/// Opens the file without a key, so it cannot back up an encrypted database;
/// the app backs up through its own connection instead (`backup_from`).
pub fn backup_database(db_path: &Path, output_path: &Path) -> Result<(), String> {
    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| format!("failed to open database for backup: {e}"))?;
    backup_from(&conn, output_path)
}

/// Copy the open database to `output_path`, whole and consistent. Through
/// the connection the app already holds, so an encrypted database (whose key
/// that connection has) backs up too, and the copy keeps its passphrase.
/// Until 2026-10-15 the app reopened the file without a key here, so a
/// writer who turned encryption on had no working backup.
pub fn backup_from(conn: &rusqlite::Connection, output_path: &Path) -> Result<(), String> {
    conn.execute_batch(&format!(
        "VACUUM INTO '{}';",
        output_path.display().to_string().replace('\'', "''")
    ))
    .map_err(|e| format!("backup failed: {e}"))?;
    Ok(())
}

pub struct StatusInfo {
    pub page_count: i64,
    pub word_count: i64,
    pub last_written_date: Option<String>,
}

pub fn get_status(conn: &Connection) -> Result<StatusInfo, String> {
    let page_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM pages", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let word_count: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(LENGTH(text) - LENGTH(REPLACE(text, ' ', '')) + 1), 0) FROM lines WHERE LENGTH(TRIM(text)) > 0",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let last_written_date: Option<String> = conn
        .query_row(
            "SELECT date FROM pages ORDER BY date DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .ok();

    Ok(StatusInfo {
        page_count,
        word_count,
        last_written_date,
    })
}

pub struct SearchResult {
    pub page_id: String,
    pub date: String,
    pub page_number: i64,
    pub snippet: String,
}

pub fn search_fts(conn: &Connection, query: &str) -> Result<Vec<SearchResult>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT p.id, p.date, p.page_number, snippet(pages_fts, 0, '>>>', '<<<', '...', 32) \
             FROM pages_fts \
             JOIN pages p ON p.id = pages_fts.rowid \
             WHERE pages_fts MATCH ? \
             ORDER BY rank \
             LIMIT 50",
        )
        .map_err(|e| e.to_string())?;

    let results: Vec<SearchResult> = stmt
        .query_map(params![query], |row| {
            Ok(SearchResult {
                page_id: row.get(0)?,
                date: row.get(1)?,
                page_number: row.get(2)?,
                snippet: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(results)
}

#[cfg(test)]
mod dialog_path_tests {
    use super::dialog_save_path;
    use std::str::FromStr;
    use tauri_plugin_dialog::FilePath;

    /// The reported Android bug, stated as a decision.
    ///
    /// `export_pages_gui` and `backup_database_gui` both did
    /// `picked.as_path().ok_or("invalid file path")`, and `as_path()` is
    /// documented to return None for the `Url` variant. Android's SAF
    /// returns nothing but `content://` URIs, so both commands failed 100%
    /// of the time there — not a regression, they never worked.
    ///
    /// Android no longer reaches this function (it stages and shares), but
    /// this case must still produce a message that names what came back
    /// rather than the uniformly unhelpful "invalid file path" — a desktop
    /// picker on some future platform could hand us one too.
    #[test]
    fn a_content_uri_is_refused_with_a_message_that_names_it() {
        let picked = FilePath::from_str("content://com.android.providers/document/1234").unwrap();
        let err = dialog_save_path(picked).expect_err("a content URI is not writable");
        assert!(
            err.contains("content://"),
            "the error must show what the picker actually returned: {err}"
        );
    }

    /// The regression this function exists to prevent on DESKTOP: a
    /// portal-backed GTK save dialog can return `file:///…` rather than a
    /// bare path, and `as_path()` answers None for that too — so the old
    /// code would have failed with "invalid file path" on a perfectly
    /// writable location. Not a no-op assertion: it converts.
    #[test]
    fn a_file_url_converts_to_the_path_it_names() {
        let picked = FilePath::from_str("file:///tmp/shizumu-export.zip").unwrap();
        let path = dialog_save_path(picked).expect("a file:// URL is writable");
        assert_eq!(path.to_str(), Some("/tmp/shizumu-export.zip"));
    }

    /// The ordinary desktop case stays untouched.
    #[test]
    fn a_plain_path_passes_through() {
        let picked = FilePath::from(std::path::PathBuf::from("/tmp/shizumu-export.zip"));
        assert_eq!(
            dialog_save_path(picked).unwrap(),
            std::path::PathBuf::from("/tmp/shizumu-export.zip")
        );
    }
}

#[cfg(test)]
mod backup_tests {
    use super::backup_from;

    fn temp_dir() -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("shizumu-backup-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn a_backup_opens_and_holds_every_page() {
        let dir = temp_dir();
        let conn = rusqlite::Connection::open(dir.join("settles.db")).unwrap();
        conn.execute_batch("CREATE TABLE pages (id TEXT, content_json TEXT);
            INSERT INTO pages VALUES ('p1', 'the kitchen'), ('p2', 'lisbon');").unwrap();
        let out = dir.join("backup.db");
        backup_from(&conn, &out).unwrap();
        let copy = rusqlite::Connection::open(&out).unwrap();
        let n: i64 = copy.query_row("SELECT count(*) FROM pages", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 2);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn an_encrypted_database_backs_up_and_stays_encrypted() {
        // The backup used to open the file again with no key, so on an
        // encrypted database it failed every time. It reads through the
        // app's own connection now; the copy keeps the same passphrase.
        let dir = temp_dir();
        let conn = crate::crypto::open_encrypted(&dir.join("settles.db"), "the right one").unwrap();
        conn.execute_batch("CREATE TABLE pages (id TEXT, content_json TEXT);
            INSERT INTO pages VALUES ('p1', 'the kitchen');").unwrap();
        let out = dir.join("backup.db");
        backup_from(&conn, &out).unwrap();
        assert!(crate::crypto::check_db_encrypted(&out), "the copy is not readable without the passphrase");
        let copy = crate::crypto::open_encrypted(&out, "the right one").unwrap();
        let v: String = copy.query_row("SELECT content_json FROM pages", [], |r| r.get(0)).unwrap();
        assert_eq!(v, "the kitchen");
        std::fs::remove_dir_all(dir).ok();
    }
}
