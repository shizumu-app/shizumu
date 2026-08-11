import { placeMenu } from "../editor/menu-placement.js";
import { Extension } from "@tiptap/core";
import { Suggestion } from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import { getLineages, searchPagesForMention, searchPinsForMention } from "../api.js";
import { buildMentionLabel } from "../mention-label.js";

// Unique plugin key — see slash-commands.js for the rationale.
const MentionCommandPluginKey = new PluginKey("mentionCommand");

const REF_LIMIT = 50;

// ----- styling helpers -----

function createMenu() {
  const el = document.createElement("div");
  el.className = "mention-command-menu";
  el.style.cssText = `
    position: fixed;
    z-index: 200;
    background: var(--canvas-bg, #f5f0e8);
    box-shadow: 0 4px 16px rgba(0,0,0,0.1);
    border-radius: 6px;
    padding: 4px 0;
    min-width: min(320px, calc(100vw - 16px));
    max-width: 480px;
    overflow-y: auto;
    display: none;
  `;
  document.body.appendChild(el);
  return el;
}

function rowStyle(selected, clickable) {
  return `
    display: flex; align-items: baseline; justify-content: space-between;
    gap: 12px; width: 100%;
    background: ${selected ? "rgba(0,0,0,0.06)" : "transparent"};
    border: none; cursor: ${clickable ? "pointer" : "default"};
    padding: 6px 14px; text-align: left;
  `;
}

function sectionDivider() {
  const hr = document.createElement("div");
  hr.style.cssText = `
    height: 1px;
    margin: 4px 0;
    background: color-mix(in srgb, var(--ink, #1a1410) 7%, transparent);
  `;
  return hr;
}

function sectionLabel(text, accent) {
  const el = document.createElement("div");
  el.style.cssText = `
    font-family: 'Inter', sans-serif;
    font-size: 10px;
    letter-spacing: 0.05em;
    text-transform: lowercase;
    color: ${accent ? "var(--warm-accent, #C44D28)" : "var(--ink, #1a1410)"};
    opacity: ${accent ? "0.75" : "0.35"};
    padding: 6px 14px 2px;
  `;
  el.textContent = text;
  return el;
}

function appendRefRow(menuEl, item, selected, onSelect) {
  const btn = document.createElement("button");
  btn.style.cssText = rowStyle(selected, true);
  btn.onclick = onSelect;

  const titleSpan = document.createElement("span");
  titleSpan.style.cssText = "font-family: 'Lora', serif; font-size: 14px; color: var(--ink, #1a1410); opacity: 0.85; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";
  titleSpan.textContent = `→ ${item.label}`;

  const cue = document.createElement("span");
  cue.style.cssText = "font-family: 'Inter', sans-serif; font-size: 10px; color: var(--ink, #1a1410); opacity: 0.3; flex-shrink: 0;";
  cue.textContent = selected ? "enter ↵" : "";

  btn.appendChild(titleSpan);
  btn.appendChild(cue);
  menuEl.appendChild(btn);
}

function appendPinRefRow(menuEl, item, selected, onSelect) {
  const btn = document.createElement("button");
  btn.style.cssText = rowStyle(selected, true);
  btn.onclick = onSelect;

  // Warm-accent the leading arrow so pins read as visually distinct from
  // page rows (which use ink-colored "→"). The label itself stays in ink
  // for legibility against the cream canvas.
  const titleSpan = document.createElement("span");
  titleSpan.style.cssText = "font-family: 'Lora', serif; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";
  const arrow = document.createElement("span");
  arrow.style.cssText = "color: var(--warm-accent, #C44D28); opacity: 0.92; margin-right: 4px;";
  arrow.textContent = "↗";
  const label = document.createElement("span");
  label.style.cssText = "color: var(--ink, #1a1410); opacity: 0.85;";
  label.textContent = item.label;
  titleSpan.appendChild(arrow);
  titleSpan.appendChild(label);

  const right = document.createElement("span");
  right.style.cssText = "display: flex; align-items: baseline; gap: 8px; flex-shrink: 0;";
  const scopeBadge = document.createElement("span");
  scopeBadge.style.cssText = "font-family: 'Inter', sans-serif; font-size: 10px; color: var(--warm-accent); opacity: 0.55; letter-spacing: 0.02em;";
  scopeBadge.textContent = item.scope;
  right.appendChild(scopeBadge);

  if (selected) {
    const cue = document.createElement("span");
    cue.style.cssText = "font-family: 'Inter', sans-serif; font-size: 10px; color: var(--ink, #1a1410); opacity: 0.3;";
    cue.textContent = "enter ↵";
    right.appendChild(cue);
  }

  btn.appendChild(titleSpan);
  btn.appendChild(right);
  menuEl.appendChild(btn);
}

