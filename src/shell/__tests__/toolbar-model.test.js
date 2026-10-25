import { describe, it, expect, afterEach } from "vitest";
import { Editor, Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Document } from "@tiptap/extension-document";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { SlashCommandsPluginKey } from "../../lib/slash-commands.js";
import { computeSnapshot } from "../../components/editor/editor-snapshot.js";
import { toolbarFor, TOOLBAR_BUTTON_LABELS } from "../toolbar-model.js";
import { suggestionChips } from "../suggestion-strip-model.js";
import { BLOCK_ACTION_LABELS } from "../block-sheet-model.js";

const BLOCK = { type: "paragraph", pos: 4 };

describe("toolbarFor", () => {
  it("leaves the nav row alone when the keyboard is down", () => {
    const t = toolbarFor({ editing: false, selectionEmpty: true, activeBlock: null });
    // "none" is no STRIP ABOVE the nav, not an empty band. The nav row is
    // not a mode this function can decline — see the header.
    expect(t.strip).toBe("none");
    expect(t.nav).toBe(true);
    // The tab bar's three roots are the TabBar primitive's own business, not
    // a strip of buttons this model enumerates.
    expect(t.buttons).toEqual([]);
  });

  it("shows the block strip for a caret with no selection", () => {
    // Six, and exactly these, in this order — the visual pass's strip.
    // `list` is not among them (it lives under `turn into` now, see
    // turn-into-model.js) and neither is `keyboard-down` (toolbar-model's
    // BLOCK_STRIP records the Android reason and the open iOS question).
    // Asserted as the whole list so a control drifting back in fails by
    // name rather than being absorbed.
    const t = toolbarFor({ editing: true, keyboardOpen: true, selectionEmpty: true, activeBlock: BLOCK });
    expect(t.strip).toBe("block-strip");
    expect(t.buttons).toEqual(["insert", "type", "bold", "italic", "pin", "undo"]);
    expect(t.buttons).not.toContain("list");
    expect(t.buttons).not.toContain("keyboard-down");
  });

  it("adds indent and outdent after turn into while the caret is in a list item", () => {
    // A list item cannot be nested by touch any other way: only a hardware
    // Tab did it. The owner chose the strip over the block sheet
    // (2026-10-25); everywhere else the strip stays the six above.
    const t = toolbarFor({ editing: true, keyboardOpen: true, selectionEmpty: true, activeBlock: BLOCK, inListItem: true });
    expect(t.buttons).toEqual(["insert", "type", "indent", "outdent", "bold", "italic", "pin", "undo"]);
    expect(TOOLBAR_BUTTON_LABELS.indent).toBe("indent");
    expect(TOOLBAR_BUTTON_LABELS.outdent).toBe("outdent");
  });

  it("keeps the labels for the two ids it no longer emits", () => {
    // `keyboard-down` may come back for iOS and `list` is still a mark
    // name activeIdsFor reads — both stay labelled so the id keeps its
    // words the day a strip needs it, rather than being re-invented under
    // another name. Dropping either entry would make this red.
    expect(TOOLBAR_BUTTON_LABELS["keyboard-down"]).toBe("hide keyboard");
    expect(TOOLBAR_BUTTON_LABELS.list).toBe("list");
  });

  it("drops the turn-into button when nothing is the active block", () => {
    // "type" turns THIS block into another kind; with no active block there
    // is nothing to turn, and a button that cannot act is worse than absent.
    const t = toolbarFor({ editing: true, keyboardOpen: true, selectionEmpty: true, activeBlock: null });
    expect(t.buttons).not.toContain("type");
    // `insert` leads either way — the one position that does not move.
    expect(t.buttons.slice(0, 2)).toEqual(["insert", "bold"]);
  });

  it("shows the selection strip when text is selected", () => {
    const t = toolbarFor({ editing: true, keyboardOpen: true, selectionEmpty: false, activeBlock: BLOCK });
    expect(t.strip).toBe("selection-strip");
    expect(t.buttons).toEqual([
      "bold", "italic", "strike", "code", "link", "pin-selection", "copy",
    ]);
  });

  it("shows the suggestion strip, carrying the chips, while a query is live", () => {
    const t = toolbarFor({
      editing: true, keyboardOpen: true,
      selectionEmpty: true,
      activeBlock: BLOCK,
      query: { kind: "slash", text: "cha" },
      suggestions: ["chart"],
    });
    expect(t.strip).toBe("suggestion-strip");
    // The chips come THROUGH this row rather than from it: which commands
    // a query resolves to is the editor extension's list to answer
    // (suggestion-strip-model.js). What this row decides is whether the
    // slot is theirs — and until Task 4 it answered yes while emitting
    // nothing, which is the bug the next test pins.
    expect(t.buttons).toEqual(["chart"]);
  });

  it("leaves the slot alone for a query with no chips rather than blanking it", () => {
    // THE defect this row shipped with. `{ strip: "suggestion-strip",
    // buttons: [] }` won the slot on every live trigger and put nothing in
    // it — a reserved, empty band arriving on `/`, the most common
    // keystroke in the editor, on a phone with no floating slash menu to
    // compensate. ShellApp's only defence was to hardcode `query: null` at
    // the call site, i.e. to keep the row switched off.
    //
    // Reproduced before the fix: with `if (query) return { strip:
    // "suggestion-strip", buttons: [] }` this returns "suggestion-strip"
    // and an empty list. It falls through now.
    const t = toolbarFor({
      editing: true, keyboardOpen: true,
      selectionEmpty: true,
      activeBlock: BLOCK,
      query: { kind: "slash", text: "zzzz" },
    });
    expect(t.strip).toBe("block-strip");
    expect(t.buttons).toContain("bold");
  });

  it("ignores a chip list with no live query — a strip must not latch open", () => {
    // The mirror guard, and the reason the row asks two questions instead
    // of inferring one from the other. A caller derives `suggestions` from
    // `query`, so in production they agree; the failure this pins is a
    // chip list that outlives the trigger it was computed for, which is
    // exactly the latching toolbar-model's header exists to prevent.
    // Drop the `query &&` term and this goes red while every other test
    // here stays green.
    const t = toolbarFor({
      editing: true, keyboardOpen: true,
      selectionEmpty: true,
      activeBlock: BLOCK,
      query: null,
      suggestions: ["heading 1", "heading 2"],
    });
    expect(t.strip).toBe("block-strip");
  });

  it("ignores an inactive query", () => {
    // The snapshot's `query` field IS the liveness signal: computeSnapshot
    // returns null the instant no trigger is open, never an object with an
    // `active: false` flag. Reading truthiness of a fabricated flag instead
    // of the object's presence was how the strip latched open after the
    // trigger was deleted (there is no producer shape to "ignore" here —
    // the correct inactive value is null, exercised below).
    const t = toolbarFor({
      editing: true, keyboardOpen: true,
      selectionEmpty: true,
      activeBlock: BLOCK,
      query: null,
    });
    expect(t.strip).toBe("block-strip");
  });

  it("gives find the slot whenever it is open, keyboard up or down", () => {
    for (const keyboardOpen of [true, false]) {
      const t = toolbarFor({ keyboardOpen, selectionEmpty: true, activeBlock: BLOCK, findOpen: true });
      expect(t.strip).toBe("find-strip");
      expect(t.buttons).toEqual(["field", "prev", "next", "close"]);
    }
  });

  it("lets find outrank a live query and a selection", () => {
    const t = toolbarFor({
      editing: true, keyboardOpen: true,
      selectionEmpty: false,
      activeBlock: BLOCK,
      query: { kind: "slash", text: "x" },
      findOpen: true,
    });
    expect(t.strip).toBe("find-strip");
  });

  it("lets a live query outrank a selection", () => {
    // Pins query-before-selection. Typing `/` with text selected means the
    // trigger, not the selection — swap these two guards and every other
    // test still passes, which is how this rule went unguarded.
    expect(
      toolbarFor({
        editing: true, keyboardOpen: true,
        selectionEmpty: false,
        activeBlock: BLOCK,
        query: { kind: "slash", text: "ch" },
        suggestions: ["chart"],
      }).strip,
    ).toBe("suggestion-strip");
  });

  it("shows the tab bar with the keyboard down even while a query is live", () => {
    // Pins keyboard-down above query. With no keyboard there is no editing
    // context, so the slot belongs to navigation whatever else is true.
    expect(
      toolbarFor({
        editing: false,
        selectionEmpty: true,
        activeBlock: BLOCK,
        query: { kind: "slash", text: "ch" },
      }).strip,
    ).toBe("none");
  });

  it("raises no strip with the keyboard down even with text selected", () => {
    // Pins keyboard-down above selection, same rule as above mirrored.
    expect(
      toolbarFor({ editing: false, selectionEmpty: false, activeBlock: BLOCK }).strip,
    ).toBe("none");
  });

  it("shows nothing when a screen is pushed over this one", () => {
    // A pushed screen owns the bottom of the display outright — no strip of
    // ours may show underneath it. That would leave the component to add
    // `if (pushed) hide` itself, a decision this model exists to hold.
    expect(
      toolbarFor({ editing: true, keyboardOpen: true, selectionEmpty: true, activeBlock: BLOCK, pushedScreen: true }).strip,
    ).toBe("none");
  });

  it("shows nothing when a sheet is open", () => {
    // Same layering rule, the other overlay: an open Sheet owns the bottom
    // of the display too.
    const t = toolbarFor({ editing: true, keyboardOpen: true, selectionEmpty: true, activeBlock: BLOCK, sheetOpen: true });
    expect(t.strip).toBe("none");
    expect(t.buttons).toEqual([]);
  });

  it("lets nothing outrank find — a find bar must not peek out from under a sheet", () => {
    // The single-slot rule's whole point: only one owner of the bottom of
    // the display at a time. A sheet open over a find bar is exactly the
    // layering bug this ordering exists to prevent, so "none" is checked
    // above findOpen.
    expect(
      toolbarFor({ editing: true, keyboardOpen: true, selectionEmpty: true, activeBlock: BLOCK, findOpen: true, sheetOpen: true }).strip,
    ).toBe("none");
  });

  it("keeps the tab bar on another root, keyboard or no keyboard", () => {
    // Memory's search field, folded into the table. Every strip below this
    // row is the EDITOR's, and only the page root mounts one — so a field
    // on another root raising the keyboard used to hand the writer eight
    // editor controls over a list of days.
    const t = toolbarFor({
      editing: true, keyboardOpen: true,
      selectionEmpty: true,
      activeBlock: BLOCK,
      space: "memory",
    });
    // Memory reaches its tab bar through this row, so the row keeps
    // producing one; what memory has no use for is a strip above it.
    expect(t.strip).toBe("none");
    expect(t.nav).toBe(true);
    expect(t.buttons).toEqual([]);
  });

  it("takes find away from a root that cannot find anything", () => {
    // Deliberately ordered ABOVE findOpen, which is the second bug of the
    // same shape: nothing resets `findOpen` on a root switch, so opening
    // find on the page and then leaving for memory left the find strip
    // sitting under memory's list, typing into a page nobody can see.
    expect(
      toolbarFor({ editing: true, keyboardOpen: true, selectionEmpty: true, findOpen: true, space: "memory" })
        .strip,
    ).toBe("none");
  });

  it("still lets an overlay outrank the root", () => {
    // Row 1 stays first: a sheet open over memory empties the slot rather
    // than showing the tab bar under it. Without this the new row would
    // have reintroduced the layering bug one root over.
    expect(
      toolbarFor({ editing: false, space: "memory", sheetOpen: true }).strip,
    ).toBe("none");
    expect(
      toolbarFor({ editing: false, space: "memory", pushedScreen: true }).strip,
    ).toBe("none");
  });

  it("reads an unstated root as the page", () => {
    // The default changes the answer, so it is asserted rather than
    // assumed: every existing caller and every test above omits `space`,
    // and reading an absent value as "some other root" would take the
    // editor's chrome away from the one root that has an editor.
    expect(toolbarFor({ editing: true, keyboardOpen: true, selectionEmpty: true, activeBlock: BLOCK }).strip).toBe(
      "block-strip",
    );
  });

  it("labels every button it can emit", () => {
    // The three strips whose ids this model OWNS. The suggestion strip is
    // deliberately not among them: its ids are slash-command titles, which
    // are their own labels and have no entry here by design — adding it
    // would fail on every chip and the fix would be to widen the map,
    // which is the drift SuggestionStrip's header refuses.
    const strips = [
      toolbarFor({ editing: true, keyboardOpen: true, selectionEmpty: true, activeBlock: BLOCK }),
      toolbarFor({ editing: true, keyboardOpen: true, selectionEmpty: false, activeBlock: BLOCK }),
      toolbarFor({ editing: true, keyboardOpen: true, selectionEmpty: true, activeBlock: BLOCK, findOpen: true }),
    ];
    for (const s of strips) {
      for (const id of s.buttons) expect(TOOLBAR_BUTTON_LABELS[id]).toBeTruthy();
    }
  });
});

