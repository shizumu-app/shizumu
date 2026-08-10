import { Node, mergeAttributes } from "@tiptap/core";
import { SvelteNodeViewRenderer } from "svelte-tiptap";
import AttachmentBlock from "../../components/AttachmentBlock.svelte";

export const Attachment = Node.create({
  name: "attachment",
  // Schema-inline (like localImage) so a file flows inside a text line as a
  // compact chip instead of breaking onto its own full-width line.
  inline: true,
  group: "inline",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      kind: { default: "file" },
      blob_hash: { default: null },
      filename: { default: null },
      mime_type: { default: null },
      size_bytes: { default: 0 },
      // Local-first: a freshly attached file stays on this device until the
      // user authorizes syncing it (the sync toggle on the attachment block).
      // Nothing leaves the device without that explicit opt-in.
      sync: { default: false },
      created_at: { default: null },
      pinId: { default: null },
      // image-kind only, ignored by the file chip. Ported from local-image.js.
      width: { default: null },
      // `display` is legacy-only now: nothing creates "inline" any more
      // (the /inline image command is gone — collapsing an image is the
      // inline form). Documents written before that still carry it, and
      // AttachmentBlock + global.css still honour it, so don't remove this
      // thinking it's dead.
      display: { default: "block" },
      collapsed: { default: false },
    };
  },

  parseHTML() {
    return [
      { tag: 'span[data-type="attachment"]' },
      { tag: 'div[data-type="attachment"]' }, // legacy block markup
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const span = mergeAttributes(HTMLAttributes, { "data-type": "attachment" });
    // Static surfaces (memory cards, pin previews, hover preview cards) go
    // through generateHTML, which never mounts the NodeView — so an image
    // has to carry a real <img> in its serialized form or it renders as an
    // empty span. The src can't be known synchronously (it's a blob path
    // resolved per device), so the element ships with data-blob-hash only
    // and hydrateBlobImages fills the src in once it's in the DOM.
    //
    // The <img> is a CHILD of the span rather than the root element on
    // purpose: parseHTML matches span[data-type="attachment"], and the node
    // is an atom, so nesting keeps the HTML round-trip (copy/paste, export
    // re-import) intact.
    if (node.attrs.kind === "image") {
      return [
        "span",
        span,
        [
          "img",
          {
            "data-blob-hash": node.attrs.blob_hash || "",
            "data-display": node.attrs.display || "block",
            alt: node.attrs.filename || "",
            ...(node.attrs.width ? { style: `width: ${node.attrs.width}` } : {}),
          },
        ],
      ];
    }
    return ["span", span];
  },

  addNodeView() {
    return SvelteNodeViewRenderer(AttachmentBlock);
  },

  addCommands() {
    return {
      insertAttachment:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});