function appendCreateRow(menuEl, item, selected, onSelect) {
  const btn = document.createElement("button");
  btn.style.cssText = rowStyle(selected, true);
  btn.onclick = onSelect;

  const titleSpan = document.createElement("span");
  titleSpan.style.cssText = "font-family: 'Lora', serif; font-size: 14px; color: var(--ink, #1a1410); opacity: 0.85;";
  if (item.kind === "subtrail") {
    titleSpan.textContent = `new subtrail of "${item.parentName || "trail"}" · ${item.query}`;
  } else {
    titleSpan.textContent = `new trail · ${item.query}`;
  }

  const right = document.createElement("span");
  right.style.cssText = "display: flex; align-items: baseline; gap: 8px; flex-shrink: 0;";

  const modeBadge = document.createElement("span");
  modeBadge.style.cssText = "font-family: 'Inter', sans-serif; font-size: 10px; color: var(--ink, #1a1410); opacity: 0.5; letter-spacing: 0.04em;";
  modeBadge.textContent = item.mode;
  right.appendChild(modeBadge);

  if (selected) {
    const hint = document.createElement("span");
    hint.style.cssText = "font-family: 'Inter', sans-serif; font-size: 10px; color: var(--ink, #1a1410); opacity: 0.3;";
    hint.textContent = "tab toggles · enter ↵";
    right.appendChild(hint);
  }

  btn.appendChild(titleSpan);
  btn.appendChild(right);
  menuEl.appendChild(btn);
}

function appendPlaceholder(menuEl, text) {
  const ph = document.createElement("div");
  ph.style.cssText = rowStyle(false, false);
  const titleSpan = document.createElement("span");
  titleSpan.style.cssText = "font-family: 'Lora', serif; font-size: 14px; color: var(--ink, #1a1410); opacity: 0.45;";
  titleSpan.textContent = text;
  ph.appendChild(titleSpan);
  menuEl.appendChild(ph);
}

function renderMenu(menuEl, items, selectedIndex, dispatch) {
  menuEl.innerHTML = "";
  if (items.length === 0) {
    appendPlaceholder(menuEl, "type a name");
    return;
  }

  // Section labels above each group make pages vs pins vs create-actions
  // visually distinct at a glance, since the row arrows alone read as similar.
  let lastKind = null;
  items.forEach((item, i) => {
    const startsPages = item.kind === "ref" && lastKind !== "ref";
    const startsPins = item.kind === "pin-ref" && lastKind !== "pin-ref";
    const startsCreate = (item.kind === "create-subtrail" || item.kind === "create-toplevel") && lastKind !== "create";

    if (startsPages) {
      menuEl.appendChild(sectionLabel("pages", false));
    }
    if (startsPins) {
      if (lastKind) menuEl.appendChild(sectionDivider());
      menuEl.appendChild(sectionLabel("pins", true));
    }
    if (startsCreate) {
      if (lastKind) menuEl.appendChild(sectionDivider());
      menuEl.appendChild(sectionLabel("create", false));
    }

    if (item.kind === "ref") {
      appendRefRow(menuEl, item, i === selectedIndex, () => dispatch(i));
      lastKind = "ref";
    } else if (item.kind === "pin-ref") {
      appendPinRefRow(menuEl, item, i === selectedIndex, () => dispatch(i));
      lastKind = "pin-ref";
    } else if (item.kind === "create-subtrail") {
      appendCreateRow(menuEl, { ...item, kind: "subtrail" }, i === selectedIndex, () => dispatch(i));
      lastKind = "create";
    } else if (item.kind === "create-toplevel") {
      appendCreateRow(menuEl, { ...item, kind: "toplevel" }, i === selectedIndex, () => dispatch(i));
      lastKind = "create";
    }
  });
}

