<!--
  A pin's writing, mounted to be edited: the desktop's PinArtifactModal
  recipe, in the shell.

  ── THE SECOND EDITOR HOST, AND WHY IT IS ALLOWED ──────────────────────

  Spec §4 gives the shell one editor host, the page's EditorCore, and
  PinArtifactScreen's header spent three paragraphs on why a pin is read
  through a static renderer instead. The second device pass overruled it
  from the outside — "pins are not editable" — and the desktop had
  already made the same call: PinArtifactModal mounts a real TipTap
  instance beside the page's, because a pinned table or board cannot be
  edited any other way. This is that instance, and only that: `new
  Editor` over READONLY_EXTENSIONS with `editable: true`, which is the
  canonical schema (every node the source editor can produce parses) with
  none of the editing-only plugins (no slash menu, no mention, no block
  moves) — the modal's own comment, the modal's own list.

  NOT EditorCore. EditorCore saves to a PAGE (savePageContent by pageId,
  the yjs binding, the pin cache reads, the snapshot store the toolbar
  slot consumes). A pin's cache is not a page, and mounting the page's
  host over it would either save the pin's doc as a page or need every
  one of those paths gated — the surface area of the bug class the
  single-host rule exists to end. The desktop reached the same shape for
  the same reason.

  ── WHAT IT HANDS UP ──────────────────────────────────────────────────

  `onChange(doc)` on every update, with `editor.getJSON()`, and the
  instance itself through `onEditor` in EditorCore's shape. Whether and
  when that is WRITTEN is the host's (ShellApp leaves the screen and
  writes a dirty draft, once); this component never persists. The doc it
  mounts on is `pinArtifactDoc`'s — already wrapped and migrated — so a
  pin from last year's schema opens here for the same reason it renders
  on the reading screen.

  Mounted once, on the doc it was given first. A pin re-opened after a
  save arrives with a new `updated_at`, and PinArtifactScreen keys this
  component on it, so the fresh doc is a fresh mount rather than a
  setContent over a live one — which would reset the writer's caret
  under them and, on a stale prop, their text.

  ── THE HOST ELEMENT ──────────────────────────────────────────────────

  `.prose`, like every other rendering of a doc in this app, so
  prose.css's node-shape rules apply; ProseMirror puts `.ProseMirror` on
  the contenteditable it creates inside, so global.css's list rules (the
  ones StaticProse has to copy for a static tree) apply here on their
  own. No font-family: the prose face is `.prose`'s.
-->
<script>
  import { onMount, onDestroy } from "svelte";
  import { Editor } from "@tiptap/core";
  import { PIN_EDITOR_EXTENSIONS } from "../../lib/render/shared-extensions.js";

  /** @type {{
    doc: object,
    onChange?: ((doc: object) => void) | null,
    onEditor?: ((editor: any | null) => void) | null,
  }} */
  let { doc, onChange = null, onEditor = null } = $props();

  let host = $state(null);
  let editor = null;

  onMount(() => {
    if (!host) return;
    editor = new Editor({
      element: host,
      extensions: PIN_EDITOR_EXTENSIONS,
      content: doc,
      editable: true,
      onUpdate: ({ editor: ed }) => onChange?.(ed.getJSON()),
    });
    // The instance, up — EditorCore's shape (onEditor, then null on
    // teardown). The screen has no use for it yet; a test does, and a
    // host that wants to place the caret will.
    onEditor?.(editor);
  });

  onDestroy(() => {
    onEditor?.(null);
    editor?.destroy();
    editor = null;
  });
</script>

<div class="prose shell-pin-editor" bind:this={host}></div>

<style>
  /* The caret's room: the page's canvas pads its bottom by --space-8 so
     the last line is never against the keyboard; the same here. */
  .shell-pin-editor {
    padding-bottom: var(--space-8);
  }
</style>
