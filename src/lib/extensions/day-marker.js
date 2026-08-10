import { Node, mergeAttributes } from "@tiptap/core";

/**
 * DayMarker — a non-editable decorator node that marks the start of a day's
 * writing on a continuous trail. Stores the date and the day's "what matters now".
 * Excluded from word count. Soft-styled, not part of the prose.
 *
 * Inserted automatically by Page.svelte when a continuous-trail user fills
 * their daily focus for the first time that day.
 */
export const DayMarker = Node.create({
  name: "dayMarker",
  group: "block",
  atom: true,
  selectable: false,
  draggable: false,

  addAttributes() {
    return {
      date: { default: null },
      whatMatters: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="day-marker"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const date = HTMLAttributes.date || "";
    const whatMatters = HTMLAttributes.whatMatters || "";
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "day-marker",
        "data-date": date,
        class: "day-marker",
        contenteditable: "false",
      }),
      ["span", { class: "day-marker-date" }, formatDate(date)],
      ["span", { class: "day-marker-sep" }, " · "],
      ["span", { class: "day-marker-focus" }, whatMatters],
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
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toLowerCase();
  } catch {
    return dateStr;
  }
}
