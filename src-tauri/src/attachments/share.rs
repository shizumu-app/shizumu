//! Getting a blob into another app's hands on Android.
//!
//! `tauri_plugin_opener::open_path` has no Android file-path implementation
//! (its Android side only handles URLs), and even if it did, Android forbids
//! passing a bare `file://` path to another app — `FileUriExposedException`
//! since API 24. A receiving app needs a `content://` URI minted by a
//! `FileProvider`, which in turn needs the file to live somewhere the
//! provider's `<paths>` config maps: `<app_cache_dir>/shared/` here, since
//! `file_paths.xml` already declares `<cache-path name="my_cache_images"
//! path="." />` covering the whole cache dir.
//!
//! Blobs are content-addressed with no extension (`store::path_for` ->
//! `blobs/<prefix>/<hash>`), so nothing downstream can infer a MIME type or
//! give the share sheet a sensible display name from the blob path alone —
//! both come from the attachment's ORIGINAL filename, which the frontend
//! already has on the node attrs and passes in.
//!
//! [`sanitize_share_name`] and [`mime_for`] are pure and unit-tested on the
//! host; [`stage_for_share`] is plain `std::fs` I/O and also runs on the
//! host. Only [`share_via_intent`] — the JNI call into the Kotlin
//! `shareFile` method `scripts/patch-android-share.py` injects into
//! `MainActivity.kt` — is Android-only and cannot be exercised without a
//! device.

use std::path::{Path, PathBuf};

/// Sanitize an attachment's original filename for use as the display name
/// of a staged share copy.
///
/// The filename comes from an attachment record that may have synced in
/// from another device — untrusted input, in other words — and gets joined
/// onto `<cache_dir>/shared/` to build a real filesystem path in
/// [`stage_for_share`]. Keeps only the last path component (defeats
/// `"../../etc/passwd"`-style traversal and any embedded directory
/// structure), then defangs any `".."` that survives without a separator
/// (e.g. `"foo..bar"`), and falls back to a sensible default when nothing
/// usable is left. The extension is never touched, so it's preserved
/// whenever the input has one.
pub fn sanitize_share_name(filename: &str) -> String {
    let base = filename.rsplit(['/', '\\']).next().unwrap_or("").trim();
    // Drop rather than replace: a placeholder character here would still
    // leave `".."` inputs (and nothing else) mapping to a non-empty,
    // not-quite-a-real-name string instead of falling through to the
    // fallback below.
    let defanged = base.replace("..", "");
    let cleaned: String = defanged.chars().filter(|c| !c.is_control()).collect();
    let cleaned = cleaned.trim_matches(|c: char| c == '.' || c.is_whitespace());

    if cleaned.is_empty() {
        "attachment".to_string()
    } else {
        cleaned.to_string()
    }
}

/// Map a filename's extension to a MIME type for the share intent.
///
/// `*/*` is the deliberate default rather than a guess: a wrong specific
/// MIME can route the chooser toward apps that reject the file, or hide
/// ones that would have handled it fine. The extension list mirrors the
/// common attachment kinds the app already stores (see `mime_guess_for` in
/// `commands.rs`), not an exhaustive registry.
pub fn mime_for(filename: &str) -> &'static str {
    let lower = filename.to_lowercase();
    let ext = match lower.rfind('.') {
        Some(i) => &lower[i + 1..],
        None => return "*/*",
    };
    match ext {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "pdf" => "application/pdf",
        "txt" => "text/plain",
        "md" => "text/markdown",
        "mp4" => "video/mp4",
        "mp3" => "audio/mpeg",
        "zip" => "application/zip",
        _ => "*/*",
    }
}

/// Copy `blob_path`'s bytes to `<cache_dir>/shared/<sanitized filename>`,
/// creating the directory if it doesn't exist and overwriting whatever was
/// already staged at that name. Returns the staged path and the MIME type
/// to share it with.
///
/// Plain `std::fs`, not gated to Android — it runs (and is unit-tested) on
/// any host. Only the JNI call that follows it, [`share_via_intent`], needs
/// a real Android runtime.
pub fn stage_for_share(
    cache_dir: &Path,
    blob_path: &Path,
    filename: &str,
) -> Result<(PathBuf, &'static str), String> {
    let name = sanitize_share_name(filename);
    let dest_dir = cache_dir.join("shared");
    std::fs::create_dir_all(&dest_dir).map_err(|e| format!("create share dir: {e}"))?;
    let dest_path = dest_dir.join(&name);
    std::fs::copy(blob_path, &dest_path).map_err(|e| format!("stage share copy: {e}"))?;
    Ok((dest_path, mime_for(&name)))
}

