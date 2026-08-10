// Unified list/listItem schema. Replaces the legacy three-container model
// (taskList / bulletList / orderedList + taskItem / listItem). One container,
// one item type. The item carries a `marker` attr (bullet / task / ordered /
// plain) that decides what's drawn at the line head, and a `checked` attr
// meaningful only when marker = task.
//
// All conversion routes — slash commands, input rules, keyboard shortcuts —
// funnel through `setMarker(target)`. Wrap if outside a list, flip if inside.
// `/text` (target = plain) on a sole-item list unwraps the frame entirely
// (decision A). `/text` mid-list with siblings sets marker = plain.
//
// Structural keys (Enter to split, Tab/Shift-Tab to nest/lift) re-use
// prosemirror-schema-list helpers against our single listItem type.

import { Node, mergeAttributes, InputRule } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import {
  splitListItem,
  liftListItem,
  sinkListItem,
  wrapInList,
} from "@tiptap/pm/schema-list";

// ──────────────────────────────────────────────────────────────────────────
// list — the only container
// ──────────────────────────────────────────────────────────────────────────

export const List = Node.create({
  name: "list",
  group: "block list",
  content: "listItem+",
  defining: true,

  addAttributes() {
    return {
      blockTitle: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-block-title") || null,
        renderHTML: (attrs) => (attrs.blockTitle ? { "data-block-title": attrs.blockTitle } : {}),
      },
      pinId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-pin-id") || null,
        renderHTML: (attrs) => (attrs.pinId ? { "data-pin-id": attrs.pinId } : {}),
      },
    };
  },

  parseHTML() {
    return [
      { tag: "ul[data-list]", priority: 60 },
      // Legacy HTML (paste from older shizumu exports or other apps)
      { tag: 'ul[data-type="taskList"]', priority: 55 },
      { tag: 'ul[data-type="bulletList"]', priority: 55 },
      { tag: 'ol[data-type="orderedList"]', priority: 55 },
      { tag: "ul", priority: 51 },
      { tag: "ol", priority: 51 },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["ul", mergeAttributes({ "data-list": "" }, HTMLAttributes), 0];
  },
});

// ──────────────────────────────────────────────────────────────────────────
// listItem — one type, marker-driven rendering
// ──────────────────────────────────────────────────────────────────────────

const VALID_MARKERS = new Set(["bullet", "task", "ordered", "plain"]);

