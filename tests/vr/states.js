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
import { BLOCK_ACTION_LABELS } from "../../src/lib/editor/block-actions.js";
import { CONVERTIBLE_TYPES } from "../../src/lib/editor/block-convert.js";

// Whether a board type offers "convert to…" is DERIVED from
// CONVERTIBLE_TYPES, never listed separately. A hand-maintained negation of
// that list ("chart", "table") reopened the vacuous-pass hole the boardType
// throw below was added to close: a board type in neither list would skip
// both assertion blocks in silence. One list, two branches — a new board
// type lands in exactly one of them, always.

/** A short height on the same width — what an open soft keyboard leaves. */
const KEYBOARD_VIEWPORT_HEIGHT = 360;

async function settle(page, ms = 450) {
  await page.waitForTimeout(ms);
}

/**
 * Tap the top-level line that holds an attachment and photograph the gutter
 * card it reveals. Shared by the image and file drivers below, because the
 * whole diagnostic value is that the two lines get the SAME assertions —
 * the defect was one branch quietly answering differently from the other.
 *
 * `innerSelector` picks the branch: AttachmentBlock.svelte renders
 * `.attachment-image` for an image and `.attachment-block` for a file, and
 * they share no class — which was the bug's hiding place.
 */
async function attachmentGutter(page, innerSelector, label) {
  const wrapper = page.locator(".tiptap-wrapper").first();
  await wrapper.waitFor({ state: "visible" });

  // The top-level block, found through the attachment it holds rather than
  // by index: the fixtures put a plain line before and after the
  // attachment, so `> p` first would tap prose and photograph nothing about
  // an attachment at all.
  const block = page
    .locator(`.tiptap-wrapper .ProseMirror > p:has(${innerSelector})`)
    .first();
  await block.waitFor({ state: "visible" });

  // Real touch tap, same gesture BLOCK_HANDLES_TOUCH uses and for the same
  // reason — a bare click would take the desktop-hover path instead.
  await block.tap();
  await settle(page, 200);

  const handles = page.locator(".block-handles");
  await handles.waitFor({ state: "visible" });
  for (const name of ["pin", "copy", "delete"]) {
    if ((await handles.locator(`[data-label="${name}"]`).count()) === 0) {
      throw new Error(
        `${label}: the "${name}" control is missing — an attachment line is not an empty line`,
      );
    }
  }
  // The other half of the defect, and the part that named it: `isEmpty` is
  // `canInsert && !canPin`, so an attachment line offering the insert "+"
  // means the app has classified it as a blank line to write under. That is
  // literally what was shipping — `["insert"]` and nothing else.
  if ((await handles.locator('[data-label="insert"]').count()) !== 0) {
    throw new Error(`${label}: the insert "+" rendered — the line is being read as empty`);
  }
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

    // Exactly ONE "+" in the gutter. An empty chip-less block is the one
    // case where the widget decoration above and the .block-handles card
    // both fire, into the same gutter, a few pixels apart — the reported
    // "why do we have two + buttons", the larger of the two being a card
    // several times the size of the glyph beside it. The decoration wins
    // here because it is anchored to the block and costs no chrome; the
    // card still appears for anything with content (it carries pin, copy
    // and delete, which the decoration never offers).
    const cardCount = await page.locator(".block-handles").count();
    if (cardCount !== 0) {
      const glyphs = await page.locator(".block-handles .block-handle").allTextContents();
      throw new Error(
        `touch-insert-handle: the .block-handles card is also showing (${glyphs.length} ` +
        `button(s): ${JSON.stringify(glyphs)}) — that is a second "+" in the same gutter ` +
        "as the decoration this state already asserted",
      );
    }
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
      // Width cannot take the same floor — the gutter is 1.5rem and the
      // assertion above forbids crossing into the text, so 44px of width
      // does not exist to give. What CAN be required is that the button
      // spends the whole gutter instead of centring itself in it: the
      // ~1.6px-per-side slack that used to go unused is the only width
      // actually available to these controls, and leaving it unspent is
      // what this catches.
      if (box.width < handlesBox.width - 2.5) {
        throw new Error(
          `block-handles-touch: "${label}" is ${box.width}px wide inside a ` +
          `${handlesBox.width}px column — gutter width is going unused`,
        );
      }
    }
  },

  // ── the attachment gutter, image and file ───────────────────────────
  // The `/image` defect: hovering an image line offered ONLY the "+"
  // insert handle, while the identical file line offered pin/copy/delete.
  // blockPinFacts decided "is this an attachment" from `.attachment-block`,
  // a class only AttachmentBlock.svelte's FILE branch renders; the image
  // branch renders `.local-image-wrap .attachment-image`. So an image was
  // never exempt, and an attachment is an inline atom with no node text —
  // not exempt + no text = an EMPTY LINE, which is what `["insert"]` meant.
  //
  // page-image-content and page-file-content were both load-time-only
  // scenes, so the whole suite stayed green through it. These two drivers
  // are the missing half: the control only exists once you touch the line.
  //
  // Written as a pair on purpose — the file line is the control sample. On
  // its own "an image offers no pin" reads like a design decision; beside a
  // file line that offers all three, it reads as the bug it was.
  [STATES.IMAGE_BLOCK_HANDLES_TOUCH]: async (page) =>
    attachmentGutter(page, ".attachment-image", "image-block-handles"),
  [STATES.FILE_BLOCK_HANDLES_TOUCH]: async (page) =>
    attachmentGutter(page, ".attachment-block", "file-block-handles"),

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

    // The editor must still hold focus. This is root cause 1 stated
    // directly, and it needs no simulated device timing: if the button
    // takes focus, the editor blurs, the IME closes, the viewport grows,
    // the shell reflows, and the button moves out from under the finger
    // before the click resolves. Every other toolbar in TipTapEditor
    // (bubble-btn, table-btn) swallows mousedown for exactly this reason;
    // this column did not, and "nothing happens and the keyboard
    // disappears" is what that felt like.
    const focusKept = await page.evaluate(() =>
      !!document.activeElement?.closest?.(".ProseMirror"),
    );
    if (!focusKept) {
      const where = await page.evaluate(() => {
        const a = document.activeElement;
        return a ? `${a.tagName}.${(a.className || "").toString().split(" ")[0]}` : "null";
      });
      throw new Error(
        `pin-flow-touch: tapping PIN moved focus out of the editor (now ${where}) — ` +
        "on a device that closes the keyboard and reflows the page mid-tap",
      );
    }

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

    // ...and it must still be VISIBLE in that state. The already-pinned
    // style faded the glyph to 0.3 on a muted accent over cream, which on a
    // phone reads as the button vanishing the instant you use it ("tap on
    // the pin button, the icon disappear"). Desktop gets away with an even
    // fainter 0.15 because hover restores it; touch has no hover, so the
    // faded value is the final one. A floor here keeps "pinned" a state
    // rather than an absence.
    const opacity = await pin.evaluate((el) => parseFloat(getComputedStyle(el).opacity));
    if (!(opacity >= 0.5)) {
      throw new Error(
        `pin-flow-touch: after pinning, the pin glyph sits at opacity ${opacity} — ` +
        "at that value it reads as having disappeared, not as pinned",
      );
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

  // The touch action sheet a board's own `.block-type-chip` opens
  // (block-shell.js / table-shell-view.js dispatch shizumu-block-actions on
  // tap). This is the exact repro route of Task 1's bug: tapping the chip
  // on an EMPTY chart or table used to open no sheet at all. Real input
  // throughout — a tap on the chip, no hook that sets blockActionSheetOpen
  // directly.
  [STATES.BLOCK_ACTIONS_SHEET_TOUCH]: async (page) => {
    const chip = page.locator(".block-type-chip").first();
    await chip.waitFor({ state: "visible" });
    // dataset.board is read off the DOM before the tap (createBlockShell /
    // ShellTableView both stamp it) so the assertions below adapt to
    // whichever board type the scene's fixture actually put first, rather
    // than hard-coding per-scene expectations here.
    const boardType = await chip.evaluate((el) => el.closest("[data-board]")?.dataset.board || null);
    // Every scene this state is applied to is a board fixture — a null
    // boardType means the chip's own dataset.board lookup failed (wrong
    // selector, a DOM shape change), which would otherwise silently skip
    // BOTH assertion blocks below and let a real regression through
    // vacuously. page-empty-table / page-empty-chart exist specifically to
    // photograph Task 1's fix (title still offered on an EMPTY board) — a
    // vacuous pass here would defeat their whole purpose.
    if (!boardType) {
      throw new Error(
        "block-actions-sheet: could not read dataset.board off the tapped chip's closest [data-board] — " +
        "every scene using this state is a board fixture, so this should never be null",
      );
    }

    await chip.tap();
    await settle(page, 250);

    const sheet = page.locator(".block-action-sheet");
    await sheet.waitFor({ state: "visible" });
    const rowLabels = await sheet.locator(".block-action-row .block-action-label").allTextContents();

    // The sheet must always offer delete for a board — this is the
    // "opened nothing at all" half of Task 1's bug.
    if (!rowLabels.includes(BLOCK_ACTION_LABELS.delete)) {
      throw new Error(
        `block-actions-sheet: expected a "${BLOCK_ACTION_LABELS.delete}" row, got ${JSON.stringify(rowLabels)}`,
      );
    }

    // Is there anything here a pin could carry? Measured off the block
    // itself with the NodeView chrome excluded — the same distinction
    // block-pin-guard.js draws between the SHELL's text (which contains the
    // chip, so an EMPTY board reads as full) and the document node's text.
    // A chart is exempt by construction: chart.js is `atom: true` with its
    // whole dataset in attrs, so a chart full of data has no more text than
    // a blank one.
    const pinnable = await chip.evaluate((el) => {
      const block = el.closest("[data-board]");
      if (block.getAttribute("data-type") === "chart") return true;
      const clone = block.cloneNode(true);
      clone.querySelectorAll(".block-type-chip, .board-title-slot").forEach((n) => n.remove());
      return clone.textContent.trim() !== "";
    });

    // pin and copy are offered together, and only where there is something
    // to pin. An EMPTY board used to offer both: openBlockActionSheet read
    // "has content" off the shell's own textContent, chip included, so the
    // rows appeared and then did nothing when tapped — handlePinBlock's own
    // guard (block-pin-guard.js) refuses an empty block. A control that
    // does nothing reads as broken, which is exactly how it was reported.
    for (const id of ["pin", "copy"]) {
      if (rowLabels.includes(BLOCK_ACTION_LABELS[id]) !== pinnable) {
        throw new Error(
          `block-actions-sheet: "${boardType}" board ${pinnable
            ? `has content but is missing its "${BLOCK_ACTION_LABELS[id]}" row`
            : `is empty but still offers "${BLOCK_ACTION_LABELS[id]}"`}, got ${JSON.stringify(rowLabels)}`,
        );
      }
    }

    const isConvertible = CONVERTIBLE_TYPES.includes(boardType);

    // The non-convertible boards are exactly chart and table, and both
    // always render a `.board-title-slot` regardless of content, so "title"
    // is offered even when the block is empty — the other half of Task 1's
    // regression photograph (page-empty-table / page-empty-chart tap this
    // same driver and would fail here if the fix regressed). They must also
    // not offer "convert to…" (Task 5 excludes them: neither has a
    // flatten-to-paragraphs story).
    if (!isConvertible) {
      if (!rowLabels.includes(BLOCK_ACTION_LABELS.title)) {
        throw new Error(
          `block-actions-sheet: "${boardType}" board is missing its "${BLOCK_ACTION_LABELS.title}" row, got ${JSON.stringify(rowLabels)}`,
        );
      }
      if (rowLabels.includes(BLOCK_ACTION_LABELS.convert)) {
        throw new Error(
          `block-actions-sheet: "${boardType}" board must not offer "${BLOCK_ACTION_LABELS.convert}", got ${JSON.stringify(rowLabels)}`,
        );
      }
    }

    // Convertible board types (Task 5) must offer the convert row.
    if (isConvertible) {
      if (!rowLabels.includes(BLOCK_ACTION_LABELS.convert)) {
        throw new Error(
          `block-actions-sheet: convertible board "${boardType}" is missing its "${BLOCK_ACTION_LABELS.convert}" row, got ${JSON.stringify(rowLabels)}`,
        );
      }
    }
  },

  // PARKED (Task 6, fix round 1) — not applied to any scene right now.
  // Kept here, working as far as its own assertions go, so whoever lifts
  // the block below has a starting point instead of a blank page.
  //
  // The sheet swaps in place to a "← back" row plus the target list
  // (Task 5) when "convert to…" is tapped. Opening the sheet appears to
  // fire a genuine `mouseleave` on `.tiptap-wrapper` — the dialog's
  // top-layer promotion covers the previously-hovered chip — which arms
  // handleEditorMouseLeave's HOVER_HIDE_DELAY_MS (320ms) hide timer
  // (hover-reveal.js, wired up in TipTapEditor.svelte). That timer is a
  // desktop-hover mechanism never gated on touch, so it fires here too and,
  // once it lands, wipes hoveredBlock out from under this exact submenu:
  // the target rows render correctly for roughly the first ~150ms after
  // the convert tap, then collapse back to just "back" with no further
  // action from the user.
  //
  // First attempt asserted `rowCount >= 2` right after the tap and
  // returned — passed (the assertion ran inside the live window) while
  // `toHaveScreenshot`'s own re-shoot-until-stable loop kept sampling AFTER
  // the driver returned, past the 320ms mark, and committed the COLLAPSED
  // frame as the baseline. Second attempt held the pointer on a target row
  // (`.hover()`) on the theory that a resting hover, not a mouseleave,
  // would keep the timer from arming — asserted twice, once right after
  // the tap and again after the hold, both passing reliably. It still did
  // not work: re-running the SAME driver against Docker twice produced one
  // scene open (page-qa-content) and the other collapsed (page-board-
  // content) in the same run, with neither assertion ever failing — proof
  // the collapse happens strictly between this driver returning and
  // `toHaveScreenshot`'s own capture landing, a window this driver cannot
  // reach into no matter what it asserts beforehand. Whatever the timer is
  // actually reacting to, it is not simulateable from outside without
  // editing `handleEditorMouseLeave` itself (gate it on
  // `!isCoarsePointer()`, matching how the rest of the touch-reveal path
  // already treats this class of desktop-only mechanism) — and that file
  // is frozen for this task. See task-6-report.md's "Concerns" section.
  //
  // Until that lands, this state cannot honestly produce a stable
  // screenshot and must not be applied to a scene (scenes.js) or have a
  // baseline committed for it.
  [STATES.BLOCK_CONVERT_SHEET_TOUCH]: async (page) => {
    const chip = page.locator(".block-type-chip").first();
    await chip.waitFor({ state: "visible" });
    await chip.tap();

    const sheet = page.locator(".block-action-sheet");
    await sheet.waitFor({ state: "visible" });
    const convertRow = sheet.locator(".block-action-row", { hasText: BLOCK_ACTION_LABELS.convert });
    await convertRow.waitFor({ state: "visible" });
    await convertRow.tap();

    const backRow = sheet.locator(".block-action-row").filter({ hasText: "back" });
    await backRow.waitFor({ state: "visible" });
    const rows = sheet.locator(".block-action-row");
    const openCount = await rows.count();
    // back row + at least one target row.
    if (openCount < 2) {
      throw new Error(
        `block-convert-sheet: expected the back row plus at least one target row, got ${openCount} row(s)`,
      );
    }

    // Real-input hold, kept for whoever picks this up next — does not fix
    // the race (see the comment above) but is still the honest thing to
    // do while this driver is being exercised at all.
    await rows.nth(1).hover();

    const heldCount = await rows.count();
    if (heldCount < 2) {
      throw new Error(
        `block-convert-sheet: the sheet collapsed back to "${heldCount} row(s)" while holding the pointer on a target row — the hover hold did not prevent the hide timer`,
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

  // The shortcuts panel, opened the only way there is: click its own `?`.
  // Desktop project only (see the state's comment in scenes.js) — the
  // panel is display:none under (pointer: coarse), so this driver clicking
  // nothing is the correct failure on a phone, not a state to capture.
  [STATES.SHORTCUT_PANEL]: async (page) => {
    const toggle = page.getByRole("button", { name: "keyboard shortcuts" });
    await toggle.waitFor({ state: "visible" });
    await toggle.click();

    const panel = page.locator(".help-panel");
    await panel.waitFor({ state: "visible" });
    await settle(page, 350);

    // The container runs a Linux engine, so modifier-label.js must answer
    // "ctrl". Asserting ⌘ is ABSENT is the regression photograph: every
    // mod chord on this panel used to print ⌘ regardless of platform, and
    // no capture could see it because no capture ever opened the panel.
    const keys = await panel.locator(".key").allTextContents();
    if (!keys.includes("ctrl")) {
      throw new Error(
        `shortcut-panel: expected a "ctrl" chip on a Linux engine, got ${JSON.stringify(keys)}`,
      );
    }
    if (keys.includes("⌘")) {
      throw new Error("shortcut-panel: ⌘ printed on a Linux engine — modifier-label.js regressed");
    }

    // Every row's keys start at the same x. Measured rather than left to
    // the pixel diff: the column drifting a few px back to ragged is well
    // inside the 0.2% ratio gate, and the straight column is the entire
    // point of the subgrid that replaced justify-content: space-between.
    const lefts = await panel
      .locator(".help-keys")
      .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().left)));
    if (lefts.length === 0) throw new Error("shortcut-panel: no rows rendered");
    if (new Set(lefts).size !== 1) {
      throw new Error(
        `shortcut-panel: key column is ragged — left edges ${JSON.stringify([...new Set(lefts)].sort())}`,
      );
    }
  },
};

export function driverFor(state) {
  const fn = STATE_DRIVERS[state];
  if (!fn) throw new Error(`no VR driver for state: ${state}`);
  return fn;
}
