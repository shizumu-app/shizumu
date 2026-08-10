// title-slot.js — shared title-editing helper for block NodeViews.
//
// bindTitleSlot() owns ALL title-slot editing behavior: input debouncing,
// the atomic commit-and-move on Enter, keyboard navigation, focus tracking,
// and pendingFocusPos consumption. It is intentionally free of DOM construction
// (the caller supplies the <input> element) and free of content-position logic
// (the caller supplies resolveContentPos so each block type can walk its own
// schema structure).
//
// Usage:
//   const titleApi = bindTitleSlot({ titleSlot, view, getPos, ext,
//     resolveContentPos, onTitleRender });
//   // then call titleApi.refresh(node) from update()
//   // and titleApi.consumePendingFocus() from mount
//   // and titleApi.destroy() from destroy()

import { TextSelection } from "@tiptap/pm/state";

/**
 * bindTitleSlot(opts) — attach title-editing behavior to a <input> title slot.
 *
 * @param {object}   opts
 * @param {HTMLInputElement} opts.titleSlot       - the <input> element
 * @param {object}   opts.view                    - ProseMirror EditorView
 * @param {Function} opts.getPos                  - () => number | undefined
 * @param {object}   opts.ext                     - Tiptap extension (for ext.storage.pendingFocusPos)
 * @param {Function} opts.resolveContentPos       - (node, pos) => number  (-1 if none)
 * @param {Function} opts.onTitleRender           - (titleString) => void
 *
 * @returns {{ enterEditMode, consumePendingFocus, destroy, refresh }}
 */
