//! Content-addressed local blob store. Path layout:
//! `<app_data>/blobs/<sha256[0:2]>/<sha256>` — the two-char prefix keeps
//! any single directory under ~256 entries even with thousands of files.

use sha2::{Digest, Sha256};
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

pub fn blobs_root(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("blobs")
}

pub fn hash_hex(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    let out = h.finalize();
    hex::encode(out)
}

pub fn path_for(app_data_dir: &Path, blob_hash: &str) -> io::Result<PathBuf> {
    if blob_hash.len() < 2 {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "blob hash too short"));
    }
    let prefix = &blob_hash[..2];
    let dir = blobs_root(app_data_dir).join(prefix);
    fs::create_dir_all(&dir)?;
    Ok(dir.join(blob_hash))
}

/// Suffix marking a half-written blob. Never a valid content address
/// (a hash is hex), so [`list_all`] can tell the two apart.
const TEMP_SUFFIX: &str = ".part";

/// Write `bytes` to their content address, ATOMICALLY.
///
/// Write-to-temp + rename, because the file at a content address is
/// trusted on sight everywhere else in the app: `has_local` is a
/// `path.exists()`, and the row's `has_local = 1` is what the storage
/// panel and the open path believe. `File::create` + `write_all`
/// interrupted by a crash or a full disk leaves a TRUNCATED file
/// sitting at the right name — and the caller (the object fetch sweep)
/// had already verified the hash of the bytes it was handed, so nothing
/// downstream ever looks again.
///
/// The old early return on `path.exists()` is what turned that into a
/// permanent corruption rather than a transient one: the next tick
/// re-fetched, re-verified, called this, saw the truncated file, and
/// returned `Ok` WITHOUT rewriting it — so the row flipped to
/// `has_local = 1` over a file that is not the attachment. The
/// content-address check was bypassed entirely by the short-circuit.
///
/// `rename` within one directory is atomic on every filesystem this
/// ships on: the name either points at the old content or at the fully
/// written new content, never at a prefix of it. Unconditional, so a
/// truncated file left by an older build is repaired the first time
/// the bytes come round again. Rewriting bytes that are already correct
/// costs one write of a file the caller is holding in memory anyway;
/// trusting a file nobody has hashed costs the user their attachment.
pub fn write_blob(app_data_dir: &Path, blob_hash: &str, bytes: &[u8]) -> io::Result<PathBuf> {
    let actual = hash_hex(bytes);
    if actual != blob_hash {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("hash mismatch: expected {blob_hash}, got {actual}"),
        ));
    }
    let path = path_for(app_data_dir, blob_hash)?;
    // Unique per write: two threads writing the same blob (the fetch
    // sweep and an insert of the same file) must not share a temp name
    // and interleave into one corrupt file.
    let temp = path.with_file_name(format!(
        "{blob_hash}.{}{TEMP_SUFFIX}",
        uuid::Uuid::new_v4().simple()
    ));
    let write = (|| -> io::Result<()> {
        let mut f = fs::File::create(&temp)?;
        f.write_all(bytes)?;
        // Durable BEFORE the rename: a rename that reaches the disk
        // ahead of the data would put the content address on a file
        // whose contents are still in the page cache.
        f.sync_all()?;
        fs::rename(&temp, &path)
    })();
    if let Err(e) = write {
        // Leave nothing half-written behind for `list_all` to trip over.
        let _ = fs::remove_file(&temp);
        return Err(e);
    }
    Ok(path)
}

pub fn read_blob(app_data_dir: &Path, blob_hash: &str) -> io::Result<Option<Vec<u8>>> {
    let path = path_for(app_data_dir, blob_hash)?;
    if !path.exists() {
        return Ok(None);
    }
    Ok(Some(fs::read(path)?))
}

pub fn has_local(app_data_dir: &Path, blob_hash: &str) -> bool {
    path_for(app_data_dir, blob_hash)
        .map(|p| p.exists())
        .unwrap_or(false)
}

pub fn list_all(app_data_dir: &Path) -> io::Result<Vec<String>> {
    let root = blobs_root(app_data_dir);
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for shard_entry in fs::read_dir(&root)? {
        let shard = shard_entry?;
        if !shard.file_type()?.is_dir() {
            continue;
        }
        for blob_entry in fs::read_dir(shard.path())? {
            let blob = blob_entry?;
            if let Some(name) = blob.file_name().to_str() {
                // A `.part` file is a write that was interrupted, not a
                // blob. Reporting it as one would hand `attachment_gc` a
                // "hash" no attachments row can match, and it would be
                // swept — which is the right outcome, but by accident.
                if name.ends_with(TEMP_SUFFIX) {
                    continue;
                }
                out.push(name.to_string());
            }
        }
    }
    Ok(out)
}

