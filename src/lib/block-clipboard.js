// block-clipboard.js — pure serialize/parse helpers for the block-level
// copy/paste round trip (⎘ handle and Ctrl/Cmd+Shift+C).
//
// Chromium's Clipboard API rejects arbitrary custom MIME types passed to
// `ClipboardItem`/`navigator.clipboard.write()` — writing
// "application/x-shizumu-block+json" directly throws "Type ... not
// supported on write" on both desktop Chromium and Android WebView (two of
// shizumu's three shipping engines; see the QA sweep's D-3). The
// Chromium-compatible strategy: carry the block's JSON payload INSIDE the
// text/html payload, as an HTML-escaped attribute on a wrapper element, and
// write only well-known clipboard types (text/html, text/plain). On paste,
// the editor checks text/html for that wrapper first and reconstructs the
// node from the embedded JSON; anything else falls through to the default
// paste pipeline.
//
// These functions are pure (no clipboard, no editor) so the round trip is
// unit-testable without mocking navigator.clipboard — see
// __tests__/block-clipboard.test.js.

export const SHIZUMU_BLOCK_ATTR = "data-shizumu-block";

/** Escape a string for safe embedding inside a double-quoted HTML attribute. */
export function escapeHtmlAttr(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Wrap a block's serialized inner HTML with a `data-shizumu-block` carrier
 * div holding the block's ProseMirror JSON (HTML-escaped). The wrapper is
 * itself valid, readable HTML — a plain-text/rich-text paste target that
 * doesn't understand the attribute still renders the block's content.
 */
export function serializeBlockToHtml(innerHtml, nodeJson) {
  const json = JSON.stringify(nodeJson);
  const attr = escapeHtmlAttr(json);
  return `<div ${SHIZUMU_BLOCK_ATTR}="${attr}">${innerHtml || ""}</div>`;
}

/**
 * Parse an HTML string for an embedded shizumu block payload. Returns the
 * parsed node JSON, or null if the wrapper/attribute isn't present or the
 * embedded JSON fails to parse.
 */
export function parseBlockFromHtml(html) {
  if (!html) return null;
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const wrapper = doc.querySelector(`[${SHIZUMU_BLOCK_ATTR}]`);
    if (!wrapper) return null;
    const raw = wrapper.getAttribute(SHIZUMU_BLOCK_ATTR);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
