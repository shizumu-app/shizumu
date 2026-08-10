import { Node, mergeAttributes } from "@tiptap/core";
import { getPinForReference } from "../api.js";
import {
  mountPreviewCard,
  destroyPreview,
  getActivePreviewOwner,
} from "../render/preview-card.js";
import { renderDocHTML } from "../render/doc-renderer.js";

/**
 * `pinRef` — inline TipTap node that references a pin by id.
 *
 * Mirrors `pageRef`'s architecture step-for-step:
 *   - NodeView resolves the pin's current title via `getPinForReference(id)`,
 *     keyed on a module-level cache.
 *   - Hover after 300ms mounts the shared preview card with the pin's own
 *     cached content rendered via renderDocHTML.
 *   - Click invokes the configured `onNavigate(pinId)` callback (Page.svelte
 *     wires this to "open the pin's modal in the pin panel", same way the
 *     pageRef click navigates to the target page).
 *
 * Inline rendering: `↗ <pin title>` styled like pageRef (dotted underline,
 * warm-accent). Distinguishes from `→ <trail:focus>` (pageRef) by glyph.
 *
 * Cache invalidation: piggybacks on `shizumu:trail-mutated` — pin rename,
 * scope change, and delete already fire that event (or should). All
 * pinRef NodeViews re-resolve when invalidation fires.
 *
 * Storage: `{ type: "pinRef", attrs: { pinId, labelSnapshot } }`. No
 * schema migration needed; pins already have stable IDs.
 */

const labelCache = new Map(); // pinId -> { label: string|null, scope: string|null }
const pendingFetches = new Map();
const listeners = new Set();

