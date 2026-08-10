import { test, expect } from "@playwright/test";
import { SCENES, THEMES, sceneStates } from "../../src/lib/vr/scenes.js";
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
const LAYOUT_THEME = "cream";

async function gotoScene(page, query) {
  await page.goto(`/?vr=1&${query}`);
  await page.waitForFunction(() => window.__VR_READY__ === true, null, { timeout: 30000 });
}

for (const sceneId of Object.keys(SCENES)) {
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
for (const [sceneId, scene] of Object.entries(SCENES)) {
  for (const state of sceneStates(scene)) {
    test(`${sceneId} @ ${state}`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== PHONE_PROJECT, "interaction states are phone-shaped");
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
