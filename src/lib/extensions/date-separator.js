import { Node, mergeAttributes } from "@tiptap/core";

export const DateSeparator = Node.create({
  name: "dateSeparator",
  group: "block",
  atom: true,
  selectable: false,
  draggable: false,

  addAttributes() {
    return {
      date: { default: null },
      pageId: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="date-separator"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const date = HTMLAttributes.date || "";
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "date-separator",
        "data-page-id": HTMLAttributes.pageId,
        class: "date-separator",
        contenteditable: "false",
      }),
      [
        "span",
        { class: "date-separator-line" },
      ],
      [
        "span",
        { class: "date-separator-text" },
        formatDate(date),
      ],
      [
        "span",
        { class: "date-separator-line" },
      ],
    ];
  },
});

function formatDate(dateStr) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr + "T00:00:00");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.floor((today - d) / 86400000);
    if (diff === 0) return "today";
    if (diff === 1) return "yesterday";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toLowerCase();
  } catch {
    return dateStr;
  }
}
