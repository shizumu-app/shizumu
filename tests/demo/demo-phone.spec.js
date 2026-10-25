import { test, expect } from "@playwright/test";
import { serialize, DEMO_STORAGE_KEY } from "../../src/lib/demo/persistence.js";
import { SEED_VERSION } from "../../src/lib/demo/fixture.js";
import { DEMO_COPY } from "../../src/lib/demo/copy.js";

// The demo on a phone, through the real boot: `page.goto("./")`, never the
// VR harness's `?vr=1`, because the thing under test is the demo's own
// decision to let the device pick the layout (bootstrap.js leaves
// `try_new_shell` unset). A harness entry that mounted the shell directly
// would pass with that decision reverted.
//
// Selectors are the shell's own, the ones tests/vr/states.js drives:
// `.shell-tab[data-tab-id]`, `.ph-trail-button`, `.shell-sheet[data-sheet]`,
// `.shell-stack-entry[data-top="true"] .shell-row`. Every tap is a real
// tap() (the phone projects set hasTouch), so a control that only answers a
// mouse fails here.

async function openDemo(page) {
  await page.goto("./");
  // See demo.spec.js's openDemo: #demo-chrome's children are position:
  // fixed, so the host itself never has a box. The intro's button does.
  await expect(page.locator("#demo-chrome")).toBeAttached();
  const ok = page.getByRole("button", { name: DEMO_COPY.ok, exact: true });
  await expect(ok).toBeVisible();
  await ok.tap();
  await expect(page.locator(".shell-root")).toBeVisible();
}

async function typeOnToday(page, text) {
  const editor = page.locator(".ProseMirror").first();
  await editor.tap();
  await page.keyboard.type(text);
}

/** `tapScreenRow` in tests/vr/states.js: a row on the screen on top. */
async function tapScreenRow(page, label) {
  const row = page
    .locator('.shell-stack-entry[data-top="true"] .shell-row')
    .filter({ has: page.locator(`.shell-row-label:text-is("${label}")`) });
  await expect(row).toBeVisible();
  await row.tap();
}

test("a phone gets the phone app", async ({ page }) => {
  await openDemo(page);
  await expect(page.locator(".shell-tabbar")).toBeVisible();
  await expect(page.locator('.shell-tab[data-tab-id="page"]')).toBeVisible();
});

test("today's page takes a line and keeps it across a reload", async ({ page }) => {
  await openDemo(page);
  await typeOnToday(page, "a line the phone has to keep");
  // demo.spec.js's reload test has the measurement: the editor's 1000ms
  // save and then bootstrap.js's 500ms persistence debounce, stacked.
  await page.waitForTimeout(1800);
  await page.reload();
  await expect(page.locator(".shell-root")).toBeVisible();
  await expect(page.locator(".ProseMirror").first()).toContainText("a line the phone has to keep");
});

test("putting today's page on the book trail brings its pins", async ({ page }) => {
  await openDemo(page);
  await typeOnToday(page, "today's first line");

  // The shell's own picker: the header's trail tag opens the trail sheet
  // (the TRAIL_SHEET state in tests/vr/states.js), and a row assigns.
  await page.locator(".ph-trail-button").tap();
  const row = page
    .locator('.shell-sheet[data-sheet="trail"] .shell-row')
    .filter({ has: page.locator('.shell-row-label:text-is("book")') });
  await expect(row).toBeVisible();
  await row.tap();

  // The same two strings demo.spec.js asserts on the desktop: the seed's
  // auto_insert pins on the book trail, carried onto a page assigned to it
  // for the first time. This is the lead copy's promise on a phone.
  const editor = page.locator(".ProseMirror").first();
  await expect(editor).toContainText("she never explains herself");
  await expect(editor).toContainText("somewhere to go");
});

