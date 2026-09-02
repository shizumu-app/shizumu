// Demo-only stand-in for the @tauri-apps modules, wired by a vite alias in the
// demo build only (see vite.config.js). The shipped app never loads this file.
//
// Why a module seam and not more guards at the call sites: the demo intercepts
// commands inside api.js's call(), but parts of the UI reach Tauri directly and
// never pass through it - Settings' export picker imports plugin-dialog,
// src/lib/export/run.js imports invoke from api/core, and Page and
// SyncStatusPill call listen from api/event on mount. In a browser those throw.
// One alias covers all of them, including the ones nobody has written yet.
import { noticeFor } from "./unavailable.js";

function raise(text) {
  if (typeof window !== "undefined" && typeof window.__DEMO_NOTICE__ === "function") {
    window.__DEMO_NOTICE__(text);
  }
}

/** Routed through the demo invoke so the unavailable-command rules still apply. */
export async function invoke(cmd, args) {
  if (typeof window !== "undefined" && typeof window.__DEMO_INVOKE__ === "function") {
    return window.__DEMO_INVOKE__(cmd, args);
  }
  return null;
}

/** Event subscriptions have nothing to deliver here. Returns the unsubscribe
 *  the real listen returns, so callers can store and call it unchanged. */
export async function listen() {
  return () => {};
}

export function convertFileSrc(path) {
  return path;
}

export async function getVersion() {
  return "demo";
}

/** The file/directory picker. Returns null, which is exactly what the real
 *  dialog returns on cancel, so every caller already handles it - and raises
 *  the notice so the visitor learns why nothing opened. */
export async function open() {
  raise(noticeFor("export_pages_gui")?.text ?? "");
  return null;
}

export async function save() {
  raise(noticeFor("backup_database_gui")?.text ?? "");
  return null;
}

export async function message() {
  return null;
}

/** Not called from app code directly - it exists so that a real Tauri
 *  plugin's own static imports from @tauri-apps/api/core (e.g.
 *  @tauri-apps/plugin-notification, reached via a dynamic import in
 *  src/lib/api.js guarded by `if (!isTauri) return`) resolve during
 *  dev's dependency pre-bundling and a demo build's bundling, even though
 *  that guard means the real function body never runs in a browser. */
export async function addPluginListener() {
  return { unregister: async () => {} };
}
