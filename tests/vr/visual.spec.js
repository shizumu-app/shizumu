import { test, expect } from "@playwright/test";
// VR_SCENE_IDS, not Object.keys(SCENES): the catalog also carries the
// marketing scenes the store/listing shots are taken from, and those must
// never be baselined — their content is copy, so a rewritten sentence would
// land here as a screenshot diff on three projects with no behaviour behind
// it. The filter lives in scenes.js (one list, unit-tested) rather than
// inline here, because this file iterates the catalog TWICE and a filter
// remembered in one loop and forgotten in the other is the whole bug.
import {
  SCENES, STATES, THEMES, VR_SCENE_IDS,
  sceneSlides, sceneStates, sceneSurface, sceneViewportHeight,
} from "../../src/lib/vr/scenes.js";
import { driverFor } from "./states.js";

// An onboarding deck is several slides behind a single scene; a lone capture
// of slide 1 left the rest without regression coverage (a real layout break
// shipped invisible to VR once). Walk the deck: capture, advance, repeat.
//
// The COUNT lives on the scene now (`sceneSlides`), not here. It was
// `const ONBOARDING_SLIDES = 6` beside an `if (sceneId === "onboarding")`,
// which held while there was one deck; the shell's gate is a second, four
// slides long, and two counts matched by scene id in a file that imports
// neither component is two things to keep in step by hand.

// Interaction states and the simulated notch are captured on the phone
// project in one theme only. They guard LAYOUT, not colour, and they exist
// because phone-shaped bugs kept reaching devices — running them across
// every theme and engine would triple the baseline count to re-photograph
// the same geometry. Landscape likewise: same scenes, one theme.
const PHONE_PROJECT = "android-webview";
const LANDSCAPE_PROJECT = "android-landscape";
const DESKTOP_PROJECT = "win-webview2";
const IOS_PROJECT = "ios-webkit";
const LAYOUT_THEME = "cream";

// Which tree each project is here to photograph. Both Android projects
// carry both surfaces because the two trees coexist until P5 — today's
// mobile app and the shell are both real, and both need shooting.
// ios-webkit exists only for the shell: it has no desktop tree to check,
// and pointing it at the nine desktop scenes would produce nine images at
// iPhone size that nobody would ever read.
const PROJECT_SURFACES = {
  "win-webview2": ["desktop"],
  "linux-webkitgtk": ["desktop"],
  "android-webview": ["desktop", "shell"],
  // Landscape is 360px tall and exists to catch a breakpoint falling back
  // to the desktop layout on a real short-and-wide screen; a component
  // catalogue cannot tell it anything about that, and a catalogue shot at
  // 360px would be mostly cropping.
  "android-landscape": ["desktop"],
  "ios-webkit": ["shell"],
};

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
  // The second exception, and it is an exception the PLATFORM makes. The
  // iOS keyboard fixture puts the engine into `resizes-visual` — the mode
  // WKWebView uses and the one `interactive-widget=resizes-content` turns
  // off everywhere the phone project runs — so driving it on
  // android-webview would photograph a viewport mode that engine does not
  // have, under a name saying it does. `ios-webkit` is WebKit at an iPhone
  // viewport, which is as close as this suite gets; see
  // STATES.IOS_KEYBOARD_SHEET for what that is and is not worth.
  //
  // This project runs only inside the pinned Docker image (webkit needs
  // ICU 74 versioned symbols, which bare Fedora 42 does not have), so
  // `npm run test:vr` skips this state entirely and `npm run
  // test:vr:docker` is the only gate on it.
  [STATES.IOS_KEYBOARD_SHEET]: IOS_PROJECT,
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
    // A chromeless gate renders no editor, so the wait above says nothing
    // about it — and App.svelte imports ShellGate LAZILY, after
    // __VR_READY__ has already resolved. toHaveScreenshot settles on two
    // matching frames, and two blank frames match, so without this the deck
    // could be baselined as an empty page. `.shell-gate` is the gate's own
    // root element, which is the same kind of published fact as `.ProseMirror`
    // above rather than a duration guessed at.
    if (vr && vr.surface === "shell" && vr.onboarding
        && !document.querySelector(".shell-gate")) return false;
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

