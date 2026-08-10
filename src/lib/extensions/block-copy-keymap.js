// BlockCopyKeymap — binds Cmd/Ctrl+Shift+C to a 'copyCurrentBlock'
// editor command. The command dispatches a custom DOM event with the
// cursor's doc position; TipTapEditor.svelte listens for that event
// and invokes copyBlockAtPos. Decoupling the clipboard write from the
// extension keeps the extension testable without a DOM clipboard
// mock.

import { Extension } from "@tiptap/core";

export const BlockCopyKeymap = Extension.create({
  name: "blockCopyKeymap",

  addCommands() {
    return {
      copyCurrentBlock: () => ({ editor, state }) => {
        const pos = state.selection.from;
        editor.view.dom.dispatchEvent(
          new CustomEvent("shizumu:block-copy-key", {
            bubbles: true,
            detail: { pos },
          })
        );
        return true;
      },
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-c": () => this.editor.commands.copyCurrentBlock(),
    };
  },
});