// Producer-to-consumer: build a REAL editor with a real live slash query
// through computeSnapshot, the same way editor-snapshot.test.js does, and
// feed its actual query field straight into toolbarFor. This is the test
// that would have caught the `query?.active` bug — a hand-written
// `{ active: true }` fixture cannot, because the producer never emits that
// shape in the first place.
describe("toolbarFor with a real computeSnapshot query", () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  function makeEditor(content, extra = []) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const editor = new Editor({
      element: host,
      extensions: [Document, Paragraph, Text, ...extra],
      content,
    });
    cleanup = () => { editor.destroy(); host.remove(); };
    return editor;
  }

  // A stand-in for the real slash Suggestion plugin, registered under the
  // SAME PluginKey so computeSnapshot's lookup path is the one production
  // uses (mirrors editor-snapshot.test.js's FakeSlash).
  const FakeSlash = (state) => Extension.create({
    name: "fakeSlash",
    addProseMirrorPlugins() {
      return [new Plugin({ key: SlashCommandsPluginKey, state: { init: () => state, apply: (_tr, v) => v } })];
    },
  });

  // The whole chain, end to end: plugin state → computeSnapshot →
  // suggestionChips → toolbarFor. Task 4 added the middle link, and it is
  // the one that can be wrong invisibly — a chip producer fed a shape the
  // snapshot never emits returns [], which now reads as "no strip" rather
  // than as "blank strip", i.e. as nothing at all.
  function stripFor(editor) {
    const snapshot = computeSnapshot(editor);
    return {
      snapshot,
      toolbar: toolbarFor({
        editing: true, keyboardOpen: true,
        selectionEmpty: true,
        query: snapshot.query,
        suggestions: suggestionChips(snapshot.query),
      }),
    };
  }

  it("opens the suggestion strip from a real live slash query", () => {
    const editor = makeEditor(
      { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] },
      [FakeSlash({ active: true, query: "cha" })],
    );
    const { snapshot, toolbar } = stripFor(editor);
    expect(snapshot.query).toEqual({ kind: "slash", text: "cha" });
    expect(toolbar.strip).toBe("suggestion-strip");
    // And it carries the command that query names. Asserting the strip
    // alone was enough while the row emitted [] — it is exactly what was
    // enough, and exactly why the blank shipped.
    expect(toolbar.buttons).toEqual(["chart"]);
  });

  it("falls through to the block strip once the real query goes inactive", () => {
    const editor = makeEditor(
      { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] },
      [FakeSlash({ active: false, query: "" })],
    );
    const { snapshot, toolbar } = stripFor(editor);
    expect(snapshot.query).toBeNull();
    expect(toolbar.strip).toBe("block-strip");
  });
});

