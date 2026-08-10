// Frontend orchestrator for the trail-folder export.
//
// Wires together:
//   - the typed data dump from Rust (`export_trail_folder_list_data`),
//   - the JS serializer (`./markdown.js`),
//   - Rust filesystem ops (prepare / write / copy_image).
//
// One entry point: `runExport(targetDir, options)`. The Settings UI calls
// this and shows the returned summary.

import { invoke } from "@tauri-apps/api/core";
import {
  serializePage,
  serializeTrail,
  serializeReadme,
  attachmentImageExportName,
} from "./markdown.js";

export async function runExport(targetDir, { overwrite = false, onProgress = null } = {}) {
  const started = performance.now();

  // 1. Fetch all rows in one shot.
  const data = await invoke("export_trail_folder_list_data");
  const { lineages, pages, pins, skipped_orphan_pin_count: skippedOrphanPins } = data;

  // 2. Validate + create target.
  await invoke("export_trail_folder_prepare", { targetDir, overwrite });

  // 3. Build the trail-id → folder-path map by walking the lineages tree.
  const lineageById = new Map(lineages.map((l) => [l.id, l]));
  const childrenByParent = new Map();
  for (const l of lineages) {
    const key = l.parent_id || null;
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key).push(l);
  }
  const folderPathById = new Map();        // lineage_id -> "trail/sub-trail"
  const breadcrumbById = new Map();        // lineage_id -> "shizumu › book › chapter"
  walkLineageTree(null, [], "", childrenByParent, folderPathById, breadcrumbById);

  // 4. Group pages and pins by their owning lineage_id (null = untrailed).
  const pagesByLineage = new Map();
  for (const p of pages) {
    const key = p.lineage_id || null;
    if (!pagesByLineage.has(key)) pagesByLineage.set(key, []);
    pagesByLineage.get(key).push(p);
  }
  const pinsByPageId = new Map();
  for (const pin of pins) {
    if (!pinsByPageId.has(pin.source_page_id)) pinsByPageId.set(pin.source_page_id, []);
    pinsByPageId.get(pin.source_page_id).push(pin);
  }
  for (const arr of pinsByPageId.values()) arr.sort((a, b) => a.position - b.position);

  // 5. Walk lineages: write _trail.md + each page file. Collect image refs.
  let pageCount = 0;
  let totalPageCount = pages.length;
  // destFilename -> srcPath (localImage) | { blobHash } (attachment image)
  const imagesToCopy = new Map();
  for (const lineage of lineages) {
    const folder = folderPathById.get(lineage.id) || "";
    if (!folder) continue;

    const parent = lineage.parent_id ? lineageById.get(lineage.parent_id) : null;
    const trailMd = serializeTrail({ lineage, parent });
    await invoke("export_trail_folder_write", {
      targetDir,
      relativePath: joinPath(folder, "_trail.md"),
      content: trailMd,
    });

    const trailPages = (pagesByLineage.get(lineage.id) || [])
      .sort((a, b) => a.date.localeCompare(b.date) || a.page_number - b.page_number);

    if (lineage.mode === "continuous") {
      // One canonical page only.
      const page = trailPages[0];
      if (page) {
        const filename = "_doc.md";
        const md = serializePage({
          page,
          lineage,
          lineagePath: breadcrumbById.get(lineage.id) || null,
          pins: pinsByPageId.get(page.id) || [],
        });
        await invoke("export_trail_folder_write", {
          targetDir,
          relativePath: joinPath(folder, filename),
          content: md,
        });
        pageCount++;
        collectImages(page, imagesToCopy);
      }
    } else {
      // Discrete trail: one file per page, disambiguated on same-day.
      const sameDayCounts = new Map();
      for (const page of trailPages) {
        const seen = sameDayCounts.get(page.date) || 0;
        sameDayCounts.set(page.date, seen + 1);
        const filename = seen === 0 ? `${page.date}.md` : `${page.date} (${seen + 1}).md`;
        const md = serializePage({
          page,
          lineage,
          lineagePath: breadcrumbById.get(lineage.id) || null,
          pins: pinsByPageId.get(page.id) || [],
        });
        await invoke("export_trail_folder_write", {
          targetDir,
          relativePath: joinPath(folder, filename),
          content: md,
        });
        pageCount++;
        collectImages(page, imagesToCopy);
      }
    }
    if (onProgress) onProgress({ pageCount, totalPageCount });
  }

  // 6. Untrailed pages.
  const untrailed = pagesByLineage.get(null) || [];
  if (untrailed.length > 0) {
    const sameDayCounts = new Map();
    for (const page of untrailed.sort((a, b) => a.date.localeCompare(b.date) || a.page_number - b.page_number)) {
      const seen = sameDayCounts.get(page.date) || 0;
      sameDayCounts.set(page.date, seen + 1);
      const filename = seen === 0 ? `${page.date}.md` : `${page.date} (${seen + 1}).md`;
      const md = serializePage({
        page,
        lineage: null,
        lineagePath: null,
        pins: pinsByPageId.get(page.id) || [],
      });
      await invoke("export_trail_folder_write", {
        targetDir,
        relativePath: joinPath("untrailed", filename),
        content: md,
      });
      pageCount++;
      collectImages(page, imagesToCopy);
      if (onProgress) onProgress({ pageCount, totalPageCount });
    }
  }

  // 7. Copy images.
  let imageCount = 0;
  for (const [filename, entry] of imagesToCopy.entries()) {
    const srcPath = await resolveImageSrcPath(entry);
    // Not on this device: the markdown keeps its link (the file may arrive
    // on another device's export), but there are no bytes to copy here.
    if (!srcPath) continue;
    const wrote = await invoke("export_trail_folder_copy_image", {
      targetDir,
      srcPath,
      destFilename: filename,
    });
    if (wrote) imageCount++;
  }

  // 8. README at root.
  const exportedAt = new Date().toISOString();
  const readme = serializeReadme({
    summary: {
      exported_at: exportedAt,
      page_count: pageCount,
      trail_count: lineages.length,
      image_count: imageCount,
      shizumu_version: await safeAppVersion(),
    },
  });
  await invoke("export_trail_folder_write", {
    targetDir,
    relativePath: "README.md",
    content: readme,
  });

  const tookMs = Math.round(performance.now() - started);
  return {
    pageCount,
    trailCount: lineages.length,
    imageCount,
    skippedOrphanPins,
    folderPath: targetDir,
    tookMs,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function walkLineageTree(parentId, parentBreadcrumb, parentFolder, childrenByParent, folderPathById, breadcrumbById) {
  const siblings = childrenByParent.get(parentId) || [];
  // Resolve sibling name collisions deterministically: any name that
  // appears more than once gets `__<shortId>` suffixed. Stable across runs
  // because `siblings` is ordered by name (Rust query orders by name).
  const nameCounts = new Map();
  for (const s of siblings) {
    nameCounts.set(s.name, (nameCounts.get(s.name) || 0) + 1);
  }
  for (const lineage of siblings) {
    let folderName = slugify(lineage.name) || shortId(lineage.id);
    if ((nameCounts.get(lineage.name) || 0) > 1) {
      folderName = `${folderName}__${shortId(lineage.id)}`;
    }
    const folder = parentFolder ? `${parentFolder}/${folderName}` : folderName;
    const breadcrumb = parentBreadcrumb.length > 0
      ? `${parentBreadcrumb.join(" › ")} › ${lineage.name}`
      : lineage.name;
    folderPathById.set(lineage.id, folder);
    breadcrumbById.set(lineage.id, breadcrumb);
    walkLineageTree(lineage.id, [...parentBreadcrumb, lineage.name], folder, childrenByParent, folderPathById, breadcrumbById);
  }
}

function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function shortId(id) {
  return String(id).slice(0, 6);
}

function joinPath(a, b) {
  if (!a) return b;
  if (!b) return a;
  return `${a}/${b}`;
}

function collectImages(page, target) {
  const doc = parseJsonSafe(page.content_json);
  if (!doc) return;
  walkForImages(doc, target);
}

function parseJsonSafe(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

function walkForImages(node, target) {
  if (!node) return;
  if (node.type === "localImage" && node.attrs?.localPath) {
    const src = node.attrs.localPath;
    const match = String(src).match(/[^/\\]+$/);
    const filename = match ? match[0] : null;
    if (filename && !target.has(filename)) target.set(filename, src);
  }
  // Attachment images know a blob hash, not a path. Record the hash; the
  // copy step resolves it against the blob store (the bytes may not be on
  // this device at all).
  if (node.type === "attachment" && node.attrs?.kind === "image" && node.attrs?.blob_hash) {
    const destFilename = attachmentImageExportName(node.attrs);
    if (!target.has(destFilename)) {
      target.set(destFilename, { blobHash: node.attrs.blob_hash });
    }
  }
  if (Array.isArray(node.content)) {
    for (const c of node.content) walkForImages(c, target);
  }
}

/**
 * Turn a collected entry into an absolute source path. localImage entries
 * already are one; attachment entries need a lookup, and resolve to null
 * when the blob was GC'd or hasn't synced to this device yet.
 */
async function resolveImageSrcPath(entry) {
  if (typeof entry === "string") return entry;
  if (!entry?.blobHash) return null;
  try {
    return await invoke("attachment_local_src", { blobHash: entry.blobHash });
  } catch {
    return null;
  }
}

async function safeAppVersion() {
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    return await getVersion();
  } catch {
    return null;
  }
}
