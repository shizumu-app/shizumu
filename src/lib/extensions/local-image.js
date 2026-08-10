import { Image } from "@tiptap/extension-image";

// Extends the base Image node to add:
// - data-local-path (stable path separate from convertFileSrc's asset:// URL)
// - display attr ("block" | "inline")
// - width attr (user-resized width; pixel string)
// - collapsed attr (renders as a chip instead of the full image; click chip opens modal)
// - NodeView with a corner resize handle, collapse/expand toggle, and a chip form
export const LocalImage = Image.extend({
  name: "localImage",

  // Schema-inline so insertContent never splits the surrounding paragraph.
  // The visual "block" form (full-width image with its own line) is handled
  // via CSS on the wrapper (`data-display="block"` → display: block) — but
  // ProseMirror still treats the node as an inline token, which is what
  // keeps inline-mode chips and inline-mode images flowing inside text.
  inline: true,
  group: "inline",
  atom: true,

  addAttributes() {
    return {
      ...this.parent?.(),
      localPath: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-local-path"),
        renderHTML: (attrs) => attrs.localPath ? { "data-local-path": attrs.localPath } : {},
      },
      display: {
        default: "block",
        parseHTML: (el) => el.getAttribute("data-display") || "block",
        renderHTML: (attrs) => ({ "data-display": attrs.display || "block" }),
      },
      width: {
        default: null,
        parseHTML: (el) => el.style.width || el.getAttribute("width") || null,
        renderHTML: (attrs) => attrs.width ? { style: `width: ${attrs.width}` } : {},
      },
      collapsed: {
        default: false,
        parseHTML: (el) => el.getAttribute("data-collapsed") === "true",
        renderHTML: (attrs) => attrs.collapsed ? { "data-collapsed": "true" } : {},
      },
    };
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const display = node.attrs.display || "block";
      const wrap = document.createElement(display === "inline" ? "span" : "div");
      wrap.className = "local-image-wrap";
      wrap.setAttribute("data-display", display);
      wrap.setAttribute("contenteditable", "false");

      // Deduce a human label for the chip form. Prefer alt, then filename from localPath.
      function deriveLabel(attrs) {
        if (attrs.alt) return attrs.alt;
        const p = attrs.localPath || attrs.src || "";
        const match = p.match(/[^/\\]+$/);
        return match ? match[0] : "image";
      }

      // Mutation-safe attr update: use setNodeAttribute to persist to the doc.
      function updateAttr(name, value) {
        if (typeof getPos !== "function" || !editor?.view) return;
        try {
          const pos = getPos();
          const tr = editor.view.state.tr.setNodeAttribute(pos, name, value);
          editor.view.dispatch(tr);
        } catch {}
      }

      function render() {
        wrap.innerHTML = "";
        wrap.setAttribute("data-collapsed", node.attrs.collapsed ? "true" : "false");
        if (node.attrs.collapsed) {
          renderChip();
        } else {
          renderFullImage();
        }
      }

      function renderFullImage() {
        if (node.attrs.width) wrap.style.width = node.attrs.width;
        else wrap.style.width = "";

        const img = document.createElement("img");
        img.src = node.attrs.src;
        if (node.attrs.alt) img.alt = node.attrs.alt;
        if (node.attrs.localPath) img.setAttribute("data-local-path", node.attrs.localPath);
        img.setAttribute("data-display", node.attrs.display || "block");
        img.draggable = false;
        if (node.attrs.width) img.style.width = node.attrs.width;

        const resizeHandle = document.createElement("span");
        resizeHandle.className = "local-image-resize-handle";
        resizeHandle.setAttribute("contenteditable", "false");
        resizeHandle.title = "drag to resize";

        const collapseBtn = document.createElement("button");
        collapseBtn.type = "button";
        collapseBtn.className = "local-image-collapse-btn";
        collapseBtn.setAttribute("contenteditable", "false");
        collapseBtn.title = "collapse to chip";
        collapseBtn.textContent = "–";

        wrap.appendChild(img);
        wrap.appendChild(resizeHandle);
        wrap.appendChild(collapseBtn);

        resizeHandle.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const startX = e.clientX;
          const startWidth = img.offsetWidth;
          resizeHandle.setPointerCapture(e.pointerId);
          const onMove = (ev) => {
            const newWidth = Math.max(80, startWidth + (ev.clientX - startX));
            img.style.width = newWidth + "px";
            wrap.style.width = newWidth + "px";
          };
          const onUp = () => {
            resizeHandle.releasePointerCapture(e.pointerId);
            resizeHandle.removeEventListener("pointermove", onMove);
            resizeHandle.removeEventListener("pointerup", onUp);
            const finalWidth = img.style.width || null;
            if (finalWidth) updateAttr("width", finalWidth);
          };
          resizeHandle.addEventListener("pointermove", onMove);
          resizeHandle.addEventListener("pointerup", onUp);
        });

        collapseBtn.addEventListener("mousedown", (e) => e.preventDefault());
        collapseBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          updateAttr("collapsed", true);
        });
      }

      function renderChip() {
        wrap.style.width = "";

        // Single highlighted-text element — reads as a name in flow, not a
        // button. Click opens the image preview modal. Double-click expands
        // the chip back to the full inline image (escape hatch when the
        // user actually wants the picture in the canvas).
        const chip = document.createElement("span");
        chip.className = "local-image-chip";
        chip.setAttribute("contenteditable", "false");
        chip.title = "click to view · double-click to expand";
        chip.textContent = deriveLabel(node.attrs);

        wrap.appendChild(chip);

        chip.addEventListener("mousedown", (e) => e.preventDefault());
        chip.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          wrap.dispatchEvent(new CustomEvent("shizumu-image-preview", {
            detail: { src: node.attrs.src },
            bubbles: true,
          }));
        });
        chip.addEventListener("dblclick", (e) => {
          e.preventDefault();
          e.stopPropagation();
          updateAttr("collapsed", false);
        });
      }

      render();

      return {
        dom: wrap,
        update(updatedNode) {
          if (updatedNode.type.name !== "localImage") return false;
          // Re-render from scratch on attr change. Simpler than diffing DOM;
          // keeps collapsed/full state in sync with node attrs.
          // Note: we reassign the outer closure's node reference first.
          Object.assign(node.attrs, updatedNode.attrs);
          node.attrs = updatedNode.attrs;
          render();
          return true;
        },
        ignoreMutation(mutation) {
          // Don't let pointer-driven inline style changes trigger re-renders.
          return mutation.type === "attributes" && mutation.attributeName === "style";
        },
      };
    };
  },
});
