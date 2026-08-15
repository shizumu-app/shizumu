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
  // Block-actions redesign: this used to reveal the floating .block-handles
  // pill directly over the block (three separate geometry patches failed to
  // keep it clear of the text on a phone). Touch now opens a BottomSheet
  // listing the block's actions instead — this state captures that sheet,
  // and asserts the pill it replaced genuinely never renders from this path
  // (not just that the sheet happens to also be there — the whole point of
  // the redesign is no floating chrome on touch).
  //
  // The sheet opens by tapping the block's own handle now, NOT a long-press
  // (a stationary long-press opened it in an earlier version of this
  // redesign — Android's own long-press-to-select-text gesture fought it
  // there, its menu winning over the sheet every time). This fixture's
  // content (FIXTURES.pageWithContent) is plain paragraphs, so the handle
  // in play is the chip-less synthetic "⋯" (touch-block-handle.js), not a
  // board's .block-type-chip — both dispatch the identical
  // shizumu-block-actions CustomEvent (dispatch-block-actions.js), so
  // either proves the sheet opens with no chrome over the text; the
  // selector below matches whichever is actually present.
  [STATES.BLOCK_ACTION_SHEET]: async (page) => {
    // Pick a block that is actually inside the scrolling editor. Taking one
    // by index picked a node sitting above the wrapper, so the computed
    // offset came out at -223px: rendered above the scroll container's
    // content box, clipped away, and yet still reporting a bounding box.
    const wrapper = page.locator(".tiptap-wrapper").first();
    await wrapper.waitFor({ state: "visible" });
    const wrapBox = await wrapper.boundingBox();
    const blocks = page.locator(".tiptap-wrapper .ProseMirror > *");
    let box = null;
    let blockIndex = -1;
    for (let i = 0; i < (await blocks.count()); i += 1) {
      const b = await blocks.nth(i).boundingBox();
      if (b && b.height > 0 && b.y >= wrapBox.y && b.y + b.height <= wrapBox.y + wrapBox.height) {
        box = b;
        blockIndex = i;
        break;
      }
    }
    if (!box) throw new Error("block-action-sheet: no block inside the editor viewport");
    const block = blocks.nth(blockIndex);

    // Place the caret in the block first: the chip-less handle follows the
    // caret (touch-block-handle.js) rather than painting on every block at
    // once, so it doesn't exist in the DOM until the selection lands here.
    // A board's .block-type-chip needs no such step (it's per-block, always
    // present) — this tap is harmless for that case too.
    //
    // `.tap()`, not `.click()`: a plain click dispatches a bare mousemove/
    // mousedown/click with no preceding touch, which isTrustedMouseHover
    // (block-hover-guard.js) has no reason to reject — it opened the
    // desktop-hover .block-handles pill instead of getting anywhere near
    // the touch path this state exists to guard. `.tap()` fires real touch
    // events first (setting lastTouchAt via handleEditorPointerDown, same
    // as a real phone), so the compat mousemove Chromium synthesizes right
    // after lands inside the guard window and is correctly ignored.
    await block.tap({ position: { x: 8, y: Math.min(8, box.height / 2) } });
    await settle(page, 200);

    const handle = block.locator(".touch-block-handle, .block-type-chip").first();
    await handle.waitFor({ state: "visible" });
    await handle.tap();
    await settle(page);

    const sheet = page.locator(".sheet").first();
    await sheet.waitFor({ state: "visible" });
    const rows = page.locator(".block-action-row");
    if ((await rows.count()) === 0) {
      throw new Error("block-action-sheet: the sheet opened with no action rows");
    }
    // The regression this whole redesign exists to fix: the floating pill
    // must never render from a touch tap, sheet open or not.
    const pill = page.locator(".block-handles");
    if ((await pill.count()) !== 0) {
      throw new Error("block-action-sheet: .block-handles rendered from a touch tap");
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
};

export function driverFor(state) {
  const fn = STATE_DRIVERS[state];
  if (!fn) throw new Error(`no VR driver for state: ${state}`);
  return fn;
}
