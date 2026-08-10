// Shared hover-preview card for pageRef tokens and pin-row source previews.
// One active card at a time; mounting destroys any prior. Position auto-flips
// above the anchor when near the viewport bottom.
//
// Two pieces:
//   - `getPagePreviewFor(pageId)` — resolves a page id to a preview entry
//     ({ date, fullPath, docJson, cacheKey, snippet }), cached per session.
//   - `mountPreviewCard(anchorEl, owner, entry, onClick)` — DOM mount + auto
//     position + click-through behavior.
//
// Theming via `.prose` + design-system tokens; no hardcoded colors. Used by
// `src/lib/extensions/page-ref.js` and `src/components/SharedObjectsPanel.svelte`.

import {
  getCanonicalTrailPage,
  getLineages,
  getPage,
  getPageForMention,
} from "../api.js";
import { trailPathFor } from "../mention-label.js";
import { renderDocHTML } from "./doc-renderer.js";
import { hydrateBlobImages } from "./blob-image-hydrate.js";

const PREVIEW_MAX_CHARS = 180;
const previewCache = new Map(); // pageId -> entry
const previewFetches = new Map(); // pageId -> Promise
let lineagesPromise = null;

function getLineagesOnce() {
  if (!lineagesPromise) lineagesPromise = getLineages().catch(() => []);
  return lineagesPromise;
}

/** Clear the preview cache and any inflight fetches. Page-ref's existing
 *  `shizumu:trail-mutated` event handler calls this through both modules. */
export function clearPagePreviewCache() {
  previewCache.clear();
  previewFetches.clear();
  lineagesPromise = null;
}

if (typeof window !== "undefined") {
  window.addEventListener("shizumu:trail-mutated", clearPagePreviewCache);
}

function extractTextPreview(doc, maxChars = PREVIEW_MAX_CHARS) {
  if (!doc || typeof doc !== "object") return "";
  const parts = [];
  let remaining = maxChars;
  function walk(node) {
    if (remaining <= 0) return;
    if (!node || typeof node !== "object") return;
    if (node.type === "dayMarker") return;
    if (node.attrs && node.attrs.pinId) return;
    if (typeof node.text === "string") {
      const t = node.text;
      parts.push(t.length > remaining ? t.slice(0, remaining) : t);
      remaining -= t.length;
      return;
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) {
        walk(child);
        if (remaining <= 0) break;
      }
    }
  }
  walk(doc);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function safeParse(raw) {
  try { return typeof raw === "string" ? JSON.parse(raw) : raw; }
  catch { return null; }
}

/**
 * Resolve a page id to a preview entry. Used by both pageRef tokens (the page
 * being referenced) and pin-row hovers (the pin's source page).
 *
 * Returns null when the page can't be found (deleted, never existed).
 * Cached per-session; cache cleared on `shizumu:trail-mutated`.
 */
export async function getPagePreviewFor(pageId) {
  if (!pageId) return null;
  const cached = previewCache.get(pageId);
  if (cached) return cached;
  let pending = previewFetches.get(pageId);
  if (pending) return pending;
  pending = (async () => {
    try {
      const [row, lineages] = await Promise.all([
        getPageForMention(pageId),
        getLineagesOnce(),
      ]);
      if (!row) return null;
      const fullPath = trailPathFor(row.lineage_id, lineages).join(" › ");
      let pageWithLines = null;
      try {
        if (row.lineage_mode === "continuous" && row.lineage_id) {
          pageWithLines = await getCanonicalTrailPage(row.lineage_id);
        } else {
          pageWithLines = await getPage(row.date, row.page_number);
        }
      } catch {}
      const raw = pageWithLines?.page?.content_json;
      const updatedAt = pageWithLines?.page?.updated_at ?? "";
      const entry = {
        date: row.date,
        fullPath,
        docJson: raw ?? null,
        cacheKey: `${pageId}:${updatedAt}:preview`,
        snippet: raw ? extractTextPreview(safeParse(raw), PREVIEW_MAX_CHARS) : "",
      };
      previewCache.set(pageId, entry);
      return entry;
    } finally {
      previewFetches.delete(pageId);
    }
  })();
  previewFetches.set(pageId, pending);
  return pending;
}

