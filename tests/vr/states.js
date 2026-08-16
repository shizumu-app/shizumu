// Drivers that put a loaded scene into an interaction state before capture.
//
// Every one uses real input — a tap, a click, a viewport change — rather
// than a hook inside the app. That is the point: the bugs these guard
// against lived in the reveal and layout paths themselves, so a driver that
// set state directly would pass while the real path stayed broken.
//
// Each driver returns once the state is settled and the screenshot is safe
// to take. Throwing is correct if the state can't be reached: a capture
// named for a state the app never entered is worse than a missing one.
import { STATES } from "../../src/lib/vr/scenes.js";

/** A short height on the same width — what an open soft keyboard leaves. */
const KEYBOARD_VIEWPORT_HEIGHT = 360;

async function settle(page, ms = 450) {
  await page.waitForTimeout(ms);
}

export const STATE_DRIVERS = {
  // Gutter-polish pass: the chip-less touch handle (touch-block-handle.js)
  // renders "+" only on an EMPTY block, into the restored left gutter.
  // Doesn't tap it (that opens the slash menu, a different scene entirely)
  // — the point here is the glyph and its position in the gutter, not the
  // menu it leads to.
  [STATES.TOUCH_INSERT_HANDLE]: async (page) => {
    const wrapper = page.locator(".tiptap-wrapper").first();
    await wrapper.waitFor({ state: "visible" });
    const block = page.locator(".tiptap-wrapper .ProseMirror > p").first();
    await block.waitFor({ state: "visible" });
    // A plain tap, not an off-centre one: the handle lives in the left
    // gutter (outside the block's own box, see prose.css), so there's no
    // risk of landing on it by taking the element's default centre point.
    await block.tap();
    await settle(page, 200);

    const handle = block.locator(".touch-block-handle");
    await handle.waitFor({ state: "visible" });
  },

  // Gutter-polish pass, the actual bug fix ("tap on block does not show
  // the toolbar in the left space"): tapping a chip-less block that
  // already has content reveals its pin/copy/delete controls in the
  // gutter — the same .block-handles column desktop hover populates, just
  // touch-triggered (TipTapEditor.svelte's handleEditorPointerDown →
  // revealBlockHandlesForNode). Replaces the earlier BottomSheet a
  // chip-less block used to reach via a synthetic "⋯" handle — that
  // handle is gone; this plain tap is the whole gesture now.
  //
  // Deliberately targets the FIRST fixture paragraph, which is short
  // enough to wrap to one line at phone width — the tallest-risk case the
  // coordinator asked to see photographed: three stacked controls next to
  // a single text line are taller than the block itself, so this proves
  // the overflow spills DOWN THE GUTTER beside the next block rather than
  // over that next block's own text.
  [STATES.BLOCK_HANDLES_TOUCH]: async (page) => {
    const wrapper = page.locator(".tiptap-wrapper").first();
    await wrapper.waitFor({ state: "visible" });
    const block = page.locator(".tiptap-wrapper .ProseMirror > p").first();
    await block.waitFor({ state: "visible" });
    const box = await block.boundingBox();
    if (!box) throw new Error("block-handles-touch: block not found in the viewport");
    // Not "nothing happens" bait — this documents WHY the block must be
    // one line: a taller fixture paragraph would still reveal the column,
    // just without exercising the overflow-below-the-block case this
    // state exists to prove is safe.
    if (box.height > 40) {
      throw new Error(
        `block-handles-touch: fixture's first paragraph is not one line (height ${box.height}px) — ` +
        "this state needs the one-line case to prove the toolbar doesn't paint over text when it overflows",
      );
    }

    // `.tap()`, not `.click()`: a plain click dispatches a bare mousemove/
    // mousedown/click with no preceding touch, which isTrustedMouseHover
    // (block-hover-guard.js) has no reason to reject — it would reveal the
    // desktop-hover column instead of exercising the touch path this state
    // guards. `.tap()` fires real touch events first (setting lastTouchAt
    // via handleEditorPointerDown, same as a real phone), so the compat
    // mousemove Chromium synthesizes right after lands inside the guard
    // window and is correctly ignored.
    await block.tap();
    await settle(page, 200);

    const handles = page.locator(".block-handles");
    await handles.waitFor({ state: "visible" });
    const pin = handles.locator('[data-label="pin"]');
    const copy = handles.locator('[data-label="copy"]');
    const del = handles.locator('[data-label="delete"]');
    if ((await pin.count()) === 0 || (await copy.count()) === 0 || (await del.count()) === 0) {
      throw new Error("block-handles-touch: pin/copy/delete controls did not all render");
    }
    // The insert "+" belongs to the empty-block path only (TOUCH_INSERT_
    // HANDLE) — a block WITH content must not also offer it, the same
    // has-content split the desktop hover column applies.
    if ((await handles.locator('[data-label="insert"]').count()) !== 0) {
      throw new Error("block-handles-touch: the insert '+' rendered on a block that has content");
    }
    // The hard constraint under test: the column must stay inside the
    // gutter, never over the block's own text — even though it overflows
    // BELOW the block's short one-line height (asserted above), it must
    // never spill to the RIGHT of where the block's text starts.
    const handlesBox = await handles.boundingBox();
    const blockBox = await block.boundingBox();
    if (!handlesBox || !blockBox) {
      throw new Error("block-handles-touch: could not measure the revealed column");
    }
    if (handlesBox.x + handlesBox.width > blockBox.x + 0.5) {
      throw new Error(
        `block-handles-touch: column right edge (${handlesBox.x + handlesBox.width}) ` +
        `reaches past the block's text start (${blockBox.x}) — painting over text`,
      );
    }
  },

  // The touch pin flow, end to end. Every prior mobile block-action fix in
  // this app's history was reasoned about ONE seam — the reveal, or the
  // popup, or the button — and passed here while still failing on a real
  // phone, because nothing exercised the whole gesture chain a phone
  // actually walks. This state does: tap the block (reveal) → tap PIN
  // (the gutter button, not a shortcut) → assert a pin now exists, both
  // in the backend the app itself talks to AND in the toolbar's own
  // already-pinned indicator. If handlePinBlock regresses — the popup
  // eats the tap again, block resolution goes stale, the quick-pin path
  // breaks — this fails HERE.
  [STATES.PIN_FLOW_TOUCH]: async (page) => {
    const wrapper = page.locator(".tiptap-wrapper").first();
    await wrapper.waitFor({ state: "visible" });
    const block = page.locator(".tiptap-wrapper .ProseMirror > p").first();
    await block.waitFor({ state: "visible" });

    // Ground truth lives in the mock invoke the app itself calls
    // (window.__VR_INVOKE__, installed by src/lib/vr/bootstrap.js) — not
    // in what merely rendered. Asserting an INCREASE, not a fixed count,
    // holds even if a future fixture starts seeding its own pins.
    const before = await page.evaluate(() =>
      window.__VR_INVOKE__("get_pins", { lineageId: null }),
    );

    // Real touch tap — same reveal BLOCK_HANDLES_TOUCH exercises.
    await block.tap();
    await settle(page, 200);

    const handles = page.locator(".block-handles");
    await handles.waitFor({ state: "visible" });
    const pin = handles.locator('[data-label="pin"]');
    await pin.waitFor({ state: "visible" });
    const classBefore = (await pin.getAttribute("class")) || "";
    if (classBefore.includes("already-pinned")) {
      throw new Error("pin-flow-touch: fixture's block already reads as pinned before the flow starts");
    }

    // The actual reported bug: tapping PIN did nothing on touch.
    await pin.tap();
    await settle(page, 250);

    const after = await page.evaluate(() =>
      window.__VR_INVOKE__("get_pins", { lineageId: null }),
    );
    if (after.length !== before.length + 1) {
      throw new Error(
        `pin-flow-touch: expected ${before.length + 1} pin(s) after tapping PIN, backend has ${after.length} — the tap produced no pin`,
      );
    }
    const blockText = ((await block.textContent()) || "").trim();
    const newest = after[after.length - 1];
    const expectedTitle = blockText.slice(0, 50);
    if (!newest || newest.title !== expectedTitle) {
      throw new Error(
        `pin-flow-touch: newest pin's title ("${newest?.title}") doesn't match the tapped block's text ` +
        `("${expectedTitle}") — pinned the wrong content, or pinned nothing recognizable`,
      );
    }

    // The toolbar's own already-pinned indicator must reflect the new pin
    // immediately, not on some later re-reveal — a screenshot taken now
    // proves both facts at once (a pin exists AND the UI knows it).
    const classAfter = (await pin.getAttribute("class")) || "";
    if (!classAfter.includes("already-pinned")) {
      throw new Error("pin-flow-touch: pin button did not flip to already-pinned after pinning");
    }
  },

  // The header collapses to a pill and the shell resizes when the keyboard
  // is up. Shrinking the viewport is enough to trigger it: isKeyboardOpen()
  // reads a drop in innerHeight below the tallest seen, precisely so the
  // resizes-content viewport mode is detected — which makes the state
  // reachable here without emulating visualViewport.
  [STATES.KEYBOARD]: async (page) => {
    const size = page.viewportSize();
    if (!size) throw new Error("keyboard: no viewport to shrink");
    await page.locator(".ProseMirror").first().click();
    await page.setViewportSize({ width: size.width, height: KEYBOARD_VIEWPORT_HEIGHT });
    await settle(page, 700);
  },

  // The pin panel over the page — its own layout, and the surface a pinned
  // image or a titleless pin row shows up on.
  [STATES.PIN_PANEL]: async (page) => {
    await page.getByRole("button", { name: /pin/i }).first().click();
    await settle(page);
  },

  // The "what settled" strip expanded into its input. It used to stay open
  // forever once opened, because nothing collapsed it on blur.
  [STATES.WHAT_SETTLED]: async (page) => {
    await page.locator(".strip-toggle").first().click();
    await settle(page);
  },

  // Reroute note (this pass): this state used to tap the block's body and
  // assert the title revealed via a `.block-active-touch` CSS class — but
  // c912aae's cleanup pass deleted the CSS that class drove (see prose.css
  // and global.css's notes on the removed touch-overlay rules) while the
  // JS kept stamping the now-inert class. Run against that code this state
  // timed out waiting for a title that CSS no longer had any way to show —
  // exactly the "passed here, would have failed forever on-device" gap
  // this task exists to close. The real, current path is the gutter
  // toolbar's own T button (this pass's title fix): tap the block to
  // reveal the toolbar, tap T, and T's own handler focuses the slot
  // synchronously — `.board-title-slot:focus` is the CSS rule that's
  // actually still wired up.
  [STATES.BLOCK_TITLE_TOUCH]: async (page) => {
    const wrapper = page.locator(".tiptap-wrapper").first();
    await wrapper.waitFor({ state: "visible" });
    const wrapBox = await wrapper.boundingBox();
    const block = page.locator(".tiptap-wrapper .ProseMirror > .block-shell").first();
    await block.waitFor({ state: "visible" });
    const box = await block.boundingBox();
    if (!box || box.y < wrapBox.y || box.y + box.height > wrapBox.y + wrapBox.height) {
      throw new Error("block-title-touch: block is not inside the editor viewport");
    }

    // Tap the block's body — reveals its gutter toolbar (pin/copy/delete,
    // and T, since this board renders a `.board-title-slot`). Same real
    // tap BLOCK_HANDLES_TOUCH drives.
    await block.tap();
    await settle(page, 200);

    const handles = page.locator(".block-handles");
    await handles.waitFor({ state: "visible" });
    const titleButton = handles.locator('[data-label="title"]');
    await titleButton.waitFor({ state: "visible" });

    // Tap T. Its click handler must focus the slot SYNCHRONOUSLY (the tap
    // on T is the user gesture a mobile webview requires before it will
    // raise the IME) — assert actual DOM focus, not just visibility, since
    // a rAF/setTimeout-deferred focus() would still eventually land the
    // slot on-screen but miss the keyboard on a real device.
    await titleButton.tap();
    await settle(page, 150);

    const titleSlot = block.locator(".board-title-slot").first();
    await titleSlot.waitFor({ state: "visible" });
    const isFocused = await titleSlot.evaluate((el) => el === document.activeElement);
    if (!isFocused) {
      throw new Error("block-title-touch: tapping T did not focus the title slot");
    }
    const titleBox = await titleSlot.boundingBox();
    if (!titleBox || titleBox.width === 0 || titleBox.height === 0) {
      throw new Error("block-title-touch: the title never revealed");
    }
    // No "block didn't move" / "title doesn't overlap content" checks here
    // any more — the removed `.block-active-touch` overlay this state used
    // to guard was `position: absolute`, specifically so a reveal couldn't
    // reflow the block under the user's finger mid-tap. The current
    // `:focus` reveal (global.css) is deliberately IN NORMAL FLOW instead —
    // same as desktop's hover reveal — because this is now reached only by
    // a second, deliberate tap on T, not a side effect of tapping the text
    // itself; reflowing on a deliberate action is fine (see prose.css's
    // note by .block-shell). Asserting zero reflow here would be asserting
    // the wrong design.
  },
  // The /chart builder, opened the real way: focus the empty page's lone
  // paragraph, type "/chart" so the slash-command Suggestion plugin opens
  // its menu, then click the "chart" row — same DOM path renderRow() wires
  // up for a real tap/click, see src/lib/slash-commands.js.
  [STATES.CHART_BUILDER]: async (page) => {
    const wrapper = page.locator(".tiptap-wrapper").first();
    await wrapper.waitFor({ state: "visible" });
    const block = page.locator(".tiptap-wrapper .ProseMirror > p").first();
    await block.waitFor({ state: "visible" });
    await block.click();
    await page.keyboard.type("/chart");
    await settle(page, 250);

    const menu = page.locator(".slash-command-menu");
    await menu.waitFor({ state: "visible" });
    const row = menu.locator(".slash-command-row", { hasText: "chart" }).first();
    await row.waitFor({ state: "visible" });
    await row.click();
    await settle(page, 300);

    const builder = page.locator(".builder");
    await builder.waitFor({ state: "visible" });
  },

  // Same open path, then the soft keyboard comes up — the reported bug
  // involved form fields with the IME open. Shrinking the viewport is the
  // same technique KEYBOARD above uses; focus the title input first so the
  // shrink happens with a field actually focused, like a real IME open would.
  [STATES.CHART_BUILDER_KEYBOARD]: async (page) => {
    await STATE_DRIVERS[STATES.CHART_BUILDER](page);
    const size = page.viewportSize();
    if (!size) throw new Error("chart-builder-keyboard: no viewport to shrink");
    await page.locator(".builder .title-input").click();
    await page.setViewportSize({ width: size.width, height: KEYBOARD_VIEWPORT_HEIGHT });
    await settle(page, 700);
  },
};

export function driverFor(state) {
  const fn = STATE_DRIVERS[state];
  if (!fn) throw new Error(`no VR driver for state: ${state}`);
  return fn;
}
