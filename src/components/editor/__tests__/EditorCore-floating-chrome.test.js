// src/components/editor/__tests__/EditorCore-floating-chrome.test.js
//
// EditorCore's half of the floating-chrome seam: it takes the flag and
// forwards it to buildEditingExtensions — at BOTH call sites, which is the
// only part of this that is a decision rather than plumbing.
//
// The seam itself (`floatingChrome`, defaulting true, omitting
// SlashCommands / MentionCommand / TouchBlockHandle when false) is tested
// in src/lib/render/__tests__/shared-extensions-floating-chrome.test.js.
// Nothing here re-asserts what that file already owns; this file asserts
// only what EditorCore does with it.
//
// Its own mock of shared-extensions, deliberately not the one in
// EditorCore.test.js: that mock is `() => [...]` and discards its
// argument, so a forwarding claim asserted against it would be green with
// the argument dropped entirely. Here the factory is a spy that RECORDS
// each options object, which is the only shape that can see the argument
// go missing.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "../../../lib/ui/test-helper.js";

vi.mock("../../../lib/api.js", () => ({
  savePageContent: vi.fn(() => Promise.resolve()),
  saveTrailContent: vi.fn(() => Promise.resolve()),
  createPin: vi.fn(() => Promise.resolve({ id: "pin-1" })),
  getPins: vi.fn(() => Promise.resolve([])),
  attachmentAddBytes: vi.fn(() => Promise.resolve({})),
  updatePinContent: vi.fn(() => Promise.resolve()),
  updatePinStatus: vi.fn(() => Promise.resolve()),
  getSetting: vi.fn(() => Promise.resolve(null)),
  setSetting: vi.fn(() => Promise.resolve()),
}));

const isYjsEnabled = vi.fn(() => Promise.resolve(false));
vi.mock("../../../lib/yjs/feature-flag.js", () => ({ isYjsEnabled: (...a) => isYjsEnabled(...a) }));

// Recorded per call, so the yjs test below can tell the SCHEMA build from
// the EDITOR build by position — the schema one runs first, inside the
// backfill branch, and is the one that would be left defaulted.
const builds = [];
vi.mock("../../../lib/render/shared-extensions.js", async () => {
  const { Document } = await import("@tiptap/extension-document");
  const { Paragraph } = await import("@tiptap/extension-paragraph");
  const { Text } = await import("@tiptap/extension-text");
  const { UndoRedo } = await import("@tiptap/extensions");
  return {
    READONLY_EXTENSIONS: [],
    buildEditingExtensions: (opts = {}) => {
      builds.push(opts);
      return [Document, Paragraph, Text, UndoRedo];
    },
  };
});

import EditorCore from "../EditorCore.svelte";

afterEach(() => {
  cleanupAll();
  // Discards the caret timer the continuous test below parks — see its
  // own comment for why it must never be allowed to fire.
  vi.useRealTimers();
});
beforeEach(() => {
  builds.length = 0;
  isYjsEnabled.mockResolvedValue(false);
});

const doc = (t) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });

// onMount awaits a tick before constructing the editor, and the yjs gate
// awaits a promise on top of that. Four rounds, same shape as
// EditorCore.test.js's settle() with one to spare for the extra await.
async function mount(props = {}) {
  render(EditorCore, { pageId: "p1", initialContent: doc("a"), ...props });
  for (let i = 0; i < 4; i++) { await Promise.resolve(); await tick(); }
}

