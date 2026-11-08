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
  import { isInsertableImage, imageFilename, clipboardImage } from "../../lib/editor/image-file.js";
  import { replacePinRunInEditor } from "../../lib/pin-run.js";
  import { pasteNeedsNativeRead, nativeClipboardImage } from "../../lib/editor/native-clipboard.js";
  // EditorCore — the headless editor. Owns the TipTap instance, the save
  // loop, paste/drop/clipboard, attachments, yjs, the pin cache, page
  // switching and every public method. Renders ONLY the .tiptap-editor
  // mount. It has no chrome of its own: the desktop chrome
  // (TipTapEditor.svelte) and the phone shell each host it and render from
  // the hooks and the `snapshot` store. Spec: 2026-08-22-mobile-shell-design.md.
  import { onMount, onDestroy, tick } from "svelte";
  import { writable } from "svelte/store";
  import { Editor } from "@tiptap/core";
  import { TextSelection, Plugin, PluginKey } from "@tiptap/pm/state";
  import { Decoration, DecorationSet } from "@tiptap/pm/view";
  import { getSchema } from "@tiptap/core";
  import { migrateListSchema } from "../../lib/extensions/migrate-list-schema.js";
  import { migrateRecipeSchema } from "../../lib/extensions/migrate-recipe-schema.js";
  import { migrateQASchema } from "../../lib/extensions/migrate-qa-schema.js";
  import { stripPinIdsFromJSON } from "../../lib/extensions/pin-id.js";
  import { isBoardType } from "../../lib/extensions/block-title.js";
  import { writeClipboard } from "../../lib/clipboard-write.js";
  import { sanitizePastedHtml } from "../../lib/paste-sanitize.js";
  import { parseBlockFromHtml } from "../../lib/block-clipboard.js";
  import { buildEditingExtensions } from "../../lib/render/shared-extensions.js";
  import { saveFailed, saveSucceeded, retryDelayMs, isGonePageError } from "../../lib/save-health.js";
  import { savePageContent, saveTrailContent, createPin, getPins, attachmentAddBytes, updatePinContent } from "../../lib/api.js";
  import { serialWrites } from "../../lib/editor/write-order.js";
  import { looksLikeMarkdown, parseAndInsert, selectionPlainText, serializeSelection } from "../../lib/markdown-clipboard.js";
  import { hydrateDoc, encodeState, bytesFromTauri, docFromTipTapJson } from "../../lib/yjs/page-doc.js";
  import { isYjsEnabled } from "../../lib/yjs/feature-flag.js";
  import { computeSnapshot, EMPTY_SNAPSHOT } from "./editor-snapshot.js";
  import { caretScrollDelta, isDegenerateCaretRect, CARET_SCROLL_MARGIN_PX } from "../../lib/editor/caret-scroll.js";
  import { blockAlreadyPinned } from "../../lib/editor/block-already-pinned.js";
  import { pullReload, isEchoOfPull, comparablePair } from "../../lib/editor/pull-reload.js";
  import { setContentAsLoad } from "../../lib/extensions/block-id.js";
  import { fillDerivedBlockIds, stripBlockIdsFromJSON } from "../../lib/block-id.js";

  let {
    pageId,
    initialContent = null,
    initialYjsState = null,
    readonly = false,
    placeholder = "write one thought, then return",
    trailMode = null,
    isTrailMode = false,
    trailLineageId = null,
    lineageId = null,
    currentLineageId = null,
    currentLineageName = "",
    floatingChrome = true,
    onWordCount = () => {},
    onDocChange = () => {},
    onPinCreated = () => {},
    onCreateSubtrail = () => {},
    onMentionNavigate = () => {},
    onPinRefNavigate = () => {},
    onEditor = () => {},
    onUpdate = () => {},
    onSelectionUpdate = () => {},
    onFocus = () => {},
    onBlur = () => {},
    onTransaction = () => {},
    onChartOpen = () => {},
    onNotice = () => {},
  } = $props();

  let editorEl = $state(null);

  /** The nearest ancestor that actually scrolls, or null. Both a scrolling
   *  overflow AND real overflow are required: an `overflow-y: auto` box whose
   *  content fits does not scroll, and scrolling it moves nothing while
   *  stopping the walk short of the box that would have. */
  function scrollerFor(el) {
    let node = el?.parentElement ?? null;
    while (node) {
      const oy = getComputedStyle(node).overflowY;
      if ((oy === "auto" || oy === "scroll") && node.scrollHeight > node.clientHeight) return node;
      node = node.parentElement;
    }
    return null;
  }
  let editor = $state(null);
  let saveTimer = null;
  // The document exactly as the last sync pull left it (pull-reload.js).
  let pulledJson = null;
  // One save on the wire at a time, in the order they were asked for.
  // write-order.js has the report this answers: a pre-stamp debounce save
  // and confirmPin's stamped flush both in flight, and the phone's database
  // applying them in the other order, which orphaned the pin the flush had
  // just stamped. Every path that writes the doc goes through sendSave.
  const writes = serialWrites();

  /** Send one captured doc to the backend, in turn. The doc, the page id
   *  and the route are all fixed HERE, at the moment the save is asked
   *  for — a save that queues behind another must carry what the page held
   *  when it was scheduled, not what it holds when the lane clears (the
   *  teardown flush queues against an editor that is about to be
   *  destroyed). Only the IPC waits. */
  /** A page this editor must not try to save again.
   *
   *  MEASURED ON AN A16, as `Failed to flush save before page switch: Query
   *  returned no rows` on an ordinary action: deleting the page you are
   *  looking at. The host deletes the row, then adopts the neighbour, and
   *  the adopt is a page switch — so the effect below dutifully flushed the
   *  page that had just been removed, and the backend answered that there
   *  was no such row.
   *
   *  Nothing was lost (the page was deleted on purpose), but an app that
   *  logs an error during a normal gesture is an app whose log stops being
   *  worth reading — and the device harness is right to fail a run on it.
   *
   *  The editor cannot know a page is gone; only the host does. So the host
   *  says so, once, immediately before the delete. */
  let forgottenPageId = null;

  export function forgetPage(id) {
    if (!id) return;
    forgottenPageId = id;
    // The debounce belongs to the page being removed, and firing it would
    // be the same write by another route.
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
  }

  function sendSave(targetPageId, json, yjsBytes) {
    const lineage = trailLineageId;
    const send = isTrailMode && lineage
      // saveTrailContent doesn't accept yjsState yet — continuous trails go
      // through PAGE's savePageContent path, so this branch only handles
      // legacy trail-mode pages where the editor was a passthrough.
      ? () => saveTrailContent(lineage, targetPageId, json)
      : () => savePageContent(targetPageId, json, yjsBytes);
    return writes.run(send);
  }
  // Y.Doc handle when this editor is bound to a CRDT. Null for
  // discrete-trail pages and any session with `enable_yjs` off.
  // debouncedSave checks this to decide whether to ship yjs_state
  // alongside the content_json.
  let yjsDoc = $state(/** @type {import('yjs').Doc | null} */ (null));

  // What any chrome renders from. Set on every transaction (selection
  // changes included), so it is never stale relative to editor.state.
  export const snapshot = writable(EMPTY_SNAPSHOT);

  // Pin cache for display-time filtering (chrome asks via hasPinnedContent).
  let existingPinContents = $state(new Set());
  async function loadPinCache() {
    try {
      const pins = await getPins(lineageId || null);
      existingPinContents = new Set(pins.map((p) => p.content));
    } catch { existingPinContents = new Set(); }
  }
  export function hasPinnedContent(content) {
    return existingPinContents.has(content);
  }

  /** Is this block already kept — the whole rule, not the content half.
   *  `main` moved that decision into a pure module
   *  (lib/editor/block-already-pinned.js, 5804c6ab) because the content
   *  check alone could never match a quick-pin: the cache holds what was
   *  STORED, which for that path is the node's JSON, and every caller
   *  asked with prose. The stamp answers exactly, and a second press on an
   *  already-stamped block would otherwise overwrite the one `pinId` a node
   *  has and orphan the pin it replaced.
   *
   *  It arrives here because the cache did: the split moved
   *  `existingPinContents` out of the component that used to own both
   *  halves, so the core supplies the cache and the chrome supplies the
   *  stamp it can read off its own DOM block. `hasPinnedContent` stays for
   *  the callers that want only the content question. */
  export function blockIsKept({ pinId = null, text = "" } = {}) {
    return blockAlreadyPinned({ pinId, text, pinnedContents: existingPinContents });
  }

  let wordCount = $state(0);
  const cursorMemory = new Map();

  function writeMarkdownToClipboard(view, event, clearSelection) {
    if (!editor || !event.clipboardData) return false;
    if (view.state.selection.empty) return false;
    const md = serializeSelection(editor);
    if (!md) return false;
    // Mirror TipTap's defaults for text/html and text/plain so apps
    // that don't read markdown still get usable content.
    //
    // text/plain comes from the DOCUMENT, not from the markdown above. It
    // used to be the markdown with its syntax stripped, which left every
    // backslash the exporter had escaped with — and where the escape was
    // `\*` the strip took the asterisk and left the backslash, so "2*3 = 6"
    // reached other apps as "2\3 = 6". See selectionPlainText.
    const plain = selectionPlainText(editor);
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
    // This used to guard bubbleMenuEl (now chrome-owned, so that reason is
    // gone). The only bind:this left in this component is editorEl itself,
    // which Svelte flushes before onMount fires regardless — removing this
    // tick() found nothing depending on it. Left in place as a no-op pending
    // a deliberate removal; not touched in this pass.
    await tick();

    const rawContent = initialContent
      ? (typeof initialContent === "string" ? JSON.parse(initialContent) : initialContent)
      : { type: "doc", content: [{ type: "paragraph" }] };
    // Lazy schema migration — old taskList/bulletList/orderedList/taskItem
    // get rewritten before TipTap parses. algorithmBlock → recipeBlock,
    // legacy flat-paragraph qaBlock → qaBlock with qaPair children.
    // All migrations are idempotent on already-migrated docs.
    const migrated = migrateQASchema(migrateRecipeSchema(migrateListSchema(rawContent)));
    // Blocks saved before 0.8.2 carry no id. They get the id derived from
    // this page and their place in it — the same on every load, and the
    // same an export computes — and nothing is saved for it: the baseline
    // below is taken from the content WITH these ids (block-id.js).
    const content = pageId ? fillDerivedBlockIds(migrated, pageId) : migrated;

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
          // `floatingChrome` is forwarded here as well, and it is not
          // decoration. This schema is what the very next line parses this
          // page's content_json through, and the Y.Doc it produces is bound
          // to the editor built below: a schema derived from a DIFFERENT
          // extension list than the editor's is a mismatch that surfaces
          // much later as a parse error on a node the schema never learned.
          // Today the flag changes nothing here — all three surfaces it
          // omits are Extension.create, so they contribute no node and no
          // mark spec, which "derives the same schema with the floating
          // chrome off" asserts. Passing it anyway makes the two lists
          // agree BY CONSTRUCTION rather than by that accident, so the day
          // one of them grows a node they stay in step for free.
          const schema = getSchema(buildEditingExtensions({ placeholder, floatingChrome, getPageId: () => pageId }));
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
        onChartOpen: (params) => onChartOpen(params || null),
        collaborationDoc,
        floatingChrome,
        // Read at the moment of a load, so a page switch derives ids for
        // the page arriving, not the one leaving.
        getPageId: () => pageId,
      }),
      // Skip `content` when bound to a Y.Doc — Collaboration sources
      // the doc state from the YXmlFragment, and supplying `content`
      // on top would double-apply and shred the doc structure.
      ...(collaborationDoc ? {} : { content }),
      editable: !readonly,
      onUpdate: ({ editor: ed }) => {
        debouncedSave(ed);
        onUpdate({ editor: ed });
        wordCount = countWordsExcludingMarkers(ed);
        onWordCount(wordCount);
        onDocChange(ed.state.doc.toJSON());
      },
      onSelectionUpdate: ({ editor: ed }) => {
        onSelectionUpdate({ editor: ed });
        pruneEmptyHeadingOnMove(ed);
      },
      onFocus: () => {
        onFocus();
      },
      onBlur: ({ editor: ed }) => {
        pruneAllEmptyHeadings(ed, { preserveCursor: false });
        onBlur({ editor: ed });
      },
      onTransaction: ({ editor: ed }) => {
        snapshot.set(computeSnapshot(ed));
        onTransaction();
      },
      editorProps: {
        // ProseMirror's own scroll-into-view runs with no margin unless it is
        // given one, so the two paths disagreed: pressing Enter took
        // handleScrollToSelection below and got CARET_SCROLL_MARGIN_PX of
        // slack, while typing a character that wrapped took PM's path and put
        // the caret flush against the scroller's edge. One constant for both.
        // scrollMargin only, NOT scrollThreshold. The two do different
        // jobs and only one of them was wanted: margin is how much extra
        // room is left WHEN a scroll happens, threshold is how close to an
        // edge the selection must be BEFORE PM scrolls at all. Setting the
        // threshold made PM scroll on load, on any document whose selection
        // lands near an edge -- which on a 360px-tall landscape viewport is
        // a continuous trail's whole page, and the amount varied with
        // timing, so the VR diff varied run to run (2065px, then 1420px).
        //
        // Caught by P2c Task 4's VR run and proven both ways: without these
        // props the scene passes twice; with both it fails; with margin
        // alone it passes twice. Keeping margin keeps the fix it was added
        // for -- Enter got CARET_SCROLL_MARGIN_PX of slack while a wrapping
        // keystroke got none.
        scrollMargin: CARET_SCROLL_MARGIN_PX,
        /**
         * Keep the caret in view when ProseMirror's own scroll declines to.
         * Returning false hands the scroll back to PM, which is what we want
         * for every normal case. We only take over for the one PM gives up
         * on: the caret in a freshly-created EMPTY paragraph, where
         * `coordsAtPos` reports an all-zero rect and `scrollRectIntoView`
         * returns immediately on its `if (!nonZero(rect) && rect.left == 0)`
         * guard. That is why pressing Enter on the last line added a line you
         * could not see until you pressed the down arrow — see
         * lib/editor/caret-scroll.js for the full measurement.
         *
         * PM's rect is the test; the caret's BLOCK ELEMENT is what we measure
         * instead, because a block always has a box even when the caret
         * inside it does not.
         *
         * The scroller is FOUND rather than passed. On main this hook lived
         * in TipTapEditor and closed over its own `wrapperEl`; here it is in
         * the shared core, which has two hosts with different scrollers —
         * the desktop wrapper and the shell's content band. Walking up to the
         * nearest ancestor that actually scrolls serves both, and a host that
         * changes its layout does not have to remember to re-wire this.
         */
        handleScrollToSelection(view) {
          let caretRect = null;
          try { caretRect = view.coordsAtPos(view.state.selection.head); } catch { caretRect = null; }
          if (!isDegenerateCaretRect(caretRect)) return false; // PM's job.

          const scroller = scrollerFor(editorEl);
          if (!scroller) return false;

          let blockEl = null;
          try {
            const at = view.domAtPos(view.state.selection.head);
            let node = at.node;
            if (node && node.nodeType === Node.TEXT_NODE) node = node.parentNode;
            // Walk up to the element that actually has a layout box.
            while (node && node !== scroller && !(node instanceof Element)) node = node.parentNode;
            blockEl = node instanceof Element && node !== scroller ? node : null;
          } catch { blockEl = null; }
          if (!blockEl) return false;

          const delta = caretScrollDelta(
            blockEl.getBoundingClientRect(),
            scroller.getBoundingClientRect(),
          );
          if (delta !== 0) scroller.scrollTop += delta;
          // Handled either way: PM's fallback cannot do better with the rect
          // it has, and letting it run would only re-confirm the no-op it
          // already decided on.
          return true;
        },
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
              // Strip pinId so the duplicate does not double-bind to the same pin row,
              // and blockId so it is a new block here with an id of its own:
              // the copied block may live on another page (block-id.js).
              const nodeJson = stripBlockIdsFromJSON(stripPinIdsFromJSON(embeddedBlockJson));
              const node = view.state.schema.nodeFromJSON(nodeJson);
              const { tr, selection } = view.state;
              view.dispatch(tr.insert(selection.from, node));
              return true;
            } catch {
              // Fall through to the default HTML/markdown/plain-text paste below.
            }
          }

          // Image paste from clipboard
          // Files, then items: WebKitGTK may only offer the latter (image-file.js).
          const imageFile = clipboardImage(data);
          if (imageFile) {
            insertImageFile(imageFile);
            return true;
          }
          // An empty paste on the desktop app: WebKitGTK hands the page
          // nothing for an image-only clipboard, so it is read natively
          // (native-clipboard.js). Nothing else could be pasted from it.
          const desktopApp = typeof window !== "undefined" && !!window.__TAURI_INTERNALS__
            && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
          if (pasteNeedsNativeRead(data, { desktop: desktopApp })) {
            nativeClipboardImage().then((file) => { if (file) insertImageFile(file); });
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
            onNotice("couldn't parse as markdown. pasted as plain text.");
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
          const imageFile = Array.from(files).find(isInsertableImage);
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

    // Registered here rather than appended to the extension list, and that
    // is not a style choice. The yjs branch above derives its schema from
    // `getSchema(buildEditingExtensions(...))` and parses this page's
    // content_json through it; the comment there is explicit that the two
    // lists have to agree BY CONSTRUCTION rather than by the accident of
    // what the extra entries happen to contribute. registerPlugin adds a
    // ProseMirror plugin without touching the list at all, so there is no
    // second list to keep in step.
    editor.registerPlugin(liftedBlockPlugin());

    snapshot.set(computeSnapshot(editor));
    onEditor(editor);
    // Fire once after mount so the panel sees the initial doc state without
    // waiting for the first keystroke.
    if (editor) {
      onDocChange(editor.state.doc.toJSON());
      // The loaded copy, as the echo guard's baseline: leaving this page
      // untouched must not save it back (pull-reload.js, isEchoOfPull).
      pulledJson = JSON.stringify(editor.getJSON());
    }
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
        // The one page that is not flushed: the one the host just deleted.
        // See forgetPage.
        if (oldPageId && oldPageId === forgottenPageId) {
          forgottenPageId = null;
        } else if (oldPageId && editor) {
          if (saveTimer) {
            clearTimeout(saveTimer);
            saveTimer = null;
          }
          try {
            pruneAllEmptyHeadings(editor, { preserveCursor: false });
            const json = JSON.stringify(editor.getJSON());
            const yjsBytes = yjsDoc ? encodeState(yjsDoc) : null;
            // Untouched since it was loaded, pulled or saved: saving it again
            // stamps an older copy with a newer clock, and on 2026-10-19 that
            // emptied a page the phone had just written on both devices (its
            // body had not arrived when the laptop opened and left it).
            if (!isEchoOfPull({ json, pulled: pulledJson })) {
              await sendSave(oldPageId, json, yjsBytes);
            }
          } catch (err) {
            // A page deleted on the other device while this one held it is
            // gone, not unsaved; forgetPage covers the writer's own deletes.
            if (isGonePageError(err)) console.warn("left a page that is gone:", err);
            else saveFailed(err);
          }
        }

        const content = initialContent
          ? (typeof initialContent === "string" ? JSON.parse(initialContent) : initialContent)
          : { type: "doc", content: [{ type: "paragraph" }] };
        setContentAsLoad(editor, content);
        // The new page as loaded is the baseline, not null: the setContent
        // above schedules a save, and a save of exactly this copy is an echo.
        pulledJson = JSON.stringify(editor.getJSON());
        editor.setEditable(!readonly);
        // Cursor placement priority:
        //   1. Continuous trails always land at end of doc (fresh writing position).
        //   2. Otherwise restore the saved cursor for this page if we've visited before.
        // Each placement waits a beat, and the page can be left inside it:
        // a destroyed editor has no commands, and touching them threw.
        const alive = () => editor && !editor.isDestroyed;
        if (trailMode === "continuous") {
          setTimeout(() => { if (alive()) editor.commands.focus("end"); }, 50);
        } else {
          const savedPos = cursorMemory.get(pageId);
          if (savedPos && savedPos <= editor.state.doc.content.size) {
            setTimeout(() => { if (alive()) editor.commands.setTextSelection(savedPos); }, 50);
          }
        }
      })();
    }
  });

  onDestroy(() => {
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", handleHide);
    if (typeof window !== "undefined") window.removeEventListener("pagehide", handleHide);
    if (editor && !editor.isDestroyed) {
      onEditor(null);
      // Flush a pending edit before tearing down rather than discarding it —
      // this is what silently dropped a just-stamped pinId when the editor
      // unmounted inside the debounce window. Capture synchronously; the save
      // itself is fire-and-forget since onDestroy cannot await.
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; flushSave({ preserveCursor: false }); }
      try { pruneAllEmptyHeadings(editor, { preserveCursor: false }); } catch {}
      editor.destroy();
    }
    if (saveTimer) clearTimeout(saveTimer);
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
  export async function flushSave({ preserveCursor = true } = {}) {
    if (!editor || editor.isDestroyed) return;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    try {
      pruneAllEmptyHeadings(editor, { preserveCursor });
      const json = JSON.stringify(editor.getJSON());
      if (isEchoOfPull({ json, pulled: pulledJson })) return;
      pulledJson = null;
      // When bound to a Y.Doc, ship its v2-encoded state alongside the JSON
      // snapshot. The backend persists both: yjs_state is source-of-truth for
      // sync, content_json keeps FTS warm.
      const yjsBytes = yjsDoc ? encodeState(yjsDoc) : null;
      await sendSave(pageId, json, yjsBytes);
      pulledJson = json;
      saveSucceeded();
    } catch (err) {
      // Said on the page (save-health.js), and tried again: the words are
      // still in the editor, and the next save that lands writes all of them.
      const attempts = saveFailed(err);
      if (!saveTimer && editor && !editor.isDestroyed) {
        saveTimer = setTimeout(() => { flushSave(); }, retryDelayMs(attempts));
      }
    }
  }

  // Run the save the debounce is holding, now, and wait for it; nothing
  // when none is pending. main's TipTapEditor.flushPendingSave, carried
  // across the split: a pin edit that writes this page's STORED copy lets
  // the pending save land first, so it cannot write over that copy a
  // moment later (pin-edit-route.js, beforeSourceWrite).
  export async function flushPendingSave() {
    if (saveTimer) await flushSave();
  }

  function debouncedSave(_ed) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { flushSave(); }, 1000);
  }

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

  // Top-level node types copyBlockAtPos can ever produce for the
  // data-shizumu-block clipboard payload — used by handlePaste's block-
  // copy path to reject a hand-crafted/foreign payload before
  // nodeFromJSON (see the coordinator branch-review note there).
  const COPYABLE_BLOCK_TYPES = new Set([
    "paragraph", "heading", "table", "list", "blockquote",
    "recipeBlock", "decisionBlock", "qaBlock", "chart", "dayMarker", "localImage",
    "codeBlock", "attachment", "horizontalRule", "listItem",
  ]);

  export async function insertImageFile(file) {
    if (!editor) return;
    try {
      // By type first, then extension (src/lib/editor/image-file.js).
      if (!isInsertableImage(file)) return;
      const buf = await file.arrayBuffer();
      // Images go through the same content-addressed blob store as files, so
      // they get a blob_hash, an attachments row and a per-image sync
      // decision, which starts where this device's sync is.
      const att = await attachmentAddBytes(new Uint8Array(buf), imageFilename(file), file.type || null);
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

  // The data half of pinning. Chrome decides WHAT to pin (category,
  // content, node positions) and how to celebrate; the core makes it
  // durable: create the row, stamp pinId (and blockTitle on boards),
  // re-serialise non-note pins with the stamp embedded, cache, flush,
  // tell the panel. Lifted from confirmPin minus the popup/flash state,
  // which stays in chrome and runs on the `onStamped` callback below.
  export async function confirmPin({ title, category, content, nodePositions = [], onStamped } = {}) {
    if (!content) return null;
    const positions = nodePositions;
    let pinContent = content;
    try {
      const newPin = await createPin(lineageId || null, pageId, category, pinContent, title);
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
            // A board pinned on its own takes the chosen title as its
            // blockTitle. One block of a longer range keeps its own: the
            // title names the passage, and writing it there renamed the list.
            if (node && isBoardType(node.type.name) && title && positions.length === 1) {
              tr.setNodeAttribute(pos, "blockTitle", title);
            }
          }
          if (tr.docChanged) {
            editor.view.dispatch(tr);
            // Re-serialize with pinId attribute now embedded so the stored
            // snapshot matches what the editor would produce on next sync.
            if (category !== "note") {
              // Only what carries the stamp: a divider in range has no
              // pinId, the next save's walk would leave it out of the pin
              // (refresh_pin_caches), and the pin would change shape a
              // second after it was made.
              const updatedNodes = positions.map((pos) => {
                const n = editor.state.doc.nodeAt(pos);
                return n && n.attrs?.pinId === newPin.id ? n.toJSON() : null;
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
      existingPinContents = new Set([...existingPinContents, pinContent]);
      // Chrome paints its confirmation here, not after the flush: pre-split
      // the block flash ran at exactly this point — stamp done, save not yet
      // started — so the user sees it immediately, not one IPC round-trip later.
      // Guarded: a throwing chrome callback must not skip flushSave/onPinCreated
      // below (see the persist-stamp-now note there for why that flush matters).
      try { onStamped?.(); } catch (err) { console.error("onStamped callback threw:", err); }
      // The pinId now lives only in the live doc. refresh_pin_caches orphans
      // any open pin whose id is not in the SAVED content_json, so unless we
      // persist now, an unmount before the 1s debounce leaves the pin
      // orphaned (dimmed, "like deleted") on the next launch. Persist the
      // stamp synchronously so creation is durable, then tell the panel.
      //
      // Persisting now is necessary and was not sufficient. If the debounce
      // fired during `await createPin` above, a pre-stamp save is still on
      // the wire as this one goes out, and on Android the database can
      // apply them in either order — the sweep then orphans this pin on
      // the very save that was meant to keep it, with nothing left to flip
      // it back. sendSave's lane is what makes this flush the LAST save
      // applied as well as the last one sent (write-order.js).
      await flushSave();
      onPinCreated();
      return newPin ?? null;
    } catch (err) {
      console.error("Failed to pin block:", err);
      return null;
    }
  }

  export function moveBlock(fromPos, toIndex) {
    if (!editor || editor.isDestroyed) return false;
    return editor.commands.moveBlockTo(fromPos, toIndex);
  }

  /** The one block a host has picked up — §3's lift, and the only place in
   *  the app where chrome needs a node the EDITOR rendered to look
   *  different for a while.
   *
   *  A DECORATION, not a class on the node's DOM, and the difference is the
   *  whole point of this export. A host that reaches for
   *  `view.nodeDOM(pos).classList.add(...)` is mutating a node ProseMirror
   *  owns: its DOMObserver sees the attribute change, marks that range
   *  dirty, and redraws the node from the doc — within ~100ms in a browser,
   *  and within one microtask under jsdom. The class rides away on the
   *  orphaned element and the lift is invisible for the rest of the drag.
   *  A decoration is re-applied by that same redraw instead of being undone
   *  by it, which is the property the shell needs.
   *
   *  The class NAME still belongs to the host — the styling is chrome's, so
   *  `.ps-lifted` and its scale/shadow live in PageScreen — and the core
   *  only guarantees the node carries it for as long as it is lifted.
   *  Nothing else in the app calls this: the desktop chrome never lifts a
   *  block, so its editor registers the plugin and produces no decoration
   *  for the life of the page. */
  const liftedBlockKey = new PluginKey("shizumuLiftedBlock");

  function liftedBlockPlugin() {
    return new Plugin({
      key: liftedBlockKey,
      state: {
        init: () => null,
        // `undefined` means "this transaction said nothing about the lift",
        // which is every transaction but the two setLiftedBlock sends — so
        // it cannot be the cleared value. `null` is. Written this way round
        // because a falsy check would read position 0, the first block in
        // every document, as "nothing lifted".
        apply(tr, pos) {
          const meta = tr.getMeta(liftedBlockKey);
          if (meta !== undefined) return meta;
          if (pos === null) return null;
          // The doc can change under a live lift: the drop itself moves the
          // block, and the host clears the lift a moment later. Mapping
          // keeps the decoration on the block rather than on whatever slid
          // into its old position, and a position the map lands outside of
          // a node drops the lift instead of throwing out of `decorations`.
          const mapped = tr.mapping.map(pos, -1);
          return tr.doc.nodeAt(mapped) ? mapped : null;
        },
      },
      props: {
        decorations(state) {
          const pos = liftedBlockKey.getState(state);
          if (pos == null) return null;
          const node = state.doc.nodeAt(pos);
          if (!node) return null;
          return DecorationSet.create(state.doc, [
            Decoration.node(pos, pos + node.nodeSize, { class: "ps-lifted" }),
          ]);
        },
      },
    });
  }

  /**
   * Mark the block starting at `pos` as lifted, or clear the lift with
   * null. Returns false when there is no editor, or when `pos` does not
   * start a node — the same shape moveBlock uses, and the same reason: a
   * position the doc no longer has is a host holding a stale block, not a
   * crash.
   */
  export function setLiftedBlock(pos) {
    if (!editor || editor.isDestroyed) return false;
    const view = editor.view;
    const next = typeof pos === "number" ? pos : null;
    // try/catch and not just a falsy check: nodeAt THROWS on a position
    // past the end of the doc ("Position N outside of fragment") rather
    // than answering null, so a host holding a position from a document
    // that has since shrunk would take the exception out through the
    // effect that called this. Found by "refuses a position that starts no
    // node", which is the only caller that passes one.
    if (next !== null) {
      let node = null;
      try { node = view.state.doc.nodeAt(next); } catch { node = null; }
      if (!node) return false;
    }
    if (liftedBlockKey.getState(view.state) === next) return true;
    // Not undoable: a lift is chrome, and a writer pressing undo after a
    // drag means the MOVE, not the highlight the move was wearing.
    view.dispatch(view.state.tr.setMeta(liftedBlockKey, next).setMeta("addToHistory", false));
    return true;
  }

  /** The `<input>` a board's NodeView renders for its title, or null.
   *
   *  A board title is chrome the EDITOR draws, and it is not in the
   *  document: `blockTitle` is a node attribute, and the input that edits
   *  it lives inside the NodeView beside the node's content, at no document
   *  position at all. So there is no transaction that focuses it and no
   *  command a host can send — the only handle is the element, and this is
   *  the seam that hands one over rather than letting a host walk into
   *  ProseMirror's DOM on its own.
   *
   *  Not the mistake `setLiftedBlock` documents. That one is about WRITING
   *  to a node the editor owns: the DOMObserver sees the mutation, marks
   *  the range dirty and redraws from the doc, so the change rides away on
   *  an orphaned element. Nothing here mutates the tree. `focusBlockTitle`
   *  moves focus, which the observer does not watch and a redraw does not
   *  undo, and the slot survives that redraw anyway — `createBoardNodeView`
   *  keeps its DOM across update() and `bindTitleSlot.refresh` skips
   *  rewriting the value while the slot is being edited, which is what
   *  stops a transaction mid-typing from resetting the caret. */
  function titleSlotAt(pos) {
    if (!editor || editor.isDestroyed || typeof pos !== "number") return null;
    let dom;
    // nodeDOM THROWS on a position outside the doc rather than answering
    // null — the same reason setLiftedBlock wraps its nodeAt: a host can be
    // holding a position from a document that has since shrunk.
    try { dom = editor.view.nodeDOM(pos); } catch { return null; }
    if (!(dom instanceof Element)) return null;
    return dom.querySelector(".board-title-slot");
  }

  /** Does the block at `pos` render a title slot to focus — the gate
   *  `blockActionsFor` calls `hasTitleSlot`, and the same DOM question the
   *  desktop's own sheet asks of its block element. Asked here rather than
   *  answered from the node's TYPE because the type list would have to stay
   *  right forever, and asked here rather than off `snapshot.activeBlock`
   *  because that module is pure over `editor.state` and cannot see the
   *  DOM. `isTitled` on the snapshot is the neighbouring question — whether
   *  a title has been typed — and is not this one. */
  export function hasBlockTitleSlot(pos) {
    return !!titleSlotAt(pos);
  }

  /** Put the writer in the title slot of the block at `pos`. False when
   *  that block has none, which is the same shape `moveBlock` and
   *  `setLiftedBlock` return for a stale position.
   *
   *  `__enterEdit()` rather than `focus()` when it is there: `bindTitleSlot`
   *  hangs it on the input and it sets the slot's own `editing` flag before
   *  focusing, which is what stops the next transaction's `refresh` from
   *  rewriting the value under the caret. Focus lands one animation frame
   *  later — that is inside `enterEditMode`, not here — so a caller
   *  asserting `document.activeElement` synchronously sees the old one. */
  export function focusBlockTitle(pos) {
    const slot = titleSlotAt(pos);
    if (!slot) return false;
    if (typeof slot.__enterEdit === "function") slot.__enterEdit();
    else slot.focus();
    return true;
  }

  export function getElement() {
    return editorEl;
  }

  export function getEditor() {
    return editor;
  }

  export function reloadFromContent(newJson) {
    if (!editor || editor.isDestroyed) return;
    try {
      const parsed = typeof newJson === "string" ? JSON.parse(newJson) : newJson;
      if (!parsed) return;
      // Like with like: the stored copy as a load would leave it, with the
      // derived ids an old page gets (pull-reload.js, comparablePair).
      const { current, incoming } = comparablePair({
        current: editor.getJSON(), incoming: parsed, pageId, fillIds: fillDerivedBlockIds,
        normalise: (json) => editor.schema.nodeFromJSON(json).toJSON(),
      });
      // Never over unsaved typing: a pull inside the save's one second used
      // to replace the newest words with the older stored copy (pull-reload.js).
      // "deferred" goes back to the host, which saves and reads again.
      const decision = pullReload({ pendingSave: !!saveTimer, current, incoming });
      if (decision !== "apply") return decision;
      const wasFocused = editor.isFocused;
      const { from, to } = editor.state.selection;
      // emitUpdate: false → don't fire onUpdate, so this load doesn't
      // trigger a save (which would echo the remote content right back
      // through the op_log and into another sync round-trip).
      setContentAsLoad(editor, parsed, false);
      pulledJson = JSON.stringify(editor.getJSON());
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
      return "apply";
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
   *
   * RETURNS HOW MANY NODES ACTUALLY LANDED. It used to return nothing,
   * which made every caller's report of what it had done a guess: the
   * skip above, the schema failure in the loop, and a torn-down editor all
   * drop input silently, so "I appended 4 nodes" was the argument's length
   * rather than the document's. The shell's carry-forward toast is the
   * first caller that has to be able to say "these landed" and mean it
   * (P2f Task 3); Page.svelte ignores the value and is unaffected.
   *
   * @param {Array<object>} nodes
   * @returns {number} nodes inserted, 0 if none
   */
  export function appendNodesToDoc(nodes) {
    if (!editor || !Array.isArray(nodes) || nodes.length === 0) return 0;

    // Snapshot existing top-level nodes' shape (pinId- and blockId-agnostic:
    // a block on the page has an id, the carried copy of it has none).
    const shapeKey = (json) => JSON.stringify(stripBlockIdsFromJSON(stripPinIdsFromJSON(json)));
    const existingKeys = new Set();
    editor.state.doc.forEach((node) => {
      try {
        existingKeys.add(shapeKey(node.toJSON()));
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
        const key = shapeKey(json);
        if (existingKeys.has(key)) continue;
        built.push(editor.state.schema.nodeFromJSON(json));
        existingKeys.add(key);
      } catch (err) {
        console.error("appendNodesToDoc: skipping invalid node", err);
      }
    }
    if (built.length === 0) return 0;
    const end = editor.state.doc.content.size;
    const tr = editor.state.tr.insert(end, built);
    editor.view.dispatch(tr);
    return built.length;
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
   *
   * AN ARRAY IS ACCEPTED, and the shell's pin screen sends one. A pin
   * can be several blocks (made from a selection over them), and an edit
   * can split one block in two. The whole run of the pin's blocks is
   * replaced once, where it began, and every edited block carries the id:
   * `replacePinRunInEditor` (src/lib/pin-run.js), whose header has the
   * rule and the bug it closed. `withPinRun` there is the same rule for a
   * page this editor is not showing.
   */
  export function spliceNodeAtPinId(pinId, newNodeJson) {
    return replacePinRunInEditor(editor, pinId, newNodeJson);
  }

  /**
   * Write a title onto the node carrying the given pinId, in place. The
   * shell's pin sheet renames a BOARD through this rather than through the
   * pin row: a board's title is page content — its `blockTitle` slot is what
   * the writer sees — so the doc is authoritative for it and the save that
   * follows (refresh_pin_caches, commands.rs) is what brings the row into
   * step. Writing the row directly would be overwritten by that same save,
   * which is issue #1's shape seen from the other side; pin-title-authority.js
   * is where a caller decides which home a title has.
   *
   * `setNodeMarkup` rather than `spliceNodeAtPinId` with a rebuilt node:
   * only one attr changes, the node's content is untouched, and a NodeView
   * that keeps its DOM across update() (createBoardNodeView) sees an attr
   * change rather than a replacement.
   *
   * Returns false when the editor is down, the pinId is not in this doc, or
   * the node found has no `blockTitle` attr to write — a paragraph's schema
   * would silently drop the attr, and a false here is what sends the
   * caller to the row instead of letting the rename vanish.
   */
  export function setBlockTitleAtPinId(pinId, title) {
    if (!editor || !pinId) return false;
    const matches = collectNodesByPinId(pinId);
    if (matches.length === 0) return false;
    const { node, pos } = matches[0];
    if (!node.type.spec.attrs || !("blockTitle" in node.type.spec.attrs)) return false;
    try {
      const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockTitle: title });
      editor.view.dispatch(tr);
      return true;
    } catch (err) {
      console.error("setBlockTitleAtPinId failed:", err);
      return false;
    }
  }

  /**
   * Scroll the editor to the node carrying the given pinId attribute and
   * briefly flash a highlight so the user can see where the pin lives.
   * No-op if the editor is not mounted or the pinId is not found in the doc.
   * Called by the pin panel when the user clicks a pin card (Issue 2), and
   * by the shell when a pin's "open the page it came from" lands the page on
   * the writing surface.
   *
   * ANSWERS WHETHER IT FOUND ANYTHING, which the shell needs and the panel
   * ignores. The shell asks right after it adopts a page, and the editor
   * takes that content asynchronously — the content effect flushes the
   * previous page's save before it calls setContent — so "not yet" and
   * "not here" are different answers to the caller and it has to be able to
   * tell them apart to know whether waiting another frame is worth it.
   *
   * @returns {boolean} true when the node was found and scrolled to.
   */
  export function scrollToPinId(pinId) {
    if (!editor || !pinId) return false;
    const matches = collectNodesByPinId(pinId);
    if (matches.length === 0) return false;
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
    return true;
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
          await sendSave(pageId, json, yjsBytes);
        } catch (err) {
          saveFailed(err);
        }
      }
    } catch (err) {
      // Don't let a bad walk crash the create flow.
      console.error("linkPendingPageRef walk failed:", err);
    }
    return updated;
  }

</script>

<div bind:this={editorEl} class="tiptap-editor prose"></div>

<style>
  /* These four rules style the element THIS component renders, and they
     live here rather than in the chrome because Vite emits a component's
     CSS only when that component is imported. While they sat in
     TipTapEditor.svelte, any chrome that mounted EditorCore without also
     importing TipTapEditor — which is exactly what the phone shell does —
     silently lost the editor's min-height, its top-level block rhythm and
     the drag elevation cue. They stay :global(...) because they target
     ProseMirror's own DOM, which Svelte does not scope. */

  /* Block in long-press drag mode (touch only) — subtle elevation cue
     without ripping the block out of its layout slot. The block stays
     in place; subsequent moveUnit() swaps actually reorder the doc as
     the user drags past 32px thresholds. */
  :global(.tiptap-editor.prose .ProseMirror > .block-dragging) {
    background: color-mix(in srgb, var(--warm-accent) 8%, transparent);
    box-shadow: 0 0.25rem 1rem var(--card-shadow);
    border-radius: 0.375rem;
    transform: scale(1.005);
    transition: transform var(--motion-fast),
                background var(--motion-fast);
  }

  /* Editor min-height — needs scoping to the live editor (not static
     previews), so it stays here. Everything else lives in prose.css
     under the `.prose` class. */
  :global(.tiptap-editor.prose .ProseMirror) {
    min-height: 200px;
    /* Trailing room below the last block, inside the scroller. Carried
       across the P0 split from main's TipTapEditor, where this rule used
       to live. Two jobs, both denied by the old `padding: 0`:
       1. It is what the caret's bottom margin scrolls INTO. Without it the
          scroller has nothing left to give at the end of the doc, so the
          line you are writing ends up flush against the bottom edge —
          technically in view, and still like writing into the window
          frame. (See editor/caret-scroll.js for the scroll itself.)
       2. It is a click target. ProseMirror places the caret at the end of
          the doc when you click inside its own padding, so the empty space
          under the last line becomes "click here to keep writing" instead
          of dead canvas.
       Not a viewport fraction: on a phone a `vh`-based value eats the
       whole screen below a short page, and the writing surface is meant to
       start at the top. */
    padding: 0 0 6rem;
  }

  /* Block gap baseline for paragraph-shaped content. 8px between
     top-level paragraphs, lists, and blockquotes — tight enough that
     consecutive written lines read as one continuous stream (the same
     rhythm as items inside a list), not a sparse, widely-spaced page.
     Headings, hr, pre, table, and shizumu custom nodes (day-marker,
     recipe-block, chart-block, code-block-wrap, block-shell, etc.) keep
     the per-element margins set in src/styles/prose.css and their
     component styles. we don't override those. */
  :global(.tiptap-editor.prose .ProseMirror > :is(p, ul, ol, blockquote)) {
    margin-block: 8px 0;
  }
  :global(.tiptap-editor.prose .ProseMirror > :is(p, ul, ol, blockquote):first-child) {
    margin-block-start: 0;
  }
</style>
