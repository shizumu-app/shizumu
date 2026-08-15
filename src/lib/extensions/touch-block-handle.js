// TouchBlockHandle — the touch-only tap target for top-level blocks that
// render no `.block-type-chip` of their own (plain paragraphs/headings —
// see src/lib/editor/touch-block-handle.js for which types those are).
//
// Renders a single quiet widget decoration at the block containing the
// current selection — following the caret rather than painting a handle on
// every chip-less block at once (the same "current block" signal
// pruneEmptyHeadingOnMove in TipTapEditor.svelte already reads off the
// selection: `$from.before(1)`). Since the mobile-stability gutter
// restoration it renders INTO the editor's left gutter (prose.css), same
// as the desktop hover column, rather than floating over the block's own
// text — and it now splits by content the same way the desktop column
// does: an EMPTY block gets "+" and fires `shizumu-block-insert` (opens
// the slash menu, same path the desktop `+` handle calls); a block WITH
// content gets "⋯" and fires the existing `shizumu-block-actions` event
// the type chip also fires, routing through openBlockActionSheet(block)
// unchanged. touchHandleKind (editor/touch-block-handle.js) is the one
// place that decision is made, so the glyph shown here can't disagree
// with the event dispatched.
//
// Gated on the editor actually having FOCUS, not selection alone — a
// ProseMirror doc always resolves to a valid default selection (typically
// doc start) even before the user ever touches the page, the same way the
// native caret exists in the state but isn't drawn until focused. Building
// the decoration off selection alone put the handle on the very first
// paragraph of every untouched page (caught by the VR baseline: it shifted
// EVERY page-content screenshot, not just the one that drives the sheet).
// Tracked as plugin state, flipped by the view's own focus/blur DOM events,
// because `decorations(state)` never receives the view.
//
// The glyph is drawn with a CSS `::before` (prose.css), not a DOM text
// node — the widget lands as the last DOM child of the live paragraph/
// heading element (same "widget at nodeSize - 1" trick as BlockTypeChip),
// and openBlockActionSheet's `hasContent` check reads `block.textContent`;
// a real text node here would make an EMPTY paragraph misreport as having
// content the moment the handle renders into it.
//
// Visibility is further CSS-gated to `@media (pointer: coarse)`
// (prose.css) so it never renders on desktop even while focused — the
// decoration itself is built regardless of device, same as every other
// touch-only affordance in this codebase (block-active-touch, the touch
// title reveal) staying CSS-scoped rather than JS device-detected.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { touchHandleKind } from "../editor/touch-block-handle.js";
import { dispatchBlockActionsEvent, dispatchBlockInsertEvent } from "./dispatch-block-actions.js";

export const TouchBlockHandlePluginKey = new PluginKey("touchBlockHandle");

const FOCUS_META = "touchBlockHandleFocus";

export const TouchBlockHandle = Extension.create({
  name: "touchBlockHandle",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: TouchBlockHandlePluginKey,
        state: {
          init: (_, state) => ({ focused: false, decorations: DecorationSet.empty }),
          apply(tr, prev, _oldState, newState) {
            const focusMeta = tr.getMeta(FOCUS_META);
            const focused = typeof focusMeta === "boolean" ? focusMeta : prev.focused;
            if (focusMeta === undefined && !tr.docChanged && !tr.selectionSet) {
              return focused === prev.focused ? prev : { ...prev, focused };
            }
            const decorations = focused ? buildDecorations(newState) : DecorationSet.empty;
            return { focused, decorations };
          },
        },
        props: {
          decorations(state) {
            return TouchBlockHandlePluginKey.getState(state)?.decorations ?? DecorationSet.empty;
          },
          handleDOMEvents: {
            focus(view) {
              view.dispatch(view.state.tr.setMeta(FOCUS_META, true));
              return false;
            },
            blur(view) {
              view.dispatch(view.state.tr.setMeta(FOCUS_META, false));
              return false;
            },
          },
        },
      }),
    ];
  },
});

function buildDecorations(state) {
  let blockPos;
  try {
    blockPos = state.selection.$from.before(1);
  } catch {
    // Selection at the doc root (no top-level block ancestor) — nothing to
    // anchor the handle to.
    return DecorationSet.empty;
  }
  const node = state.doc.nodeAt(blockPos);
  if (!node) return DecorationSet.empty;
  const kind = touchHandleKind(node.type.name, !!node.textContent.trim());
  if (!kind) return DecorationSet.empty;

  const widgetPos = blockPos + node.nodeSize - 1;
  return DecorationSet.create(state.doc, [
    Decoration.widget(
      widgetPos,
      () => {
        const handle = document.createElement("span");
        handle.className = "touch-block-handle";
        handle.setAttribute("contenteditable", "false");
        handle.setAttribute("role", "button");
        if (kind === "insert") {
          handle.dataset.empty = "true";
          handle.setAttribute("aria-label", "insert block");
        } else {
          handle.setAttribute("aria-label", "block actions");
        }
        handle.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          // The handle is the widget's own DOM node, appended as the last
          // child of the live paragraph/heading element — its parent IS
          // the block the sheet (or slash menu) should act on.
          const block = handle.parentElement;
          if (!block) return;
          if (kind === "insert") dispatchBlockInsertEvent(handle, block);
          else dispatchBlockActionsEvent(handle, block);
        });
        return handle;
      },
      { side: 1, ignoreSelection: true, key: `touch-handle-${blockPos}-${kind}` },
    ),
  ]);
}