let activePreviewEl = null;
let activePreviewOwner = null;

/** Destroy the currently-mounted preview card, if any. */
export function destroyPreview() {
  if (activePreviewEl) {
    activePreviewEl.remove();
    activePreviewEl = null;
    activePreviewOwner = null;
  }
}

/** Return the owner that currently has a preview card mounted (or null). */
export function getActivePreviewOwner() {
  return activePreviewOwner;
}

/**
 * Mount a floating preview card anchored to `anchorEl`. `owner` identifies the
 * source element so cross-checks ("is the cursor still over the original?")
 * can disambiguate. `entry` is the shape returned by `getPagePreviewFor`.
 * `onClick` fires when the card body is clicked and is responsible for
 * navigating; the card destroys itself first.
 */
export function mountPreviewCard(anchorEl, owner, entry, onClick) {
  destroyPreview();
  if (!entry) return;
  const card = document.createElement("div");
  card.className = "page-ref-preview";
  card.style.cssText = `
    position: fixed;
    z-index: 220;
    background: var(--canvas-bg);
    border: 1px solid var(--card-border);
    box-shadow: 0 0.25rem 1rem var(--card-shadow);
    border-radius: 0.5rem;
    padding: 0.625rem 0.875rem;
    min-width: 16rem;
    max-width: 24rem;
    max-height: 18rem;
    overflow: hidden;
    color: var(--ink);
  `;

  const header = document.createElement("div");
  header.style.cssText = "font-family: 'Inter', sans-serif; font-size: 0.625rem; text-transform: lowercase; letter-spacing: 0.05em; color: var(--ink); opacity: 0.35; margin-bottom: 0.375rem;";
  const pathPart = entry.fullPath ? entry.fullPath : "(untrailed)";
  header.textContent = `${pathPart} · ${entry.date}`;
  card.appendChild(header);

  const body = document.createElement("div");
  if (entry.docJson) {
    const html = renderDocHTML(entry.docJson, { maxNodes: 4, cacheKey: entry.cacheKey });
    if (html) {
      body.className = "prose";
      body.style.cssText = "font-size: 0.8125rem; line-height: 1.5; opacity: 0.75; max-height: 12rem; overflow: hidden; position: relative;";
      body.innerHTML = html;
      // Attachment images ship srcless from generateHTML; resolve them
      // now that the markup is in the DOM. Fire-and-forget: the card is
      // already visible, images fade in when their paths come back.
      hydrateBlobImages(body);
    } else if (entry.snippet) {
      body.textContent = entry.snippet;
      body.style.cssText = "color: var(--ink); opacity: 0.75; font-family: 'Lora', serif; font-size: 0.8125rem; line-height: 1.5;";
    } else {
      body.textContent = "(empty page)";
      body.style.cssText = "color: var(--ink); opacity: 0.35; font-style: italic;";
    }
  } else if (entry.snippet) {
    body.textContent = entry.snippet;
    body.style.cssText = "color: var(--ink); opacity: 0.75; font-family: 'Lora', serif; font-size: 0.8125rem; line-height: 1.5;";
  } else {
    body.textContent = "(empty page)";
    body.style.cssText = "color: var(--ink); opacity: 0.35; font-style: italic;";
  }
  card.appendChild(body);

  card.addEventListener("mouseenter", () => {
    activePreviewOwner = owner;
  });
  card.addEventListener("mouseleave", () => {
    destroyPreview();
  });
  card.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    destroyPreview();
    if (typeof onClick === "function") onClick();
  });

  document.body.appendChild(card);
  activePreviewEl = card;
  activePreviewOwner = owner;

  const rect = anchorEl.getBoundingClientRect();
  const cardH = card.offsetHeight;
  const cardW = card.offsetWidth;
  let top = rect.bottom + 6;
  if (top + cardH > window.innerHeight - 8) {
    const flipped = rect.top - cardH - 6;
    top = flipped >= 8 ? flipped : Math.max(8, window.innerHeight - cardH - 8);
  }
  let left = rect.left;
  if (left + cardW > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - cardW - 8);
  }
  card.style.top = `${top}px`;
  card.style.left = `${left}px`;
}
