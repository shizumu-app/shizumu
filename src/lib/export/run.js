// Frontend orchestrator for the trail-folder export.
//
// Wires together:
//   - the typed data dump from Rust (`export_trail_folder_list_data`),
//   - the JS serializer (`./markdown.js`),
//   - Rust filesystem ops (prepare / write / copy_image).
//
// Entry points: `runExport(targetDir, options)`, the desktop's folder export,
// and `runExportZip()`, the phone's, which packs the same files into one zip.
// Both write what `planExport` (pure) lists.

import { invoke } from "@tauri-apps/api/core";
import {
  serializePage,
  serializeTrail,
  serializeReadme,
  attachmentImageExportName,
} from "./markdown.js";

/**
 * Every file the export holds, in the order it is written, from the rows
 * `export_trail_folder_list_data` returns. Pure: no Tauri, no filesystem.
 * The folder export (runExport) and the phone's zip (runExportZip) both
 * write exactly this, so the two cannot drift apart.
 *
 * The README is not in `files`: it counts the images actually copied, which
 * only the writer knows. `progress` on an entry is the page count to report
 * once that entry is written (after each trail's last file, and after each
 * untrailed page), which is when the folder export always reported it.
 *
 * @param {{lineages: any[], pages: any[], pins: any[]}} data
 * @returns {{files: Array<{path: string, content: string, progress?: number}>,
 *   images: Map<string, string|{blobHash: string}>, pageCount: number}}
 */
export function planExport({ lineages = [], pages = [], pins = [] }) {
  // 1. Build the trail-id → folder-path map by walking the lineages tree.
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

  // 2. Group pages and pins by their owning lineage_id (null = untrailed).
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

  const files = [];
  let pageCount = 0;
  // destFilename -> srcPath (localImage) | { blobHash } (attachment image)
  const images = new Map();

  // 3. Walk lineages: _trail.md + each page file. Collect image refs.
  for (const lineage of lineages) {
    const folder = folderPathById.get(lineage.id) || "";
    if (!folder) continue;

    const parent = lineage.parent_id ? lineageById.get(lineage.parent_id) : null;
    files.push({ path: joinPath(folder, "_trail.md"), content: serializeTrail({ lineage, parent }) });

    const trailPages = (pagesByLineage.get(lineage.id) || [])
      .sort((a, b) => a.date.localeCompare(b.date) || a.page_number - b.page_number);

    // Continuous: one canonical page only, as _doc.md. Discrete: one file
    // per page, disambiguated on same-day.
    const written = lineage.mode === "continuous" ? trailPages.slice(0, 1) : trailPages;
    const sameDayCounts = new Map();
    for (const page of written) {
      let filename = "_doc.md";
      if (lineage.mode !== "continuous") {
        const seen = sameDayCounts.get(page.date) || 0;
        sameDayCounts.set(page.date, seen + 1);
        filename = seen === 0 ? `${page.date}.md` : `${page.date} (${seen + 1}).md`;
      }
      const md = serializePage({
        page,
        lineage,
        lineagePath: breadcrumbById.get(lineage.id) || null,
        pins: pinsByPageId.get(page.id) || [],
      });
      files.push({ path: joinPath(folder, filename), content: md });
      pageCount++;
      collectImages(page, images);
    }
    files[files.length - 1].progress = pageCount;
  }

  // 4. Untrailed pages.
  const untrailed = pagesByLineage.get(null) || [];
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
    pageCount++;
    files.push({ path: joinPath("untrailed", filename), content: md, progress: pageCount });
    collectImages(page, images);
  }

  return { files, images, pageCount };
}

/** The README at the export's root, once the images are counted. */
async function readmeFile({ pageCount, trailCount, imageCount }) {
  const readme = serializeReadme({
    summary: {
      exported_at: new Date().toISOString(),
      page_count: pageCount,
      trail_count: trailCount,
      image_count: imageCount,
      shizumu_version: await safeAppVersion(),
    },
  });
  return { path: "README.md", content: readme };
}

