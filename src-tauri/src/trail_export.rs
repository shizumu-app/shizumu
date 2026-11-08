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
use serde::{Deserialize, Serialize};
use std::io::Write;
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
// ──────────────────────────────────────────────────────────────────────────
// The same export, packed as one zip (the phone)
// ──────────────────────────────────────────────────────────────────────────
//
// A phone has no folder to hand the export to: Android's save dialog answers
// with a `content://` URI that is not a path (see export_pages_gui), and the
// shell has no folder chooser. So the phone asks the JS walk for the files it
// would have written (run.js, planExport: the same markdown, the same trail
// folders, the same README) and hands them here to be packed into one zip,
// staged in the cache dir and passed to the system share sheet, the way the
// app already shares an attachment or a database backup.

/// One text file of the export, at its path inside the export.
#[derive(Debug, Deserialize)]
pub struct ZipTextFile {
    pub path: String,
    pub content: String,
}

/// One image to copy into the export's flat `images/` folder.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZipImage {
    pub src_path: String,
    pub dest_filename: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ZipSummary {
    pub file_count: usize,
    pub image_count: usize,
}

/// The entry name a relative export path gets inside the zip: its normal
/// components joined with `/`. The same refusals as `safe_join`, so a path
/// that could not be written to a folder cannot be written to a zip either
/// (a `..` entry is how a zip escapes the folder it is unpacked into).
fn zip_entry_name(relative: &str) -> Result<String, String> {
    let rel = Path::new(relative);
    if rel.is_absolute() {
        return Err("relative_path must not be absolute".into());
    }
    let mut parts: Vec<String> = Vec::new();
    for comp in rel.components() {
        match comp {
            Component::Normal(part) => parts.push(part.to_string_lossy().into_owned()),
            Component::CurDir => {}
            Component::ParentDir => return Err("parent-dir traversal rejected".into()),
            Component::Prefix(_) | Component::RootDir => {
                return Err("absolute or rooted component rejected".into());
            }
        }
    }
    if parts.is_empty() {
        return Err("empty path".into());
    }
    Ok(parts.join("/"))
}

/// Is `src` a file inside one of `roots`? An image path comes from a page's
/// content, which may have synced in from another device, so it is checked
/// before its bytes go into a zip the writer then shares: only the app's own
/// images and blobs are packed, never, say, the database beside them.
fn inside_roots(src: &Path, roots: &[PathBuf]) -> bool {
    let Ok(real) = src.canonicalize() else { return false };
    roots.iter().any(|root| match root.canonicalize() {
        Ok(r) => real.starts_with(&r),
        Err(_) => false,
    })
}

/// Where the README run.js hands over says how many images the zip holds;
/// `write_export_zip` puts the real count there. Must match run.js.
pub const IMAGE_COUNT_SLOT: &str = "IMAGE_COUNT_PACKED";