describe("EditorCore — the floating-chrome flag", () => {
  it("defaults to true, which is the desktop unchanged", async () => {
    // The default is the whole safety argument for this prop: TipTapEditor
    // passes nothing, so the desktop's extension list has to come out
    // byte-identical to what it was before the prop existed. Asserted as
    // the VALUE reaching the factory rather than as "the prop is absent" —
    // an absent prop and a prop forwarded as `undefined` look the same
    // from TipTapEditor and are not the same at the factory, where
    // `undefined` would take the destructuring default by luck rather
    // than by this component's intent.
    await mount();
    expect(builds.length).toBe(1);
    expect(builds[0].floatingChrome).toBe(true);
  });

  it("forwards false to the extension factory", async () => {
    await mount({ floatingChrome: false });
    expect(builds.length).toBe(1);
    expect(builds[0].floatingChrome).toBe(false);
  });

  it("builds the yjs backfill schema from the same list the editor gets", async () => {
    // THE reason the flag is passed at the schema call too. That call
    // (EditorCore:187) derives a prosemirror schema, parses this page's
    // content_json through it, and the Y.Doc that comes out is what the
    // editor built four lines later is BOUND to. A schema derived from a
    // different extension list than the editor's is a mismatch with no
    // symptom at the seam — it surfaces later, as a parse error on a node
    // one list knows and the other does not.
    //
    // Reached only on the lazy-backfill path: continuous trail, flag on,
    // no stored yjs_state. Both calls are asserted, and equal to each
    // other rather than each to `false`, because the claim is that the
    // two lists AGREE — that is what stays true if the default flips.
    //
    // Fake timers, held: a continuous page schedules `focus("end")` 50ms
    // after its editor mounts (EditorCore:494), and that timer must not be
    // left pending against a torn-down editor — it lands as an unhandled
    // error that fails the run at exit code 1 with every assertion green,
    // and this file hit exactly that before the clock was held. It also
    // used to be unable to run at all, ending in scrollToSelection, which
    // wants getClientRects on the Range PM measures a caret with and jsdom
    // does not implement; vitest.setup.js fills that in now, leaving the
    // torn-down half, which is reason enough. Nothing here advances it;
    // afterEach's useRealTimers discards it. ShellApp.test.js records the
    // same trap.
    vi.useFakeTimers();
    isYjsEnabled.mockResolvedValue(true);
    await mount({ trailMode: "continuous", initialYjsState: null, floatingChrome: false });

    expect(builds.length).toBe(2);
    const [schemaBuild, editorBuild] = builds;
    expect(schemaBuild.floatingChrome).toBe(false);
    expect(editorBuild.floatingChrome).toBe(false);
    expect(schemaBuild.floatingChrome).toBe(editorBuild.floatingChrome);
  });
});

describe("the real extension list — what the flag costs a schema today", () => {
  it("derives the same schema with the floating chrome off", async () => {
    // Why passing the flag to the schema call is free today, stated as a
    // test rather than as a comment nobody can check. All three surfaces
    // the flag omits are Extension.create — they register plugins and
    // keymaps, no node and no mark — so getSchema sees the identical spec
    // either way, and no existing document can fail to parse under the
    // trimmed list.
    //
    // This is the guard on the day that stops being true. An extension
    // that grows a node while sitting behind this flag would split the
    // two schemas, and this test reddens on the spec diff rather than a
    // device finding a page it cannot open. Uses the REAL factory —
    // vi.importActual past this file's own mock — because a stub's schema
    // would prove nothing about the shipped one.
    const { buildEditingExtensions } = await vi.importActual("../../../lib/render/shared-extensions.js");
    const { getSchema } = await import("@tiptap/core");

    const withChrome = getSchema(buildEditingExtensions({}));
    const without = getSchema(buildEditingExtensions({ floatingChrome: false }));

    expect(shapeOf(without)).toEqual(shapeOf(withChrome));
    // The names alone, asserted separately, so a failure says WHICH half
    // moved: a lost node reads very differently from a redefined one.
    expect(Object.keys(without.nodes)).toEqual(Object.keys(withChrome.nodes));
    expect(Object.keys(without.marks)).toEqual(Object.keys(withChrome.marks));
  });
});

/** A schema reduced to what a stored document is parsed against: which
 *  node and mark types exist, and for each the content expression, group,
 *  atom/inline flags and attribute names.
 *
 *  Written out by hand rather than compared through `schema.spec.nodes`,
 *  and that is the point of it. `spec.nodes` is a prosemirror OrderedMap,
 *  so `String(...)` on it is "[object Object]" for EVERY schema — an
 *  assertion written that way passes on two schemas that share nothing,
 *  which is what the first draft of this test did. Caught by probing it:
 *  dropping a node-bearing extension from one side left it green.
 *
 *  Node/mark NAMES would not be enough on their own either: an extension
 *  can redefine an existing type's content expression or attrs without
 *  adding a type, and a name list cannot see that. */
function shapeOf(schema) {
  const types = (map) =>
    Object.fromEntries(
      Object.entries(map).map(([name, type]) => [
        name,
        {
          content: type.spec.content ?? null,
          group: type.spec.group ?? null,
          inline: !!type.spec.inline,
          atom: !!type.spec.atom,
          marks: type.spec.marks ?? null,
          attrs: Object.keys(type.spec.attrs ?? {}).sort(),
        },
      ]),
    );
  return { nodes: types(schema.nodes), marks: types(schema.marks) };
}
