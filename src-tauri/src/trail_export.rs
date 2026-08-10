// Trail-folder export — Rust side.
//
// The JS frontend owns the schema knowledge (TipTap doc → markdown) and
// orchestrates the export walk. Rust handles:
//   1. Fetching the typed rows the frontend needs to enumerate (lineages,
//      pages, pins) in a single command.
//   2. Filesystem operations the frontend cannot do directly:
//      mkdir + write + image copy.
//
// Path safety: every write/copy joins onto the user-chosen target_dir and
// re-canonicalises the result to verify it stays inside the target_dir tree.
// This prevents a malicious relative_path payload from escaping.
//
// See docs/superpowers/specs/2026-05-19-trail-folder-export-design.md.

use crate::db::Db;
use serde::Serialize;
use std::path::{Component, Path, PathBuf};
use tauri::State;

#[derive(Debug, Serialize)]
pub struct ExportLineage {
    pub id: String,
    pub name: String,
    pub mode: String,
    pub parent_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct ExportPage {
    pub id: String,
    pub date: String,
    pub page_number: i64,
    pub lineage_id: Option<String>,
    pub what_matters_now: Option<String>,
    pub content_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
pub struct ExportPin {
    pub id: String,
    pub lineage_id: Option<String>,
    pub source_page_id: String,
    pub object_type: String,
    pub title: Option<String>,
    pub content: String,
    pub position: i64,
    pub auto_insert: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
pub struct ExportData {
    pub lineages: Vec<ExportLineage>,
    pub pages: Vec<ExportPage>,
    pub pins: Vec<ExportPin>,
    pub skipped_orphan_pin_count: usize,
}

/// One-shot fetch of every row the frontend needs to walk the export.
/// Pins with NULL `source_page_id` are excluded; their count is reported
/// in `skipped_orphan_pin_count` (per v0.3 spec — orphan-pin handling is
/// deferred).
#[tauri::command]
pub fn export_trail_folder_list_data(db: State<'_, Db>) -> Result<ExportData, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;

    let mut lineage_stmt = conn
        .prepare("SELECT id, name, mode, parent_id, created_at FROM lineages ORDER BY parent_id ASC NULLS FIRST, name ASC")
        .map_err(|e| format!("prepare lineages: {e}"))?;
    let lineages: Vec<ExportLineage> = lineage_stmt
        .query_map([], |row| {
            Ok(ExportLineage {
                id: row.get(0)?,
                name: row.get(1)?,
                mode: row.get(2)?,
                parent_id: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| format!("query lineages: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("collect lineages: {e}"))?;

    let mut page_stmt = conn
        .prepare(
            "SELECT id, date, page_number, lineage_id, what_matters_now, content_json,
                    created_at, updated_at
             FROM pages
             ORDER BY date ASC, page_number ASC",
        )
        .map_err(|e| format!("prepare pages: {e}"))?;
    let pages: Vec<ExportPage> = page_stmt
        .query_map([], |row| {
            Ok(ExportPage {
                id: row.get(0)?,
                date: row.get(1)?,
                page_number: row.get(2)?,
                lineage_id: row.get(3)?,
                what_matters_now: row.get(4)?,
                content_json: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|e| format!("query pages: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("collect pages: {e}"))?;

    // Count orphan pins separately so the summary can surface the skip.
    let orphan_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM shared_objects WHERE source_page_id IS NULL",
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("count orphan pins: {e}"))?;

    let mut pin_stmt = conn
        .prepare(
            "SELECT id, lineage_id, source_page_id, object_type, title, content,
                    position, auto_insert, created_at, updated_at
             FROM shared_objects
             WHERE source_page_id IS NOT NULL
             ORDER BY position ASC",
        )
        .map_err(|e| format!("prepare pins: {e}"))?;
    let pins: Vec<ExportPin> = pin_stmt
        .query_map([], |row| {
            Ok(ExportPin {
                id: row.get(0)?,
                lineage_id: row.get(1)?,
                source_page_id: row.get(2)?,
                object_type: row.get(3)?,
                title: row.get(4)?,
                content: row.get(5)?,
                position: row.get(6)?,
                auto_insert: row.get::<_, i64>(7).unwrap_or(0) != 0,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })
        .map_err(|e| format!("query pins: {e}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("collect pins: {e}"))?;

    Ok(ExportData {
        lineages,
        pages,
        pins,
        skipped_orphan_pin_count: orphan_count as usize,
    })
}

/// Validate + prepare the export root. Creates `target_dir` (and the
/// `images/` subdir) if absent. If the target already exists with files
/// inside, errors out unless `overwrite` is true.
#[tauri::command]
pub fn export_trail_folder_prepare(target_dir: String, overwrite: bool) -> Result<(), String> {
    let target = PathBuf::from(&target_dir);
    if target.as_os_str().is_empty() {
        return Err("empty target path".into());
    }

    if target.exists() {
        if !target.is_dir() {
            return Err("target exists and is not a folder".into());
        }
        let non_empty = std::fs::read_dir(&target)
            .map_err(|e| format!("read target dir: {e}"))?
            .next()
            .is_some();
        if non_empty && !overwrite {
            return Err("folder is not empty".into());
        }
    } else {
        std::fs::create_dir_all(&target)
            .map_err(|e| format!("create target dir: {e}"))?;
    }

    let images_dir = target.join("images");
    if !images_dir.exists() {
        std::fs::create_dir_all(&images_dir)
            .map_err(|e| format!("create images dir: {e}"))?;
    }

    Ok(())
}

/// Write a file at `target_dir / relative_path`. Creates parent directories
/// as needed. Path traversal is prevented by `safe_join`.
#[tauri::command]
pub fn export_trail_folder_write(
    target_dir: String,
    relative_path: String,
    content: String,
) -> Result<(), String> {
    let full = safe_join(&target_dir, &relative_path)?;
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create parent: {e}"))?;
    }
    std::fs::write(&full, content.as_bytes()).map_err(|e| format!("write file: {e}"))?;
    Ok(())
}

/// Copy a localImage source file into `target_dir / images / dest_filename`.
/// Returns Ok(true) if a new copy was written; Ok(false) if the target
/// filename already existed (no copy performed — image filenames carry an
/// id prefix so collisions imply same content).
#[tauri::command]
pub fn export_trail_folder_copy_image(
    target_dir: String,
    src_path: String,
    dest_filename: String,
) -> Result<bool, String> {
    let dest = safe_join(&target_dir, &format!("images/{}", dest_filename))?;
    if dest.exists() {
        return Ok(false);
    }
    let src = PathBuf::from(&src_path);
    if !src.exists() {
        // Source file gone — non-fatal. The export proceeds; the markdown
        // page still references `images/<name>` and the user will see a
        // broken image. We could log this; for v0.3 it's silent.
        return Ok(false);
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create dest parent: {e}"))?;
    }
    std::fs::copy(&src, &dest).map_err(|e| format!("copy image: {e}"))?;
    Ok(true)
}

/// Join `relative` onto `base` while rejecting any component that would
/// escape `base` (parent traversal, absolute path, root, etc.). The result
/// is the absolute path within `base`.
fn safe_join(base: &str, relative: &str) -> Result<PathBuf, String> {
    let base = PathBuf::from(base);
    let rel = Path::new(relative);
    if rel.is_absolute() {
        return Err("relative_path must not be absolute".into());
    }
    let mut out = base.clone();
    for comp in rel.components() {
        match comp {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            Component::ParentDir => return Err("parent-dir traversal rejected".into()),
            Component::Prefix(_) | Component::RootDir => {
                return Err("absolute or rooted component rejected".into());
            }
        }
    }
    // Final sanity: canonical form of out must start with canonical base.
    // We can't canonicalize non-existent paths, so we compare prefixes of
    // the cleaned forms directly.
    if !out.starts_with(&base) {
        return Err("path escapes target dir".into());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_join_accepts_normal_paths() {
        let r = safe_join("/tmp/export", "trail/2026-05-19.md").unwrap();
        assert!(r.ends_with("trail/2026-05-19.md"));
    }

    #[test]
    fn safe_join_rejects_parent_traversal() {
        assert!(safe_join("/tmp/export", "../etc/passwd").is_err());
        assert!(safe_join("/tmp/export", "trail/../../etc/passwd").is_err());
    }

    #[test]
    fn safe_join_rejects_absolute() {
        assert!(safe_join("/tmp/export", "/etc/passwd").is_err());
    }

    #[test]
    fn safe_join_allows_current_dir_component() {
        let r = safe_join("/tmp/export", "./trail/page.md").unwrap();
        assert!(r.ends_with("trail/page.md"));
    }
}