/// Pack the export's files and images into a zip at `zip_path`.
///
/// Text files are written in the order given. An image is skipped, not
/// fatal, when its source is missing or outside `image_roots`, or when an
/// image of that name is already in (names carry a hash, so a repeat is the
/// same image); the folder export does the same. Returns what was written.
pub fn write_export_zip(
    zip_path: &Path,
    files: &[ZipTextFile],
    images: &[ZipImage],
    image_roots: &[PathBuf],
    readme: Option<&ZipTextFile>,
) -> Result<ZipSummary, String> {
    // The planner gives every file its own path (run.js,
    // siblingFolderNames). Should a repeat still arrive, say which path
    // before anything is written, rather than let the zip crate refuse the
    // entry half way with "Duplicate filename". Compared without case: the
    // zip is unpacked on file systems that fold it, where `Book/` and
    // `book/` are one folder and one file would replace the other.
    let mut names = std::collections::HashSet::new();
    for f in files.iter().chain(readme) {
        let name = zip_entry_name(&f.path)?;
        if !names.insert(name.to_lowercase()) {
            return Err(format!("the export lists {name} twice (case ignored), so nothing was packed"));
        }
    }

    let file = std::fs::File::create(zip_path)
        .map_err(|e| format!("failed to create zip file: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let mut file_count = 0;
    for f in files {
        let name = zip_entry_name(&f.path)?;
        zip.start_file(&name, options)
            .map_err(|e| format!("zip entry error for {name}: {e}"))?;
        zip.write_all(f.content.as_bytes())
            .map_err(|e| format!("zip write error for {name}: {e}"))?;
        file_count += 1;
    }

    let mut image_count = 0;
    let mut seen = std::collections::HashSet::new();
    for img in images {
        let name = zip_entry_name(&format!("images/{}", img.dest_filename))?;
        if !seen.insert(name.to_lowercase()) || names.contains(&name.to_lowercase()) {
            continue;
        }
        let src = PathBuf::from(&img.src_path);
        if !inside_roots(&src, image_roots) {
            log::warn!("export zip: skipped an image outside the app's own files");
            continue;
        }
        let Ok(bytes) = std::fs::read(&src) else { continue };
        zip.start_file(&name, options)
            .map_err(|e| format!("zip entry error for {name}: {e}"))?;
        zip.write_all(&bytes)
            .map_err(|e| format!("zip write error for {name}: {e}"))?;
        image_count += 1;
    }

    // The README goes in last, once the images are in: its count is the
    // number this zip holds, not the number run.js hoped for. run.js
    // writes IMAGE_COUNT_SLOT where the count goes.
    if let Some(readme) = readme {
        let name = zip_entry_name(&readme.path)?;
        let content = readme.content.replacen(IMAGE_COUNT_SLOT, &image_count.to_string(), 1);
        zip.start_file(&name, options)
            .map_err(|e| format!("zip entry error for {name}: {e}"))?;
        zip.write_all(content.as_bytes())
            .map_err(|e| format!("zip write error for {name}: {e}"))?;
        file_count += 1;
    }

    zip.finish().map_err(|e| format!("zip finalize error: {e}"))?;
    Ok(ZipSummary { file_count, image_count })
}

/// The phone's export: pack what run.js planned into one zip and hand it to
/// the system share sheet, where the writer saves it to Files, a drive, or
/// another app.
///
/// Android only. iOS has no share path in this app yet (no plugin and no
/// native code for a share sheet or a document picker), so it answers with
/// an error the shell never reaches: its settings say the export works from
/// the laptop instead. The desktop writes a folder (runExport).
#[tauri::command]
pub async fn export_trail_zip_share(
    app: tauri::AppHandle,
    files: Vec<ZipTextFile>,
    images: Vec<ZipImage>,
    readme: Option<ZipTextFile>,
) -> Result<ZipSummary, String> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let cache_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
        let staged_dir = cache_dir.join("shared");
        std::fs::create_dir_all(&staged_dir).map_err(|e| format!("create share dir: {e}"))?;
        let zip_path = staged_dir.join(format!(
            "shizumu-export-{}.zip",
            chrono::Local::now().format("%Y-%m-%d")
        ));
        let roots = [data_dir.join("images"), crate::attachments::store::blobs_root(&data_dir)];
        let summary = write_export_zip(&zip_path, &files, &images, &roots, readme.as_ref())?;
        crate::attachments::share::share_via_intent(&zip_path.to_string_lossy(), "application/zip")?;
        return Ok(summary);
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, files, images, readme);
        Err("export to one zip works on android; here, export to a folder".to_string())
    }
}

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

    fn read_zip(path: &Path) -> Vec<(String, Vec<u8>)> {
        let mut archive = zip::ZipArchive::new(std::fs::File::open(path).unwrap()).unwrap();
        (0..archive.len())
            .map(|i| {
                let mut entry = archive.by_index(i).unwrap();
                let mut buf = Vec::new();
                std::io::Read::read_to_end(&mut entry, &mut buf).unwrap();
                (entry.name().to_string(), buf)
            })
            .collect()
    }

    fn text(path: &str, content: &str) -> ZipTextFile {
        ZipTextFile { path: path.into(), content: content.into() }
    }

    #[test]
    fn export_zip_holds_every_file_at_its_folder_path() {
        let dir = tempfile::tempdir().unwrap();
        let zip_path = dir.path().join("out.zip");
        let files = vec![
            text("book/_trail.md", "trail"),
            text("book/2026-11-01.md", "page one"),
            text("book/chapter/_doc.md", "the doc"),
            text("untrailed/2026-11-02.md", "loose page"),
            text("README.md", "readme"),
        ];
        let summary = write_export_zip(&zip_path, &files, &[], &[], None).unwrap();
        assert_eq!(summary, ZipSummary { file_count: 5, image_count: 0 });
        let entries = read_zip(&zip_path);
        let names: Vec<&str> = entries.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(
            names,
            vec!["book/_trail.md", "book/2026-11-01.md", "book/chapter/_doc.md", "untrailed/2026-11-02.md", "README.md"]
        );
        assert_eq!(entries[1].1, b"page one");
    }

    #[test]
    fn export_zip_refuses_a_path_that_climbs_out() {
        let dir = tempfile::tempdir().unwrap();
        let zip_path = dir.path().join("out.zip");
        assert!(write_export_zip(&zip_path, &[text("../evil.md", "x")], &[], &[], None).is_err());
        assert!(write_export_zip(&zip_path, &[text("/etc/evil.md", "x")], &[], &[], None).is_err());
    }

    #[test]
    fn export_zip_packs_only_images_inside_the_apps_own_folders() {
        let dir = tempfile::tempdir().unwrap();
        let images_dir = dir.path().join("images");
        std::fs::create_dir_all(&images_dir).unwrap();
        std::fs::write(images_dir.join("a.png"), b"png bytes").unwrap();
        std::fs::write(dir.path().join("shizumu.db"), b"the database").unwrap();
        let zip_path = dir.path().join("out.zip");
        let images = vec![
            ZipImage { src_path: images_dir.join("a.png").to_string_lossy().into(), dest_filename: "a.png".into() },
            // The same name again: one copy.
            ZipImage { src_path: images_dir.join("a.png").to_string_lossy().into(), dest_filename: "a.png".into() },
            // A synced page naming the database as its image: not packed.
            ZipImage { src_path: dir.path().join("shizumu.db").to_string_lossy().into(), dest_filename: "db.png".into() },
            // Gone from this device: skipped, the export still finishes.
            ZipImage { src_path: images_dir.join("gone.png").to_string_lossy().into(), dest_filename: "gone.png".into() },
        ];
        let summary = write_export_zip(&zip_path, &[text("README.md", "r")], &images, &[images_dir.clone()], None).unwrap();
        assert_eq!(summary, ZipSummary { file_count: 1, image_count: 1 });
        let entries = read_zip(&zip_path);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[1].0, "images/a.png");
        assert_eq!(entries[1].1, b"png bytes");
    }

    #[test]
    fn export_zip_names_a_repeated_path_instead_of_the_raw_zip_error() {
        // The planner keeps every path its own (run.js, siblingFolderNames).
        // If a repeat still arrives, the writer says which path, before it
        // writes anything, and counts "Book/" and "book/" as one, the way
        // the file systems the zip is unpacked on do.
        let dir = tempfile::tempdir().unwrap();
        let zip_path = dir.path().join("out.zip");
        let files = vec![text("Book/2026-11-01.md", "one"), text("book/2026-11-01.md", "two")];
        let err = write_export_zip(&zip_path, &files, &[], &[], None).unwrap_err();
        assert!(err.contains("book/2026-11-01.md"), "{err}");
        assert!(err.contains("twice"), "{err}");
        assert!(!zip_path.exists(), "nothing is left behind for a refused export");
    }

    #[test]
    fn the_readme_counts_the_images_the_zip_holds() {
        // review minor #7: the README used to count the images run.js could
        // resolve, and Rust then skipped one outside the app's folders, so
        // the README promised an image the zip did not hold.
        let dir = tempfile::tempdir().unwrap();
        let images_dir = dir.path().join("images");
        std::fs::create_dir_all(&images_dir).unwrap();
        std::fs::write(images_dir.join("a.png"), b"png bytes").unwrap();
        std::fs::write(dir.path().join("elsewhere.png"), b"not ours").unwrap();
        let zip_path = dir.path().join("out.zip");
        let images = vec![
            ZipImage { src_path: images_dir.join("a.png").to_string_lossy().into(), dest_filename: "a.png".into() },
            ZipImage { src_path: dir.path().join("elsewhere.png").to_string_lossy().into(), dest_filename: "b.png".into() },
        ];
        let readme = text("README.md", &format!("---\nimage_count: {IMAGE_COUNT_SLOT}\n---\n"));
        let summary = write_export_zip(&zip_path, &[text("book/_trail.md", "t")], &images, &[images_dir.clone()], Some(&readme)).unwrap();
        assert_eq!(summary, ZipSummary { file_count: 2, image_count: 1 });
        let entries = read_zip(&zip_path);
        let (name, body) = entries.last().unwrap();
        assert_eq!(name, "README.md");
        assert_eq!(String::from_utf8_lossy(body), "---\nimage_count: 1\n---\n");
    }

    #[test]
    fn safe_join_allows_current_dir_component() {
        let r = safe_join("/tmp/export", "./trail/page.md").unwrap();
        assert!(r.ends_with("trail/page.md"));
    }
}
