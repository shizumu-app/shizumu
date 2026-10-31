import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { READONLY_EXTENSIONS, PIN_EDITOR_EXTENSIONS } from "../shared-extensions.js";

const li = (t, kids) => ({ type: "listItem", attrs: { marker: "bullet" }, content: [{ type: "paragraph", content: [{ type: "text", text: t }] }, ...(kids ? [kids] : [])] });
// A pin that closes on a list three deep, as J12's does.
const pin = { type: "doc", content: [
  { type: "paragraph", content: [{ type: "text", text: "the ferry leaves at six" }] },
  { type: "list", content: [li("a thread", { type: "list", content: [li("deeper", { type: "list", content: [li("deepest")] })] })] },
] };

let editor;
afterEach(() => editor?.destroy());
const lastAfterATransaction = (extensions) => {
  editor = new Editor({ element: document.createElement("div"), extensions, content: pin, editable: true });
  // Any transaction, the way the native focus event's was on the laptop.
  editor.view.dispatch(editor.state.tr.setMeta("focus", true));
  const doc = editor.getJSON();
  return { count: doc.content.length, last: doc.content.at(-1).type };
};

describe("PIN_EDITOR_EXTENSIONS", () => {
  it("adds no empty paragraph after a pin that closes on a list", () => {
    // It did, through StarterKit's TrailingNode: saved, it became an extra
    // block of the pin (J12.6), and arriving on the first transaction it
    // left `focus("end")` stale on the laptop (J12.9).
    expect(lastAfterATransaction(PIN_EDITOR_EXTENSIONS)).toEqual({ count: 2, last: "list" });
  });

  it("is the page's schema otherwise, where the trailing line stays", () => {
    // The page keeps it on purpose: an empty line to write on below a list.
    expect(lastAfterATransaction(READONLY_EXTENSIONS)).toEqual({ count: 3, last: "paragraph" });
    expect(PIN_EDITOR_EXTENSIONS.slice(1)).toEqual(READONLY_EXTENSIONS.slice(1));
  });
});
