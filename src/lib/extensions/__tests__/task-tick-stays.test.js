// Ticking a task must not move the caret, focus the editor or scroll.
//
// The owner, on the phone (2026-10-30): tapping a task's box to tick it
// sent the view down to the end of the page. The change handler ran
// `chain().focus(...)` first; with the keyboard down the editor was not
// focused, so it was focused at its old caret, which a long page puts at
// the end, and the keyboard and the scroll followed it there.
import { describe, it, expect, afterEach, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { buildEditingExtensions } from "../../render/shared-extensions.js";

let editor, host;
afterEach(() => { editor?.destroy(); host?.remove(); });

const task = (text, checked = false) => ({
  type: "listItem", attrs: { marker: "task", checked },
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

function make() {
  host = document.createElement("div");
  document.body.appendChild(host);
  editor = new Editor({
    element: host,
    extensions: buildEditingExtensions({}),
    content: { type: "doc", content: [
      { type: "list", content: [task("pack the passports"), task("book the night ferry")] },
      ...Array.from({ length: 12 }, (_, i) => ({ type: "paragraph", content: [{ type: "text", text: `a later line ${i}` }] })),
    ] },
  });
  return editor;
}

describe("ticking a task", () => {
  it("ticks the item and leaves the caret, the focus and the scroll where they were", async () => {
    make();
    // The caret was last at the end of the page, and the editor is not
    // focused: the phone with its keyboard down.
    const end = editor.state.doc.content.size - 1;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)));
    editor.view.dom.blur();
    expect(editor.isFocused).toBe(false);

    // TipTap's focus command calls view.focus() on the next frame, which is
    // what raised the keyboard and scrolled to the caret; watch for it.
    const focused = vi.spyOn(editor.view, "focus");
    const box = host.querySelector('input[type="checkbox"]');
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));

    let first = null;
    editor.state.doc.descendants((n) => { if (first === null && n.type.name === "listItem") first = n; return first === null; });
    expect(first.attrs.checked).toBe(true);
    expect(editor.state.selection.from).toBe(end);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    expect(focused).not.toHaveBeenCalled();
    expect(editor.isFocused).toBe(false);
  });
});
