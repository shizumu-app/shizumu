// src/lib/navstack.js
//
// The single owner of "what's open". Every dismissable surface (bottom
// sheet, settings, settings section, memory space, trails drawer)
// registers an entry on open. Android hardware back, the browser back
// button, the left-edge back swipe, and Esc all funnel through the same
// stack, so back always closes the topmost thing — never the app while
// something is open.
//
// Invariant: every live-or-closed entry in `stack` owns exactly one
// shizumu history state, so one popstate consumes exactly one entry.
// Programmatic closes of NON-top entries defer their history pop (the
// orphan state is swallowed silently when back reaches it).
//
// Replaces the two hand-rolled pushState/suppression implementations
// that previously lived in Settings.svelte and BottomSheet.svelte.

let stack = [];
let nextId = 1;
let suppress = 0;
let subscribers = new Set();
let installed = false;

function snapshot() {
  const live = stack.filter((e) => !e.closed);
  const tags = new Set(live.map((e) => e.tag));
  return {
    depth: live.length,
    top: live.at(-1)?.tag ?? null,
    hideBar: live.some((e) => e.hideBar),
    has(tag) { return tags.has(tag); },
  };
}

function emit() {
  const snap = snapshot();
  for (const cb of subscribers) cb(snap);
}

export function subscribe(cb) {
  subscribers.add(cb);
  cb(snapshot());
  return () => subscribers.delete(cb);
}

export function navPush(tag, onClose, opts = {}) {
  const entry = { id: nextId++, tag, onClose, hideBar: !!opts.hideBar, closed: false };
  stack.push(entry);
  if (typeof window !== "undefined" && window.history) {
    window.history.pushState({ shizumu: tag, navId: entry.id }, "");
  }
  emit();
  return entry.id;
}

// Shared by navClose and navPopAll: once an entry is marked closed, rewind
// history for every closed entry sitting on top of the stack (a single
// history.go(-N) fires exactly one popstate regardless of N).
function popTrailingClosed() {
  let trailing = 0;
  while (stack.length && stack.at(-1).closed) {
    stack.pop();
    trailing += 1;
  }
  if (trailing > 0 && typeof window !== "undefined" && window.history) {
    suppress += 1;
    window.history.go(-trailing);
  }
}

export function navClose(id) {
  const entry = stack.find((e) => e.id === id && !e.closed);
  if (!entry) return;
  entry.closed = true;
  popTrailingClosed();
  emit();
}

// Sweeps every live entry matching `pred` — closing it through its own
// onClose (so its owner's state actually unwinds, exactly like a hardware-
// back dismiss) and dropping it from the stack. Used on top-level space
// switches (MobileActionBar's pages/memory/settings callbacks) to sweep
// hideBar entries a sheet left behind: a stale hideBar entry is exactly
// what latched the bar hidden until restart, so a survivor here is a bug,
// never a case to special-case around.
export function navPopAll(pred = () => true) {
  const targets = stack.filter((e) => !e.closed && pred(e));
  if (targets.length === 0) return;
  for (const e of targets) {
    try { e.onClose?.(); } catch {}
    e.closed = true;
  }
  popTrailingClosed();
  emit();
}

export function navBack() {
  if (typeof window !== "undefined" && window.history) window.history.back();
}

function handlePopState() {
  if (suppress > 0) {
    suppress -= 1;
    return;
  }
  const entry = stack.pop();
  if (entry && !entry.closed) {
    entry.closed = true;
    entry.onClose?.();
  }
  // If entry was already closed this popstate just consumed its orphan
  // history state — nothing to do. Empty stack: the OS owns back.
  emit();
}

export function initNavStack() {
  if (installed || typeof window === "undefined") return () => {};
  installed = true;
  const handler = () => handlePopState();
  window.addEventListener("popstate", handler);
  return () => {
    installed = false;
    window.removeEventListener("popstate", handler);
  };
}

export function _resetForTests() {
  stack = [];
  nextId = 1;
  suppress = 0;
  subscribers = new Set();
  installed = false;
}
