// ShellTableView — TipTap's TableView extended to render a block-title caption
// above the table, reliably (a real element, not the fragile `::before` on a
// <table>). Used as the Table extension's `View` option so it plugs into both
// `addNodeView` (read-only) and `columnResizing` (editable, resizable) — column
// resizing keeps working because the table/colgroup/tbody structure is untouched.
//
// The caption is display-only: the resizable code path instantiates the View
// without editor/getPos context, so an editable inline title slot isn't
// available here (unlike the board/codeBlock title slots). A table's blockTitle
// is set via the pin flow / slash command; this View shows it uniformly when set.
import { TableView } from "@tiptap/extension-table";
import { nodeKind, nodeFamily } from "../pin-display.js";

export class ShellTableView extends TableView {
  constructor(node, cellMinWidth, view) {
    super(node, cellMinWidth, view);
    // `this.dom` is the `.tableWrapper` div; `this.table` is the <table>.
    this.titleCaption = document.createElement("div");
    this.titleCaption.className = "table-title-caption";
    this.titleCaption.setAttribute("contenteditable", "false");
    this.dom.insertBefore(this.titleCaption, this.table);
    this.renderTitle(node);

    // Block-type chip, owned by the NodeView so it lands at the table's
    // bottom-right (the .tableWrapper is position:relative). The generic
    // BlockTypeChip widget can't place it correctly for a table (see
    // block-type-chip.js), so the chip is rendered here instead.
    this.typeChip = document.createElement("span");
    this.typeChip.className = "block-type-chip";
    this.typeChip.setAttribute("contenteditable", "false");
    this.typeChip.dataset.family = nodeFamily(node) || "none";
    this.typeChip.textContent = nodeKind(node) || "table";
    this.dom.appendChild(this.typeChip);
  }

  renderTitle(node) {
    const t = (node.attrs?.blockTitle || "").trim();
    this.titleCaption.textContent = t;
    this.titleCaption.style.display = t ? "block" : "none";
  }

  update(node) {
    const ok = super.update(node);
    if (ok) this.renderTitle(node);
    return ok;
  }

  ignoreMutation(mutation) {
    if (this.titleCaption && this.titleCaption.contains(mutation.target)) return true;
    if (this.typeChip && this.typeChip.contains(mutation.target)) return true;
    return super.ignoreMutation(mutation);
  }
}
