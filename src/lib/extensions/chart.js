import { Node, mergeAttributes } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { createBlockShell } from "./block-shell.js";
import { bindTitleSlot } from "./title-slot.js";
import { renderMermaidInto, reinitMermaidTheme } from "./chart-render.js";

/**
 * `chart` — visual diagram node backed by Mermaid.
 *
 * Storage shape (per Phase 10 plan):
 *   { type: "chart", attrs: { kind, source } }
 *
 * where `kind` ∈ {"flowchart", "mindmap", "timeline"} and `source` is the
 * STRUCTURED form state (nodes / edges / branches / events), never raw
 * Mermaid syntax. Mermaid syntax is assembled at render time via
 * `assembleMermaid({ kind, source })` so theme + renderer changes don't
 * require migrations.
 *
 * Live editor: a NodeView lazy-imports Mermaid the first time a chart
 * mounts on the page, renders the SVG inside a calm wrapper, and emits
 * an `openChartBuilder` command on click (reopening the builder in
 * "edit" mode with the current attrs).
 *
 * Static render (renderDocHTML → Memory cards, ThreadPageView, pin
 * preview): emits a placeholder element only. Mermaid never loads on
 * the static path because it's ~600kB gzipped.
 *
 * Read-only mode (read-only editors, past discrete-trail pages): NodeView
 * still renders the SVG but doesn't open the builder on click — the
 * "edit nowness" rule from the canvas applies to charts too.
 */

// Build a Mermaid escape — anything that could end the bracket / label
// is replaced by a HTML-entity-style escape that Mermaid renders back
// as the literal character. Quotes around labels disambiguate punctuation.
function escapeLabel(s) {
  if (s == null) return "";
  const str = String(s).trim();
  if (!str) return " ";
  return str
    .replace(/"/g, "#quot;")
    .replace(/\n/g, " ")
    .replace(/[<>]/g, "");
}

// Stable id slug — Mermaid node ids must be alphanumeric. We never expose
// these ids to the user; they're internal to the assembled syntax.
function idSlug(raw) {
  const s = String(raw || "").replace(/[^a-zA-Z0-9_]/g, "_");
  return s || "n";
}

/**
 * Pure helper — assemble Mermaid source from structured state. Exported
 * for testing + reuse from the builder's live preview.
 */
export function assembleMermaid({ kind, source }) {
  if (!kind || !source) return "";
  if (kind === "flowchart") return assembleFlowchart(source);
  if (kind === "mindmap") return assembleMindmap(source);
  if (kind === "timeline") return assembleTimeline(source);
  return "";
}

function assembleFlowchart(source) {
  const dir = source.direction === "LR" ? "LR" : "TB";
  const nodes = Array.isArray(source.nodes) ? source.nodes : [];
  const edges = Array.isArray(source.edges) ? source.edges : [];
  const lines = [`flowchart ${dir}`];
  for (const n of nodes) {
    const id = idSlug(n.id);
    const shape = n.shape || "rect";
    let open = "[", close = "]";
    if (shape === "rounded") { open = "("; close = ")"; }
    else if (shape === "diamond") { open = "{"; close = "}"; }
    else if (shape === "circle") { open = "(("; close = "))"; }
    lines.push(`  ${id}${open}"${escapeLabel(n.label)}"${close}`);
  }
  for (const e of edges) {
    const from = idSlug(e.from);
    const to = idSlug(e.to);
    const lbl = (e.label || "").trim();
    if (lbl) {
      lines.push(`  ${from} -->|"${escapeLabel(lbl)}"| ${to}`);
    } else {
      lines.push(`  ${from} --> ${to}`);
    }
  }
  return lines.join("\n");
}

function assembleMindmap(source) {
  const central = (source.central || "idea").trim() || "idea";
  const branches = Array.isArray(source.branches) ? source.branches : [];
  const lines = ["mindmap", `  root(("${escapeLabel(central)}"))`];
  function walk(nodes, depth) {
    if (!Array.isArray(nodes)) return;
    for (const b of nodes) {
      const indent = "  ".repeat(depth + 1);
      lines.push(`${indent}${escapeLabel(b.label)}`);
      if (b.children && b.children.length) walk(b.children, depth + 1);
    }
  }
  walk(branches, 1);
  return lines.join("\n");
}

function assembleTimeline(source) {
  const events = Array.isArray(source.events) ? source.events : [];
  const lines = ["timeline"];
  if (source.title) lines.push(`  title ${escapeLabel(source.title)}`);
  for (const ev of events) {
    const date = (ev.date || "").trim();
    const label = (ev.label || "").trim();
    if (!date && !label) continue;
    const isMilestone = ev.kind === "milestone";
    const labelOut = label ? (isMilestone ? `★ ${label}` : label) : " ";
    lines.push(`  ${escapeLabel(date) || "·"} : ${escapeLabel(labelOut)}`);
  }
  return lines.join("\n");
}

// Default empty `source` for a fresh chart of each kind.
export function emptySource(kind) {
  if (kind === "flowchart") {
    return {
      direction: "TB",
      nodes: [
        { id: "a", label: "", shape: "rect" },
        { id: "b", label: "", shape: "rect" },
      ],
      edges: [{ from: "a", to: "b", label: "" }],
    };
  }
  if (kind === "mindmap") {
    return {
      central: "",
      branches: [
        { id: "b1", label: "", children: [] },
        { id: "b2", label: "", children: [] },
      ],
    };
  }
  if (kind === "timeline") {
    return {
      title: "",
      events: [
        { date: "", label: "", kind: "event" },
        { date: "", label: "", kind: "event" },
      ],
    };
  }
  return {};
}

// Lazy Mermaid loader — single shared promise so concurrent NodeView mounts
// don't trigger multiple imports. Returns the initialized mermaid module.
let mermaidPromise = null;
export async function loadMermaid() {
  if (mermaidPromise) return mermaidPromise;
  mermaidPromise = (async () => {
    const mod = await import("mermaid");
    const mermaid = mod.default || mod;
    const { buildMermaidTheme, buildMermaidThemeCSS } = await import("../render/mermaid-theme.js");
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      themeVariables: buildMermaidTheme(),
      themeCSS: buildMermaidThemeCSS(),
      flowchart: {
        useMaxWidth: true,
        htmlLabels: false,
        curve: "basis",
        padding: 16,
      },
      mindmap: { useMaxWidth: true, padding: 12 },
    });
    return mermaid;
  })();
  return mermaidPromise;
}

