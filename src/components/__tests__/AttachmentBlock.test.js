// AttachmentBlock — TipTap node view for a synced/local attachment.
// Renders filename + formatted size; click opens the blob; the sync
// toggle flips sync and writes the attr back; delete removes the node.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";

// AttachmentBlock's template roots in <NodeViewWrapper>, which reads
// the TipTapNodeView Svelte context for an onDragStart handler. In
// production SvelteNodeViewRenderer sets that context; in unit tests
// we wire a minimal stub so the wrapper mounts cleanly.
const NODE_VIEW_CONTEXT = new Map([
  ["TipTapNodeView", { onDragStart: () => {} }],
]);

vi.mock("../../lib/api.js", () => ({
  attachmentOpen: vi.fn(() => Promise.resolve()),
  attachmentSetSync: vi.fn(() => Promise.resolve()),
  attachmentLocalSrc: vi.fn(() => Promise.resolve("/home/user/.local/share/shizumu/blobs/ab/abc123")),
}));

// AttachmentBlock's image branch calls convertFileSrc via a dynamic
// import (`await import("@tauri-apps/api/core")`), and the real
// implementation reads `window.__TAURI_INTERNALS__.convertFileSrc`,
// which doesn't exist under jsdom — it would throw and get swallowed by
// the component's own try/catch, leaving resolvedSrc stuck at null.
// Mock the module directly, same as api.js above, rather than relying
// on Tauri runtime internals in a unit test.
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((p) => `asset://localhost/${p}`),
}));

import { attachmentOpen, attachmentSetSync, attachmentLocalSrc } from "../../lib/api.js";
import AttachmentBlock from "../AttachmentBlock.svelte";

afterEach(cleanupAll);
beforeEach(() => vi.clearAllMocks());

const node = (attrs = {}) => ({
  attrs: {
    blob_hash: "abc123",
    filename: "report.pdf",
    size_bytes: 2048,
    sync: false,
    ...attrs,
  },
});

describe("AttachmentBlock", () => {
  it("renders the filename and a human-readable size", () => {
    const { target } = render(AttachmentBlock, {
      node: node(),
      updateAttributes: vi.fn(),
      deleteNode: vi.fn(),
      selected: false,
    }, { context: NODE_VIEW_CONTEXT });
    expect(target.querySelector(".filename").textContent).toBe("report.pdf");
    expect(target.querySelector(".size").textContent).toBe("2.0 KB");
  });

  it("opens the blob when the block is clicked", async () => {
    const { target } = render(AttachmentBlock, {
      node: node(),
      updateAttributes: vi.fn(),
      deleteNode: vi.fn(),
      selected: false,
    }, { context: NODE_VIEW_CONTEXT });
    target.querySelector(".attachment-block").click();
    await tick();
    expect(attachmentOpen).toHaveBeenCalledWith("abc123", "report.pdf");
  });

  it("shows a readable message when opening fails, without the raw OS error", async () => {
    attachmentOpen.mockRejectedValueOnce(
      new Error("opener failed: No such file or directory (os error 2)"),
    );
    const { target } = render(AttachmentBlock, {
      node: node(),
      updateAttributes: vi.fn(),
      deleteNode: vi.fn(),
      selected: false,
    }, { context: NODE_VIEW_CONTEXT });
    target.querySelector(".attachment-block").click();
    await tick();
    await tick();
    const errorEl = target.querySelector(".attachment-error");
    expect(errorEl).toBeTruthy();
    expect(errorEl.textContent).not.toMatch(/os error/i);
  });

  it("toggles sync and writes the new attr back", async () => {
    const updateAttributes = vi.fn();
    const { target } = render(AttachmentBlock, {
      node: node({ sync: false }),
      updateAttributes,
      deleteNode: vi.fn(),
      selected: false,
    }, { context: NODE_VIEW_CONTEXT });
    target.querySelector(".sync-toggle").click();
    await tick();
    expect(attachmentSetSync).toHaveBeenCalledWith("abc123", true);
    expect(updateAttributes).toHaveBeenCalledWith({ sync: true });
  });

  it("removes the node on delete", () => {
    const deleteNode = vi.fn();
    const { target } = render(AttachmentBlock, {
      node: node(),
      updateAttributes: vi.fn(),
      deleteNode,
      selected: false,
    }, { context: NODE_VIEW_CONTEXT });
    target.querySelector(".delete-btn").click();
    expect(deleteNode).toHaveBeenCalledTimes(1);
  });

  describe("kind: image", () => {
    // The image branch's $effect chains two awaits (attachmentLocalSrc,
    // then a dynamic import) before touching resolvedSrc, so a single
    // tick() isn't reliably enough to observe the result.
    async function settle() {
      await new Promise((r) => setTimeout(r, 0));
      await tick();
      await new Promise((r) => setTimeout(r, 0));
      await tick();
    }

    const imageNode = (attrs = {}) => ({
      attrs: {
        kind: "image",
        blob_hash: "img-hash-1",
        filename: "photo.png",
        size_bytes: 4096,
        sync: false,
        width: null,
        display: "block",
        collapsed: false,
        ...attrs,
      },
    });

    it("resolves and renders the image src via attachmentLocalSrc", async () => {
      const { target } = render(AttachmentBlock, {
        node: imageNode(),
        updateAttributes: vi.fn(),
        deleteNode: vi.fn(),
        selected: false,
      }, { context: NODE_VIEW_CONTEXT });
      await settle();
      expect(attachmentLocalSrc).toHaveBeenCalledWith("img-hash-1");
      const img = target.querySelector("img");
      expect(img).toBeTruthy();
    });

    it("renders a chip instead of the image when collapsed", async () => {
      const { target } = render(AttachmentBlock, {
        node: imageNode({ collapsed: true }),
        updateAttributes: vi.fn(),
        deleteNode: vi.fn(),
        selected: false,
      }, { context: NODE_VIEW_CONTEXT });
      await settle();
      expect(target.querySelector("img")).toBeNull();
      expect(target.querySelector(".local-image-chip")).toBeTruthy();
    });

    it("dispatches shizumu-image-preview on chip click", async () => {
      const { target } = render(AttachmentBlock, {
        node: imageNode({ collapsed: true }),
        updateAttributes: vi.fn(),
        deleteNode: vi.fn(),
        selected: false,
      }, { context: NODE_VIEW_CONTEXT });
      await settle();
      const events = [];
      target.addEventListener("shizumu-image-preview", (e) => events.push(e.detail));
      target.querySelector(".local-image-chip").click();
      // Held for one double-click interval so a second click can cancel it
      // and expand instead — see "a double-click expands instead of previewing".
      await new Promise((r) => setTimeout(r, 400));
      expect(events).toHaveLength(1);
    });

    it("still exposes the sync toggle for images", async () => {
      const updateAttributes = vi.fn();
      const { target } = render(AttachmentBlock, {
        node: imageNode({ sync: false }),
        updateAttributes,
        deleteNode: vi.fn(),
        selected: false,
      }, { context: NODE_VIEW_CONTEXT });
      await settle();
      target.querySelector(".sync-toggle").click();
      await tick();
      expect(attachmentSetSync).toHaveBeenCalledWith("img-hash-1", true);
      expect(updateAttributes).toHaveBeenCalledWith({ sync: true });
    });

    it("says so when the blob isn't on this device", async () => {
      attachmentLocalSrc.mockResolvedValueOnce(null);
      const { target } = render(AttachmentBlock, {
        node: imageNode(),
        updateAttributes: vi.fn(),
        deleteNode: vi.fn(),
        selected: false,
      }, { context: NODE_VIEW_CONTEXT });
      await settle();
      expect(target.querySelector("img")).toBeNull();
      expect(target.querySelector(".local-image-missing")).toBeTruthy();
    });
  });
});

