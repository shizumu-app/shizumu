use rusqlite::{params, Connection};
use serde::Serialize;
use std::io::Write;
use std::path::Path;

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

pub fn backup_database(db_path: &Path, output_path: &Path) -> Result<(), String> {
    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| format!("failed to open database for backup: {e}"))?;

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
