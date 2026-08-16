<script module>
  /**
   * Decide where to insert a new dayMarker in a TipTap doc.
   * - No existing markers → top (position 0). This positions the first marker
   *   above any pre-trail content, so when a user creates a continuous trail
   *   from a page that already had writing, the writing reads as "day-1
   *   content" beneath the day-1 marker.
   * - Existing markers present → end of doc. New day's content is typed
   *   after the marker, so it sits beneath its own marker.
   */
  export function chooseMarkerInsertPosition({ markersExist, docSize }) {
    return markersExist ? docSize : 0;
  }
</script>

<script>
  import { onMount, onDestroy, tick } from "svelte";
  import { fade } from "svelte/transition";
  import { Editor } from "@tiptap/core";
  import { DOMSerializer, Fragment } from "@tiptap/pm/model";
  import { TextSelection, NodeSelection } from "@tiptap/pm/state";
  import { migrateListSchema } from "../lib/extensions/migrate-list-schema.js";
  import { migrateRecipeSchema } from "../lib/extensions/migrate-recipe-schema.js";
  import { migrateQASchema } from "../lib/extensions/migrate-qa-schema.js";
  import { stripPinIdsFromJSON } from "../lib/extensions/pin-id.js";
  import { isBoardType } from "../lib/extensions/block-title.js";
  import { resolveHoveredMouseBlock, hoverClassTarget, isTrustedMouseHover } from "../lib/extensions/block-hover-guard.js";
  import { deleteBlockAt, resolveBlockPos } from "../lib/extensions/block-delete.js";
  import { writeClipboard } from "../lib/clipboard-write.js";
  import { sanitizePastedHtml } from "../lib/paste-sanitize.js";
  import { resolveCopyTarget } from "../lib/extensions/block-copy-target.js";
  import { serializeBlockToHtml, parseBlockFromHtml } from "../lib/block-clipboard.js";
  import { buildEditingExtensions } from "../lib/render/shared-extensions.js";
  import { savePageContent, saveTrailContent, createPin, getPins, attachmentAddBytes, updatePinContent, updatePinStatus, getSetting, setSetting } from "../lib/api.js";
  import { looksLikeMarkdown, parseAndInsert, serializeSelection } from "../lib/markdown-clipboard.js";
  import { hydrateDoc, encodeState, bytesFromTauri, docFromTipTapJson } from "../lib/yjs/page-doc.js";
  import { isYjsEnabled } from "../lib/yjs/feature-flag.js";
  import { isCoarsePointer } from "../lib/responsive.js";
  import { blockActionsFor, BLOCK_ACTION_LABELS } from "../lib/editor/block-actions.js";
  import { needsTouchHandle } from "../lib/editor/touch-block-handle.js";
  import { getViewportHeight, keyboardOpen } from "../lib/keyboard-state.js";
  import { getSchema } from "@tiptap/core";
  import SharePopup from "./SharePopup.svelte";
  import FindBar from "./FindBar.svelte";
  import ChartBuilder from "./ChartBuilder.svelte";
  import EditorToast from "./EditorToast.svelte";
  import BottomSheet from "../lib/ui/BottomSheet.svelte";

  /** @type {{ pageId: string, initialContent: any, initialYjsState: any, readonly: boolean, placeholder: string, lineageId: string|null, onPinCreated: () => void, onCreateSubtrail: (name: string, kind: "subtrail" | "toplevel", trailMode?: "discrete" | "continuous") => void, onMentionNavigate: (pageId: string) => void, onPinRefNavigate: (pinId: string) => void, trailMode: "continuous" | "discrete" | null, currentLineageId: string|null, currentLineageName: string }} */
  let { pageId, initialContent = null, initialYjsState = null, readonly = false, placeholder = "write one thought, then return", lineageId = null, onPinCreated = () => {}, onWordCount = () => {}, onDocChange = () => {}, onCreateSubtrail = () => {}, onMentionNavigate = () => {}, onPinRefNavigate = () => {}, isTrailMode = false, trailLineageId = null, trailMode = null, currentLineageId = null, currentLineageName = "" } = $props();

  let editorEl = $state(null);
  let wrapperEl = $state(null);
  let editor = $state(null);
  let saveTimer = $state(null);
  // Y.Doc handle when this editor is bound to a CRDT. Null for
  // discrete-trail pages and any session with `enable_yjs` off.
  // debouncedSave checks this to decide whether to ship yjs_state
  // alongside the content_json.
  let yjsDoc = $state(/** @type {import('yjs').Doc | null} */ (null));

  // Bubble menu: positioned by the same coord math as selectionPin.
  let bubbleMenuVisible = $state(false);
  let bubbleMenuPosition = $state({ top: 0, left: 0 });
  let bubbleMode = $state("buttons"); // "buttons" | "link-input"
  let linkInputValue = $state("");
  // Bound to the bubble menu root element so pickBubblePosition can read
  // its actual rendered width for the edge clamp (falls back to an
  // estimate on first show, before the element has ever mounted).
  let bubbleEl = $state(null);
  // Cache of the last (coords, wrapperRect) pair passed to
  // pickBubblePosition, so the re-measure $effect below can recompute the
  // position once bubbleEl mounts, without re-deriving coords from the
  // editor selection.
  let bubbleMenuInputs = $state(null);

  // Counter bumped after every bubble-menu command so class:active
  // expressions and bubbleShowBottomRow re-evaluate. editor.isActive
  // and editor.state.selection are not $state values; without this
  // tick the bubble's reactive expressions never refresh after a
  // toggle command.
  let bubbleRenderTick = $state(0);

  function bumpBubbleTick() {
    bubbleRenderTick++;
  }

  function openLinkInput() {
    const existing = editor?.getAttributes("link")?.href ?? "";
    linkInputValue = existing;
    bubbleMode = "link-input";
  }

  function confirmLink() {
    const url = linkInputValue.trim();
    if (!url) {
      // empty input on existing link → unset
      editor?.chain().focus().unsetLink().run();
    } else {
      editor?.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
    bubbleMode = "buttons";
    linkInputValue = "";
    syncBlockHandleToSelection();
    bumpBubbleTick();
  }

  function cancelLink() {
    bubbleMode = "buttons";
    linkInputValue = "";
  }

  // Bubble bottom row visibility: true when selection starts at the
  // beginning of its block (i.e., $from.parentOffset === 0). Promoting
  // a mid-paragraph selection to a heading or list doesn't make sense.
  function bubbleShowBottomRow() {
    if (!editor) return false;
    const frm = editor.state.selection.$from;
    return frm.parentOffset === 0;
  }

  // Click a marker button: convert to that marker, or lift out if
  // we're already in a list with that marker (toggle behavior).
  function toggleMarker(target) {
    if (!editor) return;
    const frm = editor.state.selection.$from;
    let activeMarker = null;
    for (let d = frm.depth; d > 0; d--) {
      const n = frm.node(d);
      if (n.type.name === "listItem") {
        activeMarker = n.attrs.marker || "bullet";
        break;
      }
    }
    const cmd = activeMarker === target ? "plain" : target;
    editor.chain().focus().setMarker(cmd).run();
    syncBlockHandleToSelection();
    bumpBubbleTick();
  }

  // Position picker: returns { top, left, flipped }. Clamps BOTH horizontal
  // edges (a selection near the right edge of a 360px phone used to push
  // the toolbar off-screen), and never flips below the selection when the
  // soft keyboard would occlude it.
  function pickBubblePosition(coords, wrapperRect) {
    const coarse = isCoarsePointer();
    // bubbleEl is null on every hidden→visible transition: Svelte binds it
    // after this synchronous call, so the very first frame always falls
    // back to an estimate. Make the estimate pointer-aware rather than a
    // flat 288 — on coarse/phone viewports the single-row strip (CSS
    // `max-width: calc(100vw - 16px)`) can be noticeably wider than 288,
    // so a flat fallback under-clamps `maxLeft` and still overflows the
    // right edge on a fresh selection. Mirroring the CSS cap here keeps
    // the first-frame clamp at least as conservative as the real layout.
    // The post-mount $effect below corrects the estimate once bubbleEl
    // exists, in case the real width still differs.
    const menuWidth = bubbleEl?.offsetWidth
      || (coarse ? Math.min(wrapperRect.width, window.innerWidth - 16) : 288);
    const rawLeft = coords.left - wrapperRect.left;
    const maxLeft = Math.max(4, wrapperRect.width - menuWidth - 4);
    const left = Math.min(Math.max(4, rawLeft), maxLeft);

    const viewportRelativeTop = coords.top - wrapperRect.top;
    // Flipping below is only allowed when the space below isn't covered by
    // the soft keyboard. getViewportHeight() reads --app-height, kept
    // current by keyboard-state.js (the app's single viewport-state
    // owner) — already the bottom edge of what's visible, since that
    // module resets scrollY to 0 whenever the visible viewport moves.
    const vvBottom = getViewportHeight();
    const canFlipBelow = coords.bottom + 56 < vvBottom;

    if (viewportRelativeTop < 50 && canFlipBelow) {
      return {
        top: coords.bottom - wrapperRect.top + wrapperEl.scrollTop + (coarse ? 16 : 8),
        left,
        flipped: true,
      };
    }
    const clearance = coarse ? 48 : 38;
    return {
      top: Math.max(4, coords.top - wrapperRect.top + wrapperEl.scrollTop - clearance),
      left,
      flipped: false,
    };
  }

  // Block handle state
  let handleVisible = $state(false);
  let handleTop = $state(0);
  let hoveredBlock = $state(null);

  // The editor's 32px left gutter now exists on every viewport, phone
  // included (see .tiptap-wrapper in this file's <style>) — the handles
  // column below always sits inside it, at handleTop, same as desktop.
  // This used to branch on a `gutterless` flag into a second, floating-bar
  // layout for phones (lib/editor/handle-placement.js, now gone) because
  // the gutter itself used to be reclaimed there. Restoring the gutter
  // removed the need for a second layout entirely.
  let handleShowPlus = $state(true);
  let handleIsBoard = $state(false);
  let handleHasContent = $state(false);

  // Pin popup state
  let showPinPopup = $state(false);
  // Find/replace bar state (B.5). Open + mode controlled by Cmd/Ctrl+F /
  // Cmd/Ctrl+H; closes on Esc. The bar is sticky-positioned at the top of
  // the wrapper so it stays visible while the user scrolls through matches.
  let findBarOpen = $state(false);
  let findBarMode = $state(/** @type {"find" | "replace"} */ ("find"));
  // Chart builder state (10.6). Set by Chart's onOpen callback (from the
  // /chart slash command or a click on an existing chart). Null = modal
  // closed; an object = modal open with the supplied mode + position.
  let chartBuilderState = $state(/** @type {null | { mode: "create" | "edit", pos?: number, attrs?: any }} */ (null));
  let pinCategory = $state("item");
  let pinDefaultTitle = $state("");
  let pinPopupPosition = $state({ top: 0, left: 0 });
  let pinContent = $state("");
  let pinBlockEl = $state(null);
  // Absolute positions of the top-level nodes that should receive pinId
  // attribute once the pin row is created. Cleared on every new pin attempt.
  let pinNodePositions = $state([]);

  // Block-title creation/editing happens inline via the BlockTitle NodeView
  // (src/lib/extensions/block-title.js). The slash command primes
  // editor.storage.blockTitle.pendingFocusPos to auto-focus the new board's
  // title slot; pin time still uses the pin popup to force a title.

  // Pin cache for display-time filtering
  let existingPinContents = $state(new Set());
  let blockAlreadyPinned = $state(false);

  // Selection pin state (multi-block)
  let selectionPinVisible = $state(false);
  let selectionPinPosition = $state({ top: 0, left: 0 });

  async function loadPinCache() {
    try {
      const pins = await getPins(lineageId || null);
      existingPinContents = new Set(pins.map(p => p.content));
    } catch { existingPinContents = new Set(); }
  }

  // Word count (exposed to parent via bind:this)
  let wordCount = $state(0);

  // Cursor position memory across page switches
  const cursorMemory = new Map();

  // Table toolbar state
  let tableActive = $state(false);
  let tableRect = $state({ top: 0, bottom: 0, right: 0, left: 0, width: 0, height: 0 });

  function handleBlockCopyKey(e) {
    if (!editor) return;
    const pos = e.detail?.pos;
    if (typeof pos !== "number") return;
    copyBlockAtPos(pos, null); // null sourceEl = no flash, toast only
  }

  $effect(() => {
    const el = editorEl;
    if (!el) return;
    el.addEventListener("shizumu:block-copy-key", handleBlockCopyKey);
    return () => el.removeEventListener("shizumu:block-copy-key", handleBlockCopyKey);
  });

  // Touch-actions redesign: a BOARD's block actions open by tapping its own
  // type chip (block-shell.js / table-shell-view.js) rather than a
  // long-press anywhere on the block. It dispatches the bubbling
  // shizumu-block-actions CustomEvent (dispatch-block-actions.js) because a
  // ProseMirror NodeView has no access to this component's state; listening
  // here is the one place that routes it into the existing
  // openBlockActionSheet(block). A chip-less block (plain paragraph/
  // heading) never dispatches this event: EMPTY, it fires
  // shizumu-block-insert instead (handleBlockInsertEvent, below); WITH
  // content, a tap reveals its pin/copy/delete controls directly
  // (handleEditorPointerDown's touch branch → revealBlockHandlesForNode),
  // bypassing both events and the sheet entirely.
  function handleBlockActionsEvent(e) {
    openBlockActionSheet(e.detail?.block ?? null);
  }
  $effect(() => {
    const el = editorEl;
    if (!el) return;
    el.addEventListener("shizumu-block-actions", handleBlockActionsEvent);
    el.addEventListener("shizumu-block-insert", handleBlockInsertEvent);
    return () => {
      el.removeEventListener("shizumu-block-actions", handleBlockActionsEvent);
      el.removeEventListener("shizumu-block-insert", handleBlockInsertEvent);
    };
  });

  function writeMarkdownToClipboard(view, event, clearSelection) {
    if (!editor || !event.clipboardData) return false;
    if (view.state.selection.empty) return false;
    const md = serializeSelection(editor);
    if (!md) return false;
    // Mirror TipTap's defaults for text/html and text/plain so apps
    // that don't read markdown still get usable content. Generate
    // text/plain from a stripped version of the serialized markdown.
    const plain = md.replace(/^#{1,6}\s+/gm, "").replace(/\*\*?|`+|~~/g, "");
    event.clipboardData.setData("text/markdown", md);
    event.clipboardData.setData("text/plain", plain);
    // text/html: let TipTap render the slice as HTML via the default
    // serializer so rich-text targets paste cleanly.
    const slice = view.state.selection.content();
    const tmp = document.createElement("div");
    tmp.appendChild(view.someProp("clipboardSerializer", (s) => s.serializeFragment(slice.content)) ?? document.createDocumentFragment());
    event.clipboardData.setData("text/html", tmp.innerHTML);
    event.preventDefault();

    // Mirror the write through the Rust clipboard. This path is synchronous —
    // it must fill clipboardData before returning — so the plugin write is
    // fire-and-forget alongside it, not instead of it.
    //
    // Needed because setData alone is not sufficient under Wayland: the
    // webview's clipboard integration fails there, so a plain Ctrl+C put
    // nothing on the system clipboard even though nothing errored. On X11 and
    // in the browser this is redundant and harmless — same content, last write
    // wins. See src/lib/clipboard-write.js.
    writeClipboard({ text: plain, html: tmp.innerHTML }).catch(() => {});

    if (clearSelection) view.dispatch(view.state.tr.deleteSelection());
    return true;
  }

  onMount(async () => {
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", handleHide);
    if (typeof window !== "undefined") window.addEventListener("pagehide", handleHide);
    // Ensure all `bind:this` targets (especially bubbleMenuEl) have been
    // flushed before the Editor is constructed. BubbleMenu silently bails
    // out when its `element` option is null at plugin-registration time.
    await tick();

    const rawContent = initialContent
      ? (typeof initialContent === "string" ? JSON.parse(initialContent) : initialContent)
      : { type: "doc", content: [{ type: "paragraph" }] };
    // Lazy schema migration — old taskList/bulletList/orderedList/taskItem
    // get rewritten before TipTap parses. algorithmBlock → recipeBlock,
    // legacy flat-paragraph qaBlock → qaBlock with qaPair children.
    // All migrations are idempotent on already-migrated docs.
    const content = migrateQASchema(migrateRecipeSchema(migrateListSchema(rawContent)));

    // Yjs binding gate: only continuous-trail pages, only when the
    // user has opted in via `enable_yjs`. Discrete pages and any
    // flag-off session take the unchanged page_blob path.
    let collaborationDoc = null;
    if (trailMode === "continuous" && !readonly) {
      const enabled = await isYjsEnabled();
      if (enabled) {
        const bytes = bytesFromTauri(initialYjsState);
        if (bytes && bytes.length > 0) {
          // Existing yjs_state — hydrate as-is.
          collaborationDoc = hydrateDoc(bytes);
        } else {
          // Lazy backfill: yjs_state is null but content_json may have
          // text. Derive a Y.Doc from the JSON so the editor mounts
          // with the page's actual content. The next save persists the
          // encoded yjs_state, so subsequent opens use the fast path.
          // Build the prosemirror schema from a plain (non-yjs) build
          // of the extension list — Collaboration isn't needed for
          // schema derivation, only for the live binding below.
          const schema = getSchema(buildEditingExtensions({ placeholder }));
          collaborationDoc = docFromTipTapJson(schema, content) ?? hydrateDoc(null);
        }
        yjsDoc = collaborationDoc;
      }
    }

    editor = new Editor({
      element: editorEl,
      extensions: buildEditingExtensions({
        placeholder,
        // Called fresh on every menu render — Svelte 5's reactive $props
        // proxies always reflect the current page's lineage at the moment
        // the user opens the @-menu, even though the configuration object
        // is built once at editor construction time.
        getCurrentLineage: () => (
          currentLineageId
            ? { id: currentLineageId, name: currentLineageName || "" }
            : null
        ),
        onCreateSubtrail: (name, kind, trailMode) => onCreateSubtrail(name, kind, trailMode),
        onPageRefNavigate: (targetPageId) => onMentionNavigate(targetPageId),
        onPinRefNavigate: (pinId) => onPinRefNavigate(pinId),
        onChartOpen: (params) => {
          // /chart slash command: { mode: "create" }. Click on existing
          // chart node: { mode: "edit", pos, attrs }. Both routes land here.
          chartBuilderState = params || null;
        },
        collaborationDoc,
      }),
      // Skip `content` when bound to a Y.Doc — Collaboration sources
      // the doc state from the YXmlFragment, and supplying `content`
      // on top would double-apply and shred the doc structure.
      ...(collaborationDoc ? {} : { content }),
      editable: !readonly,
      onUpdate: ({ editor: ed }) => {
        debouncedSave(ed);
        updateTableToolbar();
        updateSelectionPin(ed);
        updateBubbleMenu(ed);
        wordCount = countWordsExcludingMarkers(ed);
        onWordCount(wordCount);
        onDocChange(ed.state.doc.toJSON());
      },
      onSelectionUpdate: ({ editor: ed }) => {
        updateSelectionPin(ed);
        updateBubbleMenu(ed);
        pruneEmptyHeadingOnMove(ed);
      },
      onFocus: () => {
        maybeShowMobileGesturesHint();
      },
      onBlur: ({ editor: ed }) => {
        pruneAllEmptyHeadings(ed, { preserveCursor: false });
      },
      onTransaction: () => {
        updateTableToolbar();
      },
      editorProps: {
        handlePaste(view, event) {
          const data = event.clipboardData;
          if (!data) return false;

          // Shizumu block copy/paste — Chromium-compatible path. The
          // block's JSON payload travels inside text/html as a
          // data-shizumu-block attribute (copyBlockAtPos / block-clipboard.js)
          // because Chromium rejects the custom application/x-shizumu-block+json
          // MIME type on write. Check for that wrapper before falling
          // through to the generic HTML-paste / markdown paths below.
          //
          // Coordinator branch-review fix (item 3): this payload can come
          // from ANY text/html on the clipboard, including content pasted
          // in from outside the app — a page could hand-craft a
          // data-shizumu-block attribute carrying an arbitrary node type/
          // attrs. Allowlist the embedded JSON's top-level node type to
          // the set copyBlockAtPos can actually produce before calling
          // nodeFromJSON; anything else rejects and falls through to the
          // sanitized HTML paste path below.
          const embeddedBlockJson = parseBlockFromHtml(data.getData("text/html"));
          if (embeddedBlockJson && COPYABLE_BLOCK_TYPES.has(embeddedBlockJson.type)) {
            try {
              // Strip pinId so the duplicate does not double-bind to the same pin row.
              const nodeJson = stripPinIdsFromJSON(embeddedBlockJson);
              const node = view.state.schema.nodeFromJSON(nodeJson);
              const { tr, selection } = view.state;
              view.dispatch(tr.insert(selection.from, node));
              return true;
            } catch {
              // Fall through to the default HTML/markdown/plain-text paste below.
            }
          }

          // Image paste from clipboard
          const imageFile = Array.from(data.files).find(
            f => f.type.startsWith("image/")
          );
          if (imageFile) {
            insertImageFile(imageFile);
            return true;
          }

          // Markdown clipboard: explicit text/markdown always wins; plain
          // text that looks like markdown wins only when no text/html is
          // offered (rich-text sources keep their existing HTML path).
          // On parser failure, we do NOT preventDefault — the default
          // pipeline still inserts the plain text — but we surface a
          // toast so the user knows markdown formatting was lost.
          let mdAttempted = false;
          const md = data.getData("text/markdown");
          if (md && md.trim().length > 0) {
            mdAttempted = true;
            if (parseAndInsert(editor, md)) {
              event.preventDefault();
              return true;
            }
          }
          const plain = data.getData("text/plain");
          const htmlForMd = data.getData("text/html");
          if (plain && !htmlForMd && looksLikeMarkdown(plain)) {
            mdAttempted = true;
            if (parseAndInsert(editor, plain)) {
              event.preventDefault();
              return true;
            }
          }
          if (mdAttempted) {
            showToast("couldn't parse as markdown. pasted as plain text.");
            // fall through to default plain-text insertion path
          }

          // Sanitize rich HTML from web/Notion/Docs
          const html = data.getData("text/html");
          if (html) {
            const cleaned = sanitizePastedHtml(html);
            if (cleaned) {
              editor?.commands.insertContent(cleaned);
              return true;
            }
          }
          return false;
        },

        handleDrop(_view, event) {
          const files = event.dataTransfer?.files;
          if (!files) return false;
          const imageFile = Array.from(files).find(f => f.type.startsWith("image/"));
          if (imageFile) {
            event.preventDefault();
            insertImageFile(imageFile);
            return true;
          }
          return false;
        },

        handleDOMEvents: {
          copy(view, event) {
            return writeMarkdownToClipboard(view, event, /* clear */ false);
          },
          cut(view, event) {
            return writeMarkdownToClipboard(view, event, /* clear */ true);
          },
        },
      },
    });

    // Fire once after mount so the panel sees the initial doc state without
    // waiting for the first keystroke.
    if (editor) {
      onDocChange(editor.state.doc.toJSON());
    }

    // Quick-pin keybinding (E.1) — Cmd/Ctrl+P from inside the editor.
    // The browser's default for Cmd+P is "print"; we intercept and
    // preventDefault so the writing surface owns the chord. Listener is
    // scoped to keydown events that originate from inside our wrapper.
    const onWrapperKeydown = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === "p" || e.key === "P") {
        // Shift modifier reserved for "post-pin: open the modal"; not
        // implemented yet (Phase 10 follow-up). For now, both variants
        // route to the quick path.
        e.preventDefault();
        e.stopPropagation();
        quickPinFromCursor();
      } else if (e.key === "f" || e.key === "F") {
        // Cmd/Ctrl+F → find bar (find-only mode). Browser default
        // (page-level find) doesn't run inside Tauri webviews, but
        // preventDefault for parity.
        e.preventDefault();
        e.stopPropagation();
        findBarMode = "find";
        findBarOpen = true;
      } else if (e.key === "h" || e.key === "H") {
        // Cmd/Ctrl+H → find bar (replace mode).
        e.preventDefault();
        e.stopPropagation();
        findBarMode = "replace";
        findBarOpen = true;
      }
    };
    wrapperEl?.addEventListener("keydown", onWrapperKeydown, true);

    // Mobile action bar dispatches these window events so it can reach
    // editor-internal actions (find, quick-pin) without lifting them into
    // Page.svelte's state. Desktop users keep their chord paths above.
    const onOpenFind = (e) => {
      findBarMode = e?.detail?.mode === "replace" ? "replace" : "find";
      findBarOpen = true;
    };
    const onQuickPin = () => {
      try { quickPinFromCursor(); } catch {}
    };
    window.addEventListener("shizumu:open-find", onOpenFind);
    window.addEventListener("shizumu:quick-pin", onQuickPin);

    // Phone IME-aware caret tracking: when the soft keyboard opens or
    // closes, scroll the active selection into view so the cursor isn't
    // left hidden behind it. keyboardOpen (keyboard-state.js, the app's
    // single viewport-state owner) fires on every open/close transition.
    const onKeyboardChange = () => {
      if (!editor || !editor.isFocused) return;
      // The IME just covered (or revealed) area below. Defer one frame
      // so layout settles, then nudge ProseMirror's built-in scroll.
      requestAnimationFrame(() => {
        try { editor?.commands.scrollIntoView(); } catch {}
      });
    };
    const unsubKeyboardOpen = keyboardOpen.subscribe(onKeyboardChange);

    return () => {
      wrapperEl?.removeEventListener("keydown", onWrapperKeydown, true);
      window.removeEventListener("shizumu:open-find", onOpenFind);
      window.removeEventListener("shizumu:quick-pin", onQuickPin);
      unsubKeyboardOpen();
    };
  });

  // Load pin cache on mount and when lineageId changes
  let prevLineageId = $state(null);
  $effect(() => {
    if (lineageId !== prevLineageId) {
      prevLineageId = lineageId;
      loadPinCache();
    }
  });

  // Watch for page changes — reload content when pageId changes
  let prevPageId = $state(null);
  $effect(() => {
    if (editor && pageId && pageId !== prevPageId) {
      // Save cursor position for old page
      if (prevPageId && editor) {
        cursorMemory.set(prevPageId, editor.state.selection.anchor);
      }
      const oldPageId = prevPageId;
      prevPageId = pageId;

      // Flush save for old page BEFORE loading new content. The save is
      // awaited so a quick navigate-away-then-back can't read pre-save state
      // from the DB (the original "title disappears" bug). The save also
      // runs unconditionally — not only when a debounce timer is pending —
      // because edits dispatched via NodeView title slots commit to PM state
      // before onUpdate has had a chance to (re-)schedule the timer.
      (async () => {
        if (oldPageId && editor) {
          if (saveTimer) {
            clearTimeout(saveTimer);
            saveTimer = null;
          }
          try {
            pruneAllEmptyHeadings(editor, { preserveCursor: false });
            const json = JSON.stringify(editor.getJSON());
            const yjsBytes = yjsDoc ? encodeState(yjsDoc) : null;
            if (isTrailMode && trailLineageId) {
              await saveTrailContent(trailLineageId, oldPageId, json);
            } else {
              await savePageContent(oldPageId, json, yjsBytes);
            }
          } catch (err) {
            console.error("Failed to flush save before page switch:", err);
          }
        }

        const content = initialContent
          ? (typeof initialContent === "string" ? JSON.parse(initialContent) : initialContent)
          : { type: "doc", content: [{ type: "paragraph" }] };
        editor.commands.setContent(content);
        editor.setEditable(!readonly);
        // Cursor placement priority:
        //   1. Continuous trails always land at end of doc (fresh writing position).
        //   2. Otherwise restore the saved cursor for this page if we've visited before.
        if (trailMode === "continuous") {
          setTimeout(() => editor.commands.focus("end"), 50);
        } else {
          const savedPos = cursorMemory.get(pageId);
          if (savedPos && savedPos <= editor.state.doc.content.size) {
            setTimeout(() => editor.commands.setTextSelection(savedPos), 50);
          }
        }
      })();
    }
  });

  onDestroy(() => {
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", handleHide);
    if (typeof window !== "undefined") window.removeEventListener("pagehide", handleHide);
    if (editor && !editor.isDestroyed) {
      // Flush a pending edit before tearing down rather than discarding it —
      // this is what silently dropped a just-stamped pinId when the editor
      // unmounted inside the debounce window. Capture synchronously; the save
      // itself is fire-and-forget since onDestroy cannot await.
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; flushSave({ preserveCursor: false }); }
      try { pruneAllEmptyHeadings(editor, { preserveCursor: false }); } catch {}
      editor.destroy();
    }
    if (saveTimer) clearTimeout(saveTimer);
    if (handleShowTimer) clearTimeout(handleShowTimer);
    clearTouchHandleHide();
    clearLongPress();
    if (dragActive) endDrag();
  });

  // App backgrounded or closing: flush a pending save before the OS can
  // suspend or kill the webview. On mobile a swipe-away fires visibilitychange
  // /pagehide, not onDestroy, so without this a just-created pin's stamp is
  // lost exactly the way the user hit it.
  function handleHide() {
    if (typeof document !== "undefined" && document.visibilityState === "visible") return;
    if (saveTimer) flushSave({ preserveCursor: false });
  }

  // Persist the editor's content NOW, awaitable. The single place the doc is
  // written, so the debounce, the pin-create flush, teardown and pagehide all
  // save identically. `preserveCursor` is caller-chosen: true mid-session,
  // false on teardown where the cursor no longer matters.
  async function flushSave({ preserveCursor = true } = {}) {
    if (!editor || editor.isDestroyed) return;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    try {
      pruneAllEmptyHeadings(editor, { preserveCursor });
      const json = JSON.stringify(editor.getJSON());
      // When bound to a Y.Doc, ship its v2-encoded state alongside the JSON
      // snapshot. The backend persists both: yjs_state is source-of-truth for
      // sync, content_json keeps FTS warm.
      const yjsBytes = yjsDoc ? encodeState(yjsDoc) : null;
      if (isTrailMode && trailLineageId) {
        // saveTrailContent doesn't accept yjsState yet — continuous trails go
        // through PAGE's savePageContent path, so this branch only handles
        // legacy trail-mode pages where the editor was a passthrough.
        await saveTrailContent(trailLineageId, pageId, json);
      } else {
        await savePageContent(pageId, json, yjsBytes);
      }
    } catch (err) {
      console.error("Failed to save content:", err);
    }
  }

  function debouncedSave(_ed) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { flushSave(); }, 1000);
  }

  // Click-to-preview image modal (dispatched by the LocalImage node view).
  // Implemented via native <dialog> + showModal() so the modal lives in the
  // browser top layer — escapes every stacking context, including the
  // bottom-bar (which would otherwise render above us when the modal sits
  // inside the .column z-index stacking trap).
  let previewSrc = $state(null);
  let imageDialogEl = $state(null);

  function closeImagePreview() {
    try { imageDialogEl?.close(); } catch {}
    previewSrc = null;
  }

  $effect(() => {
    if (!wrapperEl) return;
    const handler = (e) => {
      previewSrc = e.detail?.src || null;
      if (previewSrc && imageDialogEl) {
        try { imageDialogEl.showModal(); } catch {}
      }
    };
    wrapperEl.addEventListener("shizumu-image-preview", handler);
    return () => wrapperEl.removeEventListener("shizumu-image-preview", handler);
  });

  // Gather every node in the current doc whose attrs.pinId matches the given id.
  // Order is doc-order; each entry carries its position.
  function collectNodesByPinId(pinId) {
    if (!editor || !pinId) return [];
    const out = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.attrs && node.attrs.pinId === pinId) {
        out.push({ node, pos });
        return false; // don't recurse into a pinned node — its children inherit via JSON
      }
      return true;
    });
    return out;
  }

  // Block handle: detect hovered block on mousemove
  let handleLeaveTimer = null;
  let handleShowTimer = null;
  let pendingHoverEl = null;
  // The initial hidden->visible reveal is debounced so a fast mouse pass
  // over several blocks doesn't flicker the handle column open and shut
  // for each one. Once a reveal is already showing, moving to an
  // adjacent block updates immediately (no re-delay) so a deliberate
  // scan across blocks doesn't feel laggy.
  const HANDLE_SHOW_DELAY = 200;
  const HANDLE_HIDE_DELAY = 200;

  // ── Block-title hover reveal (desktop mouse) ──────────────────────────
  // Used to be a CSS-only rule gated behind `@media (hover: hover)` (the
  // D-6 QA-sweep fix). That gate assumed matchMedia reliably reports a real
  // mouse — it doesn't: the real webkit2gtk engine (this app's actual
  // webview on Linux) was reproduced reporting `(hover: hover): false`
  // under its GDK X11 backend even with a genuine mouse and zero touch
  // hardware, which silently killed hover-reveal for X11-backed desktop
  // users. Chromium (and Playwright's separately-built WebKit) both report
  // hover:hover=true in the same scenario, so browser-based dev testing
  // never caught it. See .superpowers/hover-title-fix-report.md.
  //
  // Reveal is now driven from mousemove tracking below, mirrored onto a
  // `.block-mouse-hovered` class (global.css reveals the title for that
  // class, unconditionally — no media query). resolveHoveredMouseBlock()
  // guards against Chromium's synthetic compat mousemove after a touch tap
  // (the original D-6 hole: a touch tap must never reveal/focus-enable the
  // title) via a last-touch timestamp — but ONLY gates granting a new
  // reveal. Clearing an existing one is never gated (see
  // resolveHoveredMouseBlock's own comment in block-hover-guard.js) — a
  // touch elsewhere in the editor, or the cursor moving off a block, or
  // moving from one block straight to another, must always be able to
  // close a title that's already open.
  let lastTouchAt = 0;
  let hoveredMouseBlock = $state(null);
  let hoveredMouseBlockEl = null;
  $effect(() => {
    const active = hoveredMouseBlock;
    // `.block-mouse-hovered` exists for ONE purpose: revealing a board's title
    // slot on hover (see global.css). Its only consumers are `.block-shell` and
    // `.code-block-wrap`. Stamping it on any OTHER NodeView root — notably an
    // image/attachment wrapper (`.local-image-wrap`) — mutates that NodeView's
    // own element, which ProseMirror's MutationObserver treats as a foreign DOM
    // change and reconciles by REBUILDING the NodeView. For a Svelte NodeView
    // that remounts the component and briefly tears down the <img>, and because
    // mousemove re-runs this on every pixel of travel, the image flickers
    // rapidly the whole time the cursor is over it. Restrict the stamp to the
    // boards that actually use it; everything else was only ever paying the
    // rebuild cost for a class that did nothing.
    const board = hoverClassTarget(active);
    if (hoveredMouseBlockEl && hoveredMouseBlockEl !== board) {
      hoveredMouseBlockEl.classList.remove("block-mouse-hovered");
    }
    if (board) {
      board.classList.add("block-mouse-hovered");
    }
    hoveredMouseBlockEl = board;
  });

  function handleEditorMouseMove(e) {
    // A held primary button means the user is dragging a selection. Leave
    // every hover-driven state alone until they let go.
    //
    // These assignments end up mutating the DOM *inside* the contenteditable:
    // hoveredMouseBlock drives the .block-mouse-hovered class, and applying it
    // makes ProseMirror re-render that node — observed as childList add/remove
    // on .ProseMirror. A node swap under an in-progress drag destroys the
    // browser's selection, so the caret tracked the pointer while the range
    // stayed collapsed and no text could be selected by dragging at all.
    // Measured before this guard: 17 selectionchange events in one drag, every
    // one collapsed, with mousedown and selectstart both un-prevented.
    if (e.buttons & 1) return;

    // Cancel any pending leave-timer so the handle stays visible once
    // the user re-enters the editor area (e.g., after touching the bubble menu).
    if (handleLeaveTimer) { clearTimeout(handleLeaveTimer); handleLeaveTimer = null; }
    if (!editorEl) return;

    // If the cursor is over the block-handle column itself, leave state as-is.
    // The column is positioned at the block's top-left and stacks 4 buttons
    // vertically — for short blocks (e.g. a 1-item taskList) the bottom button
    // (×) sits below the block's bounding rect. Without this guard, moving
    // toward × would drop cursor's Y below the block, the block-finder would
    // miss, and the column would disappear before the click registered.
    if (e.target instanceof Element && e.target.closest(".block-handles")) {
      return;
    }

    const proseMirror = editorEl.querySelector(".ProseMirror");
    if (!proseMirror) return;

    // Find the direct child of ProseMirror under the cursor
    const children = proseMirror.children;
    let found = null;
    for (const child of children) {
      const rect = child.getBoundingClientRect();
      if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
        found = child;
        break;
      }
    }

    if (found) {
      const tag = found.tagName?.toLowerCase();
      const wrapperRect = wrapperEl.getBoundingClientRect();
      const blockRect = found.getBoundingClientRect();
      const top = blockRect.top - wrapperRect.top + wrapperEl.scrollTop;
      const canInsert = tag === "p" || tag === "h1" || tag === "h2" || tag === "h3";
      const isBoard = found.classList?.contains("block-shell") || found.classList?.contains("code-block-wrap");
      const hasContent = !!(found.textContent?.trim());
      const alreadyPinned = existingPinContents.has(found.textContent?.trim());

      const applyReveal = () => {
        handleShowTimer = null;
        // Android synthesises a compat mousemove after every touch tap, and
        // this reveal path was the one place that never checked for it: the
        // long-press redesign removed the deliberate touch entries into the
        // floating pill, but a tap still arrived here as a "mouse hover" and
        // painted the pill over the block's own text. hoveredMouseBlock (the
        // title reveal) has been guarded by this exact predicate since D-6;
        // handleVisible simply never was. A real mouse — including a hybrid
        // laptop's, once the guard window since the last real touch has
        // elapsed — still reveals normally.
        if (!isTrustedMouseHover(lastTouchAt, Date.now())) return;
        handleTop = top;
        handleVisible = true;
        hoveredBlock = found;
        handleShowPlus = canInsert;
        handleIsBoard = isBoard;
        handleHasContent = hasContent;
        blockAlreadyPinned = alreadyPinned;
      };

      if (handleVisible) {
        // Already mid-hover — move to the new block immediately, no delay.
        if (handleShowTimer) { clearTimeout(handleShowTimer); handleShowTimer = null; }
        pendingHoverEl = found;
        applyReveal();
      } else if (pendingHoverEl !== found) {
        // Fresh hover onto a block from a hidden state — debounce so a
        // fast pass-through doesn't flash the handle column open.
        if (handleShowTimer) clearTimeout(handleShowTimer);
        pendingHoverEl = found;
        handleShowTimer = setTimeout(applyReveal, HANDLE_SHOW_DELAY);
      }
    } else {
      if (handleShowTimer) { clearTimeout(handleShowTimer); handleShowTimer = null; }
      pendingHoverEl = null;
      handleVisible = false;
      hoveredBlock = null;
      handleIsBoard = false;
      blockAlreadyPinned = false;
    }
    // Clearing is always the safe default; only revealing a block is
    // guarded. resolveHoveredMouseBlock() returns `found` itself iff found
    // exists AND the hover is trusted, and `null` in every other case —
    // so a touch anywhere in the editor (or the cursor moving off a block,
    // or moving from block A to block B within the guard window) always
    // clears the previous reveal, it just doesn't necessarily grant a new
    // one. See block-hover-guard.js for the full rationale (code-review
    // finding post-7af09e1: gating the clear path alongside the reveal
    // path let a revealed title get stuck open across an intervening
    // touch, or stuck on a stale block when the cursor moved on).
    hoveredMouseBlock = resolveHoveredMouseBlock(found, lastTouchAt, Date.now());
  }

  function handleEditorMouseLeave() {
    // A pending reveal (mid show-delay) should never fire after the mouse
    // has already left — otherwise a fast in-and-out pass could still flash
    // the handle column open just as the cursor exits.
    if (handleShowTimer) { clearTimeout(handleShowTimer); handleShowTimer = null; }
    pendingHoverEl = null;
    // Delay hiding so user can click the handle. Tracked timer so a quick
    // re-entry (via mousemove) cancels the pending hide.
    if (handleLeaveTimer) clearTimeout(handleLeaveTimer);
    handleLeaveTimer = setTimeout(() => {
      handleVisible = false;
      hoveredBlock = null;
      hoveredMouseBlock = null;
      handleLeaveTimer = null;
    }, HANDLE_HIDE_DELAY);
  }

  // Shared by the desktop `+` handle (hoveredBlock, mouse hover) and the
  // touch gutter handle's insert entry (an explicit block from the
  // shizumu-block-insert event, see handleBlockInsertEvent below) — one
  // insert path for both, per the gutter-restoration report's instruction
  // to reuse rather than duplicate it.
  function insertSlashAtBlock(block) {
    if (!editor || !block) return;
    // Focus the start of the block and type /
    const pos = editor.view.posAtDOM(block, 0);
    editor.chain().focus().setTextSelection(pos).insertContent("/").run();
  }

  function handleBlockHandleClick() {
    insertSlashAtBlock(hoveredBlock);
  }

  // Touch gutter handle's insert entry — the "+" touch-block-handle.js
  // renders on an EMPTY chip-less block — fires this bubbling event rather
  // than shizumu-block-actions, so an empty block's tap reaches the slash
  // menu directly.
  function handleBlockInsertEvent(e) {
    insertSlashAtBlock(e.detail?.block ?? null);
  }

  // ── Touch block-handle (Phase 11.3) ───────────────────────────────────
  // Touch devices never fire mousemove, so the hover-driven .block-handles
  // column (handleVisible/hoveredBlock above) doesn't reveal from a tap
  // the way it does from mouse hover. It's reached from touch two ways:
  // a bubble-menu action (syncBlockHandleToSelection), or a direct tap on
  // a chip-less block that already has content (handleEditorPointerDown's
  // touch branch → revealBlockHandlesForNode — the gutter-polish fix for
  // "tap on block does not show the toolbar"). Touch also gets its own
  // gestures for everything else:
  //   • Long-press (700ms) anywhere on a block enters drag-to-reorder
  //     mode — the block elevates visually; pointermove past a
  //     threshold (32px) triggers one moveUnit swap and resets, so
  //     dragging across the page reorders one step at a time.
  //   • A BOARD block's own actions sheet is reached by tapping its type
  //     chip (see handleBlockActionsEvent above) — unchanged by the
  //     gutter-polish fix, which only touches chip-less blocks. That used
  //     to be what an unmoved long-press did; long-press is Android's own
  //     text-selection gesture, so a long-press sheet fought the platform
  //     there instead of opening it. Long-press now ONLY ever starts a
  //     reorder drag (below); releasing it without moving simply ends the
  //     drag with no side effect (see handleEditorPointerUp).
  let touchHandleHideTimer = null;
  const TOUCH_HANDLE_REVEAL_MS = 4000;
  const TOUCH_LONG_PRESS_MS = 700;
  const TOUCH_DRAG_STEP_PX = 32;

  // Long-press drag state. While dragging:
  //   dragActive = true; dragBlock = the moving block;
  //   dragAccumY = signed Y travel since last swap.
  let dragActive = $state(false);
  let dragBlock = null;
  let dragAccumY = 0;
  let dragLastY = 0;
  let longPressTimer = null;

  function findBlockAtY(clientY) {
    if (!editorEl) return null;
    const proseMirror = editorEl.querySelector(".ProseMirror");
    if (!proseMirror) return null;
    for (const child of proseMirror.children) {
      const rect = child.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) {
        return child;
      }
    }
    return null;
  }

  function armTouchHandleHide() {
    // A control that removes itself after four seconds cannot be
    // photographed: toHaveScreenshot's stability pass takes longer than
    // that, so every capture of this state came back with the bar already
    // gone (measured: present at 3s, gone at 4.2s). The VR harness asks for
    // the state by name; when it does, the bar stays up.
    //
    // This freezes the timer ONLY — the long-press that reveals the bar,
    // and the placement that decides where it sits, both run exactly as
    // they do for a user. The attribute only exists in a VR build.
    if (typeof document !== "undefined" &&
        document.documentElement.dataset.vrState === "block-handles") {
      return;
    }
    if (touchHandleHideTimer) clearTimeout(touchHandleHideTimer);
    touchHandleHideTimer = setTimeout(() => {
      handleVisible = false;
      hoveredBlock = null;
      touchActiveBoard = null;
      touchHandleHideTimer = null;
    }, TOUCH_HANDLE_REVEAL_MS);
  }

  function clearTouchHandleHide() {
    if (touchHandleHideTimer) { clearTimeout(touchHandleHideTimer); touchHandleHideTimer = null; }
  }

  // Coordinator branch-review fix (item 2): on touch, the title slot's
  // hover-reveal is scoped to `(hover: hover)` (see global.css) so a tap
  // can never accidentally steal focus into it — but that also meant
  // touch users had NO path to reach an existing block's title at all.
  // Mirror the reveal state onto a DOM class so a matching
  // `@media (hover: none)` rule can reveal + re-enable the SAME block's
  // title, exactly like `.block-mouse-hovered` does for desktop hover
  // (hoveredMouseBlock above) — a follow-up tap directly on the (now
  // visible, now pointer-events:auto) title slot then focuses it normally.
  // Coordinator branch-review fix (item 2), take 2: this can't be driven
  // by handleVisible/hoveredBlock (the block-handles reveal state) —
  // handleEditorMouseMove (bound for the desktop hover path) also gets
  // driven by the synthetic mousemove/mouseenter compatibility events
  // Chromium dispatches after ANY touch tap, ANYWHERE on a block (not
  // just the margin — that handler doesn't check X at all, only
  // Y-range). Mirroring handleVisible/hoveredBlock directly re-opened the
  // exact D-6 hole this was meant to close. `touchActiveBoard` is instead
  // a dedicated signal, set directly by handleEditorPointerDown's own
  // pointerType==="touch" branch — never by mouse-compat events.
  // Mobile-stability item 4: originally set ONLY by the deliberate
  // margin-tap gesture (parity gap — a block read as titleless until the
  // user found that gesture). Now set on ANY touch pointerdown inside a
  // block (see handleEditorPointerDown), giving touch the same "tap it to
  // see its title" parity desktop hover already has. Filtered through
  // hoverClassTarget — the identical board/code-wrap-only filter the
  // desktop hover effect above applies — so this stays the single
  // stamping path for `.block-active-touch` regardless of which gesture
  // (margin-tap or body-tap) set it.
  let touchActiveBoard = $state(null);
  let touchActiveBlockEl = null;
  $effect(() => {
    const board = hoverClassTarget(touchActiveBoard);
    if (touchActiveBlockEl && touchActiveBlockEl !== board) {
      touchActiveBlockEl.classList.remove("block-active-touch");
    }
    if (board) {
      board.classList.add("block-active-touch");
    }
    touchActiveBlockEl = board;
  });

  function clearLongPress() {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  }

  function startDrag(block, startY) {
    if (!block) return;
    dragActive = true;
    dragBlock = block;
    dragAccumY = 0;
    dragLastY = startY;
    block.classList.add("block-dragging");
  }

  function endDrag() {
    if (dragBlock) dragBlock.classList.remove("block-dragging");
    dragActive = false;
    dragBlock = null;
    dragAccumY = 0;
  }

  // Reorder by one swap when the user has dragged a full step (32px). The
  // editor's existing moveUnit command swaps the current selection's
  // block with the adjacent sibling, so we first place the cursor inside
  // dragBlock, then dispatch the swap.
  function commitDragStep(direction) {
    if (!editor || !dragBlock) return;
    try {
      const pos = editor.view.posAtDOM(dragBlock, 0);
      if (typeof pos !== "number") return;
      editor.chain().setTextSelection(pos).moveUnit(direction).run();
    } catch {}
  }

  function handleEditorPointerDown(e) {
    if (e.pointerType === "touch") {
      // Record real-touch timestamps regardless of margin/body target —
      // isTrustedMouseHover() uses this to reject Chromium's post-tap
      // compat mousemove no matter where on the block the tap landed (that
      // handler doesn't check X, only Y-range — see hoveredMouseBlock's
      // declaration comment above).
      lastTouchAt = Date.now();
    }
    if (e.pointerType !== "touch") return;
    if (!editorEl) return;
    // Tapping a block-handle button — let the button's own onclick fire,
    // don't interfere with the reveal state.
    if (e.target instanceof Element && e.target.closest(".block-handles")) {
      return;
    }
    // Tapping the block-actions handle itself (a board's .block-type-chip
    // or a chip-less block's synthetic .touch-block-handle, the EMPTY-only
    // "+") — let its own click fire its dispatch undisturbed. Without
    // this the tap would also arm the long-press-drag timer below on the
    // very same gesture that's opening the sheet.
    if (e.target instanceof Element && e.target.closest(".block-type-chip, .touch-block-handle")) {
      return;
    }
    // Tapping the (already-revealed) title slot — let the tap focus the
    // <input> normally. Bug fixed here: the title slot is revealed via
    // `position: absolute; bottom: 100%` (global.css) so it renders ABOVE
    // the block's own border-box top — outside the Y range findBlockAtY
    // matches against that block. Without this guard, the code below
    // resolved a tap on the title to either the PREVIOUS block or nothing,
    // reassigned touchActiveBoard away from the block the title belongs
    // to, and the $effect that stamps `.block-active-touch` (which the
    // title's touch-reveal CSS is keyed on) immediately cleared it —
    // dismissing the very title the user just tapped, before focus could
    // land. Bailing out here leaves touchActiveBoard untouched (title
    // stays revealed) and lets the native mousedown/click/focus sequence
    // reach the input uninterrupted.
    if (e.target instanceof Element && e.target.closest(".board-title-slot")) {
      return;
    }
    // Touch parity with desktop hover (mobile-stability, item 4): tapping a
    // block ANYWHERE inside it reveals its title. Reuses the SAME
    // touchActiveBoard state + $effect the long-press-release path below
    // also drives (see that effect for the class-stamping mechanism) — no
    // second stamping path. hoverClassTarget is the identical filter the
    // desktop hover path applies (block-shell / code-block-wrap only — see
    // block-hover-guard.js) so a tap on some other top-level ProseMirror
    // child (a dayMarker, say) doesn't stamp a class nothing reads.
    // Assigning the raw (unfiltered) find here and filtering inside the
    // effect mirrors hoveredMouseBlock's own shape exactly.
    const block = findBlockAtY(e.clientY);
    touchActiveBoard = block;
    // Code-review fix (post-120d403): this path used to set
    // touchActiveBoard without arming the same auto-hide timer the
    // long-press path calls — the reveal never cleared on its own and
    // could sit up indefinitely while the user kept typing. Same timer,
    // same TOUCH_HANDLE_REVEAL_MS, so a body-tap reveal behaves
    // identically to every other touch reveal.
    if (block) armTouchHandleHide();

    // Gutter-polish fix ("tap on block does not show the toolbar"): a tap
    // on a chip-less block (plain paragraph/heading — board types have
    // their own chip, unaffected) that already has content reveals that
    // block's pin/copy/delete controls in the gutter — the same
    // .block-handles column desktop hover already populates, just
    // touch-triggered instead. An empty chip-less block is excluded
    // (needsTouchHandle + !textContent) because it already gets the "+"
    // insert affordance from touch-block-handle.js's own ProseMirror
    // decoration; this path only ever needs to fire for the OTHER half.
    //
    // Deliberately resolves the block from the tap's own Y position
    // (`block`, already computed above) rather than from
    // editor.state.selection the way syncBlockHandleToSelection does:
    // at pointerdown time the caret hasn't necessarily moved to the tap
    // position yet (that update lands in a separate, later transaction),
    // so reading the selection here would show the PREVIOUS block's
    // controls, not the one under the finger. Reading straight off the
    // DOM node the tap actually landed on sidesteps that race entirely.
    // Nothing here calls preventDefault — the tap still places the caret
    // through the normal path; this only ever adds the reveal alongside it.
    if (block) {
      // EVERY top-level block, not just chip-less ones. This was gated on
      // needsTouchHandle(), which only answers true for paragraph/heading —
      // a board (task list, quote, code) is a <div>, so it resolved to "",
      // the gate said no, and tapping a list revealed nothing at all. The
      // type chip is an ADDITIONAL way into a board's actions, never the
      // only one. revealBlockHandlesForNode works out which controls apply
      // (content / board / plus) from the node itself, so it is safe to
      // call for any block.
      revealBlockHandlesForNode(block);
    }

    // Arm long-press: released without moving → the block actions sheet
    // (see handleEditorPointerUp); moved past the drag threshold → reorder
    // (see handleEditorPointerMove). Cancelled by pointerup, pointercancel,
    // or significant movement before the 700ms timer fires. A tap alone —
    // this timer never firing — places the caret and does nothing else;
    // no floating chrome appears on touch (block-handles is mouse-hover
    // only, see the render guard on that element below).
    if (!block) return;
    const startY = e.clientY;
    clearLongPress();
    longPressTimer = setTimeout(() => {
      // Verify the user hasn't already lifted / moved away. (Move/leave
      // handlers clear longPressTimer.)
      startDrag(block, startY);
    }, TOUCH_LONG_PRESS_MS);
  }

  function handleEditorPointerMove(e) {
    if (e.pointerType !== "touch") return;
    if (!dragActive) {
      // Drag hasn't started yet — but movement before the long-press
      // fires should cancel the timer (a tap-and-drag isn't a long
      // press; treat as scroll instead).
      if (longPressTimer) clearLongPress();
      return;
    }
    e.preventDefault();
    const dy = e.clientY - dragLastY;
    dragLastY = e.clientY;
    dragAccumY += dy;
    while (dragAccumY >= TOUCH_DRAG_STEP_PX) {
      commitDragStep("down");
      dragAccumY -= TOUCH_DRAG_STEP_PX;
    }
    while (dragAccumY <= -TOUCH_DRAG_STEP_PX) {
      commitDragStep("up");
      dragAccumY += TOUCH_DRAG_STEP_PX;
    }
  }

  function handleEditorPointerUp(e) {
    if (e.pointerType !== "touch") return;
    clearLongPress();
    if (dragActive) {
      // Touch-actions redesign: a long-press that never moved used to open
      // the block-actions sheet (dragMoved tracked "did this move at all"
      // specifically to distinguish that from a reorder, since dragAccumY
      // resets to zero on every committed swap). That path fought Android's
      // own long-press-to-select-text gesture, so opening the sheet moved
      // to the block's own handle (a board's type chip — see
      // handleBlockActionsEvent). Long-press now ONLY ever starts a
      // reorder drag; releasing it unmoved just ends the drag with no
      // further action.
      endDrag();
    }
  }

  // ── Touch block-actions sheet ──────────────────────────────────────────
  // Replaces the floating .block-handles pill on touch, for BOARD blocks
  // only. Opened by tapping the block's own type chip (block-shell.js /
  // table-shell-view.js) — routed here via the shizumu-block-actions
  // CustomEvent (handleBlockActionsEvent above). A chip-less block (plain
  // paragraph/heading) never reaches this sheet: it either fires
  // shizumu-block-insert (empty) or reveals its .block-handles column
  // directly (has content — see handleEditorPointerDown). NOT a
  // long-press: an earlier redesign opened it that way, but long-press is
  // Android's own text-selection gesture, so the platform's own menu won
  // this fight every time instead of the sheet. Closed by any BottomSheet
  // dismiss path (scrim tap, drag-down, Escape, hardware back — all via
  // BottomSheet's own navstack integration).
  let blockActionSheetOpen = $state(false);
  let blockActionSheetBlock = $state(null);
  let blockActionSheetActions = $state(/** @type {string[]} */ ([]));

  // Presentation only (which glyph next to which label) — the DECISION of
  // which actions apply lives in block-actions.js's blockActionsFor.
  const BLOCK_ACTION_GLYPHS = {
    pin: "↗",
    copy: "⎘",
    title: "T",
    "insert-below": "+",
    delete: "×",
  };

  function openBlockActionSheet(block) {
    if (!block) return;
    // Same signals revealHandleForBlock used to compute for the pill,
    // reused here so blockActionsFor sees exactly what the old inline
    // gates saw — the decision moved, not the underlying facts.
    const isBoard = block.classList?.contains("block-shell") || block.classList?.contains("code-block-wrap");
    const hasContent = !!(block.textContent?.trim());
    const tag = block.tagName?.toLowerCase();
    const canInsert = tag === "p" || tag === "h1" || tag === "h2" || tag === "h3";
    const hasTitle = !!block.querySelector?.(".board-title-slot");
    let actions = blockActionsFor({
      isBoard,
      hasTitle,
      canPin: hasContent,
      isEmpty: canInsert && !hasContent,
    });
    // Mirrors the old pill's per-button `!readonly` gates exactly: insert/
    // copy/delete were readonly-gated there, pin and the title reveal were
    // not (a past page's block can still be pinned, and tapping to read
    // its title was never blocked either) — same split here.
    if (readonly) {
      actions = actions.filter((id) => id !== "copy" && id !== "insert-below" && id !== "delete");
    }
    blockActionSheetActions = actions;
    if (blockActionSheetActions.length === 0) return;
    // hoveredBlock is what handlePinBlock/handleCopyBlock/handleDeleteBlock/
    // handleBlockHandleClick all act on — setting it here lets the sheet's
    // action handlers below reuse those functions unchanged rather than
    // re-implementing pin/copy/delete/insert against a second target
    // variable.
    hoveredBlock = block;
    blockActionSheetBlock = block;
    blockActionSheetOpen = true;
  }

  function closeBlockActionSheet() {
    blockActionSheetOpen = false;
  }

  async function runBlockAction(id) {
    const block = blockActionSheetBlock;
    closeBlockActionSheet();
    if (!block) return;
    if (id === "pin") {
      await handlePinBlock();
    } else if (id === "copy") {
      await handleCopyBlock();
    } else if (id === "title") {
      // .block-active-touch is what the title's touch-reveal CSS keys on
      // (global.css) — set it so the slot is visible+hit-testable, then
      // enter edit mode the same way keyboard nav does (block-title.js's
      // ArrowUp/Backspace handlers call the identical __enterEdit()).
      touchActiveBoard = block;
      const slot = block.querySelector(".board-title-slot");
      if (slot && typeof slot.__enterEdit === "function") {
        slot.__enterEdit();
      } else if (slot) {
        slot.focus();
      }
    } else if (id === "insert-below") {
      handleBlockHandleClick();
    } else if (id === "delete") {
      handleDeleteBlock();
    }
  }

  // Table toolbar: show add row/column when cursor is in a table
  function updateTableToolbar() {
    if (!editor || !editorEl || !wrapperEl) {
      tableActive = false;
      return;
    }
    const isInTable = editor.isActive("table");
    tableActive = isInTable;

    if (isInTable) {
      const tableEl = editorEl.querySelector(".ProseMirror table");
      if (tableEl) {
        const wrapperRect = wrapperEl.getBoundingClientRect();
        const tRect = tableEl.getBoundingClientRect();
        // The toolbar is position:absolute inside wrapperEl, so its `top`/`left`
        // are measured from the wrapper's CONTENT origin, not its visible top.
        // getBoundingClientRect is viewport-relative, so we add the wrapper's
        // scroll offset — otherwise a tall table that's been scrolled places the
        // toolbar `scrollTop` pixels too high, landing it on top of the table.
        const sx = wrapperEl.scrollLeft || 0;
        const sy = wrapperEl.scrollTop || 0;
        tableRect = {
          top: tRect.top - wrapperRect.top + sy,
          bottom: tRect.bottom - wrapperRect.top + sy,
          right: tRect.right - wrapperRect.left + sx,
          left: tRect.left - wrapperRect.left + sx,
          width: tRect.width,
          height: tRect.height,
        };
      }
    }
  }

  function addTableRow(e) {
    e.preventDefault();
    if (editor) editor.chain().addRowAfter().run();
  }

  function addTableColumn(e) {
    e.preventDefault();
    if (editor) editor.chain().addColumnAfter().run();
  }

  // Top-level node types copyBlockAtPos can ever produce for the
  // data-shizumu-block clipboard payload — used by handlePaste's block-
  // copy path to reject a hand-crafted/foreign payload before
  // nodeFromJSON (see the coordinator branch-review note there).
  const COPYABLE_BLOCK_TYPES = new Set([
    "paragraph", "heading", "table", "list", "blockquote",
    "recipeBlock", "qaBlock", "chart", "dayMarker", "localImage",
    "codeBlock", "attachment", "horizontalRule", "listItem",
  ]);

  const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"]);

  async function insertImageFile(file) {
    if (!editor) return;
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      if (!IMAGE_EXTS.has(ext)) return;
      const buf = await file.arrayBuffer();
      // Images go through the same content-addressed blob store as files, so
      // they get a blob_hash, an attachments row and a per-image sync
      // decision. Default sync=false: nothing leaves the device unasked.
      const att = await attachmentAddBytes(new Uint8Array(buf), file.name, file.type || null, false);
      editor.chain().focus().insertContent({
        type: "attachment",
        attrs: {
          kind: "image",
          blob_hash: att.blob_hash,
          filename: att.filename,
          mime_type: att.mime_type,
          size_bytes: att.size_bytes,
          sync: att.sync,
          created_at: att.created_at,
          display: "block",
        },
      }).run();
    } catch (err) {
      console.error("Failed to insert image:", err);
    }
  }

  // Shared block-copy implementation, called by both the hover handle
  // (handleCopyBlock) and the keyboard shortcut (BlockCopyKeymap). Pos
  // is a doc position inside (or at the boundary of) the block to
  // copy; sourceEl is the DOM element to flash (or null for keyboard
  // path: no flash, the toast is the feedback).
  async function copyBlockAtPos(pos, sourceEl) {
    if (!editor) return false;
    // Boundary arithmetic lives in block-copy-target.js so it can be tested
    // without a clipboard. It used to be inline here and read nodeBefore
    // before nodeAfter, which made the ⎘ handle copy the block ABOVE the one
    // pointed at for every block but the first — resolveBlockPos hands us
    // `before(1)` of the target, a depth-0 boundary where nodeBefore is the
    // PRECEDING block. See block-copy-target.test.js.
    //
    // preferListItem: the keyboard path (sourceEl == null) has a real cursor
    // inside a list item and should copy that item, not the whole list. The
    // hover handle explicitly pointed at a top-level child, so it keeps the
    // depth-1 grain.
    const target = resolveCopyTarget(editor.state.doc, pos, {
      preferListItem: sourceEl == null,
    });
    if (!target) return false;
    const { node, blockStart, blockEnd, grain: copiedGrain } = target;

    // 1. Plain text.
    const plainText = node.textContent || "";

    // 2. HTML via ProseMirror serializer — also carries the block's JSON
    //    payload for paste-back into shizumu, embedded as a
    //    data-shizumu-block attribute (see block-clipboard.js). Chromium's
    //    Clipboard API rejects the custom application/x-shizumu-block+json
    //    MIME type on write ("Type ... not supported on write" — the same
    //    error on desktop Chromium and Android WebView, two of shizumu's
    //    three shipping engines), so the payload travels inside the
    //    standard text/html entry instead of its own MIME entry.
    let html = "";
    try {
      const serializer = DOMSerializer.fromSchema(editor.state.schema);
      const wrapper = document.createElement("div");
      wrapper.appendChild(serializer.serializeFragment(Fragment.from(node)));
      html = wrapper.innerHTML;
    } catch {}
    const htmlWithBlockPayload = serializeBlockToHtml(html, node.toJSON());

    // 3. Markdown via the existing serializeSelection helper. Span the
    //    block as the editor's selection so serializeSelection picks
    //    up the whole frame, then restore the prior selection.
    const priorSel = editor.state.selection;
    let markdown = "";
    try {
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, blockStart + 1, blockEnd - 1))
      );
      markdown = serializeSelection(editor);
    } catch {}
    finally {
      // Restore. The temporary tr only changed selection, so positions
      // in priorSel are still valid.
      try {
        editor.view.dispatch(
          editor.state.tr.setSelection(priorSel)
        );
      } catch {}
    }

    // Inside the app this goes through the Rust clipboard rather than the
    // webview: WebKitGTK rejects navigator.clipboard.* with NotAllowedError
    // (no way to grant its permission prompt from a Tauri window), and under
    // Wayland the webview's clipboard doesn't work at all. writeClipboard
    // falls back to the web API outside Tauri, so browser dev and the VR
    // harness are unchanged. See src/lib/clipboard-write.js.
    //
    // The html flavour carries the embedded data-shizumu-block payload, which
    // is what handlePaste reads to reconstruct the block — so pasting back
    // into shizumu still rebuilds the real node rather than dropping to text.
    const wrote = await writeClipboard({
      text: plainText,
      html: htmlWithBlockPayload,
    });
    if (!wrote) {
      showToast("couldn't copy block");
      return false;
    }

    // Flash the source block if we have one (mouse path).
    if (sourceEl) {
      sourceEl.style.transition = "background 200ms ease";
      sourceEl.style.background = "color-mix(in srgb, var(--warm-accent) 10%, transparent)";
      setTimeout(() => { if (sourceEl) sourceEl.style.background = ""; }, 500);
    }

    // Toast: include "frame" wording when the block is a frame node.
    // Frame nodes get a "frame copied" toast; everything else "block copied".
    // "Boards" are list nodes with a blockTitle attr (no separate schema node
    // for the wrapper). DOM class .block-shell is rendered by the list's
    // NodeView, not by a distinct doc-level node.
    const FRAME_TYPES = new Set(["recipeBlock", "qaBlock", "chart", "codeBlock", "dayMarker"]);
    const isTitledList = node.type.name === "list" && node.attrs?.blockTitle != null;
    const isFrame = FRAME_TYPES.has(node.type.name) || isTitledList;
    // Keyboard path (no sourceEl): teach the new shortcut by showing
    // longer text. Mouse path: short label since the flash is the
    // primary signal.
    if (!sourceEl) {
      const grainLabel = copiedGrain === "listItem" ? "list item" : "block";
      showToast(`${grainLabel} copied. paste anywhere as markdown`);
    } else {
      showToast(isFrame ? "frame copied" : "block copied");
    }
    return true;
  }

  async function handleCopyBlock() {
    if (!editor || !hoveredBlock) return;
    // Coordinator branch-review fix (item 4): this used to map
    // proseMirror.children DOM index -> doc.child(index), the same
    // fragile assumption handleDeleteBlock's fix (block-delete.js)
    // replaced — a NodeView's DOM index can desync from its doc child
    // index (atom NodeViews, any future widget decoration). Reuse the
    // same boundary resolution so copy can't desync from them either.
    let pos;
    try {
      pos = resolveBlockPos(editor.view, hoveredBlock);
    } catch {
      return;
    }
    await copyBlockAtPos(pos, hoveredBlock);
  }

  function handleDeleteBlock() {
    if (!editor || !hoveredBlock) return;
    // See block-delete.js for why the DOM→pos resolution has to walk out
    // to the depth-1 block boundary rather than using posAtDOM's raw
    // result (which lands inside the block's first DOM child — a table's
    // title caption, a board's title input — and deletes the wrong node).
    deleteBlockAt(editor, hoveredBlock);
    handleVisible = false;
    hoveredBlock = null;
    touchActiveBoard = null;
  }

  // Track which top-level block the cursor was in last; when the user moves
  // out of an empty heading, convert it back to a paragraph — no zombie
  // empty-heading blocks left behind if the user typed /h1 and walked away.
  let prevCursorBlockPos = null;

  function pruneEmptyHeadingOnMove(ed) {
    let currentBlockPos;
    try {
      currentBlockPos = ed.state.selection.$from.before(1);
    } catch {
      return;
    }
    if (prevCursorBlockPos !== null && prevCursorBlockPos !== currentBlockPos) {
      try {
        const prevNode = ed.state.doc.nodeAt(prevCursorBlockPos);
        if (prevNode && prevNode.type.name === "heading" && prevNode.content.size === 0) {
          const paragraphType = ed.state.schema.nodes.paragraph;
          if (paragraphType) {
            const tr = ed.state.tr.setNodeMarkup(prevCursorBlockPos, paragraphType);
            ed.view.dispatch(tr);
          }
        }
      } catch {}
    }
    prevCursorBlockPos = currentBlockPos;
  }

  // Sweep every empty heading in the doc to a paragraph. Called at lifecycle
  // moments (blur, save, destroy) that pruneEmptyHeadingOnMove can't catch:
  // same-position clicks, focus leaving the editor, and unmount-without-move.
  // When preserveCursor is true, the heading currently holding the cursor is
  // left alone so active typing isn't clobbered between keystrokes.
  function pruneAllEmptyHeadings(ed, { preserveCursor = true } = {}) {
    if (!ed || !ed.state) return;
    let cursorHeadingPos = -1;
    if (preserveCursor) {
      try { cursorHeadingPos = ed.state.selection.$from.before(1); } catch {}
    }
    const targets = [];
    ed.state.doc.descendants((node, pos) => {
      if (node.type.name === "heading" && node.content.size === 0) {
        if (pos !== cursorHeadingPos) targets.push(pos);
      }
      // Top-level only: don't recurse into non-block children needlessly,
      // but descendants() is cheap on a doc of this size — leave default.
    });
    if (targets.length === 0) return;
    const paragraphType = ed.state.schema.nodes.paragraph;
    if (!paragraphType) return;
    // Iterate in reverse so earlier positions stay valid while the tr mutates.
    let tr = ed.state.tr;
    for (let i = targets.length - 1; i >= 0; i--) {
      try { tr = tr.setNodeMarkup(targets[i], paragraphType); } catch {}
    }
    if (tr.docChanged) ed.view.dispatch(tr);
  }

  function updateBubbleMenu(ed) {
    if (readonly) { bubbleMenuVisible = false; return; }
    const { from, to, empty } = ed.state.selection;
    if (empty) { bubbleMenuVisible = false; return; }
    // NodeSelection (e.g. clicking an atom like an attachment) is never
    // empty, so it passes the check above even though it isn't a text
    // selection at all — none of bold/italic/strike/link apply to a
    // selected file. Mirrors the same guard in updateSelectionPin.
    if (ed.state.selection instanceof NodeSelection) {
      bubbleMenuVisible = false;
      return;
    }
    // Skip code blocks (marks would render poorly there).
    const parentType = ed.state.selection.$from.parent.type.name;
    if (parentType === "codeBlock") { bubbleMenuVisible = false; return; }
    // Skip multi-block selections — selection-pin-btn claims that slot.
    const resolvedFrom = ed.state.doc.resolve(from);
    const resolvedTo = ed.state.doc.resolve(to);
    if (resolvedTo.index(0) > resolvedFrom.index(0)) {
      bubbleMenuVisible = false; return;
    }
    const coords = ed.view.coordsAtPos(from);
    const wrapperRect = wrapperEl?.getBoundingClientRect();
    if (!wrapperRect) { bubbleMenuVisible = false; return; }
    bubbleMenuInputs = { coords, wrapperRect };
    bubbleMenuPosition = pickBubblePosition(coords, wrapperRect);
    bubbleMenuVisible = true;
  }

  // Re-measure once the bubble actually mounts. pickBubblePosition's
  // first call (above) always runs before bubbleEl is bound — Svelte
  // sets bind:this after the DOM patch — so a hidden→visible transition
  // is positioned from an estimate. Once bubbleEl exists this effect
  // reruns (it reads bubbleEl), recomputes with the real offsetWidth,
  // and corrects bubbleMenuPosition if the estimate was off. Comparing
  // before writing (rather than writing unconditionally) is the loop
  // guard: the effect also reads bubbleMenuPosition, so an unconditional
  // write would make it depend on its own output every run.
  $effect(() => {
    if (!bubbleMenuVisible || !bubbleEl || !bubbleMenuInputs) return;
    const recomputed = pickBubblePosition(bubbleMenuInputs.coords, bubbleMenuInputs.wrapperRect);
    if (
      recomputed.left !== bubbleMenuPosition.left ||
      recomputed.top !== bubbleMenuPosition.top ||
      recomputed.flipped !== bubbleMenuPosition.flipped
    ) {
      bubbleMenuPosition = recomputed;
    }
  });

  function updateSelectionPin(ed) {
    // Touch-only removal (reported obsolete from a phone): a coarse
    // pointer can't precisely extend or shrink a multi-block drag
    // selection the way a mouse can, so the button mostly just floated
    // mid-drag with nothing useful to land on. Desktop (mouse/trackpad)
    // keeps it unchanged — pin-a-selection may still earn its place with
    // precise pointing, this is the conservative call for the platform
    // that reported the problem specifically.
    if (isCoarsePointer()) {
      selectionPinVisible = false;
      return;
    }
    const sel = ed.state.selection;
    const { from, to, empty } = sel;
    if (empty || to - from < 2) {
      selectionPinVisible = false;
      return;
    }
    // NodeSelection (e.g. the BlockTitle plugin pins selection on the
    // board before focusing the title input) spans an entire top-level
    // block, which would otherwise trigger the multi-block pin button.
    // It's not a real text selection — skip.
    if (sel instanceof NodeSelection) {
      selectionPinVisible = false;
      return;
    }
    const resolvedFrom = ed.state.doc.resolve(from);
    const resolvedTo = ed.state.doc.resolve(to);
    const startBlock = resolvedFrom.index(0);
    const endBlock = resolvedTo.index(0);
    if (endBlock <= startBlock) {
      selectionPinVisible = false;
      return;
    }
    const wrapperRect = wrapperEl.getBoundingClientRect();
    // Everything from here down only ever runs on a fine (mouse/trackpad)
    // pointer — the isCoarsePointer() return above already sent touch
    // back with the button hidden. Prefer the browser's selection rect —
    // it hugs the actual end of the selected text, which is closer to
    // where the mouse button was released than ProseMirror's own cursor
    // coords (PM updates selection state after pointerup, so those lag).
    // Fall back to PM coords if no DOM selection range exists.
    let rect = null;
    try {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        rect = sel.getRangeAt(0).getBoundingClientRect();
      }
    } catch {}
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      const coords = ed.view.coordsAtPos(to);
      rect = { top: coords.top, bottom: coords.bottom, left: coords.left, right: coords.left };
    }
    selectionPinPosition = {
      top: rect.top - wrapperRect.top + wrapperEl.scrollTop - 32,
      left: Math.max(4, rect.right - wrapperRect.left - 28),
    };
    selectionPinVisible = true;
  }

  // Populate the block-handles column's state from a live DOM block —
  // shared tail of syncBlockHandleToSelection (below, resolves the node from
  // the editor's own selection) and revealBlockHandlesOnTouchTap
  // (handleEditorPointerDown, resolves the node from the tap's Y position
  // instead — see that function for why it can't reuse the selection path).
  function revealBlockHandlesForNode(node) {
    if (!node || !wrapperEl) return;
    const wrapperRect = wrapperEl.getBoundingClientRect();
    const blockRect = node.getBoundingClientRect();
    handleTop = blockRect.top - wrapperRect.top + wrapperEl.scrollTop;
    hoveredBlock = node;
    const tag = node.tagName?.toLowerCase();
    handleShowPlus = tag === "p" || tag === "h1" || tag === "h2" || tag === "h3";
    handleIsBoard = node.classList?.contains("block-shell") || node.classList?.contains("code-block-wrap");
    handleHasContent = !!(node.textContent?.trim());
    blockAlreadyPinned = existingPinContents.has(node.textContent?.trim());
    handleVisible = true;
  }

  // Resolve the DOM element of the top-level block containing the cursor/selection
  // and sync block-handle state to it. Used after bubble-menu interaction so the
  // pin/copy toolbar for the selection's block appears immediately — no mousemove
  // required.
  function syncBlockHandleToSelection() {
    if (!editor || !wrapperEl || !editorEl) return;
    const proseMirror = editorEl.querySelector(".ProseMirror");
    if (!proseMirror) return;
    try {
      const { from } = editor.state.selection;
      const domAtPos = editor.view.domAtPos(from);
      let node = domAtPos.node;
      if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
      while (node && node.parentNode !== proseMirror) node = node.parentNode;
      if (!node || node.parentNode !== proseMirror) return;
      revealBlockHandlesForNode(node);
      if (handleLeaveTimer) { clearTimeout(handleLeaveTimer); handleLeaveTimer = null; }
    } catch {}
  }

  async function handlePinSelection() {
    if (!editor) return;
    const { from, to, empty } = editor.state.selection;
    if (empty) return;

    // Collect absolute positions of every top-level doc child that overlaps
    // [from, to]. These are the nodes we'll stamp with the new pinId.
    const positions = [];
    const nodes = [];
    editor.state.doc.forEach((node, offset) => {
      const start = offset;
      const end = offset + node.nodeSize;
      if (start < to && end > from) {
        positions.push(offset);
        nodes.push(node.toJSON());
      }
    });
    if (nodes.length === 0) return;

    const jsonContent = { type: "doc", content: nodes };
    pinContent = JSON.stringify(jsonContent);
    pinCategory = "board";
    pinNodePositions = positions;

    const slice = editor.state.doc.slice(from, to);
    const textPreview = slice.content.textBetween(0, slice.content.size, " ").trim();
    pinDefaultTitle = textPreview.slice(0, 50) || `${nodes.length} blocks`;

    try {
      const existing = await getPins(lineageId || null);
      if (existing.some(p => p.content === pinContent)) return;
    } catch {}

    const coords = editor.view.coordsAtPos(to);
    pinPopupPosition = { top: coords.top + 20, left: coords.left };
    pinBlockEl = null;
    showPinPopup = true;
    selectionPinVisible = false;
  }

  // The live top-level block the pin button belongs to, resolved at click
  // time from the best source available. `hoveredBlock` is the happy path,
  // but by the time onclick fires it is often gone: svelte-tiptap replaces a
  // block's DOM node when a NodeView settles, and the reveal/leave timing can
  // null it out entirely — which on a first launch left the button visible
  // and inert, no error, no popup, "nothing at all". So fall back to the
  // block under the handle's on-screen row, then to the block at the cursor.
  function resolveHandleBlock() {
    if (hoveredBlock?.isConnected) return hoveredBlock;
    const proseMirror = editorEl?.querySelector(".ProseMirror");
    const wrapperRect = wrapperEl?.getBoundingClientRect();
    if (proseMirror && wrapperRect) {
      // handleTop is content-space (it includes scrollTop); convert back to
      // viewport before matching against getBoundingClientRect.
      const targetY = wrapperRect.top + handleTop - (wrapperEl?.scrollTop || 0) + 4;
      const fresh = Array.from(proseMirror.children).find((child) => {
        const r = child.getBoundingClientRect();
        return targetY >= r.top && targetY <= r.bottom;
      });
      if (fresh?.isConnected) return fresh;
    }
    // Last resort: the top-level block containing the cursor.
    try {
      const pos = editor.state.selection.$from.before(1);
      const dom = editor.view.domAtPos(pos)?.node;
      let el = dom?.nodeType === 1 ? dom : dom?.parentElement;
      while (el && el.parentElement && !el.parentElement.classList?.contains("ProseMirror")) {
        el = el.parentElement;
      }
      if (el?.isConnected && el.parentElement?.classList?.contains("ProseMirror")) return el;
    } catch {}
    return null;
  }

  async function handlePinBlock() {
    if (!editor) return;
    const block = resolveHandleBlock();
    if (!block) return;
    hoveredBlock = block;

    // Don't pin empty blocks
    const blockText = hoveredBlock.textContent?.trim() || "";
    if (!blockText) return;

    const tag = hoveredBlock.tagName?.toLowerCase();

    // Auto-detect category
    // hoveredBlock is the top-level child of .ProseMirror. With BlockTitle's
    // NodeView in play, lists/blockquote/qa-block are wrapped in a div with
    // data-type set; so detection goes through data-type attribute first and
    // falls back to tag for the unwrapped types (table, raw paragraph paste).
    const dataType = hoveredBlock.getAttribute("data-type");
    const hasTable = tag === "table" || !!hoveredBlock.querySelector("table");
    // Unified list schema collapses taskList/bulletList/orderedList into one
    // "list" type; per-line marker is on the listItem. Legacy data-type names
    // are kept in the OR-chain so old DOM (e.g., from a stale render or
    // legacy paste) still classifies correctly.
    const isList = dataType === "list" || dataType === "taskList" || dataType === "bulletList" || dataType === "orderedList" || tag === "ul" || tag === "ol";
    const isQABlock = dataType === "qaBlock" || dataType === "qa-block";
    const isBlockquote = dataType === "blockquote" || tag === "blockquote";
    const isRecipeBlock = dataType === "recipe-block" || dataType === "recipeBlock";
    const isChart = dataType === "chart";
    const isCodeBlock = dataType === "code-block" || dataType === "codeBlock";
    // A Svelte NodeView's live DOM is the data-node-view-wrapper div, which
    // carries no data-type — so detect the attachment by its inner class
    // instead (data-type only exists in the serialized/parse HTML).
    const isAttachment = dataType === "attachment"
      || hoveredBlock?.classList?.contains?.("attachment-block")
      || !!hoveredBlock?.querySelector?.(".attachment-block");
    const isBoard = hasTable || isList || isQABlock || isBlockquote || isRecipeBlock || isChart || isCodeBlock;
    pinCategory = isAttachment ? "file" : (isBoard ? "board" : "note");
    pinNodePositions = [];

    // Find the top-level doc child position for this hovered DOM block.
    // hoveredBlock is always a direct child of .ProseMirror (see
    // handleEditorMouseMove), so this map is unambiguous.
    const proseMirror = editorEl?.querySelector(".ProseMirror");
    const childIndex = proseMirror ? Array.from(proseMirror.children).indexOf(hoveredBlock) : -1;
    let topLevelNode = null;
    let topLevelPos = -1;
    if (childIndex >= 0) {
      editor.state.doc.forEach((node, offset, index) => {
        if (index === childIndex) {
          topLevelNode = node;
          topLevelPos = offset;
        }
      });
    }

    // A line that is ONLY a file pins as a file. A line mixing text with an
    // inline file pins as a note (the whole line) — the file rides along in
    // the note's JSON and the modal shows text + file together. Both cases
    // capture JSON (below) so the inline file is never flattened to text.
    const isSoleAttachment = isAttachment && (
      topLevelNode?.type?.name === "attachment"
      || (topLevelNode?.childCount === 1 && topLevelNode?.firstChild?.type?.name === "attachment")
    );
    if (isAttachment) pinCategory = isSoleAttachment ? "file" : (isBoard ? "board" : "note");

    // Detect any pre-existing title BEFORE we serialize. Sources of truth in
    // priority order: PM attr (committed) → wrapper DOM attr (NodeView mirror)
    // → title slot textContent (user-typed but pre-debounce). If we serialize
    // before this commit, the captured JSON won't carry blockTitle and the
    // recovery in confirmPin has to patch it after the fact.
    // Title slot is an <input>; read its .value. Fall back to textContent
    // for non-NodeView render paths (e.g. tables, which use a CSS pseudo).
    const slotEl = hoveredBlock?.querySelector?.(".board-title-slot");
    const slotText = (slotEl?.value ?? slotEl?.textContent ?? "").trim();
    const existingTitle = isBoard
      ? (topLevelNode?.attrs?.blockTitle || hoveredBlock?.getAttribute?.("data-block-title") || slotText || "").trim()
      : "";

    // Force-commit the title to PM state up-front, so the snapshot below sees
    // the final attrs. Re-fetch the node from the post-dispatch doc — the old
    // `topLevelNode` reference still points at the pre-dispatch node value.
    if (isBoard && existingTitle && !topLevelNode?.attrs?.blockTitle && topLevelPos >= 0) {
      try {
        const tr = editor.state.tr.setNodeAttribute(topLevelPos, "blockTitle", existingTitle);
        editor.view.dispatch(tr);
        topLevelNode = editor.state.doc.nodeAt(topLevelPos);
      } catch {}
    }

    // Extract content. Attachments go through the same JSON-capturing path
    // as boards (the file IS the content — we must store the attachment node,
    // not its rendered text) even though they aren't "board" pins.
    if (isBoard || isAttachment) {
      if (!topLevelNode) {
        // Could not resolve a TipTap node for this DOM element. Bail out
        // rather than store raw HTML — the modal Editor cannot render HTML
        // and the pin would be permanently unrenderable.
        return;
      }
      const jsonContent = { type: "doc", content: [topLevelNode.toJSON()] };
      pinContent = JSON.stringify(jsonContent);
      pinNodePositions = [topLevelPos];

      // Prefer the block's inline-title slot value (data-block-title set by
      // the BlockTitle NodeView when the user filled the + title affordance).
      // Without this, pinning a titled board would still get an
      // auto-generated default that hides the user's intent.
      const userBlockTitle = hoveredBlock.getAttribute("data-block-title")?.trim();
      if (userBlockTitle) {
        pinDefaultTitle = userBlockTitle.slice(0, 50);
      } else if (hasTable) {
        const rows = hoveredBlock.querySelectorAll("tr");
        const cols = hoveredBlock.querySelectorAll("tr:first-child th, tr:first-child td");
        pinDefaultTitle = `table · ${rows.length}×${cols.length}`;
      } else if (isList) {
        // Type-derived label (tasks / numbered / list) matching the slash
        // command titles. Items show up in the snippet already, so the
        // title only needs to name the list flavor.
        const firstLi = hoveredBlock.querySelector("li");
        const marker = firstLi?.getAttribute("data-marker");
        if (marker === "task") pinDefaultTitle = "tasks";
        else if (marker === "ordered") pinDefaultTitle = "numbered";
        else pinDefaultTitle = "list";
      } else if (isQABlock) {
        const paragraphs = hoveredBlock.querySelectorAll("p");
        const q = paragraphs[0]?.textContent?.trim() || "Q:";
        const a = paragraphs[1]?.textContent?.trim() || "A:";
        pinDefaultTitle = `${q} / ${a}`.slice(0, 50);
      } else if (isBlockquote) {
        pinDefaultTitle = "outline";
      } else if (isSoleAttachment) {
        // Pure file line: title by the attachment's filename (the file is
        // inline, so dig it out of the wrapping paragraph).
        let fname = topLevelNode?.attrs?.filename || "";
        topLevelNode?.descendants?.((d) => {
          if (!fname && d.type?.name === "attachment") fname = d.attrs?.filename || "";
        });
        pinDefaultTitle = (fname || "file").slice(0, 50);
      } else if (isAttachment) {
        // Mixed line (text + inline file): title from the line's text only
        // (textContent skips the atom, so the chip label doesn't leak in).
        pinDefaultTitle = (topLevelNode?.textContent?.trim() || "note").slice(0, 50);
      } else {
        pinDefaultTitle = blockText.slice(0, 30) || "board";
      }
    } else {
      pinContent = blockText;
      pinDefaultTitle = pinContent.slice(0, 50);
      if (topLevelPos >= 0) pinNodePositions = [topLevelPos];
    }

    if (!pinContent) return;

    // Don't pin already-pinned content
    try {
      const existing = await getPins(lineageId || null);
      const isDuplicate = existing.some(p => p.content === pinContent);
      if (isDuplicate) return;
    } catch {}

    pinBlockEl = hoveredBlock;

    // If the block already carries (or just committed) a blockTitle, pin
    // silently with that title — no need to show the popup.
    if (isBoard && existingTitle) {
      await confirmPin(existingTitle);
      return;
    }

    // Position popup near the block
    const rect = hoveredBlock.getBoundingClientRect();
    pinPopupPosition = { top: rect.top + rect.height + 4, left: rect.left };
    showPinPopup = true;
  }

  /**
   * Quick-pin (E.1): one-keystroke capture. Triggered by Cmd/Ctrl+P. Uses
   * the current selection if any; otherwise the block under cursor. Skips
   * the title popup — title is auto-derived from selection text or the
   * block's existing blockTitle. Surfaces a brief toast confirmation.
   *
   * Intentionally a thin wrapper around the existing handlePinSelection /
   * handlePinBlock setup paths so the pin row/cache shape stays identical
   * to mouse-flow pins.
   */
  let quickPinToast = $state(null);
  let quickPinToastTimer = null;
  function showQuickPinToast(label) {
    quickPinToast = label;
    if (quickPinToastTimer) clearTimeout(quickPinToastTimer);
    quickPinToastTimer = setTimeout(() => { quickPinToast = null; }, 1600);
  }

  // Generic editor toast (T15) — used by the slash module (and any other
  // editor-internal helper) to surface short error/info messages. Bottom-
  // centre placement so it doesn't collide with quick-pin-toast (bottom-
  // right). Exposed on editorEl below so the slash module can find it
  // without prop drilling.
  let toastMessage = $state(null);
  let toastTimer = null;
  function showToast(msg) {
    toastMessage = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastMessage = null; }, 3000);
  }

  $effect(() => {
    if (!editorEl) return;
    editorEl.__shizumuShowToast = showToast;
    return () => {
      if (editorEl) delete editorEl.__shizumuShowToast;
    };
  });

  // First-tap mobile gestures hint. Coarse-pointer only — desktop users
  // see the keyboard shortcuts in the slash menu and don't need this.
  // Persisted via mobile_gestures_tip_seen so the toast fires once per
  // device, then stays out of the way.
  let mobileHintChecked = false;
  async function maybeShowMobileGesturesHint() {
    if (mobileHintChecked || readonly) return;
    mobileHintChecked = true;
    try {
      if (!isCoarsePointer()) return;
      let seen = false;
      try { seen = (await getSetting("mobile_gestures_tip_seen")) === "true"; } catch {}
      if (seen) return;
      // Describes what the gesture does NOW. It used to say "swipe from the
      // right edge for a new page", which was accurate only because
      // navigateNext created one at the end of the rail — the bug that made
      // every right-swipe on a single-page day spawn a page. The gesture
      // navigates and no longer creates. It also used to say "long-press a
      // block for actions" — long-press now only starts a reorder drag; a
      // tap reaches a block's controls instead (its chip for a board, or
      // the block itself for a plain paragraph/heading), since a
      // long-press is Android's own text-selection gesture.
      showToast("tip — tap a block for its controls. swipe from either edge to move between pages.");
      try { await setSetting("mobile_gestures_tip_seen", "true"); } catch {}
    } catch {}
  }

  async function quickPinFromCursor() {
    if (!editor) return;
    const sel = editor.state.selection;
    const { from, to, empty } = sel;
    const fromResolved = sel.$from;

    let title = "";
    if (!empty) {
      // Pin the selection — same path as the mouse-flow selection-pin.
      await handlePinSelection();
      // handlePinSelection sets pinContent + pinCategory + pinNodePositions
      // and would show the popup. Override by deriving a title and calling
      // confirmPin directly.
      if (!showPinPopup) return; // duplicate detected; nothing to do
      const slice = editor.state.doc.slice(from, to);
      const selText = slice.content.textBetween(0, slice.content.size, " ").trim();
      title = (selText || pinDefaultTitle || "").slice(0, 60);
    } else {
      // Pin the block at cursor.
      const depth = fromResolved.depth;
      if (depth < 1) {
        showQuickPinToast("nothing to pin");
        return;
      }
      const blockNode = fromResolved.node(1);
      const blockPos = fromResolved.before(1);
      if (!blockNode) {
        showQuickPinToast("nothing to pin");
        return;
      }
      // A file is schema-inline now, so it lives inside a paragraph. Treat a
      // paragraph whose sole child is an attachment (or a bare attachment) as
      // a file pin.
      const attachmentNode = blockNode.type.name === "attachment"
        ? blockNode
        : (blockNode.childCount === 1 && blockNode.firstChild?.type.name === "attachment"
            ? blockNode.firstChild
            : null);
      const isAttachment = !!attachmentNode;
      const isBoardNode = isBoardType(blockNode.type.name);
      const existingTitle = (blockNode.attrs?.blockTitle || "").trim();
      const textPreview = blockNode.textContent?.trim() || "";
      // Refuse to pin emptiness. Attachments are pinnable even without text
      // (the file IS the content). Boards with a blockTitle but no body
      // are also keepers — the title carries meaning. Everything else
      // needs visible content; pinning a blank paragraph produces an
      // 'untitled' card that says nothing.
      if (!isAttachment && !existingTitle && !textPreview) {
        showQuickPinToast("nothing to pin");
        return;
      }
      pinCategory = isAttachment ? "file" : (isBoardNode ? "board" : "note");
      pinNodePositions = [blockPos];
      const blockJson = blockNode.toJSON();
      pinContent = JSON.stringify({ type: "doc", content: [blockJson] });
      title = isAttachment
        ? (existingTitle || attachmentNode.attrs?.filename || "file").slice(0, 60)
        : (existingTitle || textPreview.slice(0, 60) || "untitled");
      pinDefaultTitle = title;

      // Skip duplicates same as the slow paths.
      try {
        const existing = await getPins(lineageId || null);
        if (existing.some((p) => p.content === pinContent)) {
          showQuickPinToast("already pinned");
          return;
        }
      } catch {}
    }

    showPinPopup = false; // ensure popup never shows for quick path
    pinBlockEl = null;
    await confirmPin(title);
    showQuickPinToast(`pinned · ${title.slice(0, 40)}${title.length > 40 ? "…" : ""}`);
  }

  async function confirmPin(title) {
    showPinPopup = false;
    if (!pinContent) return;

    const positions = pinNodePositions;
    pinNodePositions = [];

    try {
      const newPin = await createPin(lineageId || null, pageId, pinCategory, pinContent, title);
      // Stamp the pin's id onto the source node(s) so future syncs find them
      // deterministically, regardless of how the content gets edited.
      if (newPin?.id && positions.length > 0 && editor) {
        try {
          const tr = editor.state.tr;
          for (const pos of positions) {
            const node = editor.state.doc.nodeAt(pos);
            if (node && node.type.spec.attrs && "pinId" in node.type.spec.attrs) {
              tr.setNodeAttribute(pos, "pinId", newPin.id);
            }
            // Boards also receive the chosen title as their blockTitle metadata.
            if (node && isBoardType(node.type.name) && title) {
              tr.setNodeAttribute(pos, "blockTitle", title);
            }
          }
          if (tr.docChanged) {
            editor.view.dispatch(tr);
            // Re-serialize with pinId attribute now embedded so the stored
            // snapshot matches what the editor would produce on next sync.
            if (pinCategory !== "note") {
              const updatedNodes = positions.map((pos) => {
                const n = editor.state.doc.nodeAt(pos);
                return n ? n.toJSON() : null;
              }).filter(Boolean);
              if (updatedNodes.length > 0) {
                const updatedJson = JSON.stringify({ type: "doc", content: updatedNodes });
                pinContent = updatedJson;
                try { await updatePinContent(newPin.id, updatedJson, title); } catch {}
              }
            }
          }
        } catch (err) {
          console.error("Failed to stamp pinId on source node:", err);
        }
      }
      // Visual feedback
      if (pinBlockEl) {
        pinBlockEl.style.transition = "background 300ms ease";
        pinBlockEl.style.background = "var(--warm-accent-soft, rgba(196,77,40,0.1))";
        setTimeout(() => { if (pinBlockEl) pinBlockEl.style.background = ""; }, 800);
      }
      existingPinContents = new Set([...existingPinContents, pinContent]);
      // The pinId now lives only in the live doc. refresh_pin_caches orphans
      // any open pin whose id is not in the SAVED content_json, so unless we
      // persist now, an unmount before the 1s debounce leaves the pin
      // orphaned (dimmed, "like deleted") on the next launch. Persist the
      // stamp synchronously so creation is durable, then tell the panel.
      await flushSave();
      onPinCreated();
    } catch (err) {
      console.error("Failed to pin block:", err);
    }
  }

  export function getEditor() {
    return editor;
  }

  /// The editor's own scroll container (`.tiptap-wrapper`) — exposed so
  /// Page.svelte's swipe-up-to-memory flick can check whether the canvas
  /// is scrolled to its bottom boundary before arming (gesture-arming.js).
  export function getScrollEl() {
    return wrapperEl;
  }

  /// Replace the editor's content with a fresh JSON doc, preserving the
  /// user's cursor when possible. Called from Page.svelte when a sync
  /// pull updates the content_json of the currently-open page.
  ///
  /// Always reloads — even if focused — but preserves cursor position
  /// and selection. Skipping while focused led to data loss: the user
  /// would click a block (triggering onBlur → pruneAllEmptyHeadings →
  /// transaction → debouncedSave) with the editor's stale content,
  /// which then overwrote the remote update on the next sync.
  export function reloadFromContent(newJson) {
    if (!editor || editor.isDestroyed) return;
    try {
      const parsed = typeof newJson === "string" ? JSON.parse(newJson) : newJson;
      if (!parsed) return;
      const current = JSON.stringify(editor.getJSON());
      const incoming = JSON.stringify(parsed);
      if (current === incoming) return;
      const wasFocused = editor.isFocused;
      const { from, to } = editor.state.selection;
      // emitUpdate: false → don't fire onUpdate, so this load doesn't
      // trigger a save (which would echo the remote content right back
      // through the op_log and into another sync round-trip).
      editor.commands.setContent(parsed, false);
      // Restore cursor position if the doc is still long enough. Falls
      // back to end-of-doc if the new content is shorter.
      try {
        const docSize = editor.state.doc.content.size;
        const safeFrom = Math.min(from, docSize);
        const safeTo = Math.min(to, docSize);
        editor.commands.setTextSelection({ from: safeFrom, to: safeTo });
      } catch {}
      if (wasFocused) {
        editor.commands.focus();
      }
    } catch (err) {
      console.warn("reloadFromContent failed:", err);
    }
  }

  export function focusInput() {
    if (!editor) return;
    // Defer one frame so any in-flight readonly→editable prop change has
    // propagated before we claim focus. Without this, focusing right after
    // the writing gate lifts can fail because editable was still false.
    requestAnimationFrame(() => {
      if (editor && !editor.isDestroyed) editor.commands.focus("end");
    });
  }

  export function getWordCount() {
    return wordCount;
  }

  /**
   * Append a list of node JSONs to the end of the doc in a single transaction.
   * Shared by both the carry-forward auto-inject path (called from Page.svelte
   * after a discrete trail is assigned for the first time) and the manual
   * inject button on the pin panel. Inserted nodes deliberately do NOT carry
   * pinId — they are independent copies of the source pin's content.
   *
   * Skips any incoming node whose stripped-JSON shape already matches a
   * top-level node in the doc — prevents the "pin appears duplicated after
   * navigate-and-return" failure where an injected copy lands next to its
   * original (still pinId-stamped) source block.
   */
  export function appendNodesToDoc(nodes) {
    if (!editor || !Array.isArray(nodes) || nodes.length === 0) return;

    // Snapshot existing top-level nodes' shape (pinId-agnostic).
    const existingKeys = new Set();
    editor.state.doc.forEach((node) => {
      try {
        existingKeys.add(JSON.stringify(stripPinIdsFromJSON(node.toJSON())));
      } catch {}
    });

    const built = [];
    for (const json of nodes) {
      try {
        // Compare shapes WITHOUT pinIds so the same content is not injected
        // twice, but insert the node WITH its pinId. Inserting the stripped
        // copy is what made an injected pin inert: it looked identical and
        // carried no link, so editing it changed the page and never the pin.
        // With the id intact, the save path's refresh_pin_caches recognises
        // the node and the page that holds it becomes the pin's owner.
        const stripped = stripPinIdsFromJSON(json);
        const key = JSON.stringify(stripped);
        if (existingKeys.has(key)) continue;
        built.push(editor.state.schema.nodeFromJSON(json));
        existingKeys.add(key);
      } catch (err) {
        console.error("appendNodesToDoc: skipping invalid node", err);
      }
    }
    if (built.length === 0) return;
    const end = editor.state.doc.content.size;
    const tr = editor.state.tr.insert(end, built);
    editor.view.dispatch(tr);
  }

  /**
   * Sum text-content length across the doc, skipping dayMarker atoms.
   * dayMarkers are decorator metadata, not prose.
   */
  function countWordsExcludingMarkers(ed) {
    let text = "";
    ed.state.doc.descendants((node) => {
      if (node.type.name === "dayMarker") return false;
      if (node.isText) text += node.text + " ";
      return true;
    });
    return text.split(/\s+/).filter(Boolean).length;
  }

  /**
   * Returns the list of dayMarker nodes in the doc, earliest-first.
   * Used by the TrailIndex (Cmd+K) palette.
   */
  export function getDayMarkers() {
    if (!editor) return [];
    const markers = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "dayMarker") {
        markers.push({
          pos,
          date: node.attrs.date || "",
          whatMatters: node.attrs.whatMatters || "",
        });
        return false;
      }
      return true;
    });
    return markers;
  }

  /** Scroll the editor viewport to the dayMarker whose date matches. */
  export function scrollToDate(date) {
    if (!editor) return;
    const markers = getDayMarkers();
    const match = markers.find((m) => m.date === date);
    if (!match) return;
    editor.commands.focus();
    editor.commands.setTextSelection(match.pos + 1);
    editor.commands.scrollIntoView();
  }

  /**
   * Insert today's dayMarker, or update an existing one in place.
   *
   * - If a marker with the same `date` already exists: update its
   *   `whatMatters` attr to the supplied value (no-op if unchanged).
   *   Cursor position is left alone.
   * - Otherwise, insert a new dayMarker followed by an empty paragraph.
   *   Position logic is in chooseMarkerInsertPosition (module-level export).
   *   Cursor moves into the empty paragraph after the new marker so the
   *   user can immediately type today's content.
   *
   * Idempotency: calling this with the same (date, whatMatters) pair after
   * a marker exists is a no-op. Calling with a new whatMatters updates in place.
   */
  export function stampDayMarker(date, whatMatters) {
    if (!editor) return;
    const desired = whatMatters || "";
    const markers = getDayMarkers();
    const existing = markers.find((m) => m.date === date);
    if (existing) {
      if ((existing.whatMatters || "") === desired) return;
      editor
        .chain()
        .command(({ tr }) => {
          const node = tr.doc.nodeAt(existing.pos);
          if (!node) return false;
          tr.setNodeMarkup(existing.pos, undefined, { date, whatMatters: desired });
          return true;
        })
        .run();
      return;
    }

    const docSize = editor.state.doc.content.size;
    const insertPos = chooseMarkerInsertPosition({
      markersExist: markers.length > 0,
      docSize,
    });
    editor
      .chain()
      .focus()
      .insertContentAt(insertPos, [
        { type: "dayMarker", attrs: { date, whatMatters: desired } },
        { type: "paragraph" },
      ])
      .run();
    // Move cursor into the new paragraph (right after the inserted marker).
    // The marker is one node + the paragraph that follows; cursor lands
    // at the start of the paragraph.
    editor.commands.setTextSelection(insertPos + 2);
  }

  /** Returns true if a dayMarker for the given date exists in the doc. */
  export function hasDayMarker(date) {
    return getDayMarkers().some((m) => m.date === date);
  }

  export function invalidatePinContent(content) {
    existingPinContents = new Set([...existingPinContents].filter(c => c !== content));
  }

  /**
   * Replace the node carrying the given pinId with newNodeJson. Called by the
   * pin modal's save path for SAME-PAGE pins: the modal's serialized content
   * (which still carries the pinId attr) is spliced into the main editor's
   * doc in a single PM transaction. The editor's onUpdate fires, debouncedSave
   * kicks in, save_page_content runs in Rust, and refresh_pin_caches updates
   * the pin row's content/title cache.
   * Returns true on success, false if the pinId is not found in the doc.
   */
  export function spliceNodeAtPinId(pinId, newNodeJson) {
    if (!editor || !pinId || !newNodeJson) return false;
    let firstPos = null;
    let lastEnd = null;
    editor.state.doc.descendants((node, pos) => {
      if (firstPos !== null) return false;
      if (node.attrs?.pinId === pinId) {
        firstPos = pos;
        lastEnd = pos + node.nodeSize;
        return false;
      }
      return true;
    });
    if (firstPos === null) return false;
    try {
      const newNode = editor.state.schema.nodeFromJSON(newNodeJson);
      const tr = editor.state.tr.replaceWith(firstPos, lastEnd, newNode);
      editor.view.dispatch(tr);
      return true;
    } catch (err) {
      console.error("spliceNodeAtPinId failed:", err);
      return false;
    }
  }

  /**
   * Scroll the editor to the node carrying the given pinId attribute and
   * briefly flash a highlight so the user can see where the pin lives.
   * No-op if the editor is not mounted or the pinId is not found in the doc.
   * Called by the pin panel when the user clicks a pin card (Issue 2).
   */
  export function scrollToPinId(pinId) {
    if (!editor || !pinId) return;
    const matches = collectNodesByPinId(pinId);
    if (matches.length === 0) return;
    const { pos } = matches[0];
    // Place selection at the start of the node so PM scrolls to it.
    try {
      const tr = editor.state.tr.setSelection(
        TextSelection.near(editor.state.doc.resolve(pos + 1))
      );
      editor.view.dispatch(tr);
      editor.commands.scrollIntoView();
    } catch {}
    // Visual flash: find the DOM node and apply a brief background tint.
    try {
      const domNode = editor.view.nodeDOM(pos);
      if (domNode instanceof HTMLElement) {
        domNode.style.transition = "background 250ms ease";
        domNode.style.background = "var(--warm-accent-soft, rgba(196,77,40,0.12))";
        setTimeout(() => {
          if (domNode) {
            domNode.style.background = "";
            setTimeout(() => { if (domNode) domNode.style.transition = ""; }, 300);
          }
        }, 700);
      }
    } catch {}
  }

  // Walk the editor doc looking for a pending pageRef (targetId === "")
  // whose labelSnapshot matches `label`, and rewrite its targetId to the
  // newly-created page id. Called by the @-mention create-* flow after
  // the host has provisioned the new lineage and page so the source
  // page retains a real reference when the user comes back.
  export async function linkPendingPageRef(label, newPageId) {
    if (!editor || !newPageId) return false;
    const target = (label || "").trim();
    if (!target) return false;
    let updated = false;
    try {
      const tr = editor.state.tr;
      editor.state.doc.descendants((node, pos) => {
        if (updated) return false;
        if (node.type.name === "pageRef"
            && (!node.attrs?.targetId)
            && (node.attrs?.labelSnapshot || "").trim() === target) {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, targetId: newPageId });
          updated = true;
          return false;
        }
        return true;
      });
      if (updated) {
        editor.view.dispatch(tr);
        // Force-flush the debounced save so the back-reference persists
        // before the host navigates away to the new page.
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
        try {
          pruneAllEmptyHeadings(editor, { preserveCursor: false });
          const json = JSON.stringify(editor.getJSON());
          const yjsBytes = yjsDoc ? encodeState(yjsDoc) : null;
          if (isTrailMode && trailLineageId) {
            await saveTrailContent(trailLineageId, pageId, json);
          } else {
            await savePageContent(pageId, json, yjsBytes);
          }
        } catch (err) {
          console.error("Failed to flush save after linkPendingPageRef:", err);
        }
      }
    } catch (err) {
      // Don't let a bad walk crash the create flow.
      console.error("linkPendingPageRef walk failed:", err);
    }
    return updated;
  }

