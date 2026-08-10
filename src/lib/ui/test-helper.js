// Shared mount/unmount harness for ui/* component tests.
// Uses Svelte 5's mount() API directly (no @testing-library/svelte in repo).
import { mount, unmount } from "svelte";

/**
 * Mount a component into a fresh container, return { el, instance, cleanup }.
 * Caller is responsible for calling cleanup() — or use `afterEach(cleanupAll)`.
 */
const mounted = new Set();

export function render(Component, props = {}, { context } = {}) {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const mountOpts = { target, props };
  if (context) mountOpts.context = context;
  const instance = mount(Component, mountOpts);
  const entry = { target, instance };
  mounted.add(entry);
  return {
    target,
    instance,
    el: target.firstElementChild,
    cleanup() {
      mounted.delete(entry);
      unmount(instance);
      target.remove();
    },
  };
}

export function cleanupAll() {
  for (const entry of mounted) {
    try {
      unmount(entry.instance);
    } catch {}
    entry.target.remove();
  }
  mounted.clear();
}