// Reported together: hovering an image/file flickers, block and inline
// images look the same, and a chip collapsed with "–" can't be expanded.
describe("image: inline vs block, and re-resolution", () => {
  async function settle() {
    await new Promise((r) => setTimeout(r, 0));
    await tick();
    await new Promise((r) => setTimeout(r, 0));
    await tick();
  }
  const img = (attrs = {}) => ({
    attrs: { kind: "image", blob_hash: "h", filename: "p.png", size_bytes: 1,
             sync: false, width: null, display: "block", collapsed: false, ...attrs },
  });

  it("renders inline and block images differently", async () => {
    const mk = async (display) => {
      const { target } = render(AttachmentBlock, {
        node: img({ display }), updateAttributes: vi.fn(), deleteNode: vi.fn(), selected: false,
      }, { context: NODE_VIEW_CONTEXT });
      await settle();
      return target.querySelector("[data-node-view-wrapper]");
    };
    const block = await mk("block");
    const inline = await mk("inline");
    expect(block.getAttribute("data-display")).toBe("block");
    expect(inline.getAttribute("data-display")).toBe("inline");
    expect(block.tagName).not.toBe(inline.tagName);
  });

  it("expands a collapsed chip", async () => {
    const updateAttributes = vi.fn();
    const { target } = render(AttachmentBlock, {
      node: img({ collapsed: true }), updateAttributes, deleteNode: vi.fn(), selected: false,
    }, { context: NODE_VIEW_CONTEXT });
    await settle();
    const chip = target.querySelector(".local-image-chip");
    chip.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await tick();
    expect(updateAttributes).toHaveBeenCalledWith({ collapsed: false });
  });

  it("a double-click expands instead of previewing", async () => {
    // The two chip gestures used to fight: the first click opened the
    // preview dialog, which covers the chip, so the second click hit the
    // modal and dblclick never fired — a collapsed image could not be
    // expanded at all. The preview is now held for one double-click
    // interval so the second click can cancel it.
    const updateAttributes = vi.fn();
    const { target } = render(AttachmentBlock, {
      node: img({ collapsed: true }), updateAttributes, deleteNode: vi.fn(), selected: false,
    }, { context: NODE_VIEW_CONTEXT });
    await settle();
    const events = [];
    target.addEventListener("shizumu-image-preview", (e) => events.push(e.detail));
    const chip = target.querySelector(".local-image-chip");

    chip.click();
    chip.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));

    expect(updateAttributes).toHaveBeenCalledWith({ collapsed: false });
    expect(events).toHaveLength(0);
  });
});
