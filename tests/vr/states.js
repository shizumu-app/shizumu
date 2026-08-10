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
  // Block controls only exist after a reveal. On a phone layout that's a
  // long-press; the bar is then placed clear of the block it acts on
  // (src/lib/editor/handle-placement.js). This is the state in which the
  // bar used to be drawn straight over the text.
  [STATES.BLOCK_HANDLES]: async (page) => {
    // Pick a block that is actually inside the scrolling editor. Taking one
    // by index picked a node sitting above the wrapper, so the computed
    // offset came out at -223px: rendered above the scroll container's
    // content box, clipped away, and yet still reporting a bounding box.
    const wrapper = page.locator(".tiptap-wrapper").first();
    await wrapper.waitFor({ state: "visible" });
    const wrapBox = await wrapper.boundingBox();
    const blocks = page.locator(".tiptap-wrapper .ProseMirror > *");
    let box = null;
    for (let i = 0; i < (await blocks.count()); i += 1) {
      const b = await blocks.nth(i).boundingBox();
      if (b && b.height > 0 && b.y >= wrapBox.y && b.y + b.height <= wrapBox.y + wrapBox.height) {
        box = b;
        break;
      }
    }
    if (!box) throw new Error("block-handles: no block inside the editor viewport");

    // pointerType MUST be "touch". handleEditorPointerDown returns
    // immediately for anything else, so page.mouse would silently capture
    // the hover path instead — a state no phone user can reach — while the
    // long-press path this is meant to guard stayed unphotographed. (It
    // did exactly that on the first attempt.)
    const x = box.x + 8;
    const y = box.y + box.height / 2;
    const opts = { pointerType: "touch", pointerId: 1, isPrimary: true, clientX: x, clientY: y, bubbles: true };
    await page.dispatchEvent(".tiptap-wrapper", "pointerdown", opts);
    await settle(page, 900); // past TOUCH_LONG_PRESS_MS (700ms)
    // Release without moving: movement would mean a reorder drag, not a
    // request for the block's actions.
    await page.dispatchEvent(".tiptap-wrapper", "pointerup", opts);
    await settle(page);
    const bar = page.locator(".block-handles").first();
    await bar.waitFor({ state: "visible" });
    // waitFor alone is not enough to trust the capture: the bar removes
    // itself on a timer, so it can be visible here and gone by the time the
    // screenshot settles — which produced a baseline of an empty page that
    // would then have passed forever. Assert it is still on screen, with a
    // real box, at the last possible moment.
    const barBox = await bar.boundingBox();
    if (!barBox || barBox.width === 0 || barBox.height === 0) {
      throw new Error("block-handles: the bar vanished before capture");
    }
    // A box is not enough. The bar is absolutely positioned inside a
    // scroll container, so it can sit outside that container's content box
    // — clipped out of the pixels while still measuring perfectly. Assert
    // it is genuinely within the editor before trusting the screenshot.
    if (barBox.y < wrapBox.y - 1 || barBox.y + barBox.height > wrapBox.y + wrapBox.height + 1) {
      throw new Error(
        `block-handles: bar at y=${barBox.y} is outside the editor ` +
        `(${wrapBox.y}..${wrapBox.y + wrapBox.height}) and would be clipped`,
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
};

export function driverFor(state) {
  const fn = STATE_DRIVERS[state];
  if (!fn) throw new Error(`no VR driver for state: ${state}`);
  return fn;
}