describe("toolbarFor — an absent selectionEmpty", () => {
  it("falls to the block strip, not the selection strip", () => {
    // The first paint asks this before any snapshot exists. Without the
    // default, `!selectionEmpty` is `!undefined` -- true -- and the slot
    // renders the SELECTION strip with no editor and no selection: seven
    // controls for text nobody has selected, three of which act on a
    // selection that is not there.
    //
    // Reproduced before the fix: toolbarFor({ editing: true, keyboardOpen: true }) returned
    // strip "selection-strip". It returns "block-strip" now.
    expect(toolbarFor({ editing: true, keyboardOpen: true }).strip).toBe("block-strip");
  });

  it("still shows the selection strip when something really is selected", () => {
    // The other half: defaulting must not make the selection strip
    // unreachable, which a default of `false` would have done in reverse.
    expect(toolbarFor({ editing: true, keyboardOpen: true, selectionEmpty: false }).strip).toBe("selection-strip");
  });
});

describe("one action, one name", () => {
  it("the strip and the block sheet call the type change the same thing", () => {
    // Reachable two ways -- this button and the sheet's `convert` row --
    // and a writer hits both within a session. Asserted across the two
    // maps rather than trusting either in isolation, because the failure
    // is a DIVERGENCE and neither file can see it alone.
    expect(TOOLBAR_BUTTON_LABELS.type).toBe(BLOCK_ACTION_LABELS.convert);
  });
});