// Exposes the in-flight/resolved load promise without starting a load —
// lets reinitMermaidTheme() (chart-render.js) skip re-initializing a
// Mermaid instance that was never loaded in the first place, same as
// the guard this function replaces.
export function peekMermaidPromise() {
  return mermaidPromise;
}

export const Chart = Node.create({
  name: "chart",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return {
      // Page.svelte / TipTapEditor wires this to open the ChartBuilder
      // modal. Called with { mode: "edit", pos, attrs } from a NodeView
      // click and with { mode: "create", insertAt } from the slash
      // command.
      onOpen: null,
    };
  },

  addAttributes() {
    return {
      kind: {
        default: "flowchart",
        parseHTML: (el) => el.getAttribute("data-kind") || "flowchart",
        renderHTML: (attrs) => ({ "data-kind": attrs.kind || "flowchart" }),
      },
      source: {
        default: null,
        parseHTML: (el) => {
          const raw = el.getAttribute("data-source");
          if (!raw) return null;
          try { return JSON.parse(raw); } catch { return null; }
        },
        renderHTML: (attrs) => {
          if (!attrs.source) return {};
          try { return { "data-source": JSON.stringify(attrs.source) }; }
          catch { return {}; }
        },
      },
      // Legacy size attr (s / m / l). Kept on the schema so older docs
      // parse, but the NodeView reads it once on mount and migrates to
      // `width` (pixels). Removed from the renderHTML so freshly saved
      // charts no longer carry it.
      size: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-size") || null,
        renderHTML: () => ({}),
      },
      // User-set width in pixels. null means full column (default).
      // Persisted from drag-to-resize at the bottom-right corner.
      width: {
        default: null,
        parseHTML: (el) => {
          const raw = el.getAttribute("data-width");
          const n = raw ? parseInt(raw, 10) : NaN;
          return Number.isFinite(n) && n > 0 ? n : null;
        },
        renderHTML: (attrs) => attrs.width ? { "data-width": String(attrs.width) } : {},
      },
      // User-set height in pixels. null means intrinsic (SVG natural height).
      // Persisted alongside width from the same bottom-right drag.
      height: {
        default: null,
        parseHTML: (el) => {
          const raw = el.getAttribute("data-height");
          const n = raw ? parseInt(raw, 10) : NaN;
          return Number.isFinite(n) && n > 0 ? n : null;
        },
        renderHTML: (attrs) => attrs.height ? { "data-height": String(attrs.height) } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="chart"]' }];
  },

  // Static renderHTML — used by `generateHTML` for Memory cards, etc.
  // Emits a placeholder only; the live Mermaid render only happens
  // inside the NodeView. The placeholder label echoes the structured
  // shape so readers can identify the chart at a glance.
  renderHTML({ HTMLAttributes, node }) {
    const kind = node?.attrs?.kind || HTMLAttributes["data-kind"] || "flowchart";
    const source = node?.attrs?.source || null;
    let countText = kind;
    try {
      if (kind === "flowchart" && source) {
        const n = (source.nodes || []).length;
        countText = `flowchart · ${n} ${n === 1 ? "node" : "nodes"}`;
      } else if (kind === "mindmap" && source) {
        const n = (source.branches || []).length;
        countText = `mind map · ${n} ${n === 1 ? "branch" : "branches"}`;
      } else if (kind === "timeline" && source) {
        const n = (source.events || []).length;
        countText = `timeline · ${n} ${n === 1 ? "event" : "events"}`;
      }
    } catch {}
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "chart",
        "data-kind": kind,
        class: "chart-block chart-placeholder",
      }),
      ["span", { class: "chart-placeholder-glyph" }, "◇"],
      ["span", { class: "chart-placeholder-label" }, countText],
    ];
  },

  addCommands() {
    return {
      // Open the ChartBuilder modal. Called from the slash command (create
      // mode) and from NodeView clicks (edit mode). Dispatches through the
      // configured `onOpen` callback so the host UI owns modal mounting.
      openChartBuilder: (params) => ({ editor: e }) => {
        const onOpen = this.options.onOpen;
        if (typeof onOpen === "function") {
          onOpen({ ...(params || {}), editor: e });
        }
        return true;
      },
      // Update an existing chart's attrs at `pos`. Used by the builder's
      // save flow when reopened in edit mode.
      updateChart: ({ pos, attrs }) => ({ editor: e, tr, dispatch }) => {
        if (typeof pos !== "number") return false;
        const node = e.state.doc.nodeAt(pos);
        if (!node || node.type.name !== "chart") return false;
        if (dispatch) {
          if (attrs.kind !== undefined) tr.setNodeAttribute(pos, "kind", attrs.kind);
          if (attrs.source !== undefined) tr.setNodeAttribute(pos, "source", attrs.source);
          if (attrs.size !== undefined) tr.setNodeAttribute(pos, "size", attrs.size);
          if (attrs.width !== undefined) tr.setNodeAttribute(pos, "width", attrs.width);
          if (attrs.height !== undefined) tr.setNodeAttribute(pos, "height", attrs.height);
          if (attrs.blockTitle !== undefined) tr.setNodeAttribute(pos, "blockTitle", attrs.blockTitle);
          dispatch(tr);
        }
        return true;
      },
      // Insert a new chart node at the current selection. The chart is
      // followed by a fresh paragraph so the cursor has somewhere to
      // land after the user dismisses the builder.
      insertChart: ({ attrs }) => ({ editor: e, tr, dispatch }) => {
        const node = e.schema.nodes.chart.create(attrs);
        const para = e.schema.nodes.paragraph.create();
        const sel = e.state.selection.$from;
        // Replace the empty paragraph the caret is sitting in, rather than
        // inserting into it.
        //
        // `/chart` runs through prepareInsertionPoint like every other
        // BLOCK_COMMANDS entry, which opens a FRESH empty line before the
        // builder is opened — correct, because a block command typed on a
        // written line must not swallow that line. But the chart itself
        // arrives later, from the builder's save, and inserting at
        // `selection.from` puts it INSIDE that empty paragraph, which then
        // survives above it: `/chart` on a written line produced
        // paragraph, EMPTY paragraph, chart, paragraph.
        //
        // Every other board avoids this with
        // insertBoardReplacingEmptyLeadingParagraph (slash-commands.js:117)
        // — q&a, recipe and outline all use it, and chart alone did not,
        // because chart is the one board whose insert is a separate
        // command run after an async round trip through a modal.
        //
        // Same test as that helper's: top level, a paragraph, and empty.
        // Nested or alongside text, the old behaviour is right and stands.
        const onEmptyTopLevelParagraph =
          sel.depth === 1 &&
          sel.parent.type.name === "paragraph" &&
          sel.parent.content.size === 0;
        const pos = onEmptyTopLevelParagraph ? sel.before(1) : e.state.selection.from;
        if (dispatch) {
          if (onEmptyTopLevelParagraph) {
            tr.replaceWith(pos, pos + sel.parent.nodeSize, [node, para]);
          } else {
            tr.insert(pos, [node, para]);
          }
          // Place cursor in the trailing paragraph.
          const after = pos + node.nodeSize + 1;
          tr.setSelection(TextSelection.near(tr.doc.resolve(after)));
          dispatch(tr);
        }
        return true;
      },
    };
  },

  addNodeView() {
    return ({ node, editor, getPos, extension }) => {
      // ── Shared chrome via BlockShell (same factory list/blockquote/qaBlock/
      // recipeBlock/codeBlock already use) ──. Chart is atom: true (no
      // ProseMirror content), so the shell's generic contentDOM is
      // discarded — mirrors code-block.js's exact precedent, which also
      // supplies its own content host in place of the shell's contentDOM.
      const shell = createBlockShell({ node, view: editor.view, getPos, ext: extension });
      const wrap = shell.dom;
      // Kept as an additional class (not a replacement) so every existing
      // `.chart-block` CSS/JS selector keeps working unchanged.
      wrap.classList.add("chart-block");
      wrap.setAttribute("data-type", "chart");
      wrap.setAttribute("data-kind", node.attrs.kind || "flowchart");
      wrap.setAttribute("contenteditable", "false");
      const initialTitle = (node.attrs.blockTitle || "").trim();
      if (initialTitle) wrap.setAttribute("data-block-title", initialTitle);

      const titleSlot = shell.titleSlot;
      const chip = shell.chip;
      shell.contentDOM.remove();

      // ── Title editing via shared bindTitleSlot ──
      // resolveContentPos is a no-op: chart is atom — there's no textblock
      // inside it for ArrowDown/Enter to land in, so the title's exit-
      // downward paths just fall back to view.focus() (see title-slot.js's
      // moveCursorToContent / commitTitleAndEnterBoard, both of which no-op
      // gracefully on a negative contentPos).
      if (!editor.isEditable) titleSlot.disabled = true;
      const titleApi = bindTitleSlot({
        titleSlot,
        view: editor.view,
        getPos,
        ext: extension,
        resolveContentPos: () => -1,
        onTitleRender: (t) => shell.setTitle(t),
      });
      titleApi.refresh(node);

      // Migrate legacy size attr (s/m/l) to a numeric pixel width once
      // on mount. Existing charts saved before the resize-handle redesign
      // carry data-size; convert, persist the new width, and let
      // size linger as a no-op (renderHTML drops it on next save).
      const legacySizeToPx = { s: 320, m: 480, l: 640 };
      let initialWidth = node.attrs.width;
      if (!initialWidth && node.attrs.size && legacySizeToPx[node.attrs.size]) {
        initialWidth = legacySizeToPx[node.attrs.size];
        // Defer the dispatch so the NodeView finishes mounting before we
        // trigger an attr update (avoids a remount mid-mount).
        queueMicrotask(() => {
          if (cancelled) return;
          if (typeof getPos !== "function") return;
          const pos = getPos();
          if (typeof pos !== "number") return;
          editor.commands.updateChart({
            pos,
            attrs: { width: initialWidth, size: null },
          });
        });
      }
      const initialHeight = node.attrs.height;
      if (initialWidth) wrap.style.width = `${initialWidth}px`;
      if (initialHeight) wrap.style.height = `${initialHeight}px`;
      wrap.classList.toggle("chart-sized-w", !!initialWidth);
      wrap.classList.toggle("chart-sized-h", !!initialHeight);

      const renderHost = document.createElement("div");
      renderHost.className = "chart-render";
      // Inserted before the chip (not appended) — final DOM order is
      // titleSlot, renderHost, resizeHandle, chip, matching code-block.js's
      // titleSlot/header/pre/chip ordering.
      wrap.insertBefore(renderHost, chip);

      // Resize handle — bottom-right corner. Drag horizontally to change
      // width, vertically to change height; both persist on `pointerup`.
      // Clicks stop propagation so they don't bubble to the chart-click-
      // to-edit handler.
      const resizeHandle = document.createElement("div");
      resizeHandle.className = "chart-resize-handle";
      resizeHandle.setAttribute("contenteditable", "false");
      resizeHandle.setAttribute("aria-label", "resize chart");
      resizeHandle.setAttribute("title", "drag to resize");
      wrap.insertBefore(resizeHandle, chip);

      let dragState = null;
      function onResizeStart(e) {
        if (!editor.isEditable) return;
        e.preventDefault();
        e.stopPropagation();
        const rect = wrap.getBoundingClientRect();
        dragState = {
          startX: e.clientX,
          startY: e.clientY,
          startWidth: rect.width,
          startHeight: rect.height,
        };
        document.addEventListener("pointermove", onResizeMove);
        document.addEventListener("pointerup", onResizeEnd);
        wrap.classList.add("chart-resizing");
      }
      function onResizeMove(e) {
        if (!dragState) return;
        const dx = e.clientX - dragState.startX;
        const dy = e.clientY - dragState.startY;
        const nextW = Math.max(200, Math.min(1200, Math.round(dragState.startWidth + dx)));
        const nextH = Math.max(120, Math.min(1200, Math.round(dragState.startHeight + dy)));
        wrap.style.width = `${nextW}px`;
        wrap.style.height = `${nextH}px`;
        wrap.classList.add("chart-sized-w");
        wrap.classList.add("chart-sized-h");
      }
      function onResizeEnd() {
        if (!dragState) return;
        document.removeEventListener("pointermove", onResizeMove);
        document.removeEventListener("pointerup", onResizeEnd);
        wrap.classList.remove("chart-resizing");
        dragState = null;
        if (typeof getPos !== "function") return;
        const pos = getPos();
        if (typeof pos !== "number") return;
        const rect = wrap.getBoundingClientRect();
        const finalWidth = Math.round(rect.width);
        const finalHeight = Math.round(rect.height);
        editor.commands.updateChart({
          pos,
          attrs: {
            kind: currentKind,
            source: currentSource,
            width: finalWidth,
            height: finalHeight,
          },
        });
      }
      resizeHandle.addEventListener("pointerdown", onResizeStart);
      resizeHandle.addEventListener("click", (e) => e.stopPropagation());

      // Loading state placeholder — keeps a stable visual frame while
      // Mermaid is being lazy-imported on first chart mount.
      renderHost.innerHTML = `
        <div class="chart-loading">
          <span class="chart-placeholder-glyph">◇</span>
          <span class="chart-placeholder-label">${node.attrs.kind || "chart"}</span>
        </div>
      `;

      let currentKind = node.attrs.kind;
      let currentSource = node.attrs.source;
      let cancelled = false;
      let isRendering = false;
      let queuedRender = false;

      async function render() {
        if (cancelled) return;
        if (isRendering) {
          queuedRender = true;
          return;
        }
        isRendering = true;
        try {
          await renderMermaidInto(renderHost, { kind: currentKind, source: currentSource });
        } finally {
          isRendering = false;
          if (queuedRender) {
            queuedRender = false;
            render();
          }
        }
      }

      render();

      // Re-render when canvas tone flips (data-tone on documentElement).
      //
      // A MutationObserver fires on every setAttribute call, even one that
      // rewrites the SAME value — the VR boot path does exactly that
      // (bootstrap.js sets data-tone once, then App.svelte's onMount calls
      // applyTone(tone) again with the same value on the VR path), and so
      // does a production re-save of the current theme or reopening the
      // theme menu without changing it. Every one of those used to re-run
      // reinitMermaidTheme() + a full Mermaid re-render for nothing —
      // wasted work always, and on VR specifically a race: the screenshot
      // sometimes landed between the first render and this redundant
      // second one, catching the chart mid-rebuild (Task 6:
      // page-chart-content / page-empty-chart's load-time baselines).
      // Compare each record's oldValue against the CURRENT attribute value
      // (not against each other) and skip entirely when nothing changed.
      const themeObserver = new MutationObserver(async (records) => {
        const changed = records.some(
          (r) => r.oldValue !== document.documentElement.getAttribute(r.attributeName),
        );
        if (!changed) return;
        await reinitMermaidTheme();
        if (!cancelled) render();
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-tone", "class"],
        attributeOldValue: true,
      });

      // Click → reopen builder in edit mode. Skip in read-only editors
      // (past discrete-trail pages, ThreadPageView, pin previews) so the
      // "edit nowness" rule applies to charts too.
      function handleClick(e) {
        if (!editor.isEditable) return;
        // The title <input> is a descendant of `wrap`, so a click landing on
        // it would otherwise bubble here and reopen the builder mid-typing.
        // This guard is UNREACHABLE today: bindTitleSlot calls
        // stopPropagation on the slot's own mousedown/click in the target
        // phase, so such a click never reaches this listener at all. It is
        // kept deliberately, as the local defence for this NodeView if
        // title-slot's propagation contract ever changes (or a new descendant
        // control is wired without one) — not because it fires now.
        if (e.target instanceof Element && e.target.closest(".board-title-slot")) return;
        e.preventDefault();
        e.stopPropagation();
        if (typeof getPos !== "function") return;
        const pos = getPos();
        if (typeof pos !== "number") return;
        const liveNode = editor.state.doc.nodeAt(pos);
        const blockTitle = liveNode?.attrs?.blockTitle ?? null;
        editor.commands.openChartBuilder({
          mode: "edit",
          pos,
          attrs: { kind: currentKind, source: currentSource, blockTitle },
        });
      }
      wrap.addEventListener("click", handleClick);
      wrap.addEventListener("mousedown", (e) => e.preventDefault());

      // Toggle pointer cursor based on editability so the visual affordance
      // matches the actual click behavior (no pointer on read-only mounts).
      function applyEditableClass() {
        wrap.classList.toggle("chart-editable", editor.isEditable);
      }
      applyEditableClass();

      return {
        dom: wrap,
        update(updatedNode) {
          if (updatedNode.type.name !== "chart") return false;
          const newKind = updatedNode.attrs.kind;
          const newSource = updatedNode.attrs.source;
          const kindChanged = newKind !== currentKind;
          const sourceChanged = JSON.stringify(newSource) !== JSON.stringify(currentSource);
          if (kindChanged || sourceChanged) {
            currentKind = newKind;
            currentSource = newSource;
            wrap.setAttribute("data-kind", currentKind || "flowchart");
            render();
          }
          // Sync width + height from attrs → inline style. Only overwrite
          // when no drag is in flight (drag handler writes directly).
          if (!dragState) {
            const newWidth = updatedNode.attrs.width || null;
            const newHeight = updatedNode.attrs.height || null;
            if (newWidth) wrap.style.width = `${newWidth}px`;
            else wrap.style.removeProperty("width");
            if (newHeight) wrap.style.height = `${newHeight}px`;
            else wrap.style.removeProperty("height");
            wrap.classList.toggle("chart-sized-w", !!newWidth);
            wrap.classList.toggle("chart-sized-h", !!newHeight);
          }
          // Title sync via shared helper — also covers the data-block-title
          // attr the CSS pseudo-element / static render reads, same as the
          // manual sync this replaces (see titleApi's onTitleRender above).
          titleApi.refresh(updatedNode);
          if (titleSlot.disabled !== !editor.isEditable) {
            titleSlot.disabled = !editor.isEditable;
          }
          applyEditableClass();
          return true;
        },
        destroy() {
          cancelled = true;
          themeObserver.disconnect();
          wrap.removeEventListener("click", handleClick);
          resizeHandle.removeEventListener("pointerdown", onResizeStart);
          document.removeEventListener("pointermove", onResizeMove);
          document.removeEventListener("pointerup", onResizeEnd);
          titleApi.destroy();
        },
        // Mermaid SVGs include text — let ProseMirror know not to attempt
        // to put selections inside this atom (but not the title slot,
        // handled by stopEvent below — the title text is real editable
        // input, not part of the atom's rendered content).
        ignoreMutation() { return true; },
        stopEvent(event) {
          return event.target === titleSlot;
        },
      };
    };
  },
});