function positionMenu(menuEl, rect) {
  if (!menuEl || !rect) return;
  menuEl.style.visibility = "hidden";
  menuEl.style.top = "0px";
  menuEl.style.left = "0px";
  menuEl.style.maxHeight = "";
  menuEl.style.display = "block";

  const vv = window.visualViewport;
  const cs = getComputedStyle(document.documentElement);
  const px = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };

  const { top, left, maxHeight } = placeMenu({
    caretRect: rect,
    menuH: menuEl.offsetHeight,
    menuW: menuEl.offsetWidth,
    // visualViewport, not innerHeight: the layout viewport's keyboard
    // behaviour is engine-dependent, and this menu is opened by typing.
    vh: (vv && vv.height) || window.innerHeight,
    vw: (vv && vv.width) || window.innerWidth,
    safeTop: px(cs.getPropertyValue("--safe-top")),
    safeBottom: px(cs.getPropertyValue("--safe-bottom")),
  });

  menuEl.style.top = `${top}px`;
  menuEl.style.left = `${left}px`;
  // Replaces the fixed 380px cap in createMenu, which was a guess rather
  // than a fit: nothing compared it to what was left of the screen.
  menuEl.style.maxHeight = `${maxHeight}px`;
  menuEl.style.overflowY = "auto";
  menuEl.style.visibility = "visible";
}

// ----- the extension -----

