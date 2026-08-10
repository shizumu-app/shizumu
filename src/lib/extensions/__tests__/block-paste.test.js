// Phase G verification: structural cut/paste invariants.
//
// The plan called for a BlockPaste extension to strip pinId on paste. After
// reading pin-id.js, the existing transformPasted plugin already handles this
// fully — it walks nested content recursively and rebuilds only the affected
// subtree by reference. No new extension is needed.
//
// This file documents the expected behavior and provides regression coverage so
// that any future refactor of pin-id.js doesn't silently break the invariant.

import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Fragment, Slice } from "@tiptap/pm/model";
import { PinId, stripPinIdsFromJSON } from "../pin-id.js";
import { BlockTitle } from "../block-title.js";
import { UnifiedListExtensions } from "../unified-list.js";
import { QABlock } from "../qa-block.js";
import { QAPair } from "../qa-pair.js";

function makeEditor(content) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new Editor({
    element: host,
    extensions: [
      StarterKit.configure({
        // Disable StarterKit's bundled list types: replaced by UnifiedListExtensions.
        bulletList: false,
        orderedList: false,
        listItem: false,
      }),
      BlockTitle,
      QABlock,
      QAPair,
      ...UnifiedListExtensions,
      PinId,
    ],
    content,
  });
  return {
    editor,
    host,
    cleanup: () => {
      editor.destroy();
      host.remove();
    },
  };
}

describe("BlockPaste / transformPasted strips pinId", () => {
  it("stripPinIdsFromJSON removes pinId from a single node", () => {
    const node = { type: "list", attrs: { pinId: "P1", blockTitle: "x" }, content: [] };
    const stripped = stripPinIdsFromJSON(node);
    expect(stripped.attrs.pinId).toBeUndefined();
    // Other attrs preserved.
    expect(stripped.attrs.blockTitle).toBe("x");
  });

  it("stripPinIdsFromJSON descends into nested content", () => {
    const node = {
      type: "doc",
      content: [
        {
          type: "blockquote",
          attrs: { pinId: "OUTER" },
          content: [
            { type: "paragraph", attrs: { pinId: "INNER" }, content: [{ type: "text", text: "hi" }] },
          ],
        },
      ],
    };
    const stripped = stripPinIdsFromJSON(node);
    expect(stripped.content[0].attrs.pinId).toBeUndefined();
    expect(stripped.content[0].content[0].attrs.pinId).toBeUndefined();
  });

  it("transformPasted is a no-op when slice has no pinIds", () => {
    const env = makeEditor({ type: "doc", content: [{ type: "paragraph" }] });
    try {
      const node = env.editor.state.schema.nodeFromJSON({
        type: "list",
        content: [
          {
            type: "listItem",
            attrs: { marker: "bullet", checked: false },
            content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }],
          },
        ],
      });
      const slice = new Slice(Fragment.from(node), 0, 0);
      const out =
        env.editor.view.someProp("transformPasted", (f) => f(slice, env.editor.view)) || slice;
      // Slice should be structurally identical when no pinId is present.
      expect(out.content.size).toBe(slice.content.size);
    } finally {
      env.cleanup();
    }
  });

  it("transformPasted strips pinId when slice contains a pinned node", () => {
    const env = makeEditor({ type: "doc", content: [{ type: "paragraph" }] });
    try {
      const node = env.editor.state.schema.nodeFromJSON({
        type: "list",
        attrs: { pinId: "PASTED", blockTitle: null },
        content: [
          {
            type: "listItem",
            attrs: { marker: "bullet", checked: false },
            content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }],
          },
        ],
      });
      const slice = new Slice(Fragment.from(node), 0, 0);
      const out =
        env.editor.view.someProp("transformPasted", (f) => f(slice, env.editor.view)) || slice;
      // Walk the output; assert no pinId remains on any node.
      let hasPinId = false;
      out.content.descendants((n) => {
        if (n.attrs && n.attrs.pinId) hasPinId = true;
      });
      expect(hasPinId).toBe(false);
    } finally {
      env.cleanup();
    }
  });
});