</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="tiptap-wrapper"
  bind:this={wrapperEl}
  onmousemove={handleEditorMouseMove}
  onmouseleave={handleEditorMouseLeave}
  onpointerdown={handleEditorPointerDown}
  onpointermove={handleEditorPointerMove}
  onpointerup={handleEditorPointerUp}
  onpointercancel={handleEditorPointerUp}
>
  <!-- Block handles: + (insert), T (title for untitled boards), ↗ (pin), ⎘ (copy), × (delete) -->
  {#if handleVisible && !selectionPinVisible && (handleHasContent || (!readonly && (handleShowPlus || handleIsBoard)))}
    <div
      class="block-handles"
      style="top: {handleTop}px;"
      onmouseenter={() => handleVisible = true}
    >
      {#if !readonly && handleShowPlus && !handleHasContent}
        <button class="block-handle" data-label="insert" onclick={handleBlockHandleClick} aria-label="add block">+</button>
      {/if}
      {#if handleHasContent}
        <button class="block-handle pin-handle" data-label="pin" class:already-pinned={blockAlreadyPinned} onclick={handlePinBlock} aria-label="pin block">↗</button>
      {/if}
      {#if handleHasContent && !readonly}
        <button class="block-handle copy-handle" data-label="copy" onclick={handleCopyBlock} aria-label="copy block">⎘</button>
      {/if}
      {#if (handleHasContent || handleIsBoard) && !readonly}
        <button class="block-handle del-handle" data-label="delete" onclick={handleDeleteBlock} aria-label="delete block">×</button>
      {/if}
    </div>
  {/if}

  {#if selectionPinVisible && !readonly && !showPinPopup}
    <button
      class="selection-pin-btn"
      style="top: {selectionPinPosition.top}px; left: {selectionPinPosition.left}px;"
      onclick={handlePinSelection}
      aria-label="pin selection"
    >↗</button>
  {/if}

  <!-- Touch block-actions sheet — replaces .block-handles on touch. Opened
       by tapping the block's chip/synthetic handle (see
       handleBlockActionsEvent / openBlockActionSheet), not a long-press. -->
  <BottomSheet open={blockActionSheetOpen} onClose={closeBlockActionSheet} title="block">
    <div class="block-action-sheet">
      {#each blockActionSheetActions as id (id)}
        <button
          type="button"
          class="block-action-row"
          class:danger={id === "delete"}
          onclick={() => runBlockAction(id)}
        >
          <span class="block-action-glyph" aria-hidden="true">{BLOCK_ACTION_GLYPHS[id]}</span>
          <span class="block-action-label">{BLOCK_ACTION_LABELS[id]}</span>
        </button>
      {/each}
    </div>
  </BottomSheet>

  <FindBar
    editor={editor}
    open={findBarOpen}
    mode={findBarMode}
    onClose={() => (findBarOpen = false)}
  />

  <ChartBuilder
    builderState={chartBuilderState}
    onSave={(attrs) => {
      const s = chartBuilderState;
      chartBuilderState = null;
      if (!s || !editor) return;
      if (s.mode === "edit" && typeof s.pos === "number") {
        editor.commands.updateChart({ pos: s.pos, attrs });
      } else {
        editor.commands.insertChart({ attrs });
      }
    }}
    onCancel={() => (chartBuilderState = null)}
  />

  <div bind:this={editorEl} class="tiptap-editor prose"></div>

  <!-- Quick-pin toast (E.1) — brief confirmation after Cmd/Ctrl+P -->
  {#if quickPinToast}
    <div class="quick-pin-toast" transition:fade={{ duration: 180 }}>{quickPinToast}</div>
  {/if}

  <!-- Generic editor toast (T15) — slash-command errors etc. -->
  <EditorToast message={toastMessage} />

  <!-- Pin popup -->
  {#if showPinPopup}
    <SharePopup
      category={pinCategory}
      defaultTitle={pinDefaultTitle}
      position={pinPopupPosition}
      onShare={confirmPin}
      onDismiss={() => showPinPopup = false}
    />
  {/if}

  <!-- Table toolbar -->
  {#if tableActive && !readonly}
    <div
      class="table-toolbar"
      style="top: {tableRect.bottom + 4}px; left: {tableRect.left}px; width: {tableRect.width}px;"
    >
      <button class="table-btn label" onmousedown={(e) => e.preventDefault()} onclick={addTableRow}>+ row</button>
      <button class="table-btn label" onmousedown={(e) => e.preventDefault()} onclick={addTableColumn}>+ column</button>
    </div>
  {/if}

  <!-- Click-to-preview image modal — native <dialog> so it lives in the
       browser top layer, above any stacking context. ESC closes by default;
       backdrop click closes via target check (target === dialog only when
       the click landed on the backdrop, not on the inner <img>). -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <dialog
    bind:this={imageDialogEl}
    class="image-preview-modal"
    onclose={() => previewSrc = null}
    onclick={(e) => { if (e.target === imageDialogEl) imageDialogEl.close(); }}
  >
    {#if previewSrc}<img src={previewSrc} alt="" />{/if}
  </dialog>

  <!-- Bubble menu: inline styling on text selection -->
  {#if bubbleMenuVisible && !readonly}
    <div
      class="bubble-menu two-tier"
      class:flipped={bubbleMenuPosition.flipped}
      data-tick={bubbleRenderTick}
      style="top: {bubbleMenuPosition.top}px; left: {bubbleMenuPosition.left}px;"
      bind:this={bubbleEl}
    >
      {#if bubbleMode === "link-input"}
        <div class="bubble-link-row">
          <input
            class="bubble-link-input"
            type="text"
            bind:value={linkInputValue}
            placeholder="paste or type url"
            onkeydown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); confirmLink(); }
              else if (e.key === "Escape") { e.preventDefault(); cancelLink(); }
            }}
          />
          <button class="bubble-btn mono" onmousedown={(e) => e.preventDefault()} onclick={confirmLink}>↵</button>
          <button class="bubble-btn mono" onmousedown={(e) => e.preventDefault()} onclick={cancelLink}>×</button>
        </div>
      {:else}
        <div class="bubble-rows">
          <div class="bubble-row">
            <button class="bubble-btn" class:active={editor?.isActive("bold")} onmousedown={(e) => e.preventDefault()} onclick={() => { editor?.chain().focus().toggleBold().run(); syncBlockHandleToSelection(); bumpBubbleTick(); }} title="bold"><strong>B</strong></button>
            <button class="bubble-btn" class:active={editor?.isActive("italic")} onmousedown={(e) => e.preventDefault()} onclick={() => { editor?.chain().focus().toggleItalic().run(); syncBlockHandleToSelection(); bumpBubbleTick(); }} title="italic"><em>I</em></button>
            <button class="bubble-btn" class:active={editor?.isActive("strike")} onmousedown={(e) => e.preventDefault()} onclick={() => { editor?.chain().focus().toggleStrike().run(); syncBlockHandleToSelection(); bumpBubbleTick(); }} title="strike"><s>S</s></button>
            <button class="bubble-btn mono" class:active={editor?.isActive("code")} onmousedown={(e) => e.preventDefault()} onclick={() => { editor?.chain().focus().toggleCode().run(); syncBlockHandleToSelection(); bumpBubbleTick(); }} title="inline code">‹›</button>
            <button class="bubble-btn mono" class:active={editor?.isActive("link")} onmousedown={(e) => e.preventDefault()} onclick={openLinkInput} title="link">🔗</button>
            <button class="bubble-btn bubble-btn-pin" onmousedown={(e) => e.preventDefault()} onclick={() => { handlePinSelection(); bumpBubbleTick(); }} title="pin selection">↗</button>
            <button class="bubble-btn mono" onmousedown={(e) => e.preventDefault()} onclick={() => {
              const chain = editor?.chain().focus().unsetAllMarks();
              if (chain && editor?.isActive("heading")) chain.setNode("paragraph");
              chain?.run();
              syncBlockHandleToSelection();
              bumpBubbleTick();
            }} title="clear formatting">⌫</button>
          </div>
          {#if bubbleShowBottomRow()}
            <div class="bubble-row bubble-row-bottom">
              <button class="bubble-btn mono" class:active={editor?.isActive("heading", { level: 1 })} onmousedown={(e) => e.preventDefault()} onclick={() => { editor?.chain().focus().toggleHeading({ level: 1 }).run(); syncBlockHandleToSelection(); bumpBubbleTick(); }} title="heading 1">h1</button>
              <button class="bubble-btn mono" class:active={editor?.isActive("heading", { level: 2 })} onmousedown={(e) => e.preventDefault()} onclick={() => { editor?.chain().focus().toggleHeading({ level: 2 }).run(); syncBlockHandleToSelection(); bumpBubbleTick(); }} title="heading 2">h2</button>
              <button class="bubble-btn mono" class:active={editor?.isActive("heading", { level: 3 })} onmousedown={(e) => e.preventDefault()} onclick={() => { editor?.chain().focus().toggleHeading({ level: 3 }).run(); syncBlockHandleToSelection(); bumpBubbleTick(); }} title="heading 3">h3</button>
              <button class="bubble-btn mono" class:active={editor?.isActive("blockquote")} onmousedown={(e) => e.preventDefault()} onclick={() => { editor?.chain().focus().toggleBlockquote().run(); syncBlockHandleToSelection(); bumpBubbleTick(); }} title="blockquote">&gt;</button>
              <button class="bubble-btn mono" class:active={editor?.isActive("listItem", { marker: "bullet" })} onmousedown={(e) => e.preventDefault()} onclick={() => toggleMarker("bullet")} title="bullet list">-</button>
              <button class="bubble-btn mono" class:active={editor?.isActive("listItem", { marker: "ordered" })} onmousedown={(e) => e.preventDefault()} onclick={() => toggleMarker("ordered")} title="ordered list">1.</button>
              <button class="bubble-btn mono" class:active={editor?.isActive("listItem", { marker: "task" })} onmousedown={(e) => e.preventDefault()} onclick={() => toggleMarker("task")} title="task list">[ ]</button>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .tiptap-wrapper {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: none;
    scrollbar-color: transparent transparent;
    position: relative;
    /* Gutter for the block-handles column, which sits inside it — on
       EVERY viewport, phone included.

       This used to be reclaimed below 480px / on any coarse pointer /
       short-landscape (see history in this repo before the mobile-
       stability sweep): the handles moved instead to a bar that floated
       clear of the block, above or below it. That bar is gone now —
       restored here, because every phone chrome-collision bug this
       project chased traced back to the same root cause: touch had no
       gutter, so its controls had nowhere to live that wasn't on top of
       the text. The touch caret handle (touch-block-handle.js) renders
       into this same 32px column now, same as the desktop hover column
       below — one gutter, one place for block controls to sit, on every
       device.

       The accepted trade: on a narrow phone this is 32px of writing width
       spent on the gutter, asymmetric against the 16px right margin. That
       asymmetry is the accepted cost — colliding chrome was a functional
       bug, the reclaimed width was only ever cosmetic.

       Gutter-polish pass: 32px was sized to the DESKTOP column (a 30px
       touch target plus its 1px border each side), never to what a phone
       actually needs — a phone-width override below narrows it to the
       handle plus breathing room instead. Scoped by viewport WIDTH, not
       `pointer: coarse`: a touchscreen laptop is coarse-pointer too but
       desktop-width, and must keep this 32px value, not the phone one. */
    padding-left: 32px;
  }

  /* Phone-width gutter: sized to the handle it holds, not to desktop's
     column. Not pointer-scoped — see the comment above. rem-based so it
     tracks --ui-scale's phone default (0.875, global.css, same
     breakpoint) rather than freezing at a pixel value picked for scale 1. */
  @media (max-width: 480px) {
    .tiptap-wrapper {
      padding-left: 1.5rem;
    }
  }

  .tiptap-wrapper::-webkit-scrollbar {
    display: none;
    width: 0;
    height: 0;
  }

  /* Block in long-press drag mode (touch only) — subtle elevation cue
     without ripping the block out of its layout slot. The block stays
     in place; subsequent moveUnit() swaps actually reorder the doc as
     the user drags past 32px thresholds. */
  .tiptap-editor :global(.ProseMirror > .block-dragging) {
    background: color-mix(in srgb, var(--warm-accent) 8%, transparent);
    box-shadow: 0 0.25rem 1rem var(--card-shadow);
    border-radius: 0.375rem;
    transform: scale(1.005);
    transition: transform var(--motion-fast),
                background var(--motion-fast);
  }

  /* Block handles — inside the 32px left padding, left of text.
     No padding/border trick expands the hit area beyond this box (unlike
     the board-title-slot's D-6 history) — `display: flex` sizes the
     container to exactly its visible content + padding + border, so it
     never claims pointer-events over text it isn't visibly covering. */
  .block-handles {
    position: absolute;
    left: 2px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    z-index: 5;
    background: var(--surface);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-lg);
    /* Tight and faint, deliberately. This column is ~20px wide; the old
       `0 0.5rem 1.5rem var(--card-shadow-hover)` cast an 8px-offset, 24px-blur
       shadow — larger than the control itself — which pooled under the chip
       and read as a grey smudge on the cream canvas rather than as lift. A
       control this small only needs enough separation to sit above the text,
       and the hairline border is already doing most of that work. */
    box-shadow: 0 1px 4px var(--card-shadow);
  }


  .block-handle {
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    cursor: pointer;
    font-family: "Inter", sans-serif;
    font-size: 12px;
    font-weight: 400;
    color: var(--ink);
    opacity: 0.7;
    border-radius: 4px;
    transition: opacity var(--motion-fast), background var(--motion-fast);
    padding: 0;
    line-height: 1;
  }

  .block-handle:hover {
    opacity: 1;
    background: color-mix(in srgb, var(--ink) 5%, transparent);
  }

  .block-handle:active {
    background: color-mix(in srgb, var(--warm-accent) 12%, transparent);
  }

  .block-handle:focus-visible {
    outline: 2px solid var(--warm-accent);
    outline-offset: 2px;
  }

  /* Phone: keep the glyphs visually small (no chip background, no
     border) but extend the touch target for a comfortable tap. Stronger
     opacity so the icon reads clearly without becoming chrome. The
     column itself sits in the gutter on phone now (no more `.floating`
     bar variant — see .tiptap-wrapper above for why), so its width is
     capped to fit flush inside that 32px gutter rather than bleeding
     into the text next to it. */
  @media (pointer: coarse) {
    /* The gutter is 32px; .block-handles normally sits at `left: 2px`
       with a 1px border each side, leaving 28px for a 20px desktop
       button — plenty of slack. A touch target this size needs every
       spare pixel, so both get pulled to the gutter's own edges here:
       `left: 0` (below) and 1.875rem (30px) content width, so
       0 + 1px border + 30px + 1px border = 32px exactly — flush with the
       gutter, never past it into text. 30px is the floor: shrinking
       further to reclaim space is how a control becomes hard to hit for
       anyone whose aim is less than perfect. */
    .block-handles {
      left: 0;
    }
    .block-handle {
      width: 1.875rem;
      height: 1.875rem;
      padding: 0;
      font-size: 0.8125rem;
      opacity: 0.75;
      background: none;
      border: none;
    }
    .block-handle:active {
      opacity: 1;
      background: color-mix(in srgb, var(--ink) 8%, transparent);
    }
    .pin-handle,
    .pin-handle:hover {
      color: var(--warm-accent);
      opacity: 0.85;
      background: none;
    }
    .pin-handle:active {
      background: color-mix(in srgb, var(--warm-accent) 12%, transparent);
    }
    .pin-handle.already-pinned {
      opacity: 0.3;
    }
    /* Hover-tooltip is mouse-only; suppress on coarse pointers. */
    .block-handle[data-label]:hover::before,
    .block-handle[data-label]:hover::after {
      display: none;
    }
  }

  .pin-handle {
    font-size: 12px;
    color: var(--warm-accent);
  }

  .pin-handle:hover {
    opacity: 0.8;
    background: var(--warm-accent-soft, rgba(196,77,40,0.08));
  }

  .pin-handle.already-pinned {
    opacity: 0.15;
  }

  /* Phone-width column sizing — its own numbers, not desktop's shrunk down.
     Not pointer-scoped, same reasoning as .tiptap-wrapper's phone override
     above: a touchscreen laptop keeps the 30px `pointer: coarse` sizing
     from the block above, since it's desktop-width. This layer only fires
     under 480px, where the gutter itself has already narrowed to 1.5rem.
     Placed after every other .block-handle/.pin-handle rule in this file
     so it wins the cascade at equal specificity — a media query adds no
     specificity of its own, only source order does.

     rem throughout so the glyph and the surrounding rhythm track
     --ui-scale's phone default (0.875) together, rather than a pixel size
     that was right at scale 1 and merely happens to still fit at 0.875.
     The visible card (.block-handles' own background/border/shadow, set
     above) shrinks to whatever its children measure — sizing the BUTTON
     narrower here is what keeps that card inside the narrower gutter,
     clear of the text column that starts right after it.

     Tap targets stay generous through padding, not box width: the glyph
     itself is small and the row spacing is tight (both deliberately, so
     three stacked controls next to phone-sized type don't sprawl), but
     each button's own vertical padding — not layout gap — is what a
     finger actually has to land in. */
  @media (max-width: 480px) {
    /* Centred in the gutter, not flush against the text.
       The column was `left: 0` with a 1.25rem button — 19.5px of card
       (button + 1px border each side) inside a 21px gutter, so it sat hard
       against the text column with ~1.5px to spare and read as attached to
       the words rather than as chrome beside them. Narrowing the button to
       1rem frees ~5px, and the offset below splits that evenly so there is
       daylight on BOTH sides. Kept as a calc of the same three values the
       layout actually uses (gutter, button, borders) so it stays centred if
       any of them is retuned, instead of a magic pixel that silently stops
       being centred the next time the gutter moves. */
    .block-handles {
      gap: 0.125rem;
      left: calc((1.5rem - 1rem - 2px) / 2);
    }
    .block-handle {
      width: 1rem;
      height: auto;
      padding: 0.3rem 0;
      /* Legible, not merely present. 0.625rem at --ui-scale 0.875 renders
         ~8.75px at 0.6 opacity — technically visible, in practice a smudge
         the user could not read as a "+". Sized and weighted up until the
         glyph reads as a control; still quiet against the canvas. */
      font-size: 0.8125rem;
      opacity: 0.8;
      border-radius: 3px;
    }
    .pin-handle {
      font-size: 0.625rem;
    }
  }

  /* Role label tooltip on hover */
  .block-handle[data-label] {
    position: relative;
  }

  .block-handle[data-label]:hover::after {
    content: attr(data-label);
    position: absolute;
    left: calc(100% + 8px);
    top: 50%;
    transform: translateY(-50%);
    white-space: nowrap;
    font-family: "DM Mono", monospace;
    font-size: 0.625rem;
    font-weight: 300;
    letter-spacing: 0.04em;
    text-transform: lowercase;
    color: var(--ink);
    background: var(--surface);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sm);
    box-shadow: 0 0.25rem 0.75rem var(--card-shadow);
    padding: 3px 8px;
    pointer-events: none;
    z-index: 10;
    opacity: 0.82;
  }

  .copy-handle {
    font-size: 13px;
    opacity: 0.35;
  }

  .copy-handle:hover {
    opacity: 0.7;
    background: color-mix(in srgb, var(--ink) 5%, transparent);
  }

  .selection-pin-btn {
    position: absolute;
    z-index: 10;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--warm-accent);
    color: var(--canvas-bg);
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    box-shadow: 0 2px 8px var(--card-shadow-hover);
    transition: opacity var(--motion-fast), transform var(--motion-fast);
    opacity: 0.9;
  }

  .selection-pin-btn:hover {
    opacity: 1;
    transform: scale(1.1);
  }

  .del-handle {
    font-size: 12px;
    opacity: 0.4;
  }

  .del-handle:hover {
    opacity: 1;
    background: color-mix(in srgb, var(--ink) 5%, transparent);
  }

  /* Touch block-actions sheet — see BottomSheet above. One full-width row
     per action, thumb-sized (var(--touch-target) floor) since every row
     here only ever renders for a touch long-press. */
  .block-action-sheet {
    display: flex;
    flex-direction: column;
  }

  .block-action-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    min-height: max(var(--touch-target), 44px);
    padding: 0 0.25rem;
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--ink);
    font-family: "Lora", Georgia, serif;
    font-size: 0.9375rem;
    text-align: left;
    cursor: pointer;
  }

  .block-action-row:active {
    background: color-mix(in srgb, var(--warm-accent) 12%, transparent);
  }

  .block-action-row.danger {
    color: var(--warm-accent);
  }

  .block-action-glyph {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    flex-shrink: 0;
    font-style: italic;
    opacity: 0.6;
  }

  /* Table toolbar */
  .table-toolbar {
    position: absolute;
    display: flex;
    gap: 8px;
    justify-content: center;
    z-index: 5;
  }

  .table-btn {
    background: none;
    border: 1px dashed color-mix(in srgb, var(--horizon) 50%, transparent);
    border-radius: 4px;
    cursor: pointer;
    color: var(--ink);
    opacity: 0.3;
    padding: 3px 12px;
    font-size: 11px;
    transition: opacity 150ms ease, background 150ms ease;
  }

  .table-btn:hover {
    opacity: 0.7;
    background: color-mix(in srgb, var(--ink) 3%, transparent);
  }

  /* Bubble menu — inline text styling on selection. Positioned by the
     component using the same coord math as the selection-pin-btn.
     pointer-events: none on the container + auto on the buttons means the
     menu's padding/gaps don't intercept mouseover/mousemove targeted at the
     text block underneath — keeps the left-gutter block handles reachable. */
  .bubble-menu {
    position: absolute;
    background: var(--surface);
    border: 1px solid var(--card-border);
    box-shadow: 0 0.5rem 1.5rem var(--card-shadow-hover);
    border-radius: var(--radius-md);
    padding: 4px;
    z-index: 40;
    display: flex;
    flex-direction: column;
    gap: 3px;
    animation: bubble-menu-in 120ms ease;
    font-family: "Inter", sans-serif;
    font-size: 13px;
    pointer-events: none;  /* container ignored; buttons re-enable below */
  }
  /* Wraps the always-on row + conditional bottom row so a coarse
     pointer can restrip them into one horizontally scrollable row
     (below). Desktop keeps today's two-tier stacked look untouched. */
  .bubble-rows { display: contents; }
  .bubble-row { display: flex; gap: 1px; }
  .bubble-row-bottom {
    padding-top: 3px;
    border-top: 1px solid color-mix(in srgb, var(--ink) 10%, transparent);
  }
  .bubble-btn {
    background: transparent;
    border: none;
    padding: 6px 8px;
    border-radius: 4px;
    cursor: pointer;
    color: var(--ink);
    opacity: 0.7;
    font-family: inherit;
    font-size: 13px;
    line-height: 1;
    min-width: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    pointer-events: auto;
    transition: opacity var(--motion-fast), background var(--motion-fast);
  }
  .bubble-btn:hover { opacity: 1; background: color-mix(in srgb, var(--ink) 5%, transparent); }
  .bubble-btn:active { background: color-mix(in srgb, var(--warm-accent) 12%, transparent); }
  .bubble-btn:focus-visible {
    outline: 2px solid var(--warm-accent);
    outline-offset: 2px;
  }
  .bubble-btn.active {
    background: var(--warm-accent-soft);
    color: var(--warm-accent);
    opacity: 1;
  }
  .bubble-btn.mono { font-family: "DM Mono", monospace; font-size: 11px; }
  .bubble-btn-pin { color: var(--warm-accent); }

  /* Phone: bigger bubble-menu hit targets so the formatting toolbar
     is actually tappable above a text selection. */
  @media (pointer: coarse) {
    .bubble-btn {
      padding: 7px 10px;
      font-size: 14px;
      min-width: 34px;
      min-height: 34px;
    }
    .bubble-btn.mono { font-size: 13px; }

    /* Two stacked rows over a small selection push the menu tall enough
       to collide with the keyboard/selection handles on a phone. Restrip
       into one horizontally scrollable row instead. */
    .bubble-rows {
      display: flex;
      flex-direction: row;
      flex-wrap: nowrap;
      overflow-x: auto;
      max-width: calc(100vw - 16px);
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
      /* edge fade hints there's more to scroll */
      mask-image: linear-gradient(to right, transparent 0, black 12px, black calc(100% - 12px), transparent 100%);
    }
    .bubble-rows::-webkit-scrollbar { display: none; }
    .bubble-rows > * {
      display: flex;
      flex-wrap: nowrap;
      flex-shrink: 0;
      /* the bottom row's top border/padding read as a section divider in
         the stacked layout; in the single-row strip it's just noise. */
      padding-top: 0;
      border-top: none;
    }
  }

  .bubble-link-row { display: flex; gap: 4px; align-items: center; padding: 2px; }
  .bubble-link-input {
    flex: 1;
    min-width: 180px;
    border: 1px solid color-mix(in srgb, var(--ink) 12%, transparent);
    border-radius: 4px;
    padding: 4px 8px;
    font-family: "DM Mono", monospace;
    font-size: 12px;
    color: var(--ink);
    background: var(--canvas-bg);
    outline: none;
    pointer-events: auto;
  }
  .bubble-link-input:focus {
    border-color: var(--warm-accent);
  }

  @keyframes bubble-menu-in {
    from { opacity: 0; transform: translateY(2px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* Links */
  /* Editor min-height — needs scoping to the live editor (not static
     previews), so it stays here. Everything else lives in prose.css
     under the `.prose` class. */
  .tiptap-editor :global(.ProseMirror) {
    min-height: 200px;
    padding: 0;
  }

  /* Block gap baseline for paragraph-shaped content. 8px between
     top-level paragraphs, lists, and blockquotes — tight enough that
     consecutive written lines read as one continuous stream (the same
     rhythm as items inside a list), not a sparse, widely-spaced page.
     Headings, hr, pre, table, and shizumu custom nodes (day-marker,
     recipe-block, chart-block, code-block-wrap, block-shell, etc.) keep
     the per-element margins set in src/styles/prose.css and their
     component styles. we don't override those. */
  .tiptap-editor :global(.ProseMirror > :is(p, ul, ol, blockquote)) {
    margin-block: 8px 0;
  }
  .tiptap-editor :global(.ProseMirror > :is(p, ul, ol, blockquote):first-child) {
    margin-block-start: 0;
  }

  /* Quick-pin toast — brief floating confirmation after Cmd/Ctrl+P.
     Bottom-right of the editor wrapper, calm, ~1.6s lifetime. */
  .quick-pin-toast {
    position: fixed;
    bottom: 1.5rem;
    right: 1.5rem;
    z-index: 60;
    background: var(--surface);
    border: 1px solid var(--card-border);
    box-shadow: 0 0.5rem 1.5rem var(--card-shadow-hover);
    border-radius: var(--radius-md);
    padding: 0.5rem 0.875rem;
    font-family: "Inter", sans-serif;
    font-size: 0.75rem;
    color: var(--ink);
    opacity: 0.92;
    pointer-events: none;
    user-select: none;
  }
</style>