export const MentionCommand = Extension.create({
  name: "mentionCommand",
  // Higher priority than the unified list extension — see slash-commands.js
  // for the rationale.
  priority: 1000,

  addOptions() {
    return {
      // onCreate(name, mode) — mode is "subtrail" or "toplevel"
      onCreate: null,
      // onNavigate(pageId) — fired when the user picks a reference row
      // (the editor inserts the node; navigation is the host's job).
      // Currently unused on the popup side — kept for symmetry with PageRef.
      // Getter for the current page's lineage:
      //   getCurrentLineage() => { id, name } | null
      getCurrentLineage: () => null,
      suggestion: {
        char: "@",
        pluginKey: MentionCommandPluginKey,
        allowSpaces: false,
        startOfLine: false,
        // Suggestion's command runs when an item is committed. The selected
        // item carries `kind` plus everything needed to commit.
        command: ({ editor, range, props }) => {
          if (!props || props.kind === "placeholder") return;
          if (props.kind === "ref") {
            editor
              .chain()
              .focus()
              .deleteRange(range)
              .insertContent({
                type: "pageRef",
                attrs: { targetId: props.pageId, labelSnapshot: props.label },
              })
              .run();
            return;
          }
          if (props.kind === "pin-ref") {
            editor
              .chain()
              .focus()
              .deleteRange(range)
              .insertContent({
                type: "pinRef",
                attrs: { pinId: props.pinId, labelSnapshot: props.label },
              })
              .run();
            return;
          }
          if (props.kind === "create-subtrail" || props.kind === "create-toplevel") {
            const name = (props.query || "").trim();
            if (!name) return;
            // Replace the @query with a pageRef whose targetId is empty.
            // The host's onCreate then creates the lineage + page and calls
            // back to populate the targetId once it knows the new page id,
            // so returning to this page later still shows the reference.
            editor
              .chain()
              .focus()
              .deleteRange(range)
              .insertContent({
                type: "pageRef",
                attrs: { targetId: "", labelSnapshot: name },
              })
              .run();
            if (typeof props.onCreate === "function") {
              const mode = props.kind === "create-subtrail" ? "subtrail" : "toplevel";
              props.onCreate(name, mode, props.mode);
            }
          }
        },
      },
    };
  },

  addProseMirrorPlugins() {
    const ext = this;
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
        pluginKey: MentionCommandPluginKey,

        items: async ({ query }) => {
          const trimmed = (query || "").trim();
          const cur = ext.options.getCurrentLineage?.() || null;
          const onCreate = ext.options.onCreate;

          // Reference rows (pages) + pin reference rows + create rows, in
          // that order. Pin section gets its own divider in renderMenu so
          // the user sees three groups: pages · pins · new.
          let refRows = [];
          let pinRefRows = [];
          try {
            const [pageRows, pinRows, lineages] = await Promise.all([
              searchPagesForMention(trimmed, REF_LIMIT),
              searchPinsForMention(trimmed, 10, cur?.id || null),
              getLineages(),
            ]);
            refRows = pageRows.map((row) => ({
              kind: "ref",
              pageId: row.page_id,
              label: buildMentionLabel({ page: row, lineages }),
            }));
            // Dedupe: a continuous trail's canonical may match by both
            // lineage name and focus; keep first.
            const seen = new Set();
            refRows = refRows.filter((r) => {
              if (seen.has(r.pageId)) return false;
              seen.add(r.pageId);
              return true;
            });
            pinRefRows = (pinRows || []).map((row) => ({
              kind: "pin-ref",
              pinId: row.id,
              label: (row.title && row.title.trim()) || "untitled pin",
              scope: row.scope_label || "global",
            }));
          } catch {
            refRows = [];
            pinRefRows = [];
          }

          // Create rows only when the user has typed something.
          const createRows = [];
          if (trimmed.length > 0) {
            if (cur && cur.id) {
              createRows.push({
                kind: "create-subtrail",
                parentName: cur.name,
                parentId: cur.id,
                query: trimmed,
                mode: "discrete",
                onCreate,
              });
            }
            createRows.push({
              kind: "create-toplevel",
              query: trimmed,
              mode: "discrete",
              onCreate,
            });
          }

          return [...refRows, ...pinRefRows, ...createRows];
        },

        render: () => {
          let menuEl = null;
          let currentItems = [];
          let selectedIndex = 0;
          let activeProps = null;

          const dispatchByIndex = (i) => {
            if (!activeProps) return;
            const item = currentItems[i];
            if (!item) return;
            activeProps.command(item);
          };

          return {
            onStart: (props) => {
              menuEl = createMenu();
              currentItems = props.items || [];
              selectedIndex = 0;
              activeProps = props;
              renderMenu(menuEl, currentItems, selectedIndex, dispatchByIndex);
              if (props.clientRect) positionMenu(menuEl, props.clientRect());
            },

            onUpdate: (props) => {
              currentItems = props.items || [];
              if (selectedIndex >= currentItems.length) selectedIndex = 0;
              activeProps = props;
              renderMenu(menuEl, currentItems, selectedIndex, dispatchByIndex);
              if (props.clientRect) positionMenu(menuEl, props.clientRect());
            },

            onKeyDown: ({ event }) => {
              const actionable = currentItems.filter((it) => it.kind !== "placeholder");
              if (event.key === "ArrowDown") {
                if (actionable.length <= 1) return false;
                event.preventDefault();
                selectedIndex = (selectedIndex + 1) % currentItems.length;
                renderMenu(menuEl, currentItems, selectedIndex, dispatchByIndex);
                return true;
              }
              if (event.key === "ArrowUp") {
                if (actionable.length <= 1) return false;
                event.preventDefault();
                selectedIndex = (selectedIndex - 1 + currentItems.length) % currentItems.length;
                renderMenu(menuEl, currentItems, selectedIndex, dispatchByIndex);
                return true;
              }
              if (event.key === "Tab") {
                const item = currentItems[selectedIndex];
                if (item && (item.kind === "create-subtrail" || item.kind === "create-toplevel")) {
                  event.preventDefault();
                  item.mode = item.mode === "discrete" ? "continuous" : "discrete";
                  renderMenu(menuEl, currentItems, selectedIndex, dispatchByIndex);
                  return true;
                }
                return false;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                if (actionable.length === 0) return true;
                dispatchByIndex(selectedIndex);
                return true;
              }
              if (event.key === "Escape") {
                return true;
              }
              return false;
            },

            onExit: () => {
              if (menuEl) {
                menuEl.remove();
                menuEl = null;
              }
              currentItems = [];
              selectedIndex = 0;
              activeProps = null;
            },
          };
        },
      }),
    ];
  },
});
