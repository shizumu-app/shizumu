// Build a deterministic, pre-seeded invoke for one scene. The caller must
// have already installed the fixed clock + sequential uuid (so the mock's
// internal new Date()/crypto.randomUUID() are frozen).
import { createMockInvoke } from "../api.js";

/**
 * Make an attachment image actually RENDER under the seeded mock.
 *
 * Two separate things stand between a fixture's `attachment` node and a
 * bitmap on screen, and patching either one alone still shows the
 * "image not on this device" fallback:
 *
 *   1. `attachment_local_src` — the mock answers null for it ("No blob
 *      store in mock mode", api.js), because there is no blob store.
 *   2. `convertFileSrc` — AttachmentBlock.svelte hands the path it got to
 *      `@tauri-apps/api/core`'s convertFileSrc, which reads
 *      `window.__TAURI_INTERNALS__.convertFileSrc`. In a plain browser that
 *      global does not exist, the call throws, and the catch clears the src.
 *
 * So this installs both halves together, off ONE option, rather than
 * leaving the second half for the next person to rediscover.
 *
 * Only reached when a scene supplies blobs. Marketing scenes do; every
 * baselined VR scene leaves `opts.blobs` undefined and keeps today's
 * behaviour exactly — `page-image-content` and `dead-image-ref` exist to
 * photograph the missing-image fallback, and must keep photographing it.
 *
 * @param {(cmd: string, args?: any) => Promise<any>} invoke
 * @param {Record<string, string>} blobs  blob_hash -> data URI (or any URL
 *        the page can load directly).
 */
function withBlobs(invoke, blobs) {
  // The identity shim, not a real Tauri global: convertFileSrc's whole job
  // here is to hand back what it was given, since `blobs` already holds
  // something an <img> can load. Set only if nothing else claimed the
  // global — never overwrite a real Tauri runtime.
  if (typeof window !== "undefined" && !window.__TAURI_INTERNALS__) {
    window.__TAURI_INTERNALS__ = { convertFileSrc: (path) => path };
  }
  return (cmd, args) => {
    if (cmd === "attachment_local_src") {
      return Promise.resolve(blobs[args?.blobHash] ?? null);
    }
    return invoke(cmd, args);
  };
}

/**
 * @param {(invoke: Function) => Promise<void>} fixture
 * @param {{ blobs?: Record<string, string> }} [opts]
 */
export async function createSeededInvoke(fixture, opts = {}) {
  const invoke = createMockInvoke();
  // Suppress the one-time mobile gestures tip before the fixture runs. It is
  // a transient toast fired on coarse pointers when this setting is unset, so
  // whether a screenshot catches it depends on how long the fixture's awaits
  // happened to take — adding one await to a fixture is enough to start
  // capturing it. Deterministic scenes can't depend on losing that race.
  await invoke("set_setting", { key: "mobile_gestures_tip_seen", value: "true" });
  await fixture(invoke);
  const blobs = opts.blobs;
  if (!blobs || Object.keys(blobs).length === 0) return invoke;
  return withBlobs(invoke, blobs);
}