export const ListItem = Node.create({
  name: "listItem",
  // Restrictive content per decision C: a leading paragraph, then any
  // combination of paragraph / list / qaBlock / blockquote. Tables, headings,
  // day markers, images, and dividers stay top-level.
  content: "paragraph (paragraph | list | qaBlock | blockquote)*",
  defining: true,

  addAttributes() {
    return {
      marker: {
        default: "bullet",
        parseHTML: (el) => {
          const m = el.getAttribute("data-marker");
          if (m && VALID_MARKERS.has(m)) return m;
          // Legacy <li data-type="taskItem"> → marker=task
          if (el.getAttribute("data-type") === "taskItem") return "task";
          return "bullet";
        },
        renderHTML: (attrs) => ({ "data-marker": attrs.marker || "bullet" }),
      },
      checked: {
        default: false,
        parseHTML: (el) => {
          const v = el.getAttribute("data-checked");
          return v === "" || v === "true" || v === "checked";
        },
        renderHTML: (attrs) =>
          attrs.marker === "task" ? { "data-checked": String(!!attrs.checked) } : {},
      },
      blockTitle: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-block-title") || null,
        renderHTML: (attrs) =>
          attrs.blockTitle ? { "data-block-title": attrs.blockTitle } : {},
      },
      pinId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-pin-id") || null,
        renderHTML: (attrs) => (attrs.pinId ? { "data-pin-id": attrs.pinId } : {}),
      },
    };
  },

  parseHTML() {
    return [
      { tag: "li[data-marker]", priority: 60 },
      { tag: 'li[data-type="taskItem"]', priority: 55 }, // legacy paste
      { tag: "li", priority: 51 },
    ];
  },

  // Static renderHTML — used for HTML serialization (export, copy/paste).
  // The on-canvas rendering goes through addNodeView below.
  renderHTML({ node, HTMLAttributes }) {
    if (node.attrs.marker === "task") {
      return [
        "li",
        mergeAttributes(HTMLAttributes, { "data-marker": "task" }),
        [
          "label",
          { contenteditable: "false" },
          [
            "input",
            { type: "checkbox", checked: node.attrs.checked ? "checked" : null },
          ],
          ["span"],
        ],
        ["div", 0],
      ];
    }
    return ["li", mergeAttributes(HTMLAttributes), 0];
  },

  addNodeView() {
    return ({ node, getPos, editor, HTMLAttributes }) => {
      const dom = document.createElement("li");
      // Apply the merged attributes (data-marker, data-checked, data-pin-id, etc.)
      Object.entries(HTMLAttributes).forEach(([k, v]) => {
        if (v !== null && v !== undefined) dom.setAttribute(k, String(v));
      });
      if (!dom.getAttribute("data-marker")) {
        dom.setAttribute("data-marker", node.attrs.marker || "bullet");
      }

      // contentDOM is where ProseMirror writes the item's child nodes.
      const contentDOM = document.createElement("div");

      // Optional checkbox chrome — only present for marker="task".
      let label = null;
      let checkbox = null;

      const buildTaskChrome = (checked) => {
        label = document.createElement("label");
        label.contentEditable = "false";
        checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = !!checked;
        const styler = document.createElement("span");
        label.append(checkbox, styler);
        // Don't let ProseMirror handle mousedown — checkbox click would
        // otherwise move the selection to the start of the item.
        checkbox.addEventListener("mousedown", (e) => e.preventDefault());
        checkbox.addEventListener("change", (e) => {
          const checked = e.target.checked;
          // Use PM's DOM-to-pos mapping rather than the getPos() closure.
          // posAtDOM walks the live DOM-to-doc mapping and returns the
          // correct position for THIS checkbox's listItem, regardless of
          // any NodeView reuse / sibling-update timing that could otherwise
          // make the closure resolve to a different item.
          let itemPos;
          try {
            const innerPos = editor.view.posAtDOM(dom, 0);
            if (typeof innerPos !== "number") return;
            // posAtDOM(dom, 0) lands just inside the listItem (start of
            // its first child's content). The listItem node itself starts
            // one position earlier.
            itemPos = innerPos - 1;
          } catch {
            return;
          }
          editor
            .chain()
            .focus(undefined, { scrollIntoView: false })
            .command(({ tr }) => {
              const cur = tr.doc.nodeAt(itemPos);
              if (!cur || cur.type.name !== "listItem") return false;
              tr.setNodeMarkup(itemPos, undefined, {
                ...cur.attrs,
                checked,
              });
              return true;
            })
            .run();
        });
        return label;
      };

      const removeTaskChrome = () => {
        if (label && label.parentNode === dom) {
          dom.removeChild(label);
        }
        label = null;
        checkbox = null;
      };

      // Initial mount
      if (node.attrs.marker === "task") {
        dom.append(buildTaskChrome(node.attrs.checked), contentDOM);
      } else {
        dom.append(contentDOM);
      }

      return {
        dom,
        contentDOM,
        update: (updatedNode) => {
          if (updatedNode.type !== node.type) return false;
          const newMarker = updatedNode.attrs.marker || "bullet";
          const oldMarker = dom.getAttribute("data-marker");
          if (newMarker !== oldMarker) {
            dom.setAttribute("data-marker", newMarker);
            // Toggle the checkbox chrome to match the new marker. We mutate
            // the wrapper around contentDOM rather than rebuilding contentDOM
            // itself — ProseMirror still owns the children.
            if (newMarker === "task" && oldMarker !== "task") {
              dom.insertBefore(buildTaskChrome(updatedNode.attrs.checked), contentDOM);
            } else if (newMarker !== "task" && oldMarker === "task") {
              removeTaskChrome();
            }
          }
          // Sync checked state when marker stays task.
          if (newMarker === "task" && checkbox) {
            checkbox.checked = !!updatedNode.attrs.checked;
            dom.setAttribute("data-checked", String(!!updatedNode.attrs.checked));
          } else if (newMarker !== "task") {
            dom.removeAttribute("data-checked");
          }
          // Sync any other dataset attrs (pinId, blockTitle).
          if (updatedNode.attrs.pinId) {
            dom.setAttribute("data-pin-id", updatedNode.attrs.pinId);
          } else {
            dom.removeAttribute("data-pin-id");
          }
          return true;
        },
      };
    };
  },

  addCommands() {
    // Diagnostic: this should fire once during editor init in any build.
    // If you don't see it in production, our ListItem.addCommands() isn't
    // running and StarterKit's bundled listItem (which lacks setMarker) is
    // winning despite `listItem: false` in StarterKit.configure().
    if (typeof window !== "undefined") {
      console.log("[shizumu] unified-list ListItem.addCommands() registering setMarker");
    }
    return {
      // The single primitive every conversion routes through.
      // target ∈ "bullet" | "task" | "ordered" | "plain" | "none"
      //   "none" — lift item out of its list entirely
      //   "plain" on a sole-item list — also lifts (decision A)
      //   "plain" with siblings — keeps the line in the list, marker=plain
      setMarker: (target) => ({ tr, state, dispatch, chain, commands }) => {
        if (!VALID_MARKERS.has(target) && target !== "none") return false;

        const { $from } = state.selection;

        // Walk up to find the listItem we're sitting in, if any.
        let itemNode = null;
        let itemPos = -1;
        let parentList = null;
        for (let d = $from.depth; d > 0; d--) {
          const n = $from.node(d);
          if (n.type.name === "listItem") {
            itemNode = n;
            itemPos = $from.before(d);
            parentList = d > 0 ? $from.node(d - 1) : null;
            break;
          }
        }

        // Path A — already inside a listItem.
        if (itemNode) {
          if (target === "none") {
            return commands.liftListItem("listItem");
          }
          if (
            target === "plain" &&
            parentList &&
            parentList.type.name === "list" &&
            parentList.childCount === 1
          ) {
            // Sole item in its list — drop the frame entirely.
            return commands.liftListItem("listItem");
          }
          const newAttrs = {
            ...itemNode.attrs,
            marker: target,
            // Preserve checked when staying task; reset otherwise.
            checked: target === "task" ? !!itemNode.attrs.checked : false,
          };
          if (dispatch) {
            tr.setNodeMarkup(itemPos, null, newAttrs);
            dispatch(tr);
          }
          return true;
        }

        // Path B — not in a list. Wrap the current paragraph and set the
        // marker on a SINGLE transaction so it composes inside the outer
        // slash-command chain (focus → deleteRange → setMarker). The old
        // nested `chain().command(...).command(...).run()` did NOT compose
        // with the outer chain's pending tr, so the explicit setNodeMarkup
        // didn't stick and the new item kept its schema default marker
        // "bullet" — invisible for /bullet, but wrong for /task (showed a
        // bullet instead of a checkbox) and /numbered.
        if (target === "none" || target === "plain") {
          // Already a bare paragraph — nothing to do.
          return false;
        }

        const listType = state.schema.nodes.list;
        if (!listType) return false;

        // wrapInList builds its transaction from `state.tr` and hands it to
        // our callback; we set the freshly-created item's marker on that
        // SAME tr and dispatch once. In a dry run (can(), dispatch
        // undefined) the callback is skipped and wrapInList just reports
        // whether the wrap is possible.
        return wrapInList(listType)(state, (wrapped) => {
          if (!dispatch) return;
          const { $from } = wrapped.selection;
          for (let depth = $from.depth; depth > 0; depth--) {
            const n = $from.node(depth);
            if (n.type.name === "listItem") {
              wrapped.setNodeMarkup($from.before(depth), null, {
                ...n.attrs,
                marker: target,
                checked: false,
              });
              break;
            }
          }
          dispatch(wrapped);
        });
      },

      // Used by the input rule for `[x]`, which needs to set checked too.
      setMarkerWithChecked: (target, checked) => ({ chain }) => {
        return chain()
          .setMarker(target)
          .updateAttributes("listItem", {
            marker: target,
            checked: target === "task" ? !!checked : false,
          })
          .run();
      },

      // Aliases for muscle memory.
      toggleTaskList: () => ({ commands }) => commands.setMarker("task"),
      toggleBulletList: () => ({ commands }) => commands.setMarker("bullet"),
      toggleOrderedList: () => ({ commands }) => commands.setMarker("ordered"),

      // Wrappers around the prosemirror-schema-list helpers so the keyboard
      // shortcuts can call them via `editor.commands.*` (which returns a
      // boolean Tiptap can use to mark the chord as handled). Calling the raw
      // PM command from a shortcut handler returns a function, not a boolean,
      // and Tiptap silently treats it as a no-op.
      splitListItemAtCursor: () => ({ state, dispatch }) =>
        splitListItem(this.type)(state, dispatch),
      liftListItemOnce: () => ({ state, dispatch }) =>
        liftListItem(this.type)(state, dispatch),
      sinkListItemOnce: () => ({ state, dispatch }) =>
        sinkListItem(this.type)(state, dispatch),
    };
  },

  addInputRules() {
    return [
      // [], [ ], [x], [X] + space → marker=task (checked when x/X)
      new InputRule({
        find: /^\[( |x|X)?\]\s$/,
        handler: ({ range, match, chain }) => {
          const checked = match[1] === "x" || match[1] === "X";
          chain()
            .deleteRange({ from: range.from, to: range.to })
            .setMarkerWithChecked("task", checked)
            .run();
        },
      }),
      // * or - + space → marker=bullet
      new InputRule({
        find: /^[*-]\s$/,
        handler: ({ range, chain }) => {
          chain()
            .deleteRange({ from: range.from, to: range.to })
            .setMarker("bullet")
            .run();
        },
      }),
      // 1. + space → marker=ordered
      new InputRule({
        find: /^1\.\s$/,
        handler: ({ range, chain }) => {
          chain()
            .deleteRange({ from: range.from, to: range.to })
            .setMarker("ordered")
            .run();
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    const isInsideListItem = (state) => {
      const { $from } = state.selection;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === "listItem") return true;
      }
      return false;
    };

    const isEmptyTrailingItem = (state) => {
      const { $from } = state.selection;
      let itemDepth = -1;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === "listItem") { itemDepth = d; break; }
      }
      if (itemDepth < 0) return false;
      const item = $from.node(itemDepth);
      const itemEmpty =
        item.childCount === 1 &&
        item.firstChild.type.name === "paragraph" &&
        item.firstChild.content.size === 0;
      if (!itemEmpty) return false;
      const list = $from.node(itemDepth - 1);
      const idx = $from.index(itemDepth - 1);
      return idx === list.childCount - 1;
    };

    return {
      // Backspace at start of an empty listItem: remove it and merge cursor
      // upward into whatever is above (a sibling list item, or the line
      // before the list).
      //   - Middle/last item: remove the listItem, cursor to end of previous
      //     item in the same list.
      //   - First item (not sole): remove the listItem, cursor to end of
      //     the node above the list. Remaining items stay in the list.
      //   - Sole item: remove the entire (empty) list, cursor to end of the
      //     node above. If the list is the doc's first node (no above),
      //     fall back to lift so an empty paragraph takes the list's place.
      Backspace: () => {
        const { state, view } = this.editor;
        const { $from } = state.selection;
        if ($from.parentOffset !== 0) return false;
        if (!$from.parent.isTextblock) return false;
        if ($from.parent.content.size !== 0) return false;

        let liDepth = -1;
        for (let d = $from.depth; d >= 1; d--) {
          if ($from.node(d).type.name === "listItem") { liDepth = d; break; }
        }
        if (liDepth < 0) return false;

        const li = $from.node(liDepth);
        // Only operate on truly empty single-textblock listItems. Items that
        // contain nested lists or multiple paragraphs go through PM defaults.
        if (li.childCount > 1) return false;

        const list = $from.node(liDepth - 1);
        if (!list) return false;
        const itemIndex = $from.index(liDepth - 1);

        if (itemIndex === 0) {
          // First item case (sole or one-of-many).
          const listDepth = liDepth - 1;
          const listStartPos = $from.before(listDepth);
          if (listStartPos === 0) {
            // No line above the list. Fall back to lift so the user still
            // gets an empty paragraph to type into (avoids leaving them with
            // no editable target).
            return this.editor.commands.liftListItemOnce();
          }
          const targetPos = listStartPos - 1;
          let tr;
          if (list.childCount === 1) {
            // Sole empty item: delete the whole list.
            tr = state.tr.delete(listStartPos, listStartPos + list.nodeSize);
          } else {
            // Non-sole: delete just this empty first item.
            const liStart = $from.before(liDepth);
            const liEnd = $from.after(liDepth);
            tr = state.tr.delete(liStart, liEnd);
          }
          try {
            const $target = tr.doc.resolve(targetPos);
            tr = tr.setSelection(TextSelection.near($target, -1));
          } catch {
            return false;
          }
          view.dispatch(tr);
          return true;
        }

        // Middle / last (not first) item: delete the listItem, cursor to end
        // of previous sibling within the same list.
        const liStart = $from.before(liDepth);
        const liEnd = $from.after(liDepth);
        const prevPos = liStart - 1;
        if (prevPos < 0) return false;

        let tr = state.tr.delete(liStart, liEnd);
        try {
          const $target = tr.doc.resolve(prevPos);
          tr = tr.setSelection(TextSelection.near($target, -1));
        } catch {
          return false;
        }
        view.dispatch(tr);
        return true;
      },

      // Progressive Enter behavior:
      //   1. Try splitListItem first. PM's splitListItem internally handles
      //      both regular split AND the empty-trailing-lift case for nested
      //      lists — atomically: it removes the trailing empty item from the
      //      nested list and creates a new sibling at the outer level in one
      //      transaction.
      //   2. PM's lift branch creates the new outer-level item via
      //      `itemType.createAndFill()` — i.e. with default attrs, which for
      //      our schema means marker="bullet". When the outer list is full
      //      of tasks, that produces a stray bullet under a task list. We
      //      capture the OUTER listItem's marker before the split and, when
      //      a lift just happened, propagate it to the lifted item so the
      //      surrounding rhythm stays consistent.
      //   3. If split returned false (top-level empty trailing — PM
      //      short-circuits at depth 3), fall back to plain lift, which
      //      unwraps to a paragraph below the list.
      //   4. Still no luck but cursor is in a listItem → consume the event
      //      so PM's default Enter doesn't insert a stray sibling paragraph.
      //   5. Outside a list → return false, default Enter runs.
      // Enter inside a listItem:
      //   1. Try splitListItemAtCursor (PM's helper). Splits the current item
      //      and creates a new sibling at the same level. Works for both
      //      non-empty and empty trailing items at any nesting depth except
      //      the top-level empty-trailing case (PM short-circuits there).
      //   2. If split returned false (top-level empty trailing item), STILL
      //      create another empty sibling. The list never auto-exits — that
      //      was the "Enter quits the block" complaint. To exit, the user
      //      presses Esc or ArrowDown past the last item.
      //   3. When the split path runs at the boundary between a nested list
      //      and its outer item, propagate the outer listItem's marker to the
      //      new sibling so the surrounding rhythm stays consistent.
      Enter: () => {
        const { state } = this.editor;
        let outerListItemMarker = null;
        if (isEmptyTrailingItem(state)) {
          const { $from } = state.selection;
          let innerDepth = -1;
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === "listItem") { innerDepth = d; break; }
          }
          const outerDepth = innerDepth - 2;
          if (outerDepth > 0 && $from.node(outerDepth)?.type?.name === "listItem") {
            outerListItemMarker = $from.node(outerDepth).attrs?.marker || null;
          }
        }
        if (this.editor.commands.splitListItemAtCursor()) {
          if (outerListItemMarker && outerListItemMarker !== "bullet") {
            this.editor.commands.updateAttributes("listItem", {
              marker: outerListItemMarker,
              checked: false,
            });
          }
          return true;
        }
        // Top-level empty trailing item: PM short-circuits splitListItem.
        // Stay in the list by manually appending an empty sibling listItem.
        if (isEmptyTrailingItem(state)) {
          const { $from } = state.selection;
          let liDepth = -1;
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === "listItem") { liDepth = d; break; }
          }
          if (liDepth < 0) return isInsideListItem(state);
          const list = $from.node(liDepth - 1);
          if (!list) return isInsideListItem(state);
          const currentLi = $from.node(liDepth);
          const liAfter = $from.after(liDepth);
          const newItem = state.schema.nodes.listItem.create(
            {
              marker: currentLi.attrs?.marker || "bullet",
              checked: false,
              blockTitle: null,
              pinId: null,
            },
            state.schema.nodes.paragraph.create(),
          );
          let tr = state.tr.insert(liAfter, newItem);
          // Cursor at start of the new item's paragraph.
          const cursorTarget = liAfter + 2;
          try {
            const $target = tr.doc.resolve(cursorTarget);
            tr = tr.setSelection(TextSelection.near($target, 1));
          } catch {}
          this.editor.view.dispatch(tr);
          return true;
        }
        return isInsideListItem(state);
      },
      // Soft line break: insert hardBreak in the current paragraph so a list
      // item can hold multi-line content visually. The default Enter still
      // creates a new sibling item.
      "Shift-Enter": () => this.editor.commands.setHardBreak(),
      "Shift-Tab": () => this.editor.commands.liftListItemOnce(),
      Tab: () => this.editor.commands.sinkListItemOnce(),
    };
  },
});

export const UnifiedListExtensions = [List, ListItem];
