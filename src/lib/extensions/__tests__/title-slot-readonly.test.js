// A closed page is closed for the title too.
//
// The title slot is an <input> the NodeView renders as chrome OUTSIDE the
// contenteditable (title-slot.js's own note says so, and says "Input is
// always editable — no contentEditable toggling"). So TipTap's
// `editable: !readonly` never reaches it: on a read-only page the field
// took focus, accepted keystrokes, and dispatched setNodeAttribute into a
// document the app says is frozen. Renaming every board on a page you
// cannot type into is not a smaller version of editing it.
//
// Driven through `bindTitleSlot` with a fake view rather than a mounted
// editor, because the defect is in the write path and a fake view is the
// only way to set `editable` both ways without a second Editor.
import { describe, it, expect, vi } from "vitest";
import { bindTitleSlot } from "../title-slot.js";

/** The smallest view bindTitleSlot's write path actually reads. */
function fakeView({ editable, title = null }) {
  const dispatch = vi.fn();
  const node = { attrs: { blockTitle: title }, content: { size: 0 } };
  return {
    editable,
    dispatch,
    state: {
      doc: { nodeAt: () => node, resolve: () => ({}) },
      tr: {
        setNodeAttribute: vi.fn().mockReturnThis(),
        setMeta: vi.fn().mockReturnThis(),
        docChanged: false,
      },
    },
    focus: vi.fn(),
  };
}

function bind(view) {
  const titleSlot = document.createElement("input");
  return {
    titleSlot,
    api: bindTitleSlot({
      titleSlot,
      view,
      getPos: () => 0,
      ext: { storage: { pendingFocusPos: null } },
      resolveContentPos: () => -1,
      onTitleRender: () => {},
    }),
  };
}

describe("bindTitleSlot — a read-only page", () => {
  it("dispatches no transaction when the view is not editable", () => {
    // THE regression. `editable: false` is what TipTap's `readonly` prop
    // sets on the view (setEditable), so this is the editor's own answer
    // rather than a second flag that could drift from it.
    const view = fakeView({ editable: false });
    const { titleSlot } = bind(view);

    titleSlot.value = "renamed on a closed page";
    titleSlot.dispatchEvent(new Event("blur"));

    expect(view.dispatch).not.toHaveBeenCalled();
    expect(view.state.tr.setNodeAttribute).not.toHaveBeenCalled();
  });

  it("still writes when the view IS editable", () => {
    // The other half, and the one that makes the test above mean
    // something: a guard that refused everything would pass the first
    // assertion and break the feature.
    const view = fakeView({ editable: true });
    const { titleSlot } = bind(view);

    titleSlot.value = "a real title";
    titleSlot.dispatchEvent(new Event("blur"));

    expect(view.state.tr.setNodeAttribute).toHaveBeenCalledWith(0, "blockTitle", "a real title");
    expect(view.dispatch).toHaveBeenCalled();
  });

  it("treats a view with no `editable` at all as editable", () => {
    // Not a placeholder assertion: the guard is `!== false`, deliberately,
    // so a host that never set the flag keeps working. Written down
    // because `!view.editable` would have been the obvious spelling and
    // would silently freeze every such host.
    const view = fakeView({ editable: undefined });
    const { titleSlot } = bind(view);

    titleSlot.value = "still fine";
    titleSlot.dispatchEvent(new Event("blur"));

    expect(view.dispatch).toHaveBeenCalled();
  });
});

describe("bindTitleSlot — a position that cannot be read", () => {
  // CAUGHT ON A DEVICE, twice in one run, by scripts/device/drive.mjs while
  // tapping around a table:
  //
  //   RangeError: Position -1 out of range
  //     at getPos … at Object.consumePendingFocus
  //
  // ProseMirror resolves a NodeView's position when asked, so a view whose
  // node has gone — or has not landed yet — makes getPos() call
  // doc.resolve(-1) and throw. consumePendingFocus runs from a
  // requestAnimationFrame, where nothing above it can catch that, so it
  // reached the page as an uncaught exception. A table is a NodeView that
  // mounts its own title slot (table-shell-view.js), which is why tapping
  // one found it.
  //
  // The fake throws exactly as ProseMirror does, which is the whole fixture.
  const throwing = () => { throw new RangeError("Position -1 out of range"); };

  it("does not throw out of consumePendingFocus when getPos throws", () => {
    const titleSlot = document.createElement("input");
    const api = bindTitleSlot({
      titleSlot,
      view: fakeView({ editable: true }),
      getPos: throwing,
      ext: { storage: { pendingFocusPos: 0 } },
      resolveContentPos: () => -1,
      onTitleRender: () => {},
    });
    expect(() => api.consumePendingFocus()).not.toThrow();
  });

  it("leaves the pending arm alone rather than claiming it", () => {
    // A position nobody can read is not a position that MATCHES, so the arm
    // belongs to whichever NodeView can still answer. Consuming it here
    // would take the focus away from the block the slash command meant.
    const storage = { pendingFocusPos: 7 };
    const titleSlot = document.createElement("input");
    const api = bindTitleSlot({
      titleSlot,
      view: fakeView({ editable: true }),
      getPos: throwing,
      ext: { storage },
      resolveContentPos: () => -1,
      onTitleRender: () => {},
    });
    api.consumePendingFocus();
    expect(storage.pendingFocusPos).toBe(7);
  });
});
