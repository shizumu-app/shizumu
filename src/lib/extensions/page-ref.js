import { Node, mergeAttributes } from "@tiptap/core";
import {
  getLineages,
  getPageForMention,
} from "../api.js";
import { buildMentionLabel } from "../mention-label.js";
import {
  getPagePreviewFor,
  mountPreviewCard,
  destroyPreview,
  getActivePreviewOwner,
} from "../render/preview-card.js";

/**
 * Module-level resolver for `pageRef` labels.
 *
 * Each NodeView instance asks `resolveLabel(targetId)` on mount and on
 * cache-invalidation events. The resolver:
 *   - returns the cached label immediately if it has one,
 *   - otherwise fetches `getPageForMention(targetId)` and `getLineages()`
 *     (the lineages list is shared across all refs and is fetched at most
 *     once per invalidation cycle),
 *   - emits `null` when the target is missing (deleted / folded).
 *
 * Invalidation: any window event named `shizumu:trail-mutated` clears
 * the entire cache. API wrappers fire this on rename / move / fold /
 * delete / setFocusLineage success.
 */
const labelCache = new Map(); // targetId -> { label: string | null }
const pendingFetches = new Map(); // targetId -> Promise
const listeners = new Set(); // (targetId) => void
let lineagesPromise = null;

function clearCache() {
  labelCache.clear();
  pendingFetches.clear();
  lineagesPromise = null;
  for (const fn of listeners) {
    try { fn(null); } catch {}
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("shizumu:trail-mutated", clearCache);
}

async function getLineagesOnce() {
  if (!lineagesPromise) lineagesPromise = getLineages().catch(() => []);
  return lineagesPromise;
}

async function resolveLabel(targetId) {
  if (!targetId) return null;
  const cached = labelCache.get(targetId);
  if (cached) return cached.label;

  let pending = pendingFetches.get(targetId);
  if (!pending) {
    pending = (async () => {
      try {
        const [row, lineages] = await Promise.all([
          getPageForMention(targetId),
          getLineagesOnce(),
        ]);
        if (!row) {
          labelCache.set(targetId, { label: null });
          return null;
        }
        const label = buildMentionLabel({ page: row, lineages });
        labelCache.set(targetId, { label });
        return label;
      } finally {
        pendingFetches.delete(targetId);
      }
    })();
    pendingFetches.set(targetId, pending);
  }
  return pending;
}

/** Subscribe to cache invalidation. Used by NodeView to re-resolve when
 *  trails mutate. Returns an unsubscribe function. */
function subscribeInvalidation(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// Hover-preview helpers (getPagePreviewFor / mountPreviewCard / destroyPreview)
// live in src/lib/render/preview-card.js — extracted so the pin panel can
// reuse the same card. The shared module also clears its cache on
// `shizumu:trail-mutated`, so renames/folds invalidate both surfaces at once.

export const PageRef = Node.create({
  name: "pageRef",
  inline: true,
  group: "inline",
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return {
      // Page.svelte registers this at editor construction.
      //   onNavigate(pageId) — called when the user clicks the reference.
      onNavigate: null,
    };
  },

  addAttributes() {
    return {
      targetId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-target-id"),
        renderHTML: (attrs) => attrs.targetId ? { "data-target-id": attrs.targetId } : {},
      },
      labelSnapshot: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-snapshot"),
        renderHTML: (attrs) => attrs.labelSnapshot ? { "data-snapshot": attrs.labelSnapshot } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-page-ref]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const snapshot = node?.attrs?.labelSnapshot || HTMLAttributes["data-snapshot"] || "";
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-page-ref": "",
        class: "page-ref",
      }),
      `→ ${snapshot}`,
    ];
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const onNavigate = this.options.onNavigate;
      const targetId = node.attrs.targetId;
      const initialSnapshot = node.attrs.labelSnapshot ?? "";

      const wrap = document.createElement("span");
      wrap.className = "page-ref";
      wrap.setAttribute("data-page-ref", "");
      wrap.setAttribute("data-target-id", targetId ?? "");
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
        wrap.classList.toggle("page-ref--deleted", isMissing);
        if (isMissing) {
          const arrow = document.createElement("span");
          arrow.className = "page-ref-arrow";
          arrow.textContent = "→";
          const labelEl = document.createElement("span");
          labelEl.className = "page-ref-label";
          labelEl.textContent = `(deleted: ${currentLabel || "?"})`;
          const removeBtn = document.createElement("button");
          removeBtn.type = "button";
          removeBtn.className = "page-ref-remove";
          removeBtn.setAttribute("contenteditable", "false");
          removeBtn.title = "remove this reference";
          removeBtn.textContent = "×";
          removeBtn.addEventListener("mousedown", (e) => e.preventDefault());
          removeBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            removeNode();
          });
          wrap.appendChild(arrow);
          wrap.appendChild(document.createTextNode(" "));
          wrap.appendChild(labelEl);
          wrap.appendChild(removeBtn);
        } else {
          const arrow = document.createElement("span");
          arrow.className = "page-ref-arrow";
          arrow.textContent = "→";
          const labelEl = document.createElement("span");
          labelEl.className = "page-ref-label";
          labelEl.textContent = currentLabel || "…";
          wrap.appendChild(arrow);
          wrap.appendChild(document.createTextNode(" "));
          wrap.appendChild(labelEl);
        }
      }

      async function resolveAndRender() {
        if (!targetId) {
          isMissing = true;
          render();
          return;
        }
        try {
          const resolved = await resolveLabel(targetId);
          if (resolved == null) {
            isMissing = true;
            // Don't overwrite the snapshot on missing — preserve the last
            // known good label so the user sees something meaningful.
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

      // Hover preview — fires after a short dwell so flick-by doesn't trigger.
      let hoverTimer = null;
      let leaveTimer = null;
      const HOVER_DELAY = 300;
      const LEAVE_GRACE = 80;

      function cancelHoverTimer() {
        if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
      }
      function cancelLeaveTimer() {
        if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
      }

      wrap.addEventListener("mouseenter", () => {
        if (isMissing || !targetId) return;
        cancelLeaveTimer();
        cancelHoverTimer();
        hoverTimer = setTimeout(async () => {
          try {
            const entry = await getPagePreviewFor(targetId);
            // Only mount if the user is still hovering on this node.
            if (!entry) return;
            if (!wrap.matches(":hover") && getActivePreviewOwner() !== wrap) {
              // Hover ended during the fetch.
              return;
            }
            mountPreviewCard(wrap, wrap, entry, () => {
              if (typeof onNavigate === "function" && targetId) onNavigate(targetId);
            });
          } catch {}
        }, HOVER_DELAY);
      });
      wrap.addEventListener("mouseleave", () => {
        cancelHoverTimer();
        // Give the cursor a grace window to move into the preview card.
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
        if (typeof onNavigate === "function" && targetId) onNavigate(targetId);
      });

      return {
        dom: wrap,
        update(updatedNode) {
          if (updatedNode.type.name !== "pageRef") return false;
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

// Dispatch invalidation. Used by API wrappers that mutate trail metadata.
export function invalidatePageRefCache() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("shizumu:trail-mutated"));
  } else {
    clearCache();
  }
}