function clearCache() {
  labelCache.clear();
  pendingFetches.clear();
  for (const fn of listeners) {
    try { fn(null); } catch {}
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("shizumu:trail-mutated", clearCache);
}

async function resolveLabel(pinId) {
  if (!pinId) return null;
  const cached = labelCache.get(pinId);
  if (cached) return cached.label;

  let pending = pendingFetches.get(pinId);
  if (!pending) {
    pending = (async () => {
      try {
        const row = await getPinForReference(pinId);
        if (!row) {
          labelCache.set(pinId, { label: null, scope: null });
          return null;
        }
        const label = (row.title && row.title.trim()) || "untitled pin";
        labelCache.set(pinId, { label, scope: row.scope_label || null, content: row.content || null, updated_at: row.updated_at || null });
        return label;
      } finally {
        pendingFetches.delete(pinId);
      }
    })();
    pendingFetches.set(pinId, pending);
  }
  return pending;
}

function subscribeInvalidation(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Build a preview entry shape compatible with `mountPreviewCard`. */
async function getPinPreviewFor(pinId) {
  if (!pinId) return null;
  // Ensure the pin row is in cache (resolveLabel populates it).
  await resolveLabel(pinId);
  const entry = labelCache.get(pinId);
  if (!entry || !entry.label) return null;
  const docJson = entry.content;
  return {
    date: entry.scope || "global",
    fullPath: `↗ ${entry.label}`,
    docJson,
    cacheKey: `pin:${pinId}:${entry.updated_at || ""}:preview`,
    snippet: "",
  };
}

export const PinRef = Node.create({
  name: "pinRef",
  inline: true,
  group: "inline",
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return {
      // Page.svelte wires this to "show the pin modal for this pinId".
      onNavigate: null,
    };
  },

  addAttributes() {
    return {
      pinId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-pin-id"),
        renderHTML: (attrs) => attrs.pinId ? { "data-pin-id": attrs.pinId } : {},
      },
      labelSnapshot: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-snapshot"),
        renderHTML: (attrs) => attrs.labelSnapshot ? { "data-snapshot": attrs.labelSnapshot } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-pin-ref]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const snapshot = node?.attrs?.labelSnapshot || HTMLAttributes["data-snapshot"] || "";
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-pin-ref": "",
        class: "pin-ref",
      }),
      `↗ ${snapshot}`,
    ];
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const onNavigate = this.options.onNavigate;
      const pinId = node.attrs.pinId;
      const initialSnapshot = node.attrs.labelSnapshot ?? "";

      const wrap = document.createElement("span");
      wrap.className = "pin-ref";
      wrap.setAttribute("data-pin-ref", "");
      wrap.setAttribute("data-pin-id", pinId ?? "");
      wrap.setAttribute("contenteditable", "false");

      let currentLabel = initialSnapshot;
      let isMissing = false;

      function persistSnapshot(label) {
        if (typeof getPos !== "function" || !editor?.view) return;
        try {
          const pos = getPos();
          if (typeof pos !== "number") return;
          const tr = editor.view.state.tr.setNodeAttribute(pos, "labelSnapshot", label);
          editor.view.dispatch(tr);
        } catch {}
      }

      function removeNode() {
        if (typeof getPos !== "function" || !editor?.view) return;
        try {
          const pos = getPos();
          if (typeof pos !== "number") return;
          const tr = editor.view.state.tr.delete(pos, pos + node.nodeSize);
          editor.view.dispatch(tr);
        } catch {}
      }

      function render() {
        wrap.innerHTML = "";
        wrap.classList.toggle("pin-ref--deleted", isMissing);
        const arrow = document.createElement("span");
        arrow.className = "pin-ref-arrow";
        arrow.textContent = "↗";
        const labelEl = document.createElement("span");
        labelEl.className = "pin-ref-label";
        labelEl.textContent = isMissing
          ? `(deleted: ${currentLabel || "?"})`
          : (currentLabel || "…");
        wrap.appendChild(arrow);
        wrap.appendChild(document.createTextNode(" "));
        wrap.appendChild(labelEl);

        if (isMissing) {
          const removeBtn = document.createElement("button");
          removeBtn.type = "button";
          removeBtn.className = "pin-ref-remove";
          removeBtn.setAttribute("contenteditable", "false");
          removeBtn.title = "remove this reference";
          removeBtn.textContent = "×";
          removeBtn.addEventListener("mousedown", (e) => e.preventDefault());
          removeBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            removeNode();
          });
          wrap.appendChild(removeBtn);
        }
      }

      async function resolveAndRender() {
        if (!pinId) {
          isMissing = true;
          render();
          return;
        }
        try {
          const resolved = await resolveLabel(pinId);
          if (resolved == null) {
            isMissing = true;
          } else {
            isMissing = false;
            if (resolved !== currentLabel) {
              currentLabel = resolved;
              persistSnapshot(resolved);
            }
          }
          render();
        } catch {
          render();
        }
      }

      render();
      resolveAndRender();

      const unsubscribe = subscribeInvalidation(() => {
        resolveAndRender();
      });

      let hoverTimer = null;
      let leaveTimer = null;
      const HOVER_DELAY = 300;
      const LEAVE_GRACE = 80;

      function cancelHoverTimer() { if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; } }
      function cancelLeaveTimer() { if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; } }

      wrap.addEventListener("mouseenter", () => {
        if (isMissing || !pinId) return;
        cancelLeaveTimer();
        cancelHoverTimer();
        hoverTimer = setTimeout(async () => {
          try {
            const entry = await getPinPreviewFor(pinId);
            if (!entry) return;
            if (!wrap.matches(":hover") && getActivePreviewOwner() !== wrap) return;
            mountPreviewCard(wrap, wrap, entry, () => {
              if (typeof onNavigate === "function" && pinId) onNavigate(pinId);
            });
          } catch {}
        }, HOVER_DELAY);
      });
      wrap.addEventListener("mouseleave", () => {
        cancelHoverTimer();
        cancelLeaveTimer();
        leaveTimer = setTimeout(() => {
          if (getActivePreviewOwner() === wrap) {
            const cardEl = document.querySelector(".page-ref-preview");
            if (!cardEl || !cardEl.matches(":hover")) destroyPreview();
          }
        }, LEAVE_GRACE);
      });

      wrap.addEventListener("mousedown", (e) => e.preventDefault());
      wrap.addEventListener("click", (e) => {
        if (isMissing) return;
        e.preventDefault();
        e.stopPropagation();
        destroyPreview();
        if (typeof onNavigate === "function" && pinId) onNavigate(pinId);
      });

      return {
        dom: wrap,
        update(updatedNode) {
          if (updatedNode.type.name !== "pinRef") return false;
          const newSnapshot = updatedNode.attrs.labelSnapshot ?? "";
          if (newSnapshot !== currentLabel && !isMissing) {
            currentLabel = newSnapshot;
            render();
          }
          return true;
        },
        destroy() {
          try { unsubscribe(); } catch {}
          cancelHoverTimer();
          cancelLeaveTimer();
          if (getActivePreviewOwner() === wrap) destroyPreview();
        },
      };
    };
  },
});