test("an unavailable action explains itself", async ({ page }) => {
  await openDemo(page);
  // The shell has no export or backup control; sync is the noticed family
  // it reaches. In the demo build `set up sync` does not open the setup
  // screen (ShellApp's openSetup): that screen's first act is to ask for a
  // recovery phrase, which the demo cannot make, so the screen would answer
  // the strip's notice with "could not make a phrase. try again." Two
  // sentences, one of them calling the demo broken. The row asks the
  // noticed command and the strip says why instead.
  await page.locator('.shell-tab[data-tab-id="settings"]').tap();
  await expect(page.locator('.shell-navbar-title:text-is("settings")')).toBeVisible();
  await tapScreenRow(page, "sync");
  await tapScreenRow(page, "set up sync");
  // DEMO_COPY.sync's own tail: "it runs in the installed app". The export
  // notice says "they run", and no shell control reaches export.
  await expect(page.locator("#demo-chrome").getByText("runs in the installed app")).toBeVisible();
  // The setup screen did not open: its bar would read "set up", and its
  // phrase failure is the sentence this guards against. The wait is what
  // makes these absences mean something: the push and the failed generate
  // land a frame or two after the notice, and a count of 0 taken before
  // they render passes on the very build it exists to catch (it did).
  await page.waitForTimeout(1000);
  await expect(page.locator('.shell-navbar-title:text-is("set up")')).toHaveCount(0);
  await expect(page.getByText("could not make a phrase")).toHaveCount(0);
  await expect(page.getByText(/failed|error/i)).toHaveCount(0);
});

test("pairing explains itself instead of asking for the camera", async ({ page }) => {
  // Record every camera request. On the real path the pair screen's scan
  // row pushes SyncScanScreen, which calls getUserMedia: a permission
  // prompt from a public demo page for a pairing that cannot happen here.
  await page.addInitScript(() => {
    window.__cameraCalls = 0;
    const devices = navigator.mediaDevices;
    if (devices?.getUserMedia) {
      devices.getUserMedia = () => {
        window.__cameraCalls += 1;
        return Promise.reject(new DOMException("recorded by the test", "NotAllowedError"));
      };
    }
  });
  await openDemo(page);
  await page.locator('.shell-tab[data-tab-id="settings"]').tap();
  await expect(page.locator('.shell-navbar-title:text-is("settings")')).toBeVisible();
  await tapScreenRow(page, "sync");
  await tapScreenRow(page, "pair this device");
  await expect(page.locator("#demo-chrome").getByText("runs in the installed app")).toBeVisible();
  // Test 4's reason for the wait: a push lands a frame after the notice,
  // and an absence checked before it renders proves nothing.
  await page.waitForTimeout(1000);
  await expect(page.locator('.shell-navbar-title:text-is("pair")')).toHaveCount(0);
  await expect(page.locator('.shell-navbar-title:text-is("scan")')).toHaveCount(0);
  expect(await page.evaluate(() => window.__cameraCalls)).toBe(0);
  await expect(page.getByText(/failed|error/i)).toHaveCount(0);
});

// demo.spec.js's start over test, on the shell: the reload the strip's
// button triggers has to complete, and the reset has to survive the pagehide
// flush that reload fires.
test("start over returns to the seeded state", async ({ page }) => {
  await openDemo(page);
  await typeOnToday(page, "this should not survive start over");
  await page.waitForTimeout(1800);
  await page.locator("#demo-chrome").getByRole("button", { name: DEMO_COPY.startOver }).tap();
  await page.getByRole("dialog").getByRole("button", { name: DEMO_COPY.startOver }).tap();
  const editor = page.locator(".ProseMirror").first();
  await expect(editor).not.toContainText("this should not survive");
  await expect(editor).toHaveText("");
  await expect(page.locator(".shell-root")).toBeVisible();
});

/**
 * Every visible control in the shell, and what a tap at its centre lands
 * on. A box comparison against two named elements was green while the pill
 * sat on the header's `find` and `pins`: it only knew about the controls it
 * was told about. This asks the browser instead, for every one on screen.
 */
async function coveredControls(page) {
  return page.evaluate(() => {
    const root = document.querySelector(".shell-root");
    const controls = root.querySelectorAll(
      'button, a[href], input, textarea, [role="button"], [contenteditable="true"]',
    );
    const covered = [];
    let checked = 0;
    for (const el of controls) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.bottom <= 0 || r.top >= window.innerHeight) continue;
      if (getComputedStyle(el).visibility === "hidden") continue;
      // The editor is a tall box; its first line is the caret's, so that
      // is the point to test rather than the centre of an empty canvas.
      const editable = el.getAttribute("contenteditable") === "true";
      const x = editable ? r.left + Math.min(24, r.width / 2) : r.left + r.width / 2;
      const y = editable ? r.top + Math.min(12, r.height / 2) : r.top + r.height / 2;
      checked += 1;
      const hit = document.elementFromPoint(x, y);
      if (!hit || !el.contains(hit)) {
        covered.push({
          control: `${el.tagName.toLowerCase()}.${[...el.classList].join(".")} "${el.textContent.trim().slice(0, 20)}"`,
          hit: hit ? `${hit.tagName.toLowerCase()}.${[...hit.classList].join(".")} "${hit.textContent.trim().slice(0, 20)}"` : null,
          inStrip: !!hit?.closest("#demo-chrome"),
        });
      }
    }
    return { checked, covered };
  });
}

