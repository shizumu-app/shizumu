// Reads the `enable_yjs` setting from the backend. Caches the value
// so the editor can check synchronously inside `onMount` without
// awaiting on every keystroke.
//
// On by default since v0.4 — continuous trails route through Y.Doc
// unless the user has explicitly opted out. Discrete trails ignore
// this flag entirely. The lazy backfill in TipTapEditor.svelte
// derives yjs_state from content_json on first open, so existing
// continuous pages converge to the yjs path without a migration.

import { getSetting, setSetting } from "../api.js";

const KEY = "enable_yjs";
let cached = null;

/// Returns true unless the user has explicitly opted out. Result is
/// cached after the first call.
export async function isYjsEnabled() {
  if (cached !== null) return cached;
  try {
    const raw = await getSetting(KEY);
    // Any value other than an explicit off sentinel means enabled —
    // including null / undefined for never-touched-the-setting installs.
    cached = raw !== "false" && raw !== "0";
  } catch {
    // Setting unreachable (backend hiccup): default-on. Worst case is
    // one editor mount goes through the yjs path; nothing breaks if
    // the read recovers next reload.
    cached = true;
  }
  return cached;
}

/// Force the cache to a known value — for the settings UI when the
/// user toggles the switch, so subsequent calls see the new state
/// without a full refetch.
export function setYjsEnabledCache(enabled) {
  cached = Boolean(enabled);
}

/// Persist the flag and update the in-process cache atomically.
export async function setYjsEnabled(enabled) {
  await setSetting(KEY, enabled ? "true" : "false");
  cached = Boolean(enabled);
}

/// Test-only: drop the cache so the next isYjsEnabled() call rereads
/// from the backend. Production code never calls this.
export function resetYjsFeatureFlagCache() {
  cached = null;
}
