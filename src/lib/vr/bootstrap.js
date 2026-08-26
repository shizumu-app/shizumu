// Runs before the Svelte app mounts. Dev/VITE_VR gated so production builds
// strip it. When ?vr=1 is present it installs determinism, seeds a scene,
// and publishes config for App.svelte to consume.
//
// The harness modules (clock/seed/scenes/fixtures) are imported DYNAMICALLY
// inside the gated branch below, not statically at the top. That way the
// production bundle never includes the VR module graph (or the fixture copy)
// at all — "absent from prod", not merely "inert in prod".

// One frozen instant for every VR capture. Chosen arbitrarily; must be stable.
const VR_CLOCK = "2026-01-15T09:00:00.000Z";

export function isVrRequested() {
  if (!(import.meta.env.DEV || import.meta.env.VITE_VR)) return false;
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("vr") === "1";
}

export async function bootstrapVR() {
  // Build-time gate first: in a production build both flags are statically
  // false, so Rollup dead-code-eliminates everything below this line — the
  // dynamic import()s are dropped and the VR chunks are never emitted.
  if (!(import.meta.env.DEV || import.meta.env.VITE_VR)) return;
  if (!isVrRequested()) return;

  const [{ installFixedClock, installSeqUuid }, { createSeededInvoke }, { getScene, THEMES, sceneStates }] =
    await Promise.all([
      import("./clock.js"),
      import("./seed.js"),
      import("./scenes.js"),
    ]);

  const params = new URLSearchParams(window.location.search);
  const sceneId = params.get("scene") || "page-blank";
  const theme = THEMES.includes(params.get("theme")) ? params.get("theme") : "cream";
  const scene = getScene(sceneId);
  // `state` is declarative only: it names an interaction state the capture
  // spec will drive with real input (hover, tap, viewport resize). Nothing
  // here puts the app into it — that would mean VR hooks inside components,
  // and would test the hook instead of the reveal path where the bugs were.
  // It is published so a scene can assert which state it is in, and stamped
  // on the root for state-specific VR styling if one ever needs it.
  const state = sceneStates(scene).includes(params.get("state")) ? params.get("state") : null;
  // A notch is a device condition Playwright cannot produce. global.css
  // reads every inset through --safe-*, so this attribute is the seam that
  // makes an inset regression visible to the screenshot suite.
  const inset = params.get("inset") === "notch" ? "notch" : null;

  installFixedClock(VR_CLOCK);
  installSeqUuid("vr");

  // A scene that declares `blobs` gets attachment images that actually
  // resolve; every other scene keeps the mock's blob-store gap, which is
  // what page-image-content and dead-image-ref exist to photograph. The
  // loader is a function so the bytes are fetched only for the scene that
  // asked for them.
  const blobs = typeof scene.blobs === "function" ? await scene.blobs() : undefined;
  window.__VR_INVOKE__ = await createSeededInvoke(scene.fixture, { blobs });
  window.__VR__ = {
    scene: sceneId,
    theme,
    space: scene.space,
    onboarding: scene.onboarding,
    state,
    inset,
  };
  document.documentElement.setAttribute("data-tone", theme);
  document.documentElement.setAttribute("data-vr", "1");
  if (state) document.documentElement.setAttribute("data-vr-state", state);
  if (inset) document.documentElement.setAttribute("data-vr-inset", inset);
}
