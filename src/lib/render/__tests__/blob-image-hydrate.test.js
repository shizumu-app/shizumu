import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../api.js", () => ({
  attachmentLocalSrc: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((p) => `asset://localhost/${p}`),
}));

import { attachmentLocalSrc } from "../../api.js";
import { hydrateBlobImages, clearBlobSrcCache } from "../blob-image-hydrate.js";

beforeEach(() => {
  vi.clearAllMocks();
  clearBlobSrcCache();
});

function mount(html) {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

describe("hydrateBlobImages", () => {
  it("fills in the src of an un-hydrated attachment image", async () => {
    attachmentLocalSrc.mockResolvedValue("/data/blobs/de/deadbeef");
    const root = mount('<img data-blob-hash="deadbeef" alt="photo.png">');

    const count = await hydrateBlobImages(root);

    expect(count).toBe(1);
    expect(root.querySelector("img").getAttribute("src"))
      .toBe("asset://localhost//data/blobs/de/deadbeef");
  });

  it("resolves each distinct hash once, however many images use it", async () => {
    attachmentLocalSrc.mockResolvedValue("/data/blobs/de/deadbeef");
    const root = mount(
      '<img data-blob-hash="deadbeef"><img data-blob-hash="deadbeef"><img data-blob-hash="deadbeef">',
    );

    await hydrateBlobImages(root);

    expect(attachmentLocalSrc).toHaveBeenCalledTimes(1);
    expect([...root.querySelectorAll("img[src]")]).toHaveLength(3);
  });

  it("marks a missing blob instead of setting a broken src", async () => {
    attachmentLocalSrc.mockResolvedValue(null);
    const root = mount('<img data-blob-hash="gone">');

    const count = await hydrateBlobImages(root);

    expect(count).toBe(0);
    const img = root.querySelector("img");
    expect(img.hasAttribute("src")).toBe(false);
    expect(img.getAttribute("data-blob-missing")).toBe("true");
  });

  it("doesn't re-ask for an image it already hydrated or gave up on", async () => {
    attachmentLocalSrc.mockResolvedValue("/data/blobs/aa/aaa");
    const root = mount('<img data-blob-hash="aaa"><img data-blob-hash="bbb">');
    await hydrateBlobImages(root);
    vi.clearAllMocks();

    const count = await hydrateBlobImages(root);

    expect(count).toBe(0);
    expect(attachmentLocalSrc).not.toHaveBeenCalled();
  });

  it("swallows a failing resolve rather than throwing into the render path", async () => {
    attachmentLocalSrc.mockRejectedValue(new Error("db is gone"));
    const root = mount('<img data-blob-hash="boom">');

    await expect(hydrateBlobImages(root)).resolves.toBe(0);
    expect(root.querySelector("img").getAttribute("data-blob-missing")).toBe("true");
  });

  it("is a no-op for a null root or a subtree with no blob images", async () => {
    expect(await hydrateBlobImages(null)).toBe(0);
    expect(await hydrateBlobImages(mount("<p>just text</p>"))).toBe(0);
    expect(attachmentLocalSrc).not.toHaveBeenCalled();
  });
});
