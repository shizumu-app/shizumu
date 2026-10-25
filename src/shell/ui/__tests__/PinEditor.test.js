import { describe, it, expect, afterEach, vi } from "vitest";
import { flushSync } from "svelte";
import { render, cleanupAll } from "../../../lib/ui/test-helper.js";

import PinEditor from "../PinEditor.svelte";

afterEach(cleanupAll);

const doc = {
  type: "doc",
  content: [
    {
      type: "blockquote",
      content: [{ type: "paragraph", content: [{ type: "text", text: "not time, scope" }] }],
    },
  ],
};

describe("PinEditor", () => {
  it("mounts a live, editable ProseMirror over the doc", () => {
    const { target } = render(PinEditor, { doc });
    flushSync();
    const pm = target.querySelector(".shell-pin-editor .ProseMirror");
    expect(pm).not.toBeNull();
    expect(pm.getAttribute("contenteditable")).toBe("true");
    expect(pm.textContent).toContain("not time, scope");
  });

  it("hands up the whole doc on every change", () => {
    // The host writes what it is handed, once, on leaving the screen —
    // so what is handed must be the doc as the writer left it, not a
    // diff and not the first node alone.
    const onChange = vi.fn();
    let editor = null;
    render(PinEditor, { doc, onChange, onEditor: (e) => { editor = e; } });
    flushSync();
    expect(editor, "the instance is handed up on mount").toBeTruthy();
    const { view } = editor;
    view.dispatch(view.state.tr.insertText("still ", 2));
    expect(onChange).toHaveBeenCalledTimes(1);
    const handed = onChange.mock.calls[0][0];
    expect(handed.type).toBe("doc");
    expect(JSON.stringify(handed)).toContain("still not time, scope");
  });

  it("renders through the container the prose rules address", () => {
    const { target } = render(PinEditor, { doc });
    flushSync();
    expect(target.querySelector(".prose.shell-pin-editor")).not.toBeNull();
  });

  it("hands the instance back as null on teardown, and destroys it", () => {
    let editor = null;
    const seen = [];
    const { cleanup } = render(PinEditor, { doc, onEditor: (e) => { seen.push(e); editor = e ?? editor; } });
    flushSync();
    cleanup();
    expect(seen.length).toBe(2);
    expect(seen[1]).toBeNull();
    expect(editor.isDestroyed).toBe(true);
  });
});
