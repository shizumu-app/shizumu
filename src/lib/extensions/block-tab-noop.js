// BlockTabNoop. consumes Tab and Shift-Tab when the cursor is not
// inside a list item or a table cell. Lists own indentation and the
// table extension owns cell-to-cell navigation; everywhere else, Tab
// should not insert a literal tab character or let the browser
// tab-focus out of the editor. Keymap binding returns true (handled)
// without dispatching a transaction; inside a list item or table cell
// the command returns false so unified-list's sink/lift handlers (or
// the table extension's goToNextCell) run instead.
//
// Why a tiny extension: keymap precedence in TipTap is driven by
// extension priority, but threading the no-op into existing
// extensions would couple unrelated concerns. A standalone
// extension keeps the rule explicit and testable.
import { Extension } from "@tiptap/core";

// D-4 (QA sweep): this used to check only listItem, so Tab inside a table
// cell fell through to this no-op instead of the table extension's own
// Tab-to-next-cell keymap — cells silently concatenated ("aaa" + Tab +
// "bbb" landed in the SAME cell as "aaabbb", not the next one). tableCell
// and tableHeader are the two cell node types (@tiptap/extension-table-cell,
// @tiptap/extension-table-header).
function isInsideNavigableCell(state) {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name;
    if (name === "listItem" || name === "tableCell" || name === "tableHeader") return true;
  }
  return false;
}

export const BlockTabNoop = Extension.create({
  name: "blockTabNoop",

  addCommands() {
    return {
      blockTabNoop: () => ({ state }) => {
        if (isInsideNavigableCell(state)) return false;
        return true;
      },
    };
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => this.editor.commands.blockTabNoop(),
      "Shift-Tab": () => this.editor.commands.blockTabNoop(),
    };
  },
});