export function bindTitleSlot({
  titleSlot,
  view,
  getPos,
  ext,
  resolveContentPos,
  onTitleRender,
}) {
  let commitTimer = null;
  let editing = false;

  // ---------------------------------------------------------------------------
  // refresh (was renderTitle) — reflect PM attr onto DOM when not editing.
  // ---------------------------------------------------------------------------
  const refresh = (node) => {
    // Only overwrite when not actively editing — otherwise we'd clobber
    // the user's in-flight typing on every transaction.
    if (!editing) onTitleRender(node.attrs?.blockTitle || "");
  };

  // ---------------------------------------------------------------------------
  // dispatchTitle — write the current input value into PM as a node attribute.
  // Debounced 120 ms from the input event; also called eagerly on blur and
  // ArrowDown.
  // ---------------------------------------------------------------------------
  const dispatchTitle = (value) => {
    if (typeof getPos !== "function") return;
    const pos = getPos();
    if (typeof pos !== "number") return;
    const trimmed = (value || "").trim();
    const next = trimmed.length > 0 ? trimmed : null;
    const cur = view.state.doc.nodeAt(pos);
    if (!cur || cur.attrs.blockTitle === next) return;
    try {
      const tr = view.state.tr.setNodeAttribute(pos, "blockTitle", next);
      // Mark this transaction so our own update() doesn't re-render the
      // slot text (which would reset the caret position mid-typing).
      tr.setMeta("addToHistory", true);
      view.dispatch(tr);
    } catch {}
  };

  // ---------------------------------------------------------------------------
  // enterEditMode / exitEditMode
  // ---------------------------------------------------------------------------
  const enterEditMode = (focusEnd = true) => {
    editing = true;
    // Input is always editable — no contentEditable toggling.
    requestAnimationFrame(() => {
      try {
        titleSlot.focus();
        if (focusEnd) {
          const end = titleSlot.value.length;
          titleSlot.setSelectionRange(end, end);
        } else {
          titleSlot.setSelectionRange(0, 0);
        }
      } catch {}
    });
  };

  const exitEditMode = () => {
    editing = false;
  };

  // Hook for the BlockTitle plugin's ArrowUp handler. Re-uses the same
  // edit-entry path as a programmatic mousedown so `editing` flag stays in sync.
  titleSlot.__enterEdit = () => enterEditMode(true);

  // ---------------------------------------------------------------------------
  // moveCursorToContent — ArrowDown path (its own transaction, separate from
  // Enter's atomic commit-and-move). Uses the injected resolveContentPos so
  // block types with non-standard content positions (e.g. codeBlock at pos+1)
  // get correct behavior — mirrors the path Enter already uses.
  // ---------------------------------------------------------------------------
  const moveCursorToContent = () => {
    if (typeof getPos !== "function") return;
    const pos = getPos();
    if (typeof pos !== "number") return;
    try {
      const node = view.state.doc.nodeAt(pos);
      if (!node || node.content.size === 0) {
        view.focus();
        return;
      }
      const contentPos = resolveContentPos(node, pos);
      if (contentPos < 0) { view.focus(); return; }
      const $pos = view.state.doc.resolve(contentPos);
      const tr = view.state.tr.setSelection(TextSelection.near($pos, 1));
      view.dispatch(tr);
      view.focus();
    } catch {
      try { view.focus(); } catch {}
    }
  };

  // ---------------------------------------------------------------------------
  // moveCursorBeforeBlock — ArrowUp path. Mirror of moveCursorToContent but
  // biased BACKWARD: lands the caret at the end of the textblock immediately
  // before the block, so ↑ from the title escapes the block upward. Board
  // types always have a paragraph above them (slash-commands' ensureLeading-
  // Paragraph); the pos<=0 guard covers the degenerate first-node case.
  // ---------------------------------------------------------------------------
  const moveCursorBeforeBlock = () => {
    if (typeof getPos !== "function") return;
    const pos = getPos();
    if (typeof pos !== "number") return;
    try {
      if (pos <= 0) { view.focus(); return; }
      const $before = view.state.doc.resolve(pos);
      const tr = view.state.tr.setSelection(TextSelection.near($before, -1));
      view.dispatch(tr);
      view.focus();
    } catch {
      try { view.focus(); } catch {}
    }
  };

  // ---------------------------------------------------------------------------
  // commitTitleAndEnterBoard — ATOMIC Enter path.
  //
  // Builds ONE transaction: optionally setNodeAttribute(pos,"blockTitle",next)
  // THEN setSelection(TextSelection.near(resolve(contentPos))), dispatched once,
  // then view.focus(). This single-transaction atomicity prevents the focus
  // bounce the code explicitly fights (see the webkit2gtk comments in block-title.js).
  // The only thing that varies per block type is WHERE the cursor lands —
  // that's resolveContentPos(node, pos).
  // ---------------------------------------------------------------------------
  const commitTitleAndEnterBoard = (value) => {
    if (typeof getPos !== "function") return;
    const pos = getPos();
    if (typeof pos !== "number") return;
    try {
      let tr = view.state.tr;
      const trimmed = (value || "").trim();
      const next = trimmed.length > 0 ? trimmed : null;
      const cur = view.state.doc.nodeAt(pos);
      if (cur && cur.attrs.blockTitle !== next) {
        tr = tr.setNodeAttribute(pos, "blockTitle", next);
      }
      // Apply the attribute change to a temporary doc so the descendants
      // walk sees the latest state for finding the first textblock.
      const boardNode = (tr.docChanged ? tr.doc.nodeAt(pos) : cur);
      if (boardNode && boardNode.content.size > 0) {
        const contentPos = resolveContentPos(boardNode, pos);
        if (contentPos >= 0) {
          const $pos = (tr.docChanged ? tr.doc : view.state.doc).resolve(contentPos);
          tr = tr.setSelection(TextSelection.near($pos, 1));
        }
      }
      if (tr.docChanged || tr.selectionSet) {
        view.dispatch(tr);
      }
      view.focus();
    } catch {
      try { view.focus(); } catch {}
    }
  };

  // ---------------------------------------------------------------------------
  // Event listeners
  // ---------------------------------------------------------------------------

  // stopPropagation keeps the click from reaching .ProseMirror — without it,
  // PM would observe the click and move the caret into the editor body.
  const onMousedown = (e) => {
    e.stopPropagation();
    editing = true;
  };
  const onFocus = () => {
    editing = true;
  };
  const onClick = (e) => {
    e.stopPropagation();
  };

  const onInput = () => {
    if (commitTimer) clearTimeout(commitTimer);
    commitTimer = setTimeout(() => {
      commitTimer = null;
      dispatchTitle(titleSlot.value || "");
    }, 120);
  };

  const onKeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (commitTimer) { clearTimeout(commitTimer); commitTimer = null; }
      const value = titleSlot.value || "";
      exitEditMode();
      commitTitleAndEnterBoard(value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      titleSlot.blur();
    } else if (e.key === "ArrowDown") {
      // Mirror of the plugin's ArrowUp-from-first-item: navigate forward
      // into the board's first textblock without committing or clearing
      // any in-flight title text. Commit happens on blur.
      e.preventDefault();
      if (commitTimer) { clearTimeout(commitTimer); commitTimer = null; }
      dispatchTitle(titleSlot.value || "");
      exitEditMode();
      moveCursorToContent();
    } else if (e.key === "ArrowUp") {
      // Reciprocal of ArrowDown: leave the title UPWARD, landing the caret
      // at the end of the textblock immediately before the block. Without
      // this the caret is trapped in the title slot. Commit happens on blur.
      e.preventDefault();
      if (commitTimer) { clearTimeout(commitTimer); commitTimer = null; }
      dispatchTitle(titleSlot.value || "");
      exitEditMode();
      moveCursorBeforeBlock();
    } else if (e.key === "Backspace") {
      // Empty title + Backspace = no-op. Backspace only ever deletes
      // characters; nothing to delete here. To leave the title slot, the
      // user presses Esc / Tab / ArrowDown. To remove an empty board, they
      // select it and use Delete (or a slash command, future work).
      // Filled title gets default character-delete behavior.
      if ((titleSlot.value || "").length === 0) {
        e.preventDefault();
      }
    }
  };

  const onBlur = () => {
    if (commitTimer) { clearTimeout(commitTimer); commitTimer = null; }
    dispatchTitle(titleSlot.value || "");
    exitEditMode();
  };

  titleSlot.addEventListener("mousedown", onMousedown);
  titleSlot.addEventListener("focus", onFocus);
  titleSlot.addEventListener("click", onClick);
  titleSlot.addEventListener("input", onInput);
  titleSlot.addEventListener("keydown", onKeydown);
  titleSlot.addEventListener("blur", onBlur);

  // ---------------------------------------------------------------------------
  // consumePendingFocus — enter edit mode if storage.pendingFocusPos matches
  // this node's position. The one-frame retry handles the race where the
  // NodeView mounts before the slash command's transaction commits pendingFocusPos.
  // ---------------------------------------------------------------------------
  const consumePendingFocus = () => {
    if (!ext?.storage) return;
    const wantedPos = ext.storage.pendingFocusPos;
    if (typeof getPos !== "function") return;
    const myPos = getPos();
    if (typeof wantedPos === "number" && typeof myPos === "number" && wantedPos === myPos) {
      ext.storage.pendingFocusPos = null;
      requestAnimationFrame(() => {
        try { enterEditMode(true); } catch {}
      });
      return;
    }
    // First check missed (likely race: NodeView mounted before slash command's
    // tr committed). Retry once on the next frame.
    requestAnimationFrame(() => {
      if (!ext?.storage) return;
      const retryWanted = ext.storage.pendingFocusPos;
      const retryMine = typeof getPos === "function" ? getPos() : null;
      if (typeof retryWanted === "number" && typeof retryMine === "number" && retryWanted === retryMine) {
        ext.storage.pendingFocusPos = null;
        try { enterEditMode(true); } catch {}
      }
    });
  };

  // ---------------------------------------------------------------------------
  // destroy — clear the commit timer (event listeners are on a DOM element that
  // is discarded by PM, so they do not need explicit removal).
  // ---------------------------------------------------------------------------
  const destroy = () => {
    if (commitTimer) clearTimeout(commitTimer);
  };

  return { enterEditMode, consumePendingFocus, destroy, refresh };
}
