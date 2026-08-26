// ShellTableView — TipTap's TableView extended to join the shared
// block-shell DOM contract: `.block-shell`, a real `.board-title-slot`
// input, and the block-actions type chip (see block-shell.js and
// docs/superpowers/specs/2026-06-14-block-cohesion-design.md). Used as the
// Table extension's `View` option so it plugs into both `addNodeView`
// (read-only) and `columnResizing` (editable, resizable) — column resizing
// keeps working because the table/colgroup/tbody structure is untouched.
//
// It cannot use createBlockShell (block-shell.js) directly: that factory
// assumes it owns the whole wrapper from scratch, but this View extends
// TableView, whose constructor already builds `.tableWrapper` >
// table > colgroup/tbody and columnResizing's own DOM management depends
// on that exact structure surviving untouched. So the block-shell pieces
// (title slot markup/attrs, dataset.board) are wired in by hand instead,
// copied from block-shell.js/createBlockShell rather than reusing it.
//
// The other structural gap: `getPos` isn't available here. The resizable
// path (columnResizing) constructs this View with just `(node,
// cellMinWidth, view)` — no getPos, no `editor`. getPos is recovered via
// resolveBlockPos(view, this.dom) (block-delete.js), whose own header
// comment documents this exact table case: posAtDOM lands inside the
// title element, and it walks back out to the table's own top-level
// position. The BlockTitle extension's storage (needed for
// consumePendingFocus) is reached the same indirect way, through
// `view.dom.editor` — tiptap's core sets that back-reference once the
// EditorView is constructed (see createNodeViews's `dom.editor = this`),
// and it's the only path back to `editor.storage` from a NodeView class
// that never receives an `editor` instance directly.
import { TableView } from "@tiptap/extension-table";
import { nodeKind, nodeFamily } from "../pin-display.js";
import { dispatchBlockActionsEvent } from "./dispatch-block-actions.js";
import { bindTitleSlot } from "./title-slot.js";
import { resolveBlockPos } from "./block-delete.js";

export class ShellTableView extends TableView {
  constructor(node, cellMinWidth, view) {
    super(node, cellMinWidth, view);
    this.view = view;

    // `this.dom` is the `.tableWrapper` div; `this.table` is the <table>.
    // Same class + dataset the other boards carry (block-shell.js) so the
    // four "is this a board" callers (describeHoverBlock,
    // openBlockActionSheet, revealBlockHandlesForNode in
    // TipTapEditor.svelte, hoverClassTarget in block-hover-guard.js) see a
    // table exactly like any other board, with zero changes to any of them.
    this.dom.classList.add("block-shell");
    this.dom.dataset.board = "table";

    // Title slot — a real <input>, built the same attributes
    // block-shell.js's createBlockShell uses, replacing the old
    // non-editable `titleCaption` <div>. Inserted before `this.table`,
    // same position the caption held.
    this.titleSlot = document.createElement("input");
    this.titleSlot.type = "text";
    this.titleSlot.className = "board-title-slot";
    this.titleSlot.placeholder = "+ title";
    this.titleSlot.spellcheck = false;
    this.titleSlot.autocomplete = "off";
    this.titleSlot.disabled = !view.editable;
    this.dom.insertBefore(this.titleSlot, this.table);

    this.titleApi = bindTitleSlot({
      titleSlot: this.titleSlot,
      view,
      getPos: () => resolveBlockPos(view, this.dom),
      // See the module comment above re: view.dom.editor. Resolved lazily
      // (a getter, not a captured value) because at the moment THIS
      // NodeView is constructed for the initial document, tiptap hasn't
      // stamped `dom.editor` yet (that happens right after `new
      // EditorView(...)` returns) — but every consumePendingFocus() call
      // happens later, from a requestAnimationFrame after mount, by which
      // point it's always set.
      ext: {
        get storage() {
          return view.dom.editor?.storage?.blockTitle;
        },
      },
      // Position of the table's first cell's first textblock — mirrors
      // createBoardNodeView's own resolveContentPos in block-title.js.
      resolveContentPos: (n, pos) => {
        let tp = -1;
        n.descendants((d, dp) => {
          if (tp >= 0) return false;
          if (d.isTextblock) { tp = pos + 1 + dp + 1; return false; }
          return true;
        });
        return tp;
      },
      onTitleRender: (t) => this.setTitle(t),
    });
    this.titleApi.refresh(node);
    // Same rAF-deferred consume as createBoardNodeView, so a table
    // inserted with a pending title focus (armPendingTitleFocus) enters
    // edit mode as soon as this NodeView is mounted.
    requestAnimationFrame(() => this.titleApi.consumePendingFocus());

    // Block-type chip, owned by the NodeView so it lands at the table's
    // bottom-right (the .tableWrapper is position:relative). The generic
    // BlockTypeChip widget can't place it correctly for a table (see
    // block-type-chip.js), so the chip is rendered here instead.
    this.typeChip = document.createElement("span");
    this.typeChip.className = "block-type-chip";
    this.typeChip.setAttribute("contenteditable", "false");
    this.typeChip.dataset.family = nodeFamily(node) || "none";
    this.typeChip.textContent = nodeKind(node) || "table";
    // The chip is the block-actions handle (touch-actions redesign, see
    // block-shell.js's identical wiring) — a table gets its chip from
    // here rather than block-shell.js, so it needs the same tap handler.
    this.typeChip.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dispatchBlockActionsEvent(this.typeChip, this.dom);
    });
    this.dom.appendChild(this.typeChip);
  }

  // setTitle — READ path only, mirrors createBlockShell's own setTitle:
  // reflects the current attr value onto the DOM (input value + data
  // attribute). blockTitle drives the CSS pseudo-element fallback used on
  // static/read-only renders, so the attribute stays in sync even though
  // this NodeView's own input is the live editing surface.
  setTitle(value) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    this.titleSlot.value = trimmed;
    if (trimmed) {
      this.dom.setAttribute("data-block-title", trimmed);
    } else {
      this.dom.removeAttribute("data-block-title");
    }
  }

  update(node) {
    const ok = super.update(node);
    if (ok) {
      this.titleApi.refresh(node);
      const disabled = !(this.view && this.view.editable);
      if (this.titleSlot.disabled !== disabled) this.titleSlot.disabled = disabled;
    }
    return ok;
  }

  ignoreMutation(mutation) {
    if (this.titleSlot && this.titleSlot.contains(mutation.target)) return true;
    if (this.typeChip && this.typeChip.contains(mutation.target)) return true;
    return super.ignoreMutation(mutation);
  }

  stopEvent(event) {
    if (event.target === this.titleSlot) return true;
    return false;
  }

  destroy() {
    this.titleApi.destroy();
  }
}