describe("toolbarFor — the gate row", () => {
  it("gives a chromeless gate its one action", () => {
    // With the keyboard DOWN, which is how a gate is first painted. Move
    // the row below the `!keyboardOpen` line and this answers `nav: true`:
    // three roots offered from a screen standing in front of the shell, on
    // a locked database — which is no longer merely an empty band where the
    // unlock was, it is a way around the lock.
    expect(toolbarFor({ gateAction: "unlock" })).toEqual({
      strip: "primary-action",
      buttons: ["unlock"],
      nav: false,
    });
  });

  it("keeps the gate's action with the keyboard up", () => {
    // THE ROW'S REASON, and it is reachable today rather than defensive:
    // lock is a passphrase FIELD, so tapping it raises the soft keyboard
    // and `keyboardOpen` goes true on a surface with no editor in the tree.
    // With no row for a gate at all, this returns the BLOCK STRIP — bold,
    // italic, insert, pin, undo — over a password box,
    // which is P3's `space` bug (memory's search field) repeated one level
    // up. Proven by deleting the row: this assertion reads "block-strip".
    //
    // Said precisely, because the obvious wording is wrong: no PLACEMENT of
    // the row produces the block strip here, since every placement above
    // the final return still catches a live `gateAction`. It is the row's
    // existence this case protects. What the row's POSITION protects is the
    // next two cases, and each of those really does go red when the row is
    // moved.
    expect(toolbarFor({ gateAction: "unlock", editing: true, keyboardOpen: true }).strip).toBe("primary-action");
  });

  it("keeps the gate's action under a sheet or a pushed screen", () => {
    // Why the row sits ABOVE row 1 rather than below it. Both orderings
    // agree from every call site that exists today — ShellGate is the only
    // caller that passes `gateAction` and it pushes no screens and opens no
    // sheets — so this pins the answer for the day one does. A pushed
    // screen keeps a back button in its nav bar and a sheet keeps its own
    // handle when the slot empties; a gate keeps nothing, because the slot
    // IS its only control. Blank it and the user is at a lock screen with
    // no unlock. Move the row below row 1 and both assertions read "none".
    expect(toolbarFor({ gateAction: "unlock", sheetOpen: true }).strip).toBe("primary-action");
    expect(toolbarFor({ gateAction: "gate-next", pushedScreen: true }).strip).toBe(
      "primary-action",
    );
  });

  it("changes nothing for every caller that is not a gate", () => {
    // The default has to be invisible to ShellApp, which passes no
    // `gateAction` at all. Not "nothing happens" for its own sake: this is
    // the assertion that the new row cannot steal the slot from the editor,
    // and it fails if `gateAction` is ever given a truthy default.
    expect(toolbarFor({ editing: false }).strip).toBe("none");
    expect(toolbarFor({ editing: true, keyboardOpen: true }).strip).toBe("block-strip");
    expect(toolbarFor({ editing: true, keyboardOpen: true, gateAction: null }).strip).toBe("block-strip");
  });

  it("labels every gate id it can emit", () => {
    // An id the label map does not carry renders as the raw id, silently —
    // toolbar-state.js's header records that class. `gate-next` would read
    // as "gate-next" on the button a new user taps their way in with.
    for (const id of ["unlock", "gate-next", "gate-begin"]) {
      expect(TOOLBAR_BUTTON_LABELS[id], id).toBeTruthy();
    }
  });

  it("keeps the gates' ids out of find's", () => {
    // `next` is find's next-match arrow. A gate id colliding with it would
    // share everything read off the id — `activeIdsFor` and
    // `disabledIdsFor` both work from these keys — so the day find's next
    // goes dead on a query with no matches, onboarding's next goes dead
    // with it, on a surface where it is the only control there is.
    expect(toolbarFor({ editing: true, keyboardOpen: true, findOpen: true }).buttons).not.toContain("gate-next");
    expect(toolbarFor({ gateAction: "gate-next" }).buttons).not.toContain("next");
  });
});

