use clap::{Parser, Subcommand};
use rusqlite::{params, Connection};
use serde::Deserialize;
use std::io::{self, Write};
use std::path::PathBuf;

// Import shared export logic from the library crate
use shizumu_lib::export::{self, ExportFormat};

/// shizumu CLI — query, export, and back up your writing database
#[derive(Parser)]
#[command(name = "shizumu", version, about)]
struct Cli {
    /// Path to the database file (default: ~/.local/share/app.shizumu.Shizumu/settles.db)
    #[arg(long, global = true)]
    db: Option<PathBuf>,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Export pages as individual files
    Export {
        /// Output format: md, json, or txt
        #[arg(long, default_value = "md")]
        format: String,

        /// Start date (YYYY-MM-DD)
        #[arg(long)]
        from: Option<String>,

        /// End date (YYYY-MM-DD)
        #[arg(long)]
        to: Option<String>,

        /// Output directory
        #[arg(long, default_value = ".")]
        output: PathBuf,
    },

    /// Create a safe backup copy of the database
    Backup {
        /// Output file path for the backup
        #[arg(long)]
        output: Option<PathBuf>,
    },

    /// Show database status: page count, word count, last written date
    Status,

    /// Full-text search across all pages
    Search {
        /// Search query
        query: String,
    },

    /// Seed the database with demo content from a JSON file (for screenshots)
    Seed {
        /// Path to the seed JSON file
        #[arg(long)]
        from: PathBuf,

        /// Insert even if pages already exist (will not delete, only append)
        #[arg(long, default_value_t = false)]
        force: bool,
    },
}

#[derive(Deserialize)]
struct Seed {
    #[serde(default)]
    trails: Vec<SeedTrail>,
    #[serde(default)]
    pages: Vec<SeedPage>,
    #[serde(default)]
    pins: Vec<SeedPin>,
}

#[derive(Deserialize)]
struct SeedTrail {
    slug: String,
    name: String,
    #[serde(default = "default_mode")]
    mode: String,
    #[serde(default)]
    parent: Option<String>,
}

fn default_mode() -> String {
    "discrete".to_string()
}

#[derive(Deserialize)]
struct SeedPage {
    /// "today", "-1d", "-7d", or ISO "YYYY-MM-DD"
    date: String,
    #[serde(default)]
    trail: Option<String>,
    #[serde(default = "default_page_number")]
    page_number: i64,
    #[serde(default)]
    what_matters_now: Option<String>,
    /// Plain text — split on blank lines into paragraphs and wrapped in a TipTap doc.
    /// Mutually exclusive with `doc`; if both are given, `doc` wins.
    #[serde(default)]
    content: Option<String>,
    /// Full TipTap doc JSON, inserted verbatim. Use for structured demos
    /// (mixed lists, mentions, pinned blocks, day markers).
    #[serde(default)]
    doc: Option<serde_json::Value>,
}

fn default_page_number() -> i64 { 1 }

#[derive(Deserialize)]
struct SeedPin {
    /// Optional stable id — when set, the shared_objects row uses this and the
    /// source page's content_json can reference it via `pinId` so the in-page
    /// pinned block and the panel pin are the same object.
    #[serde(default)]
    id: Option<String>,
    /// Match the page by its `date` so we can resolve to a real page id
    page_date: String,
    #[serde(default = "default_pin_kind")]
    kind: String,
    label: String,
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    trail: Option<String>,
}

fn default_pin_kind() -> String { "note".to_string() }

fn default_db_path() -> PathBuf {
    let data_dir = data_dir().unwrap_or_else(|| PathBuf::from("."));
    data_dir.join("app.shizumu.Shizumu").join("settles.db")
}

/// Resolve platform-appropriate data directory
fn data_dir() -> Option<PathBuf> {
    #[cfg(target_os = "linux")]
    {
        if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
            return Some(PathBuf::from(xdg));
        }
        if let Ok(home) = std::env::var("HOME") {
            return Some(PathBuf::from(home).join(".local").join("share"));
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            return Some(PathBuf::from(home).join("Library").join("Application Support"));
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("LOCALAPPDATA") {
            return Some(PathBuf::from(appdata));
        }
    }
    None
}