/// Hand a staged file to the Android system share sheet.
///
/// Calls the `shareFile(String, String)` method
/// `scripts/patch-android-share.py` injects into `MainActivity.kt`, via
/// `ndk-context`'s stashed `JavaVM` + activity pointers and the `jni` crate.
/// `MainActivity.shareFile` builds an `ACTION_SEND` chooser — deliberately
/// not `ACTION_VIEW` — so a device with no app registered for the MIME type
/// still gets somewhere useful instead of a dead-end "no app can open this".
///
/// Never panics: every failure — attaching the JVM thread, boxing the
/// arguments, the method call itself (including a pending Java exception,
/// which `jni` surfaces as `Err` here rather than leaving it to crash the
/// next JNI call) — becomes a readable `Err` the caller logs and turns into
/// a message the UI can show. This path cannot be exercised on the dev
/// host; it needs a device.
#[cfg(target_os = "android")]
pub fn share_via_intent(path: &str, mime: &str) -> Result<(), String> {
    let ctx = ndk_context::android_context();

    // SAFETY: `ndk_context::android_context()` is populated by wry's
    // Android glue before any Tauri command can run, and both pointers are
    // the same `vm` / `activity` handles Android's JNI passed into that
    // glue at process start — this is the standard way a Tauri mobile
    // plugin reaches back into the JVM.
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }
        .map_err(|e| format!("attach to JavaVM: {e}"))?;
    let mut env = vm
        .attach_current_thread()
        .map_err(|e| format!("attach current thread to JVM: {e}"))?;
    // SAFETY: same context pointer as above — the running Activity.
    let activity = unsafe { jni::objects::JObject::from_raw(ctx.context().cast()) };

    let jpath = env
        .new_string(path)
        .map_err(|e| format!("build path jstring: {e}"))?;
    let jmime = env
        .new_string(mime)
        .map_err(|e| format!("build mime jstring: {e}"))?;

    env.call_method(
        &activity,
        "shareFile",
        "(Ljava/lang/String;Ljava/lang/String;)V",
        &[(&jpath).into(), (&jmime).into()],
    )
    .map_err(|e| format!("call MainActivity.shareFile: {e}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_strips_a_path_traversal_attempt() {
        assert_eq!(
            sanitize_share_name("../../../etc/passwd"),
            "passwd",
            "only the last path component survives"
        );
    }

    #[test]
    fn sanitize_defangs_dots_that_have_no_separator_to_traverse_with() {
        // No '/' for rsplit to isolate a basename with, so this exercises
        // the belt-and-braces ".." replace rather than the path-component
        // split above.
        let out = sanitize_share_name("foo..bar.pdf");
        assert!(!out.contains(".."), "must not smuggle a '..' through: {out}");
        assert!(out.ends_with(".pdf"), "extension is still preserved: {out}");
    }

    #[test]
    fn sanitize_falls_back_to_a_default_name_when_empty() {
        assert_eq!(sanitize_share_name(""), "attachment");
    }

    #[test]
    fn sanitize_falls_back_when_the_input_is_only_traversal_tokens() {
        assert_eq!(sanitize_share_name(".."), "attachment");
        assert_eq!(sanitize_share_name("../"), "attachment");
    }

    #[test]
    fn sanitize_keeps_a_name_with_no_extension_as_is() {
        assert_eq!(sanitize_share_name("README"), "README");
    }

    #[test]
    fn sanitize_keeps_a_normal_name_unchanged() {
        assert_eq!(sanitize_share_name("contract.pdf"), "contract.pdf");
    }

    #[test]
    fn mime_for_maps_known_extensions() {
        assert_eq!(mime_for("photo.JPG"), "image/jpeg");
        assert_eq!(mime_for("photo.jpeg"), "image/jpeg");
        assert_eq!(mime_for("scan.png"), "image/png");
        assert_eq!(mime_for("contract.pdf"), "application/pdf");
        assert_eq!(mime_for("notes.md"), "text/markdown");
        assert_eq!(mime_for("clip.mp4"), "video/mp4");
        assert_eq!(mime_for("track.mp3"), "audio/mpeg");
        assert_eq!(mime_for("archive.zip"), "application/zip");
    }

    #[test]
    fn mime_for_defaults_to_wildcard_for_unknown_or_missing_extensions() {
        assert_eq!(mime_for("blob"), "*/*");
        assert_eq!(mime_for("weird.xyz"), "*/*");
    }

    #[test]
    fn stage_for_share_copies_the_blob_under_a_sanitized_name() {
        let src_dir = tempfile::tempdir().unwrap();
        let cache_dir = tempfile::tempdir().unwrap();
        let blob_path = src_dir.path().join("deadbeef");
        std::fs::write(&blob_path, b"the file bytes").unwrap();

        let (staged, mime) =
            stage_for_share(cache_dir.path(), &blob_path, "../../report final.pdf").unwrap();

        assert_eq!(staged, cache_dir.path().join("shared").join("report final.pdf"));
        assert_eq!(std::fs::read(&staged).unwrap(), b"the file bytes");
        assert_eq!(mime, "application/pdf");
    }

    #[test]
    fn stage_for_share_overwrites_a_previous_staged_copy_at_the_same_name() {
        let src_dir = tempfile::tempdir().unwrap();
        let cache_dir = tempfile::tempdir().unwrap();
        let blob_path = src_dir.path().join("hash-1");
        std::fs::write(&blob_path, b"first version").unwrap();
        stage_for_share(cache_dir.path(), &blob_path, "notes.txt").unwrap();

        std::fs::write(&blob_path, b"second version, longer than the first").unwrap();
        let (staged, _) = stage_for_share(cache_dir.path(), &blob_path, "notes.txt").unwrap();

        assert_eq!(std::fs::read(&staged).unwrap(), b"second version, longer than the first");
    }
}