pub fn delete_blob(app_data_dir: &Path, blob_hash: &str) -> io::Result<()> {
    let path = path_for(app_data_dir, blob_hash)?;
    if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn write_then_read_round_trips() {
        let dir = tempdir().unwrap();
        let bytes = b"hello shizumu";
        let h = hash_hex(bytes);
        write_blob(dir.path(), &h, bytes).unwrap();
        let got = read_blob(dir.path(), &h).unwrap().unwrap();
        assert_eq!(got, bytes);
    }

    #[test]
    fn hash_mismatch_rejected() {
        let dir = tempdir().unwrap();
        let err = write_blob(dir.path(), "00".repeat(32).as_str(), b"x").unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidData);
    }

    #[test]
    fn list_all_returns_all_shards() {
        let dir = tempdir().unwrap();
        let bytes_a = b"alpha";
        let bytes_b = b"beta";
        let ha = hash_hex(bytes_a);
        let hb = hash_hex(bytes_b);
        write_blob(dir.path(), &ha, bytes_a).unwrap();
        write_blob(dir.path(), &hb, bytes_b).unwrap();
        let listed = list_all(dir.path()).unwrap();
        assert!(listed.contains(&ha));
        assert!(listed.contains(&hb));
    }

    /// I6 — THE DATA-INTEGRITY ONE.
    ///
    /// A crash or a full disk mid-write leaves a truncated file at the
    /// content address. `has_local` is a `path.exists()`, so the next
    /// fetch re-downloads, re-verifies the bytes it was handed, calls
    /// this — and the old `if path.exists() { return Ok(path) }` handed
    /// back Ok without rewriting anything. The row flipped to
    /// `has_local = 1` over a file that is not the attachment, and the
    /// user held a permanently corrupt file the app reported as present.
    #[test]
    fn a_truncated_file_at_the_content_address_is_repaired_not_trusted() {
        let dir = tempdir().unwrap();
        let bytes = b"the whole file, every byte of it";
        let h = hash_hex(bytes);

        // What a crash mid-`write_all` leaves behind: the right name,
        // the wrong contents.
        let path = path_for(dir.path(), &h).unwrap();
        fs::write(&path, b"the whole file, ev").unwrap();
        assert!(has_local(dir.path(), &h), "the app already believes it has this");

        write_blob(dir.path(), &h, bytes).unwrap();

        let got = read_blob(dir.path(), &h).unwrap().unwrap();
        assert_eq!(
            got, bytes,
            "the file at the content address is still not the content — a fetch that \
             verified its bytes then declined to write them"
        );
    }

    /// A write that cannot finish leaves nothing behind for the rest of
    /// the app to trip over.
    ///
    /// What this does and does not prove: it pins the CLEANUP half of
    /// the atomic write — the `.part` file is removed when the write
    /// fails — because a leftover would be enumerated by `list_all` and
    /// swept by `attachment_gc` as if it were a blob. It does not prove
    /// that the rename itself is atomic; observing a partially written
    /// destination requires failing inside `write_all`, which needs
    /// filesystem fault injection this suite has no way to do. The
    /// repair test above is what covers the corruption that actually
    /// reached a user.
    #[test]
    fn a_failed_write_leaves_nothing_at_the_content_address() {
        let dir = tempdir().unwrap();
        let bytes = b"never lands";
        let h = hash_hex(bytes);
        // A directory where the blob's shard should be: `File::create`
        // inside it fails, standing in for a full disk.
        let shard = blobs_root(dir.path()).join(&h[..2]);
        fs::create_dir_all(&shard).unwrap();
        fs::create_dir_all(shard.join(&h)).unwrap();

        // The destination name is occupied by a directory, so the
        // rename fails. What matters is what is NOT left behind.
        let _ = write_blob(dir.path(), &h, bytes);

        let strays: Vec<String> = fs::read_dir(&shard)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .filter(|n| n != &h)
            .collect();
        // Empty because a partial write is cleaned up, not because
        // nothing was attempted: a leftover would be picked up by
        // `list_all` and swept as if it were a blob.
        assert!(strays.is_empty(), "half-written files left behind: {strays:?}");
    }

    #[test]
    fn delete_then_has_local_false() {
        let dir = tempdir().unwrap();
        let bytes = b"gone";
        let h = hash_hex(bytes);
        write_blob(dir.path(), &h, bytes).unwrap();
        assert!(has_local(dir.path(), &h));
        delete_blob(dir.path(), &h).unwrap();
        assert!(!has_local(dir.path(), &h));
    }
}
