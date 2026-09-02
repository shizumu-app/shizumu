// The renderer half of a @tiptap/suggestion extension, subtracted.
//
// A suggestion extension is two things stacked in one file. Underneath is a
// ProseMirror plugin that watches every transaction for the trigger char and
// tracks `active` / `range` / `query` / `text` in its own state
// (node_modules/@tiptap/suggestion/dist/index.js, createSuggestionState).
// On top is `render()`, which draws a floating menu out of that state.
//
// A host that draws its own suggestion UI — the mobile shell's chip strip,
// which reads the plugin state back through SlashCommandsPluginKey /
// MentionCommandPluginKey — wants the bottom half and refuses the top.
// Dropping the whole extension takes the state machine with the menu and
// leaves the host with nothing to read, which is exactly the mistake this
// module exists to make unnecessary.
//
// It works because @tiptap/suggestion optional-chains every renderer hook
// (`renderer?.onStart?.(props)` and friends, createSuggestionView) and its
// state `apply()` never consults the renderer at all. Handlers that do
// nothing are therefore indistinguishable, to the plugin, from no renderer:
// active/range/query still track a real `/` or `@` keystroke.
//
// onKeyDown returns false deliberately. `true` means "this key was consumed"
// and stops ProseMirror's dispatch there — which is right when a menu is
// open and moving a selection, and wrong here: with no menu, swallowing
// ArrowDown or Enter would take them from the host's own strip and from the
// editor. Escape is the one key the plugin handles regardless of the return
// value (handleKeyDown dispatches its exit unconditionally), so the session
// still closes on Escape exactly as it did with a menu.
export function silentSuggestionRender() {
  return {
    onStart: () => {},
    onUpdate: () => {},
    onKeyDown: () => false,
    onExit: () => {},
  };
}
