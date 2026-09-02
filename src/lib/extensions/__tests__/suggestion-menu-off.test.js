// `floatingMenu: false` removes the menu and KEEPS the plugin.
//
// The distinction this file exists to hold: a suggestion extension is a
// ProseMirror plugin (tracks active/range/query off every transaction) with
// a renderer bolted on top (draws a floating menu out of that state). A host
// that draws its own suggestion UI — the mobile shell's chip strip — reads
// the plugin state through the exported plugin keys and refuses the menu.
//
// The first attempt at that seam dropped the whole extension, which took the
// state machine with the menu: the shell's strip had nothing left to read.
// So the assertion that matters most here is not "no menu appeared" — it is
// that `active`, `range` and `query` are still exactly what they were.
//
// Everything is driven through a real Editor and real transactions, never by
// calling a renderer or plugin internal, because the thing under test is
// which halves of that pipeline survive being wired together.
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { SlashCommands, SlashCommandsPluginKey } from "../../slash-commands.js";
import { MentionCommand, MentionCommandPluginKey } from "../mention-command.js";

function makeEditor(extension) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new Editor({
    element: host,
    extensions: [StarterKit, extension],
    content: { type: "doc", content: [{ type: "paragraph" }] },
  });
  return {
    editor,
    cleanup: () => {
      editor.destroy();
      host.remove();
    },
  };
}

// @tiptap/suggestion always routes `items` through an await, so the menu
// exists synchronously but its rows land a microtask later. Every DOM
// assertion below waits, so that a menu is never called absent merely
// because the test looked too early.
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("SlashCommands with floatingMenu: false", () => {
  let env;
  afterEach(() => {
    if (env) env.cleanup();
    env = null;
  });

  it("still tracks active / range / query when `/` is typed", async () => {
    // THE assertion. `SlashCommandsPluginKey.getState(state)` is the only
    // producer of a live `/` session — the shell's suggestion strip is
    // derived entirely from it. Omitting the extension (the seam's first
    // shape) made this state undefined.
    env = makeEditor(SlashCommands.configure({ floatingMenu: false }));
    const { editor } = env;

    expect(SlashCommandsPluginKey.getState(editor.state).active).toBe(false);

    editor.commands.insertContent("/out");
    await settle();

    const state = SlashCommandsPluginKey.getState(editor.state);
    expect(state.active).toBe(true);
    expect(state.query).toBe("out");
    // "/out" typed into an empty paragraph: the text runs 1..5.
    expect(state.range).toEqual({ from: 1, to: 5 });
    expect(state.text).toBe("/out");
  });

  it("builds no floating menu DOM", async () => {
    // "Nothing happens" is the right assertion here, and it is right for a
    // reason that is not "the code path never ran": the test above proves
    // the suggestion session DID start on the same keystrokes. So this
    // absence is the renderer being silent, not the plugin being asleep —
    // and the control test below proves this selector finds a menu when
    // one is drawn.
    env = makeEditor(SlashCommands.configure({ floatingMenu: false }));
    env.editor.commands.insertContent("/out");
    await settle();

    expect(SlashCommandsPluginKey.getState(env.editor.state).active).toBe(true);
    expect(document.querySelector(".slash-command-menu")).toBeNull();
  });

  it("leaves ArrowDown to the editor instead of swallowing it", async () => {
    // The silent onKeyDown returns false. Returning true would tell
    // ProseMirror the key was consumed — correct when a menu is moving a
    // selection, wrong when there is no menu, and it would take the key
    // from the host's own strip. Contrasted against the default below.
    env = makeEditor(SlashCommands.configure({ floatingMenu: false }));
    env.editor.commands.insertContent("/out");
    await settle();

    const event = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    });
    env.editor.view.dom.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("SlashCommands by default (the desktop)", () => {
  let env;
  afterEach(() => {
    if (env) env.cleanup();
    env = null;
  });

  it("draws the floating menu, with the same plugin state underneath", async () => {
    // The control for the two absences above: same trigger, unconfigured
    // extension, and the menu is there. Without this, "no menu" would pass
    // just as well against an extension that never activates at all.
    env = makeEditor(SlashCommands);
    env.editor.commands.insertContent("/out");
    await settle();

    expect(document.querySelector(".slash-command-menu")).toBeTruthy();
    const state = SlashCommandsPluginKey.getState(env.editor.state);
    expect(state.active).toBe(true);
    expect(state.query).toBe("out");
    expect(state.range).toEqual({ from: 1, to: 5 });
  });

  it("swallows ArrowDown, which is what the menu is for", async () => {
    env = makeEditor(SlashCommands);
    env.editor.commands.insertContent("/out");
    await settle();

    const event = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      bubbles: true,
      cancelable: true,
    });
    env.editor.view.dom.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("configuring floatingMenu: true is the same as not configuring it", async () => {
    // The default is an explicit `true` in addOptions, not an absence, so
    // a caller that passes it through a variable gets the desktop.
    env = makeEditor(SlashCommands.configure({ floatingMenu: true }));
    env.editor.commands.insertContent("/out");
    await settle();

    expect(document.querySelector(".slash-command-menu")).toBeTruthy();
  });
});

describe("MentionCommand with floatingMenu: false", () => {
  let env;
  afterEach(() => {
    if (env) env.cleanup();
    env = null;
  });

  it("still tracks active / range / query when `@` is typed", async () => {
    // Same shape as the slash case: the `@` plugin's state is the producer
    // of `kind: "mention"` for the host's strip. Its `items` callback hits
    // the Tauri API and fails in this environment — deliberately not
    // mocked, because the plugin state is computed from the transaction and
    // must not depend on rows arriving.
    env = makeEditor(MentionCommand.configure({ floatingMenu: false }));
    const { editor } = env;

    editor.commands.insertContent("@foo");
    await settle();

    const state = MentionCommandPluginKey.getState(editor.state);
    expect(state.active).toBe(true);
    expect(state.query).toBe("foo");
    expect(state.range).toEqual({ from: 1, to: 5 });
  });

  it("builds no floating menu DOM", async () => {
    // Absence with a live session behind it — see the slash case above for
    // why that is the part which makes this assertion meaningful.
    env = makeEditor(MentionCommand.configure({ floatingMenu: false }));
    env.editor.commands.insertContent("@foo");
    await settle();

    expect(MentionCommandPluginKey.getState(env.editor.state).active).toBe(true);
    expect(document.querySelector(".mention-command-menu")).toBeNull();
  });
});

describe("MentionCommand by default", () => {
  let env;
  afterEach(() => {
    if (env) env.cleanup();
    env = null;
  });

  it("draws the floating menu", async () => {
    // The control for the absence above.
    env = makeEditor(MentionCommand);
    env.editor.commands.insertContent("@foo");
    await settle();

    expect(document.querySelector(".mention-command-menu")).toBeTruthy();
  });
});
