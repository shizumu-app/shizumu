// End-to-end coverage for the trickiest wiring in Task 3: @tiptap/suggestion's
// own handleKeyDown calls dispatchExit UNCONDITIONALLY on Escape (see
// node_modules/@tiptap/suggestion/dist/index.js), which would close the
// WHOLE slash menu even while the /table size grid is open. SlashCommands'
// addKeyboardShortcuts Escape binding is the fix (TipTap builds an
// extension's keymap plugin before its addProseMirrorPlugins() output, so
// it runs first). This test dispatches a REAL keydown through
// editor.view.dom — the actual ProseMirror EditorView -> plugin
// handleKeyDown dispatch path — rather than calling any internal function
// directly, so it would catch a regression in plugin ordering that a more
// unit-style test could miss.
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { SlashCommands } from "../../slash-commands.js";

function makeEditor() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new Editor({
    element: host,
    extensions: [StarterKit, SlashCommands],
    content: { type: "doc", content: [{ type: "paragraph" }] },
  });
  return { editor, host, cleanup: () => { editor.destroy(); host.remove(); } };
}

function pressKey(editor, key) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  editor.view.dom.dispatchEvent(event);
  return event;
}

describe("/table size grid + Escape (Task 3, real ProseMirror keydown dispatch)", () => {
  let env;
  afterEach(() => { if (env) env.cleanup(); env = null; });

  it("opening /table's grid, then pressing Escape, returns to the item list WITHOUT closing the menu", async () => {
    env = makeEditor();
    const { editor } = env;

    // Type "/table" — Suggestion's own plugin detects the trigger on the
    // resulting transaction, same as a real keystroke would.
    editor.commands.insertContent("/table");
    // @tiptap/suggestion fetches `items` asynchronously even for a
    // synchronous items() callback (it always routes through an `await`,
    // debounce:0 or not) — the menu exists synchronously after
    // insertContent but starts out empty ("no matches"); the real
    // (filtered) item list lands a microtask later.
    await new Promise((r) => setTimeout(r, 0));

    const menu = document.querySelector(".slash-command-menu");
    expect(menu).toBeTruthy();
    const tableRow = Array.from(menu.querySelectorAll("button.slash-command-row"))
      .find((b) => b.querySelector(".slash-command-title")?.textContent === "table");
    expect(tableRow).toBeTruthy();

    // Select it — swaps the menu into the size grid instead of inserting.
    tableRow.click();
    expect(document.querySelector(".slash-table-grid")).toBeTruthy();
    expect(document.querySelector("button.slash-command-row")).toBeNull();

    // Escape while the grid is open: must return to the item list, and the
    // menu itself must still be mounted (the old/naive behavior — letting
    // Suggestion's own Escape handling run — would remove it here).
    pressKey(editor, "Escape");
    expect(document.querySelector(".slash-command-menu")).toBeTruthy();
    expect(document.querySelector(".slash-table-grid")).toBeNull();
    const tableRowAgain = Array.from(document.querySelectorAll("button.slash-command-row"))
      .find((b) => b.querySelector(".slash-command-title")?.textContent === "table");
    expect(tableRowAgain).toBeTruthy();

    // Escape again, now that the grid is closed: normal behavior resumes —
    // the whole menu closes, same as every other slash command before
    // this task.
    pressKey(editor, "Escape");
    expect(document.querySelector(".slash-command-menu")).toBeNull();
  });

  it("the outer Escape keymap does not swallow Escape when the grid isn't open (normal menu-close behavior is unaffected)", async () => {
    env = makeEditor();
    const { editor } = env;
    editor.commands.insertContent("/table");
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector(".slash-command-menu")).toBeTruthy();

    pressKey(editor, "Escape");
    expect(document.querySelector(".slash-command-menu")).toBeNull();
  });

  // Both cases above build a FRESH Editor in makeEditor(), so neither can see
  // the lifecycle bug: `ext.storage.exitTableGrid` is assigned in the body of
  // Suggestion's `render()`, which @tiptap/suggestion calls exactly ONCE per
  // editor at plugin construction (dist/index.js — outside the returned
  // Plugin), while `onExit` fires on every menu close and used to null it.
  // After any one slash-menu session the Escape binding's `exitTableGrid`
  // check was false, Suggestion's unconditional dispatchExit ran, and the
  // whole menu closed instead of returning to the item list. See
  // final-review.md I1. This case reuses ONE editor across two sessions.
  it("Escape still returns to the item list on a SECOND /table session in the same editor", async () => {
    env = makeEditor();
    const { editor } = env;

    // Session 1: open the menu and close it — the single most common
    // interaction, and the one that used to disarm the grid's Escape.
    editor.commands.insertContent("/table");
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector(".slash-command-menu")).toBeTruthy();
    pressKey(editor, "Escape");
    expect(document.querySelector(".slash-command-menu")).toBeNull();

    // Session 2, same editor: /table -> grid -> Escape.
    editor.commands.clearContent();
    editor.commands.insertContent("/table");
    await new Promise((r) => setTimeout(r, 0));
    const menu = document.querySelector(".slash-command-menu");
    expect(menu).toBeTruthy();
    const tableRow = Array.from(menu.querySelectorAll("button.slash-command-row"))
      .find((b) => b.querySelector(".slash-command-title")?.textContent === "table");
    expect(tableRow).toBeTruthy();
    tableRow.click();
    expect(document.querySelector(".slash-table-grid")).toBeTruthy();

    pressKey(editor, "Escape");
    expect(document.querySelector(".slash-command-menu")).toBeTruthy();
    expect(document.querySelector(".slash-table-grid")).toBeNull();
    const tableRowAgain = Array.from(document.querySelectorAll("button.slash-command-row"))
      .find((b) => b.querySelector(".slash-command-title")?.textContent === "table");
    expect(tableRowAgain).toBeTruthy();
  });
});
