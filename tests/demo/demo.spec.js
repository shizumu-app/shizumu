import { test, expect } from "@playwright/test";

async function openDemo(page) {
  // No storage clear here: addInitScript runs before EVERY document load on
  // this page, not just the first, so it also re-fires (and wipes what was
  // just saved) on this test's own page.reload() calls and on the reload
  // "start over" triggers from inside the app. Playwright already gives
  // every test a fresh, isolated browser context with empty localStorage,
  // which is all a clean-slate start needs.
  await page.goto("./");
  // Not toBeVisible(): #demo-chrome's only children (.demo-card, .demo-pill
  // in DemoStrip.svelte) are position: fixed, so the host div itself always
  // collapses to a zero-height box and can never satisfy a visibility
  // check. Attached is as far as this locator alone can prove; the
  // assertion right below recovers the real visibility guarantee on an
  // element that actually has a box.
  await expect(page.locator("#demo-chrome")).toBeAttached();
  // Dismiss the one-time intro so it does not sit over the controls. This
  // also asserts DemoStrip actually mounted with visible content — a
  // Playwright click auto-waits for the target to be visible, but stating
  // it explicitly means a failed mount fails here, on this line, with a
  // clear reason, rather than surfacing later as an unrelated timeout.
  await expect(page.getByRole("button", { name: "ok" })).toBeVisible();
  await page.getByRole("button", { name: "ok" }).click();
}

test("lands on an empty page with memory already seeded", async ({ page }) => {
  await openDemo(page);
  // No onboarding: the fixture marks it complete, so the writing surface is
  // the first thing a visitor sees.
  await expect(page.locator(".ProseMirror")).toHaveText("");
  await expect(page.getByText("trail (optional)")).toBeVisible();
});

test("keeps what you wrote across a reload", async ({ page }) => {
  await openDemo(page);
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("a line the demo has to keep");
  // The brief's comment says "past the 500ms debounce", but that is only
  // the second of two stacked debounces: TipTapEditor's own save is
  // debounced 1000ms (TipTapEditor.svelte's debouncedSave), and only once
  // that fires does bootstrap.js's own 500ms persistence debounce start.
  // Measured directly against the built bundle: localStorage does not
  // change until ~1500ms after the last keystroke. 1200ms landed inside
  // that window and reads back "" on reload.
  await page.waitForTimeout(1800);
  await page.reload();
  await expect(page.locator(".ProseMirror")).toContainText("a line the demo has to keep");
});

test("choosing the book trail brings the carry-forward pins onto the page", async ({ page }) => {
  await openDemo(page);
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("today's first line");

  await page.getByText("trail (optional)").click();
  await page.locator("button.lineage-option", { hasText: "book" }).first().click();

  // The three pins seeded with auto_insert arrive on the page. This is the
  // demo's reason to exist, and the assertion that fails the moment a pin
  // loses auto_insert or get_carry_forward_pins regresses to [].
  await expect(page.locator(".ProseMirror")).toContainText("she never explains herself");
  await expect(page.locator(".ProseMirror")).toContainText("somewhere to go");
});

test("an unavailable action explains itself instead of erroring", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("button", { name: "settings" }).click();
  // Export lives under the "data" tab; settings opens on "appearance" by
  // default, so the button is not in the DOM until this nav click happens.
  await page.getByRole("button", { name: "data", exact: true }).click();
  await page.getByRole("button", { name: "export", exact: true }).click();
  await expect(page.getByText("they run in the installed app")).toBeVisible();
  // No error surface: a noticed command resolves rather than rejecting.
  await expect(page.getByText(/failed|error/i)).toHaveCount(0);
});

// Guards two fixes: the reload this button triggers actually completes
// (rather than losing the race against Modal's own history.go(-1) on close,
// commit 60523234), and the reset it performs survives the pagehide flush
// that same reload fires on the way out (commit 37aa549a).
test("start over returns to the seeded state", async ({ page }) => {
  await openDemo(page);
  await page.locator(".ProseMirror").click();
  await page.keyboard.type("this should not survive start over");
  await page.waitForTimeout(1800); // see the reload test's comment on the real debounce chain
  await page.locator("#demo-chrome").getByRole("button", { name: "start over" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "start over" }).click();
  await expect(page.locator(".ProseMirror")).not.toContainText("this should not survive");
  // Not just gone — actually reseeded: today's page is back on the fresh,
  // untrailed writing surface the fixture always starts on (same control
  // asserted in "lands on an empty page with memory already seeded"), so a
  // reset that cleared storage but reseeded nothing would fail here too.
  await expect(page.getByText("trail (optional)")).toBeVisible();
});

test("search finds a seeded page by its content", async ({ page }) => {
  await openDemo(page);
  // Guards the content_json gap in spec section 4.5: search used to read
  // store.lines, which a seeded page never populates.
  await page.getByRole("button", { name: "open memory" }).click();
  // Memory opens in "trail map" mode by default (Memory.svelte's own
  // initial state), whose rows show only a page's title. The content
  // snippet this test is guarding is ThreadCard's, which only renders in
  // "pages" mode.
  await page.getByRole("radio", { name: "pages" }).click();
  await page.getByPlaceholder("search your writing").fill("harbour");
  await expect(page.getByText(/harbour at dusk/)).toBeVisible();
});