fn open_database(path: &PathBuf) -> Result<Connection, String> {
    if !path.exists() {
        // Create the file + run migrations so seed can bootstrap a fresh DB
        // (handy for CI/automation; matches what `tauri dev` does on first launch).
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                format!("failed to create data dir {}: {e}", parent.display())
            })?;
        }
        let db = shizumu_lib::db::init_db(
            path.parent().unwrap_or(std::path::Path::new(".")).to_path_buf(),
            None,
        )?;
        // init_db returns Arc<Mutex<Connection>>; we need a fresh owned Connection.
        // Drop it so we can reopen below (it released the file handle on drop).
        drop(db);
    }

    // Try unencrypted first
    match Connection::open(path) {
        Ok(conn) => {
            match conn.execute_batch("SELECT count(*) FROM sqlite_master;") {
                Ok(_) => return Ok(conn),
                Err(_) => {
                    // Might be encrypted — prompt for passphrase
                    drop(conn);
                }
            }
        }
        Err(e) => return Err(format!("failed to open database: {e}")),
    }

    // Database is encrypted — prompt for passphrase
    eprint!("database is encrypted. passphrase: ");
    io::stderr().flush().ok();

    let mut passphrase = String::new();
    io::stdin()
        .read_line(&mut passphrase)
        .map_err(|e| format!("failed to read passphrase: {e}"))?;
    let passphrase = passphrase.trim();

    let conn = Connection::open(path).map_err(|e| format!("failed to open database: {e}"))?;
    conn.pragma_update(None, "key", passphrase)
        .map_err(|e| format!("failed to set encryption key: {e}"))?;
    conn.execute_batch("SELECT count(*) FROM sqlite_master;")
        .map_err(|e| format!("wrong passphrase or corrupt database: {e}"))?;

    Ok(conn)
}

