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

    // The other half of "usable": big enough to hit. Reported twice as
    // "hard to tap", and both times the cause was a size nothing checked —
    // most recently the phone density pass setting --ui-scale to 0.875,
    // which shrank rem-sized targets to 15.75x21px without touching this
    // file or failing anything. Measuring the RENDERED box is the point:
    // the CSS can keep saying 1.125rem while the device draws 15.75px.
    // Not 44 (Apple HIG) or 48 (Material), and deliberately so. A 44px
    // floor was tried and reverted: three stacked make a 137px column,
    // which on a two-item task list hangs past the block it belongs to and
    // over the next one — and reaching further is how the lower buttons
    // came to act on the wrong block. What this number is really guarding
    // is the regression that produced the report: tap targets sized in rem,
    // silently scaled to 15.75x21px by --ui-scale. 32 is clear of that and
    // still keeps the column beside its own block. Raising it needs the
    // overshoot answered first, not just a bigger number.
    const TAP_FLOOR_PX = 32;
    for (const button of await handles.locator("button").all()) {
      const label = await button.getAttribute("data-label");
      const box = await button.boundingBox();
      if (!box) throw new Error(`block-handles-touch: could not measure the "${label}" button`);
      if (box.height < TAP_FLOOR_PX - 0.5) {
        throw new Error(
          `block-handles-touch: "${label}" is ${box.height}px tall, under the ${TAP_FLOOR_PX}px ` +
          `touch floor — three of these are stacked, so a near miss hits the neighbour`,
        );
      }
      // Width is deliberately NOT held to the same floor, and deliberately
      // not held to "fills the gutter" either. The gutter is 1.5rem and the
      // assertion above forbids crossing into the text, so 44px of width
      // does not exist to give; filling the last 3.25px was tried and
      // reverted because it puts the card hard against the text column.
      // What the height floor cannot express, this does: the column must
      // still fit its gutter, which the overlap assertion above covers.
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

  // The same flow as PIN_FLOW_TOUCH, on a BOARD block. PIN_FLOW_TOUCH runs
  // on a plain <p>, which has no title slot — so the reveal-tap there adds
  // only the absolutely-positioned gutter column and moves nothing. A
  // board reveals its title IN FLOW on that same tap, shifting its own
  // content down a line, and THAT is the case the "tapping a toolbar
  // button does nothing" device report came from. Same assertions as
  // PIN_FLOW_TOUCH (backend ground truth via __VR_INVOKE__, not just what
  // rendered) so a regression is reported in the same terms.
  [STATES.PIN_FLOW_TOUCH_BOARD]: async (page) => {
    const wrapper = page.locator(".tiptap-wrapper").first();
    await wrapper.waitFor({ state: "visible" });
    const block = page.locator(".tiptap-wrapper .ProseMirror > .block-shell").first();
    await block.waitFor({ state: "visible" });

    const before = await page.evaluate(() =>
      window.__VR_INVOKE__("get_pins", { lineageId: null }),
    );

    await block.tap();
    await settle(page, 250);

    const handles = page.locator(".block-handles");
    await handles.waitFor({ state: "visible" });
    const pin = handles.locator('[data-label="pin"]');
    await pin.waitFor({ state: "visible" });

    // Where the button IS, at the moment before the tap. Captured so a
    // failure can say whether the button moved out from under the finger
    // (the in-flow title reveal shifting the block) rather than the click
    // handler itself doing nothing — two very different bugs that look
    // identical from the outside.
    const boxBefore = await pin.boundingBox();

    await pin.tap();
    await settle(page, 250);

    const after = await page.evaluate(() =>
      window.__VR_INVOKE__("get_pins", { lineageId: null }),
    );
    if (after.length !== before.length + 1) {
      const boxAfter = await pin.boundingBox();
      const moved = boxBefore && boxAfter
        ? Math.round(Math.abs(boxAfter.y - boxBefore.y))
        : "unknown";
      throw new Error(
        `pin-flow-touch-board: expected ${before.length + 1} pin(s) after tapping PIN, ` +
        `backend has ${after.length} — the tap produced no pin. ` +
        `Pin button moved ${moved}px vertically across the tap.`,
      );
    }

    // The two halves of "the button did something", both of which a titled
    // board used to skip: the glyph dims, and the toast names what landed.
    // Neither is cosmetic here — with the pin already created, they are the
    // ONLY difference between a working button and a dead one, and their
    // absence is the whole of the device report.
    const classAfter = (await pin.getAttribute("class")) || "";
    if (!classAfter.includes("already-pinned")) {
      throw new Error("pin-flow-touch-board: pin button did not flip to already-pinned after pinning");
    }
    const toast = page.locator(".quick-pin-toast");
    if (!(await toast.isVisible())) {
      throw new Error(
        "pin-flow-touch-board: no toast after the pin landed — the tap gave the user " +
        "no feedback at all, which is indistinguishable from a dead button",
      );
    }
    const toastText = ((await toast.textContent()) || "").trim();
    if (!toastText.startsWith("pinned ·")) {
      throw new Error(`pin-flow-touch-board: unexpected toast text "${toastText}"`);
    }

    // Tapping it again must also say something. This is the guard the
    // second tap hits, and it returned mute — so a user who missed the
    // first confirmation got nothing on the retry either.
    await pin.tap();
    await settle(page, 250);
    const toastAgain = ((await page.locator(".quick-pin-toast").textContent()) || "").trim();
    if (toastAgain !== "already pinned") {
      throw new Error(
        `pin-flow-touch-board: second tap said "${toastAgain}" — expected "already pinned"`,
      );
    }
    const afterTwo = await page.evaluate(() =>
      window.__VR_INVOKE__("get_pins", { lineageId: null }),
    );
    if (afterTwo.length !== after.length) {
      throw new Error(
        `pin-flow-touch-board: second tap created a duplicate pin (${after.length} → ${afterTwo.length})`,
      );
    }
  },

  // ONE tap on a LOWER toolbar button, on a SHORT block — the two things
  // every other state here happens to avoid, and together they are the
  // whole of "you have to tap many times before anything happens".
  //
  // The toolbar is taller than a one-line block, so its second and third
  // buttons hang past that block's own Y range and sit over whatever comes
  // next. handleEditorPointerUp resolved every touch — including one that
  // started on a toolbar button — to findBlockAtY(e.clientY), so tapping
  // those buttons reassigned touchActiveBoard to the block UNDER the
  // button. That moves .block-active-touch, which reveals/collapses title
  // slots in flow, which reflows the page between pointerup and click:
  // the button leaves from under the finger and the click never lands on
  // it. Nothing happens, repeatedly, until a tap happens to catch a layout
  // that isn't moving.
  //
  // Delete is the assertion because its effect is unmissable (the block is
  // gone or it is not) and because it is the furthest button from the
  // block, i.e. the worst case. Pin — the button every other state taps —
  // is the ONLY one that still lands inside a one-line block, which is
  // exactly why this bug survived a suite that already covered "tap pin".
  [STATES.DELETE_FLOW_TOUCH]: async (page) => {
    const wrapper = page.locator(".tiptap-wrapper").first();
    await wrapper.waitFor({ state: "visible" });
    const blocks = page.locator(".tiptap-wrapper .ProseMirror > *");
    const countBefore = await blocks.count();
    const block = blocks.first();
    await block.waitFor({ state: "visible" });
    const textBefore = ((await block.textContent()) || "").trim();

    await block.tap();
    await settle(page, 250);
    const handles = page.locator(".block-handles");
    await handles.waitFor({ state: "visible" });
    const del = handles.locator('[data-label="delete"]');
    await del.waitFor({ state: "visible" });

    // ── the device's ordering, spelled out ───────────────────────────
    // A plain .tap() here CANNOT catch the reported bug. Playwright fires
    // touchend, mouseup and click in one task, so anything scheduled for
    // "the next frame" lands after the click and the tap survives. A real
    // phone leaves a real gap between touchend and click — the IME is
    // closing, the compat mouse events are queued — and the editor's blur
    // fires inside that gap, at a moment when document.activeElement is
    // still BODY because the button is not focused until mouseup.
    //
    // So drive it the way the device does: press, blur, let frames pass,
    // and only then release. If the toolbar dismisses itself in between,
    // the release lands on nothing. That is "you have to tap many times".
    const box = await del.boundingBox();
    if (!box) throw new Error("delete-flow-touch: delete button has no box");
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await page.dispatchEvent('.block-handles [data-label="delete"]', "pointerdown", {
      pointerType: "touch", clientX: cx, clientY: cy, bubbles: true,
    });
    await page.evaluate(() => document.querySelector(".ProseMirror")?.blur());
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await settle(page, 120);

    if ((await handles.count()) === 0) {
      throw new Error(
        "delete-flow-touch: the toolbar dismissed itself between the press and the " +
        "release — the tap can no longer become a click on it, which is exactly the " +
        '"nothing happens until you tap several times" report',
      );
    }

    // Which block is "active" before the release, so the next assertion can
    // tell whether the release moved it.
    const activeBefore = await page.evaluate(() => {
      const pm = document.querySelector(".tiptap-wrapper .ProseMirror");
      return [...pm.children].findIndex((c) => c.classList.contains("block-active-touch"));
    });

    await page.dispatchEvent('.block-handles [data-label="delete"]', "pointerup", {
      pointerType: "touch", clientX: cx, clientY: cy, bubbles: true,
    });
    await settle(page, 60);

    // The release must not re-point the active block. This button hangs
    // BELOW its own block (the whole reason the state uses a short one), so
    // resolving the release by its Y coordinate lands on a different block
    // — which moves an in-flow title reveal and reflows the page mid-tap.
    const activeAfter = await page.evaluate(() => {
      const pm = document.querySelector(".tiptap-wrapper .ProseMirror");
      return [...pm.children].findIndex((c) => c.classList.contains("block-active-touch"));
    });
    if (activeAfter !== activeBefore) {
      throw new Error(
        `delete-flow-touch: releasing on the toolbar moved the active block ` +
        `${activeBefore} -> ${activeAfter} — the tap was resolved to whatever sits ` +
        `under the button, which reflows the page out from under the finger`,
      );
    }

    await del.click();
    await settle(page, 300);

    const countAfter = await blocks.count();
    if (countAfter !== countBefore - 1) {
      throw new Error(
        `delete-flow-touch: one delete left ${countAfter} blocks, expected ${countBefore - 1}`,
      );
    }
    const firstText = ((await blocks.first().textContent()) || "").trim();
    if (firstText === textBefore) {
      throw new Error(
        `delete-flow-touch: block count dropped but "${textBefore}" is still first — ` +
        "the wrong block was deleted",
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

    // Tap the block's body. That single tap IS the whole interaction now:
    // it is touch's equivalent of desktop hover, so it both reveals the
    // gutter toolbar and reveals this board's title slot, editable. There
    // is no T button any more — a dedicated control for something the block
    // already affords, occupying one of very few slots in a narrow gutter.
    await block.tap();
    await settle(page, 250);

    const handles = page.locator(".block-handles");
    await handles.waitFor({ state: "visible" });

    const titleSlot = block.locator(".board-title-slot").first();
    await titleSlot.waitFor({ state: "visible" });
    const titleBox = await titleSlot.boundingBox();
    if (!titleBox || titleBox.width === 0 || titleBox.height === 0) {
      throw new Error("block-title-touch: tapping the block did not reveal its title slot");
    }

    // The slot must be EDITABLE by tapping it — this is the half that a
    // "did it render" check misses. A mobile webview only raises the IME
    // for focus that traces to a user gesture, so the tap on the slot must
    // land focus on the input itself.
    await titleSlot.tap();
    await settle(page, 150);
    const isFocused = await titleSlot.evaluate((el) => el === document.activeElement);
    if (!isFocused) {
      throw new Error("block-title-touch: tapping the revealed title slot did not focus it — it cannot be edited");
    }

    // Deliberately no "nothing reflowed" assertion. The reveal is IN FLOW
    // by design (same as desktop's hover reveal); the overlay that used to
    // avoid reflow is what forced ~37px of reserved space above every
    // board. What matters instead is WHEN it reflows: TipTapEditor reveals
    // on pointerUP, after the caret has been placed from the tap, so the
    // text cannot move out from under the finger mid-tap. Asserting zero
    // reflow here would be asserting the design we deliberately dropped.
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