// The strip keys on `editing` — a focused text field — rather than on the
// soft keyboard, since a writer who dismisses the keyboard has not stopped
// editing and used to lose every control with it. See the row's own note.
describe("toolbarFor — the nav row is not a mode", () => {
  // THE GALAXY A34. Its webview froze every viewport-height API at the
  // keyboard-up value and never restored them, so keyboard-state believed a
  // keyboard was up for the rest of the session. This row answered
  // "tab-bar" only when it believed otherwise, so there was no tab bar — and
  // gesture-owner took the swipe off the page for the same reason. One
  // unfalsifiable belief, every way out gone, and only an app restart
  // cleared it.
  //
  // The fix is not a better measurement. It is that no belief about a
  // keyboard decides whether navigation exists, and these are the
  // assertions that say so.
  const EDITING = [
    { editing: true, keyboardOpen: true },
    { editing: true, keyboardOpen: true, selectionEmpty: false },
    { editing: true, keyboardOpen: true, query: { kind: "slash", text: "ch" }, suggestions: ["chart"] },
    { editing: true, keyboardOpen: true, findOpen: true },
    { editing: false },
    { editing: true, keyboardOpen: true, space: "memory" },
  ];

  it("keeps the nav row under every editing strip", () => {
    for (const state of EDITING) {
      expect(toolbarFor(state).nav, JSON.stringify(state)).toBe(true);
    }
  });

  it("withholds the nav row only from a gate and an overlay", () => {
    // Both for a reason that is not a measurement: a gate's whole job is to
    // stand between the writer and the database, and an overlay owns the
    // bottom edge while carrying its own labelled way out.
    expect(toolbarFor({ gateAction: "unlock" }).nav).toBe(false);
    expect(toolbarFor({ gateAction: "unlock", editing: true, keyboardOpen: true }).nav).toBe(false);
    expect(toolbarFor({ editing: true, keyboardOpen: true, sheetOpen: true }).nav).toBe(false);
    expect(toolbarFor({ editing: true, keyboardOpen: true, pushedScreen: true }).nav).toBe(false);
  });

  it("never answers with the old tab-bar strip value", () => {
    // The two-field shape's whole point. A strip value that ALSO meant
    // navigation would be the same fact written twice, and a renderer could
    // satisfy one and not the other — which is how the slot came to be
    // modal in the first place.
    for (const state of [...EDITING, { gateAction: "unlock" }, { sheetOpen: true }]) {
      expect(toolbarFor(state).strip, JSON.stringify(state)).not.toBe("tab-bar");
    }
  });
});