fn main() {
    let cli = Cli::parse();
    let db_path = cli.db.unwrap_or_else(default_db_path);

    let result = match cli.command {
        Commands::Export {
            format,
            from,
            to,
            output,
        } => run_export(&db_path, &format, from.as_deref(), to.as_deref(), &output),
        Commands::Backup { output } => run_backup(&db_path, output),
        Commands::Status => run_status(&db_path),
        Commands::Search { query } => run_search(&db_path, &query),
        Commands::Seed { from, force } => run_seed(&db_path, &from, force),
    };

    if let Err(e) = result {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}

fn run_export(
    db_path: &PathBuf,
    format: &str,
    from: Option<&str>,
    to: Option<&str>,
    output: &PathBuf,
) -> Result<(), String> {
    let fmt = ExportFormat::from_str(format)?;
    let conn = open_database(db_path)?;
    let count = export::export_pages(&conn, fmt, from, to, output.as_path())?;
    println!("exported {count} pages to {}", output.display());
    Ok(())
}

fn run_backup(db_path: &PathBuf, output: Option<PathBuf>) -> Result<(), String> {
    let output_path = output.unwrap_or_else(|| {
        let now = chrono::Local::now().format("%Y%m%d-%H%M%S");
        PathBuf::from(format!("shizumu-backup-{now}.db"))
    });

    export::backup_database(db_path.as_path(), output_path.as_path())?;
    println!("backup saved to {}", output_path.display());
    Ok(())
}

fn run_status(db_path: &PathBuf) -> Result<(), String> {
    let conn = open_database(db_path)?;
    let status = export::get_status(&conn)?;

    println!("pages: {}", status.page_count);
    println!("words: ~{}", status.word_count);
    match status.last_written_date {
        Some(date) => println!("last written: {date}"),
        None => println!("last written: (none)"),
    }

    Ok(())
}

fn run_search(db_path: &PathBuf, query: &str) -> Result<(), String> {
    let conn = open_database(db_path)?;
    let results = export::search_fts(&conn, query)?;

    if results.is_empty() {
        println!("no results for \"{query}\"");
        return Ok(());
    }

    for result in &results {
        println!(
            "{} (page {}) — {}",
            result.date, result.page_number, result.snippet
        );
    }

    println!("\n{} results", results.len());
    Ok(())
}

fn resolve_date(token: &str) -> Result<String, String> {
    let token = token.trim();
    if token == "today" {
        return Ok(chrono::Local::now().format("%Y-%m-%d").to_string());
    }
    if let Some(rest) = token.strip_prefix('-') {
        if let Some(num) = rest.strip_suffix('d').and_then(|n| n.parse::<i64>().ok()) {
            let date = chrono::Local::now().date_naive() - chrono::Duration::days(num);
            return Ok(date.format("%Y-%m-%d").to_string());
        }
    }
    // Try ISO "YYYY-MM-DD"
    if chrono::NaiveDate::parse_from_str(token, "%Y-%m-%d").is_ok() {
        return Ok(token.to_string());
    }
    Err(format!("unrecognized date token: {token:?} (expected today / -Nd / YYYY-MM-DD)"))
}

fn build_tiptap_doc(content: &str) -> String {
    let paragraphs: Vec<serde_json::Value> = content
        .split("\n\n")
        .filter(|p| !p.trim().is_empty())
        .map(|p| {
            serde_json::json!({
                "type": "paragraph",
                "content": [{ "type": "text", "text": p.trim() }]
            })
        })
        .collect();

    let doc = if paragraphs.is_empty() {
        serde_json::json!({ "type": "doc", "content": [] })
    } else {
        serde_json::json!({ "type": "doc", "content": paragraphs })
    };

    doc.to_string()
}

/// Walk a TipTap doc and collect every text node's `text` (newline-joined).
/// Used to feed pages_fts when the seed entry provides `doc` directly.
fn extract_text_from_doc(value: &serde_json::Value) -> String {
    fn walk(v: &serde_json::Value, out: &mut Vec<String>) {
        match v {
            serde_json::Value::Object(map) => {
                if let Some(t) = map.get("text").and_then(|x| x.as_str()) {
                    out.push(t.to_string());
                }
                if let Some(children) = map.get("content").and_then(|x| x.as_array()) {
                    for c in children {
                        walk(c, out);
                    }
                }
            }
            serde_json::Value::Array(arr) => {
                for item in arr {
                    walk(item, out);
                }
            }
            _ => {}
        }
    }
    let mut out = Vec::new();
    walk(value, &mut out);
    out.join("\n")
}

fn run_seed(db_path: &PathBuf, seed_file: &PathBuf, force: bool) -> Result<(), String> {
    let json = std::fs::read_to_string(seed_file)
        .map_err(|e| format!("failed to read {}: {e}", seed_file.display()))?;
    let seed: Seed = serde_json::from_str(&json)
        .map_err(|e| format!("failed to parse seed JSON: {e}"))?;

    let conn = open_database(db_path)?;

    let existing: i64 = conn
        .query_row("SELECT count(*) FROM pages", [], |r| r.get(0))
        .map_err(|e| format!("failed to count pages: {e}"))?;
    if existing > 0 && !force {
        return Err(format!(
            "database already has {existing} pages — pass --force to wipe and re-seed"
        ));
    }
    if existing > 0 && force {
        // --force: nuke the seedable tables. Run this against a screenshot-specific
        // data dir, not your main one.
        for stmt in [
            "DELETE FROM pages_fts",
            "DELETE FROM shared_objects",
            "DELETE FROM lines",
            "DELETE FROM pages",
            "DELETE FROM lineages",
        ] {
            let _ = conn.execute(stmt, []);
        }
        eprintln!("--force: wiped {existing} existing page(s) and related rows");
    }

    let now = chrono::Utc::now().to_rfc3339();
    let mut trail_ids: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();

    // ── trails ──
    for trail in &seed.trails {
        let id = uuid::Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO lineages (id, name, created_at, mode, parent_id) \
             VALUES (?, ?, ?, ?, ?)",
            params![&id, &trail.name, &now, &trail.mode,
                    trail.parent.as_ref().and_then(|p| trail_ids.get(p).cloned())],
        )
        .map_err(|e| format!("failed to insert trail {}: {e}", trail.slug))?;
        trail_ids.insert(trail.slug.clone(), id);
    }
    println!("seeded {} trail(s)", seed.trails.len());

    // ── pages (record the page id keyed by `date` token so pins can find them) ──
    let mut page_ids_by_date: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    for page in &seed.pages {
        let id = uuid::Uuid::new_v4().to_string();
        let resolved_date = resolve_date(&page.date)?;
        let lineage_id = page
            .trail
            .as_ref()
            .map(|t| trail_ids.get(t).cloned()
                .ok_or_else(|| format!("page references unknown trail {t:?}")))
            .transpose()?;

        let (content_json, fts_text) = if let Some(doc) = &page.doc {
            (doc.to_string(), extract_text_from_doc(doc))
        } else if let Some(text) = &page.content {
            (build_tiptap_doc(text), text.trim().to_string())
        } else {
            return Err(format!(
                "page for {} has neither `content` nor `doc`", page.date
            ));
        };

        conn.execute(
            "INSERT INTO pages (id, date, page_number, what_matters_now, \
             content_json, lineage_id, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                &id, &resolved_date, page.page_number,
                page.what_matters_now.as_deref(),
                &content_json, lineage_id, &now, &now
            ],
        )
        .map_err(|e| format!("failed to insert page for {}: {e}", page.date))?;

        let _ = conn.execute(
            "INSERT INTO pages_fts (page_id, content, what_matters_now, \
             what_shifted, voice_memo_transcript) VALUES (?, ?, ?, ?, ?)",
            params![&id, &fts_text,
                    page.what_matters_now.as_deref().unwrap_or(""),
                    "", ""],
        );

        page_ids_by_date.insert(page.date.clone(), id);
    }
    println!("seeded {} page(s)", seed.pages.len());

    // ── pins (shared_objects) ──
    let mut pin_count = 0;
    for pin in &seed.pins {
        let Some(source_page_id) = page_ids_by_date.get(&pin.page_date) else {
            eprintln!("warning: pin {:?} references unseeded page {:?}", pin.label, pin.page_date);
            continue;
        };
        let id = pin.id.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let lineage_id = pin.trail.as_ref().and_then(|t| trail_ids.get(t).cloned());
        conn.execute(
            "INSERT INTO shared_objects (id, lineage_id, source_page_id, \
             object_type, title, content, status, position, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)",
            params![
                &id, lineage_id, source_page_id, &pin.kind, &pin.label,
                pin.content.as_deref().unwrap_or(""),
                pin_count as i64, &now, &now
            ],
        )
        .map_err(|e| format!("failed to insert pin {:?}: {e}", pin.label))?;
        pin_count += 1;
    }
    println!("seeded {pin_count} pin(s)");

    println!("\ndone. Open shizumu to see the seeded content.");
    Ok(())
}
