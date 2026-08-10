import CodeBlock from "@tiptap/extension-code-block";
import { nodeKind } from "../pin-display.js";
import { createBlockShell } from "./block-shell.js";
import { bindTitleSlot } from "./title-slot.js";

/**
 * `codeBlock` — extends StarterKit's CodeBlock with a NodeView that adds
 * a title slot (matching the shared BlockTitle pattern) plus a quiet
 * header (language input + copy button) around the `<pre><code>`.
 *
 * Schema: still the StarterKit codeBlock node, with two extra attributes:
 *   - `language` (native) — drives the header input.
 *   - `blockTitle` (registered globally by BlockTitle extension for the
 *     `codeBlock` type) — drives the title slot.
 *
 * The NodeView writes both attributes back to the node on change and
 * re-syncs when they change externally (undo, collaborative edits).
 *
 * Read-only mounts (past discrete-trail pages, ThreadPageView, pin
 * previews) still run the NodeView; inputs are disabled. Pure static
 * rendering (`generateHTML`) does NOT run NodeViews — those surfaces
 * get the default `<pre data-block-title>...<code></code></pre>` and
 * the `.prose [data-block-title]::before` CSS fallback for the title.
 *
 * Intentional non-goals: no syntax highlighting (honest monospace),
 * no line numbers, no language autocomplete dropdown, no run button.
 */
export const CodeBlockShizumu = CodeBlock.extend({
  addNodeView() {
    return ({ node, editor, getPos, extension }) => {
      // ── Shared chrome via BlockShell ──
      const shell = createBlockShell({ node, view: editor.view, getPos, ext: extension });

      const wrap = shell.dom;
      wrap.classList.add("code-block-wrap");
      wrap.setAttribute("data-type", "code-block");

      const titleSlot = shell.titleSlot;

      // The shell creates a generic contentDOM div we don't use — codeBlock
      // supplies its own <pre><code> as contentDOM.
      shell.contentDOM.remove();

      // chip: nodeKind("codeBlock") returns "code" so the chip is already
      // populated and visible; mirror the old fallback just in case.
      const chip = shell.chip;
      if (!chip.textContent) {
        chip.textContent = nodeKind(node) || "code";
        chip.style.display = "";
      }

      if (!editor.isEditable) titleSlot.disabled = true;

      // ── Title editing via shared bindTitleSlot ──
      const titleApi = bindTitleSlot({
        titleSlot,
        view: editor.view,
        getPos,
        ext: extension,
        resolveContentPos: (_n, pos) => pos + 1,
        onTitleRender: (t) => shell.setTitle(t),
      });

      // Initial title render.
      titleApi.refresh(node);

      // ── Header (language input + copy button) ──
      const header = document.createElement("div");
      header.className = "code-block-header";
      header.setAttribute("contenteditable", "false");

      const langInput = document.createElement("input");
      langInput.className = "code-block-lang";
      langInput.type = "text";
      langInput.placeholder = "language?";
      langInput.value = node.attrs.language || "";
      langInput.spellcheck = false;
      langInput.maxLength = 24;
      if (!editor.isEditable) langInput.disabled = true;

      langInput.addEventListener("input", () => {
        if (!editor.isEditable) return;
        if (typeof getPos !== "function") return;
        const pos = getPos();
        if (typeof pos !== "number") return;
        const next = langInput.value.trim();
        editor.view.dispatch(
          editor.state.tr.setNodeAttribute(pos, "language", next || null),
        );
      });
      langInput.addEventListener("keydown", (e) => e.stopPropagation());

      const copyBtn = document.createElement("button");
      copyBtn.className = "code-block-copy";
      copyBtn.type = "button";
      copyBtn.setAttribute("contenteditable", "false");
      copyBtn.textContent = "copy";
      copyBtn.title = "copy code";

      let copyTimer = null;
      copyBtn.addEventListener("mousedown", (e) => e.preventDefault());
      copyBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(code.textContent || "");
          copyBtn.textContent = "copied";
          copyBtn.classList.add("copied");
          if (copyTimer) clearTimeout(copyTimer);
          copyTimer = setTimeout(() => {
            copyBtn.textContent = "copy";
            copyBtn.classList.remove("copied");
            copyTimer = null;
          }, 1200);
        } catch {
          // Clipboard rejected (permissions, non-secure context). Silent
          // failure beats a broken-feeling button.
        }
      });

      header.appendChild(langInput);
      header.appendChild(copyBtn);

      // ── Content (<pre><code>) ──
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      pre.appendChild(code);

      // Insert header and pre between titleSlot and chip.
      // Final DOM order: titleSlot, header, pre, chip.
      wrap.insertBefore(header, chip);
      wrap.insertBefore(pre, chip);

      // ArrowUp from the first line is handled by the BlockTitle plugin
      // (via TITLE_NAV_TYPES) which calls titleSlot.__enterEdit() — the
      // same path qaBlock/list/blockquote/recipe use. bindTitleSlot sets
      // titleSlot.__enterEdit so one source of truth covers all block types.

      return {
        dom: wrap,
        contentDOM: code,
        update(updatedNode) {
          if (updatedNode.type.name !== "codeBlock") return false;
          // Language sync — don't clobber in-progress typing.
          const newLang = updatedNode.attrs.language || "";
          if (langInput.value !== newLang && document.activeElement !== langInput) {
            langInput.value = newLang;
          }
          if (langInput.disabled !== !editor.isEditable) {
            langInput.disabled = !editor.isEditable;
          }
          // Title sync via shared helper.
          titleApi.refresh(updatedNode);
          if (titleSlot.disabled !== !editor.isEditable) {
            titleSlot.disabled = !editor.isEditable;
          }
          return true;
        },
        destroy() {
          if (copyTimer) clearTimeout(copyTimer);
          titleApi.destroy();
        },
        ignoreMutation(mutation) {
          if (header.contains(mutation.target)) return true;
          if (titleSlot.contains(mutation.target) || mutation.target === titleSlot) return true;
          // Same fix as block-title.js's createBoardNodeView: tolerate the
          // touch-reveal class stamped directly onto this NodeView's own
          // root `wrap` (the `.code-block-wrap` element) — otherwise
          // ProseMirror's domObserver rebuilds the NodeView to "fix" the
          // unrecognized class mutation, wiping it immediately.
          if (mutation.type === "attributes" && mutation.attributeName === "class" && mutation.target === wrap) {
            return true;
          }
          return false;
        },
        stopEvent(event) {
          if (event.target instanceof Node && header.contains(event.target)) return true;
          if (event.target === titleSlot) return true;
          return false;
        },
      };
    };
  },
});