describe("toolbarFor — the strip needs a caret AND a keyboard", () => {
  // TWO REPORTS FROM THE SAME PHONE, a day apart, pulling opposite ways.
  //
  // First: "the insert toolbar disappear". It did, and correctly by the rule
  // of the day — the strip was keyed on `keyboardOpen`, so dismissing the
  // keyboard took insert, turn into, bold, italic and undo with it, on the
  // one root whose job is editing. That rule had been right when the band
  // was ONE row and the strip's presence meant navigation's absence; the
  // band is two rows now and the strip costs the nav row nothing. So the row
  // moved to `editing` alone.
  //
  // Then: "the insert stay always at bottom even keyboard is active", and
  // "the insert should appear only when needed during keyboard open".
  // Android's back key hides the IME WITHOUT blurring, so `editing` alone
  // kept six editing controls parked at the bottom of a page being read
  // rather than written.
  //
  // Both inputs. The reason that is safe now and was not before: on Android
  // `keyboardOpen` comes from the activity's IME insets, not from viewport
  // arithmetic a Galaxy A34 could latch (keyboard-state.js, the native
  // branch). Keying a surface on it no longer means keying it on a belief.

  it("shows the strip while the writer is actually typing", () => {
    const t = toolbarFor({ editing: true, keyboardOpen: true });
    expect(t.strip).toBe("block-strip");
    expect(t.nav).toBe(true);
  });

  it("takes the strip away when the keyboard goes, caret or not", () => {
    // The back-key case, which is the report. Not "nothing happens": the
    // nav row is still there, so what the writer gets is the two-row band
    // minus a row of controls aimed at text nobody is entering.
    //
    // `imeSeen` because the keyboard only has a veto once it has shown up —
    // a writer who has raised it and dismissed it is the case here, and that
    // is what the back key produces.
    const t = toolbarFor({ editing: true, keyboardOpen: false, imeSeen: true });
    expect(t.strip).toBe("none");
    expect(t.buttons).toEqual([]);
    expect(t.nav).toBe(true);
  });

  it("keeps the strip on a device that has no soft keyboard to wait for", () => {
    // A BLUETOOTH KEYBOARD, a case keyboard, DeX, a Chromebook. No IME ever
    // shows, so `keyboardOpen` is false for the whole session — and a strip
    // gated on it alone offers nothing to someone typing a document. That is
    // the original complaint on a different input device, which is how a fix
    // for one report becomes the next one.
    //
    // It is also the failure mode when the native publisher does not land:
    // on an Android 15 edge-to-edge window nothing else can report a
    // keyboard, so the strip would be coupled to the Kotlin arriving.
    const t = toolbarFor({ editing: true, keyboardOpen: false, imeSeen: false });
    expect(t.strip).toBe("block-strip");
    expect(t.nav).toBe(true);
  });

  it("still needs a caret, whatever the keyboard has or has not done", () => {
    for (const imeSeen of [true, false]) {
      for (const keyboardOpen of [true, false]) {
        expect(toolbarFor({ editing: false, keyboardOpen, imeSeen }).strip).toBe("none");
      }
    }
  });

  it("takes the strip away when the caret goes", () => {
    // Not "nothing happens" either: these controls act on the block the
    // caret is in, so a strip with no caret behind it offers six commands
    // with nothing to apply them to. A keyboard up with no caret on the page
    // is a field in a sheet, or memory's search box one row further up.
    expect(toolbarFor({ editing: false, keyboardOpen: true }).strip).toBe("none");
    expect(toolbarFor({ editing: false, keyboardOpen: false }).strip).toBe("none");
  });

  it("keeps the nav row through every combination of the two", () => {
    // The part of the one-row era that must not come back: whatever these
    // two say, there is a way off the page.
    for (const editing of [true, false]) {
      for (const keyboardOpen of [true, false]) {
        expect(toolbarFor({ editing, keyboardOpen }).nav).toBe(true);
      }
    }
  });

  it("still gives memory's search field no editor strip", () => {
    // Memory's search box is a focused text field on another root, so
    // `editing` is true there — and every strip below the space row is the
    // page editor's.
    expect(toolbarFor({ editing: true, keyboardOpen: true, space: "memory" }).strip).toBe("none");
    expect(toolbarFor({ editing: true, keyboardOpen: true, space: "memory" }).nav).toBe(true);
  });
});