export async function runExport(targetDir, { overwrite = false, onProgress = null } = {}) {
  const started = performance.now();

  // 1. Fetch all rows in one shot.
  const data = await invoke("export_trail_folder_list_data");
  const { lineages, pages, skipped_orphan_pin_count: skippedOrphanPins } = data;

  // 2. Validate + create target.
  await invoke("export_trail_folder_prepare", { targetDir, overwrite });

  // 3. Write every planned file.
  const plan = planExport(data);
  const totalPageCount = pages.length;
  for (const file of plan.files) {
    await invoke("export_trail_folder_write", {
      targetDir,
      relativePath: file.path,
      content: file.content,
    });
    if (onProgress && file.progress != null) onProgress({ pageCount: file.progress, totalPageCount });
  }

  // 4. Copy images.
  let imageCount = 0;
  for (const [filename, entry] of plan.images.entries()) {
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

  // 5. README at root.
  const readme = await readmeFile({ pageCount: plan.pageCount, trailCount: lineages.length, imageCount });
  await invoke("export_trail_folder_write", {
    targetDir,
    relativePath: readme.path,
    content: readme.content,
  });

  const tookMs = Math.round(performance.now() - started);
  return {
    pageCount: plan.pageCount,
    trailCount: lineages.length,
    imageCount,
    skippedOrphanPins,
    folderPath: targetDir,
    tookMs,
  };
}

/**
 * Where the phone's README says how many images its zip holds. Rust fills
 * it in once the images are packed (trail_export.rs, IMAGE_COUNT_SLOT, which
 * must match): only Rust knows which images it could read and which were
 * outside the app's own folders.
 */
export const IMAGE_COUNT_SLOT = "IMAGE_COUNT_PACKED";

/**
 * The phone's export: the same files as runExport, packed by Rust into one
 * zip and handed to the system share sheet (trail_export.rs,
 * export_trail_zip_share). Android only today; see that command.
 *
 * The README goes over on its own, with IMAGE_COUNT_SLOT for its image
 * count, so that it counts what the zip holds.
 */
export async function runExportZip() {
  const data = await invoke("export_trail_folder_list_data");
  const plan = planExport(data);
  const images = [];
  for (const [destFilename, entry] of plan.images.entries()) {
    const srcPath = await resolveImageSrcPath(entry);
    if (srcPath) images.push({ srcPath, destFilename });
  }
  const readme = await readmeFile({
    pageCount: plan.pageCount,
    trailCount: data.lineages.length,
    imageCount: IMAGE_COUNT_SLOT,
  });
  const files = plan.files.map(({ path, content }) => ({ path, content }));
  const packed = await invoke("export_trail_zip_share", { files, images, readme });
  return {
    pageCount: plan.pageCount,
    trailCount: data.lineages.length,
    imageCount: packed?.imageCount ?? 0,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

// Folder names the export's root keeps for itself: untrailed pages and
// copied images live there, so no trail may be named into them.
const ROOT_RESERVED = ["untrailed", "images"];

function walkLineageTree(parentId, parentBreadcrumb, parentFolder, childrenByParent, folderPathById, breadcrumbById) {
  const siblings = childrenByParent.get(parentId) || [];
  const names = siblingFolderNames(siblings, parentId == null ? ROOT_RESERVED : []);
  siblings.forEach((lineage, i) => {
    const folderName = names[i];
    const folder = parentFolder ? `${parentFolder}/${folderName}` : folderName;
    const breadcrumb = parentBreadcrumb.length > 0
      ? `${parentBreadcrumb.join(" › ")} › ${lineage.name}`
      : lineage.name;
    folderPathById.set(lineage.id, folder);
    breadcrumbById.set(lineage.id, breadcrumb);
    walkLineageTree(lineage.id, [...parentBreadcrumb, lineage.name], folder, childrenByParent, folderPathById, breadcrumbById);
  });
}

/**
 * One folder name per sibling, unique AFTER slugging and regardless of case
 * (Windows and macOS file systems fold case, so `Book/` and `book/` are one
 * folder there, and a zip refuses a repeated entry outright). Any slug that
 * two siblings share, or that names a reserved folder, gets `__<shortId>`
 * on every holder of it, as before; if even that repeats (ids that share
 * their first characters), a counter follows. Stable across runs because
 * `siblings` is ordered by name (the Rust query orders by name).
 */
export function siblingFolderNames(siblings, reserved = []) {
  const base = siblings.map((l) => slugify(l.name) || shortId(l.id));
  const counts = new Map();
  for (const r of reserved) counts.set(r.toLowerCase(), 1);
  for (const b of base) counts.set(b.toLowerCase(), (counts.get(b.toLowerCase()) || 0) + 1);
  const taken = new Set(reserved.map((r) => r.toLowerCase()));
  return siblings.map((lineage, i) => {
    let name = base[i];
    if (counts.get(name.toLowerCase()) > 1) name = `${name}__${shortId(lineage.id)}`;
    let candidate = name;
    for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${name}-${n}`;
    taken.add(candidate.toLowerCase());
    return candidate;
  });
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
