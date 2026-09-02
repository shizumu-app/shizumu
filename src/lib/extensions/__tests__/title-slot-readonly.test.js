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
