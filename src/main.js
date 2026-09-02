import { mount } from "svelte";
import App from "./App.svelte";
import { bootstrapVR } from "./lib/vr/bootstrap.js";
import { bootstrapDemo } from "./lib/demo/bootstrap.js";
import { installFocusTrace } from "./lib/focus-field.js";

// Dev-only: logs every focusin/focusout with target + call-site stack so the
// mobile "keyboard flashes and disappears" blur thief is identifiable
// on-device. Stripped from production builds by import.meta.env.DEV.
if (import.meta.env.DEV) installFocusTrace(window);

// bootstrapVR() must finish before mount so the VR harness has installed its
// seeded invoke / config before App's onMount issues any api calls. It is a
// no-op (resolves immediately) outside the dev/VITE_VR-gated VR path. Using
// .then() instead of top-level await keeps the production build target happy
// (default build target does not allow top-level await).
bootstrapVR()
  .then(() => bootstrapDemo())
  .then(() => {
    mount(App, {
      target: document.getElementById("app"),
    });
  })
  .catch((err) => {
    // If bootstrap throws (e.g. a bad VR scene/seed), surface it instead of
    // leaving a blank page — otherwise VR captures just time out opaquely.
    const target = document.getElementById("app");
    if (target) target.textContent = `bootstrap failed: ${err}`;
    throw err;
  });
