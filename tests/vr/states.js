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

  // Code-review fix (post-120d403): tapping a board block on touch reveals
  // its title. A reviewer found the reveal painted over the block's own
  // first line (no reserved space above the content) and never auto-hid on
  // this specific path (armTouchHandleHide wasn't called here, unlike the
  // margin-tap and long-press paths). This is the state that would show
  // either regression: the title visible AND the block's first two lines
  // still fully legible beneath it.
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

    // Tap the BODY of the block, at least 32px from the left edge, so this
    // exercises the body-tap path (handleEditorPointerDown's unconditional
    // `touchActiveBoard = block`) and not the separate deliberate
    // margin-tap gesture — the two paths used to arm the auto-hide
    // differently, which is exactly the regression this state guards.
    // pointerType MUST be "touch" — handleEditorPointerDown returns
    // immediately for anything else (see BLOCK_HANDLES above).
    const x = box.x + Math.min(60, box.width / 2);
    const y = box.y + box.height / 2;
    const opts = { pointerType: "touch", pointerId: 1, isPrimary: true, clientX: x, clientY: y, bubbles: true };
    await page.dispatchEvent(".tiptap-wrapper", "pointerdown", opts);
    // Release well before TOUCH_LONG_PRESS_MS (700ms) — a long-press here
    // would arm drag-to-reorder instead of a plain tap-to-reveal.
    await settle(page, 150);
    await page.dispatchEvent(".tiptap-wrapper", "pointerup", opts);
    await settle(page);

    const titleSlot = block.locator(".board-title-slot").first();
    await titleSlot.waitFor({ state: "visible" });
    const titleBox = await titleSlot.boundingBox();
    if (!titleBox || titleBox.width === 0 || titleBox.height === 0) {
      throw new Error("block-title-touch: the title never revealed");
    }
    // The hard constraint under test: the revealed title must not cover
    // any part of the block's own content box (must sit at/above its
    // top edge), and the block's own top must not have moved from where
    // it measured before the tap (nothing shifts on reveal).
    const boxAfter = await block.boundingBox();
    if (Math.abs(boxAfter.y - box.y) > 0.5) {
      throw new Error(
        `block-title-touch: block moved on reveal (${box.y} -> ${boxAfter.y})`,
      );
    }
    if (titleBox.y + titleBox.height > boxAfter.y + 0.5) {
      throw new Error(
        `block-title-touch: title bottom (${titleBox.y + titleBox.height}) ` +
        `overlaps the block's content top (${boxAfter.y})`,
      );
    }
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