test("the demo strip covers no control on the shell", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator(".shell-root")).toBeVisible();
  await expect(page.getByRole("button", { name: DEMO_COPY.ok, exact: true })).toBeVisible();

  // With the intro up: the card is the strip's largest state.
  let result = await coveredControls(page);
  expect(result.checked, "found the shell's controls to test").toBeGreaterThan(5);
  expect(result.covered, "controls under the strip with the intro up").toEqual([]);

  await page.getByRole("button", { name: DEMO_COPY.ok, exact: true }).tap();
  result = await coveredControls(page);
  expect(result.covered, "controls under the strip at rest").toEqual([]);

  // And the strip is still there to use: it moved, it did not vanish.
  await expect(page.locator(".demo-pill")).toBeVisible();
  await expect(page.locator("#demo-chrome").getByRole("button", { name: DEMO_COPY.startOver }))
    .toBeVisible();
});

// A visitor who came before the demo let the device choose has a stored
// snapshot carrying `try_new_shell: "false"`, the old opt-out bootstrap.js
// used to force. They must get the phone app anyway (bootstrap.js unsets the
// key on every boot), and keep what they wrote: SEED_VERSION is unchanged, so
// the snapshot restores rather than reseeding.
const RETURNING_SENTENCE = "the lighthouse keeper writes letters nobody answers";

function returningSnapshot() {
  const date = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
  const id = "returning-visitor-page";
  const stamp = `${date}T09:00:00.000Z`;
  const page = {
    id,
    date,
    page_number: 1,
    context: null,
    what_matters_now: null,
    what_shifted: null,
    what_shifted_complete: false,
    what_shifted_edited: false,
    voice_memo_path: null,
    voice_memo_transcript: null,
    parent_id: null,
    is_open: false,
    created_at: stamp,
    updated_at: stamp,
    content_json: JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: RETURNING_SENTENCE }] }],
    }),
  };
  // The shape src/lib/api.js's buildDemoSnapshot writes and __demo_import
  // reads: Map entries for the keyed stores, plain values for the rest.
  return serialize(SEED_VERSION, {
    pages: [[`${date}-1`, page]],
    lines: [[id, []]],
    pins: [],
    lineages: [],
    blocks: [],
    settings: { try_new_shell: "false", mobile_gestures_tip_seen: "true" },
    onboardingComplete: true,
  });
}

test("a returning visitor who opted out gets the phone app and keeps their pages", async ({ page }) => {
  // Once per tab, not per document: addInitScript re-runs on every load, and
  // a reload must read what the app wrote, not this snapshot again.
  await page.addInitScript(
    ([key, value]) => {
      if (sessionStorage.getItem("returning-visitor-planted")) return;
      sessionStorage.setItem("returning-visitor-planted", "1");
      localStorage.setItem(key, value);
    },
    [DEMO_STORAGE_KEY, returningSnapshot()],
  );
  await openDemo(page);

  await page.locator('.shell-tab[data-tab-id="memory"]').tap();
  const search = page.getByPlaceholder("search your writing…");
  await expect(search).toBeVisible();
  await search.fill("lighthouse");
  // The shell's memory lists a match by its focus line, not a snippet, and
  // this page has none, so it reads "untitled". Pages mode narrows the list
  // to pages; the match is then the only row, and opening it is what shows
  // the sentence the snapshot carried actually came back.
  await page.getByRole("radio", { name: "pages" }).tap();
  const match = page.getByRole("button", { name: "untitled" });
  await expect(match).toHaveCount(1);
  await match.tap();
  await expect(page.getByText(RETURNING_SENTENCE)).toBeVisible();
});
