// One place that puts things on the system clipboard.
//
// Inside the Tauri app, writes go through tauri-plugin-clipboard-manager
// (Rust side) rather than the webview. Two reasons, both measured:
//
//   1. WebKitGTK gates navigator.clipboard.* behind a permission prompt a
//      Tauri window has no way to grant (tauri-apps/tauri#12007). Probing the
//      real app, every async write — including plain writeText — rejected with
//      NotAllowedError.
//   2. Under Wayland the webview's clipboard integration fails outright: copy
//      produced nothing at all, while the same build on X11 worked. The plugin
//      depends on wl-clipboard-rs and talks to the compositor directly, so it
//      doesn't inherit that.
//
// READS deliberately stay on the web platform. The plugin's read_text is known
// to hang indefinitely on WebKit/Linux (tauri-apps/plugins-workspace#2267), and
// we never need it — pasted content arrives through the DOM `paste` event.
//
// Outside Tauri (browser dev, the VR harness) this falls back to
// navigator.clipboard, so nothing here depends on the desktop shell.

const isTauri = typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;

/**
 * Write text, and optionally an HTML flavour, to the system clipboard.
 *
 * @param {{ text: string, html?: string|null }} payload
 *   `text` is the plain-text flavour and is required — it is what every target
 *   can accept. `html` is optional and carries rich content (for block copy it
 *   also carries the embedded data-shizumu-block JSON).
 * @returns {Promise<boolean>} true if some flavour reached the clipboard.
 */
export async function writeClipboard({ text, html = null }) {
  if (typeof text !== "string") return false;

  if (isTauri) {
    try {
      const cb = await import("@tauri-apps/plugin-clipboard-manager");
      // writeHtml carries an alt plain-text flavour, so one call covers both
      // and the two flavours can't disagree.
      if (html) await cb.writeHtml(html, text);
      else await cb.writeText(text);
      return true;
    } catch (err) {
      // Fall through to the web API rather than failing the copy outright:
      // an older shell without the plugin, or a permission that was never
      // granted, should still get whatever the webview can manage.
      console.error("clipboard: plugin write failed, falling back", err);
    }
  }

  try {
    if (html && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([text], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        }),
      ]);
      return true;
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    console.error("clipboard: web write failed", err);
  }
  return false;
}
