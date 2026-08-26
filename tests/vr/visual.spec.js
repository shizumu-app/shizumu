import { test, expect } from "@playwright/test";
// VR_SCENE_IDS, not Object.keys(SCENES): the catalog also carries the
// marketing scenes the store/listing shots are taken from, and those must
// never be baselined — their content is copy, so a rewritten sentence would
// land here as a screenshot diff on three projects with no behaviour behind
// it. The filter lives in scenes.js (one list, unit-tested) rather than
// inline here, because this file iterates the catalog TWICE and a filter
// remembered in one loop and forgotten in the other is the whole bug.
import { SCENES, STATES, THEMES, VR_SCENE_IDS, sceneStates } from "../../src/lib/vr/scenes.js";
import { driverFor } from "./states.js";

// The onboarding flow is six slides behind a single scene; a lone capture of
// slide 1 left the other five without regression coverage (a real layout
// break shipped invisible to VR once). Walk the deck: capture, advance, repeat.
const ONBOARDING_SLIDES = 6;

// Interaction states and the simulated notch are captured on the phone
// project in one theme only. They guard LAYOUT, not colour, and they exist
// because phone-shaped bugs kept reaching devices — running them across
// every theme and engine would triple the baseline count to re-photograph
// the same geometry. Landscape likewise: same scenes, one theme.
const PHONE_PROJECT = "android-webview";
const LANDSCAPE_PROJECT = "android-landscape";
const DESKTOP_PROJECT = "win-webview2";
const LAYOUT_THEME = "cream";

// Which project an interaction state belongs on. Phone is the default and
// stays the rule — these states exist because phone-shaped bugs kept
// reaching devices. The shortcuts panel is the exception, and it is an
// exception the APP makes, not the harness: ShortcutHelp.svelte sets
// display:none under (pointer: coarse), so driving it on the phone project
// would click a button that does not render. A map rather than a second
// loop, so a state lands in exactly one project and adding one is a single
// line either way.
const STATE_PROJECT = {
  [STATES.SHORTCUT_PANEL]: DESKTOP_PROJECT,
};

async function gotoScene(page, query) {
  await page.goto(`/?vr=1&${query}`);
  await page.waitForFunction(() => window.__VR_READY__ === true, null, { timeout: 30000 });
  // __VR_READY__ (App.svelte's onMount) fires before Page.svelte/
  // TipTapEditor even mount, so it says nothing about whether the editor's
  // OWN content has settled: a chart's first Mermaid render (including its
  // lazy loadMermaid() import), or a board's title slot committing its
  // value. The interaction states below never raced this — they already
  // wait on real UI (e.g. states.js's `chip.waitFor({state:"visible"})`)
  // before shooting — but every load-time capture here had no equivalent
  // wait and has been racing the editor's own settle all along. Task 6's
  // chart scenes just exposed it first (a blockTitle string that was
  // there in one capture and not another; a few px of Mermaid SVG jitter).
  //
  // This is a set of content FACTS to poll for, not a guessed ceiling —
  // same shape as the __VR_READY__ wait above. `.ProseMirror` only exists
  // for a mounted page-space, non-onboarding scene (memory/pin-view have
  // no editor at all; onboarding renders the intro deck instead) — both
  // facts are already published on window.__VR__ by bootstrap.js, so this
  // reads an existing declarative signal rather than adding a new one.
  await page.waitForFunction(() => {
    const vr = window.__VR__;
    const needsEditor = vr && vr.space === "page" && !vr.onboarding;
    if (needsEditor && !document.querySelector(".ProseMirror")) return false;
    // No chart still mid-render, and every mounted chart has its SVG.
    if (document.querySelector(".chart-loading")) return false;
    const chartsSettled = [...document.querySelectorAll(".chart-render")].every(
      (el) => el.querySelector("svg"),
    );
    if (!chartsSettled) return false;
    // Every titled board's title slot has actually committed its value —
    // the white/dark chart evidence showed this racing independently of
    // the chart's own SVG.
    const titlesSettled = [...document.querySelectorAll(".block-shell[data-block-title]")].every(
      (el) => {
        const slot = el.querySelector(".board-title-slot");
        return !!slot && slot.value.trim().length > 0;
      },
    );
    return titlesSettled;
  }, null, { timeout: 30000 });
  // One paint boundary so layout after the last render above has actually
  // flushed — a frame to wait for, not a duration to guess.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

for (const sceneId of VR_SCENE_IDS) {
  for (const theme of THEMES) {
    test(`${sceneId} @ ${theme}`, async ({ page }, testInfo) => {
      // Landscape re-photographs the same scenes at a different aspect; one
      // theme is enough to catch a breakpoint falling back to desktop.
      test.skip(
        testInfo.project.name === LANDSCAPE_PROJECT && theme !== LAYOUT_THEME,
        "landscape covers layout, captured in one theme",
      );
      await gotoScene(page, `scene=${sceneId}&theme=${theme}`);
      if (sceneId === "onboarding") {
        for (let slide = 1; slide <= ONBOARDING_SLIDES; slide += 1) {
          await expect(page).toHaveScreenshot(
            `${sceneId}-s${slide}-${theme}.png`,
            { fullPage: true },
          );
          if (slide < ONBOARDING_SLIDES) {
            await page.getByRole("button", { name: /next/ }).click();
            await page.waitForTimeout(400);
          }
        }
      } else {
        await expect(page).toHaveScreenshot(`${sceneId}-${theme}.png`, {
          fullPage: true,
        });
      }
    });
  }
}

// ── interaction states ────────────────────────────────────────────────
// Everything above is the app the moment it settles. These are the states
// you have to do something to reach — where the block bar, the collapsed
// header and the expanded strip actually live.
for (const sceneId of VR_SCENE_IDS) {
  const scene = SCENES[sceneId];
  for (const state of sceneStates(scene)) {
    test(`${sceneId} @ ${state}`, async ({ page }, testInfo) => {
      const project = STATE_PROJECT[state] ?? PHONE_PROJECT;
      test.skip(testInfo.project.name !== project, `interaction state runs on ${project}`);
      await gotoScene(page, `scene=${sceneId}&theme=${LAYOUT_THEME}&state=${state}`);
      await driverFor(state)(page);
      // Not fullPage: the keyboard state deliberately shrinks the viewport,
      // and a full-page shot would stitch back the very area being tested.
      await expect(page).toHaveScreenshot(`${sceneId}-${state}.png`);
    });
  }
}

// ── simulated notch ───────────────────────────────────────────────────
// A device inset is the one condition the engine can't produce, so inset
// bugs were invisible here and found only by hand. global.css reads every
// inset through --safe-*, which ?inset=notch overrides.
for (const sceneId of ["page-content", "memory-list"]) {
  test(`${sceneId} @ notch`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== PHONE_PROJECT, "insets are phone-shaped");
    await gotoScene(page, `scene=${sceneId}&theme=${LAYOUT_THEME}&inset=notch`);
    await expect(page).toHaveScreenshot(`${sceneId}-notch.png`, { fullPage: true });
  });
}