// VR_SCENE_IDS (main) filters marketing scenes out of baselining;
// `scene` is still needed by the shell's surface/viewport rules below.
for (const sceneId of VR_SCENE_IDS) {
  const scene = SCENES[sceneId];
  for (const theme of THEMES) {
    test(`${sceneId} @ ${theme}`, async ({ page }, testInfo) => {
      // Landscape re-photographs the same scenes at a different aspect; one
      // theme is enough to catch a breakpoint falling back to desktop.
      test.skip(
        testInfo.project.name === LANDSCAPE_PROJECT && theme !== LAYOUT_THEME,
        "landscape covers layout, captured in one theme",
      );
      const surfaces = PROJECT_SURFACES[testInfo.project.name] ?? ["desktop"];
      test.skip(
        !surfaces.includes(sceneSurface(scene)),
        `${testInfo.project.name} does not photograph the ${sceneSurface(scene)} tree`,
      );
      const forcedHeight = sceneViewportHeight(scene);
      if (forcedHeight) {
        // A catalogue has to show every primitive, and the shell gallery
        // runs to some 2100px since the visual pass (the scene's own
        // comment in scenes.js carries the number and how sure it is).
        // iPhone 14 is 664 and would cut everything past the strips off —
        // and the app is a non-scrolling shell (App.svelte's .app-shell and
        // .canvas both overflow:hidden), so fullPage cannot reach past the
        // viewport. Widths stay each project's real width; only the height
        // is raised, because we are photographing components here, not
        // testing how a 390px screen lays them out.
        //
        // The scene asks for this, not the surface. A shell SCREEN wants the
        // device's own height — that is the thing under test — so it carries
        // no viewportHeight and falls through here untouched.
        const width = testInfo.project.use.viewport?.width ?? 412;
        await page.setViewportSize({ width, height: forcedHeight });
      }
      await gotoScene(page, `scene=${sceneId}&theme=${theme}`);
      const slides = sceneSlides(scene);
      if (slides) {
        for (let slide = 1; slide <= slides; slide += 1) {
          await expect(page).toHaveScreenshot(
            `${sceneId}-s${slide}-${theme}.png`,
            { fullPage: true },
          );
          if (slide < slides) {
            // By its accessible name, which is also the assertion. Both decks
            // label the last slide's control differently from the rest — the
            // shell's `gateStep` returns `action` and `last` off one
            // comparison precisely so `begin` and "this tap finishes" cannot
            // disagree — so a deck that mislabelled its last slide would
            // stall here on a button reading `next` that had nothing to
            // advance to, rather than quietly capturing the same slide twice.
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
// shell-page joins the two desktop scenes because the shell makes a claim
// the desktop tree does not: ShellRoot subtracts the insets once, at the
// frame, and every surface inside it is inset-blind by construction. On an
// inset-free engine the tab bar simply sits on the bottom edge and that
// claim is untested — the home indicator is the whole point of the bottom
// slot, and it is the one condition the engine cannot produce by itself.
for (const sceneId of ["page-content", "memory-list", "shell-page"]) {
  test(`${sceneId} @ notch`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== PHONE_PROJECT, "insets are phone-shaped");
    await gotoScene(page, `scene=${sceneId}&theme=${LAYOUT_THEME}&inset=notch`);
    await expect(page).toHaveScreenshot(`${sceneId}-notch.png`, { fullPage: true });
  });
}

// ── the band clears the inset, as arithmetic ──────────────────────────
//
// THE QUESTION THIS ANSWERS, asked twice from a phone: is the shell's bottom
// row underneath Android's navigation buttons? The screenshots above would
// show it to someone who looked at them, and that is the whole problem — a
// baseline is only consulted when it changes, and this went to a device
// twice, both times because --safe-bottom was 0 and nothing in the suite
// had an opinion about the number.
//
// An ASSERTION, not a snapshot, so it needs no recorded baseline and says
// what it wants in its own failure message. It is also the only check in
// this file that would survive the inset arriving from somewhere new: it
// reads --safe-bottom as the app resolved it, whether that came from
// ?inset=notch here, env() on iOS, or the activity's measurement on Android
// (src/lib/safe-area.js).
test("shell-page @ notch keeps the band above the inset", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== PHONE_PROJECT, "insets are phone-shaped");
  // THE TWO-ROW BAND, not the resting one, and the difference is the whole
  // test. --slot-h is `3.25rem + var(--safe-bottom)`, so a ONE-row band
  // reserves the inset through its own min-height whether or not anything
  // pays for it: delete the padding and this still passes, which is a check
  // that cannot fail on the bug it was written for. A band with a strip
  // above the nav row exceeds that floor on content, and from there the
  // padding is the only thing holding the rows off the bottom edge.
  //
  // It is also the state the complaint came from — the row was photographed
  // in the system's button strip while the writer was typing.
  await gotoScene(page, `scene=shell-page&theme=${LAYOUT_THEME}&inset=notch&state=${STATES.BLOCK_STRIP}`);
  await driverFor(STATES.BLOCK_STRIP)(page);
  // The precondition for the precondition: a one-row band would pass this
  // test on --slot-h alone, so the strip has to actually be there.
  await expect(page.locator(".shell-toolbar-strip")).toBeVisible();

  const measured = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    const row = document.querySelector(".shell-tabbar");
    return {
      safe: Number.parseFloat(css.getPropertyValue("--safe-bottom")) || 0,
      bottom: row ? row.getBoundingClientRect().bottom : null,
      viewport: window.innerHeight,
    };
  });

  // The precondition, stated so the check cannot pass vacuously. A 0 inset
  // or a missing row would make every assertion below trivially true, which
  // is exactly the shape of the bug being tested for.
  expect(measured.safe).toBeGreaterThan(0);
  expect(measured.bottom).not.toBeNull();

  const floor = measured.viewport - measured.safe;
  expect(
    measured.bottom,
    `the tab bar's bottom edge is at ${measured.bottom} in a ${measured.viewport}px ` +
      `viewport with a ${measured.safe}px inset — it must stop at or above ${floor}, ` +
      "or the row is in the strip the system's own buttons are drawn in",
  ).toBeLessThanOrEqual(floor + 1);
});
