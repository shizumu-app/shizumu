import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Fragment, Slice } from "@tiptap/pm/model";

const PINNABLE_TYPES = [
  "paragraph",
  "heading",
  "list",
  "blockquote",
  "qaBlock",
  "table",
  "codeBlock",
  "recipeBlock",
  "decisionBlock",
  "chart",
  "attachment",
];

export const PinId = Extension.create({
  name: "pinId",

  addGlobalAttributes() {
    return [
      {
        types: PINNABLE_TYPES,
        attributes: {
          pinId: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el) => el.getAttribute("data-pin-id") || null,
            renderHTML: (attrs) => (attrs.pinId ? { "data-pin-id": attrs.pinId } : {}),
          },
        },
      },
    ];
  },

  // Strip pinId from any pasted slice so duplicating a pinned block does not
  // re-bind the duplicate to the original pin row. Critically, this is a
  // no-op when the slice contains no pinId-bearing nodes — we never touch the
  // structure of unrelated pasted content.
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("pinIdPasteStrip"),
        props: {
          transformPasted(slice) {
            // Fast path: bail out entirely if no pinId is anywhere in the
            // slice. Fragment has no `descendants`, so walk it manually.
            const fragmentHasPinId = (fragment) => {
              let found = false;
              fragment.forEach((node) => {
                if (found) return;
                if (node.attrs && node.attrs.pinId) { found = true; return; }
                if (node.content && node.content.size > 0 && fragmentHasPinId(node.content)) {
                  found = true;
                }
              });
              return found;
            };
            if (!fragmentHasPinId(slice.content)) return slice;

            // Slow path: rebuild only the subtree that contains pinId-bearing
            // nodes, leaving everything else by reference.
            const stripFragment = (fragment) => {
              let changed = null;
              fragment.forEach((node, _offset, index) => {
                const stripped = stripPinIdFromNode(node);
                if (stripped !== node && changed === null) {
                  changed = [];
                  for (let j = 0; j < index; j++) changed.push(fragment.child(j));
                }
                if (changed !== null) changed.push(stripped);
              });
              return changed === null ? fragment : Fragment.fromArray(changed);
            };
            const stripPinIdFromNode = (node) => {
              if (node.isText) return node;
              const newContent = node.content.size > 0 ? stripFragment(node.content) : node.content;
              if (node.attrs && node.attrs.pinId != null) {
                return node.type.create({ ...node.attrs, pinId: null }, newContent, node.marks);
              }
              if (newContent !== node.content) {
                return node.copy(newContent);
              }
              return node;
            };
            return new Slice(stripFragment(slice.content), slice.openStart, slice.openEnd);
          },
        },
      }),
    ];
  },
});

export function isPinnableType(typeName) {
  return PINNABLE_TYPES.includes(typeName);
}

export function stripPinIdsFromJSON(json) {
  if (!json || typeof json !== "object") return json;
  if (Array.isArray(json)) return json.map(stripPinIdsFromJSON);
  const out = { ...json };
  if (out.attrs && "pinId" in out.attrs) {
    const { pinId, ...rest } = out.attrs;
    out.attrs = rest;
  }
  if (Array.isArray(out.content)) {
    out.content = out.content.map(stripPinIdsFromJSON);
  }
  return out;
}
