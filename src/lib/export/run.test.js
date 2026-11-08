// Orchestrator test for the export pipeline.
//
// Mocks the Tauri `invoke` boundary so we can verify:
//   - lineage tree → folder path mapping (depth-first, collision suffix,
//     unique after slugging and without case)
//   - per-page filename rules (continuous → _doc.md, discrete → date.md
//     with same-day suffixes)
//   - untrailed bucket
//   - image collection from page bodies
//   - overwrite error surface
//
// We don't test markdown.js here (already covered by markdown.test.js +
// round-trip.test.js). The orchestrator's job is shape: which file ends
// up where with which content envelope.

import { describe, it, expect, beforeEach, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: async () => "0.3.0-test",
}));

let runExport;
beforeEach(async () => {
  invokeMock.mockReset();
  const mod = await import("./run.js");
  runExport = mod.runExport;
});

function fixture(overrides = {}) {
  return {
    lineages: [],
    pages: [],
    pins: [],
    skipped_orphan_pin_count: 0,
    ...overrides,
  };
}

function bindMock(data, writes, copies, prepareError = null, blobPaths = null) {
  invokeMock.mockImplementation((cmd, args) => {
    if (cmd === "export_trail_folder_list_data") return Promise.resolve(data);
    if (cmd === "export_trail_folder_prepare") {
      if (prepareError) return Promise.reject(prepareError);
      return Promise.resolve();
    }
    if (cmd === "export_trail_folder_write") { writes.push({ ...args }); return Promise.resolve(); }
    if (cmd === "export_trail_folder_copy_image") { copies.push({ ...args }); return Promise.resolve(true); }
    // Attachment images carry a blob hash, not a path — the export asks
    // the blob store where the bytes actually live before copying.
    if (cmd === "attachment_local_src") {
      return Promise.resolve(blobPaths ? (blobPaths[args.blobHash] ?? null) : null);
    }
    return Promise.reject(new Error("unexpected invoke: " + cmd));
  });
}

describe("runExport — folder shape", () => {
  it("writes _trail.md + page files for a discrete trail", async () => {
    const writes = [], copies = [];
    bindMock(fixture({
      lineages: [{ id: "L1", name: "book", mode: "discrete", parent_id: null, created_at: "x" }],
      pages: [
        {
          id: "P1", date: "2026-05-12", page_number: 1, lineage_id: "L1",
          what_matters_now: "first day", content_json: '{"type":"doc","content":[]}',
          created_at: "x", updated_at: "x",
        },
        {
          id: "P2", date: "2026-05-13", page_number: 1, lineage_id: "L1",
          what_matters_now: null, content_json: '{"type":"doc","content":[]}',
          created_at: "x", updated_at: "x",
        },
      ],
    }), writes, copies);

    const summary = await runExport("/tmp/export");
    expect(summary.pageCount).toBe(2);
    expect(summary.trailCount).toBe(1);

    const paths = writes.map((w) => w.relativePath).sort();
    expect(paths).toContain("book/_trail.md");
    expect(paths).toContain("book/2026-05-12.md");
    expect(paths).toContain("book/2026-05-13.md");
    expect(paths).toContain("README.md");
  });

  it("uses _doc.md for continuous trails (one canonical page)", async () => {
    const writes = [], copies = [];
    bindMock(fixture({
      lineages: [{ id: "L1", name: "novel", mode: "continuous", parent_id: null, created_at: "x" }],
      pages: [{
        id: "P1", date: "2026-05-12", page_number: 1, lineage_id: "L1",
        what_matters_now: null, content_json: '{"type":"doc","content":[]}',
        created_at: "x", updated_at: "x",
      }],
    }), writes, copies);

    await runExport("/tmp/export");
    const paths = writes.map((w) => w.relativePath);
    expect(paths).toContain("novel/_doc.md");
    expect(paths).not.toContain("novel/2026-05-12.md");
  });

  it("disambiguates same-day pages with (N) suffix", async () => {
    const writes = [], copies = [];
    bindMock(fixture({
      lineages: [{ id: "L1", name: "diary", mode: "discrete", parent_id: null, created_at: "x" }],
      pages: [
        { id: "P1", date: "2026-05-12", page_number: 1, lineage_id: "L1", what_matters_now: null,
          content_json: '{"type":"doc","content":[]}', created_at: "x", updated_at: "x" },
        { id: "P2", date: "2026-05-12", page_number: 2, lineage_id: "L1", what_matters_now: null,
          content_json: '{"type":"doc","content":[]}', created_at: "x", updated_at: "x" },
        { id: "P3", date: "2026-05-12", page_number: 3, lineage_id: "L1", what_matters_now: null,
          content_json: '{"type":"doc","content":[]}', created_at: "x", updated_at: "x" },
      ],
    }), writes, copies);

    await runExport("/tmp/export");
    const paths = writes.map((w) => w.relativePath);
    expect(paths).toContain("diary/2026-05-12.md");
    expect(paths).toContain("diary/2026-05-12 (2).md");
    expect(paths).toContain("diary/2026-05-12 (3).md");
  });

  it("nests child trails under their parent's folder", async () => {
    const writes = [], copies = [];
    bindMock(fixture({
      lineages: [
        { id: "L1", name: "shizumu", mode: "discrete", parent_id: null, created_at: "x" },
        { id: "L2", name: "book", mode: "discrete", parent_id: "L1", created_at: "x" },
      ],
      pages: [
        { id: "P1", date: "2026-05-12", page_number: 1, lineage_id: "L1",
          what_matters_now: null, content_json: '{"type":"doc","content":[]}',
          created_at: "x", updated_at: "x" },
        { id: "P2", date: "2026-05-13", page_number: 1, lineage_id: "L2",
          what_matters_now: null, content_json: '{"type":"doc","content":[]}',
          created_at: "x", updated_at: "x" },
      ],
    }), writes, copies);

    await runExport("/tmp/export");
    const paths = writes.map((w) => w.relativePath);
    expect(paths).toContain("shizumu/_trail.md");
    expect(paths).toContain("shizumu/book/_trail.md");
    expect(paths).toContain("shizumu/book/2026-05-13.md");
  });

  it("suffixes name collisions with __<shortId>", async () => {
    const writes = [], copies = [];
    bindMock(fixture({
      lineages: [
        { id: "AAAAAA111111", name: "research", mode: "discrete", parent_id: null, created_at: "x" },
        { id: "BBBBBB222222", name: "research", mode: "discrete", parent_id: null, created_at: "x" },
      ],
    }), writes, copies);

    await runExport("/tmp/export");
    const paths = writes.map((w) => w.relativePath);
    expect(paths).toContain("research__AAAAAA/_trail.md");
    expect(paths).toContain("research__BBBBBB/_trail.md");
  });

  it("puts untrailed pages in untrailed/", async () => {
    const writes = [], copies = [];
    bindMock(fixture({
      pages: [{
        id: "P1", date: "2026-05-19", page_number: 1, lineage_id: null,
        what_matters_now: null, content_json: '{"type":"doc","content":[]}',
        created_at: "x", updated_at: "x",
      }],
    }), writes, copies);

    await runExport("/tmp/export");
    const paths = writes.map((w) => w.relativePath);
    expect(paths).toContain("untrailed/2026-05-19.md");
  });
});

describe("runExport — image collection", () => {
  it("collects localImage references and copies them once each", async () => {
    const writes = [], copies = [];
    bindMock(fixture({
      lineages: [{ id: "L1", name: "book", mode: "discrete", parent_id: null, created_at: "x" }],
      pages: [
        {
          id: "P1", date: "2026-05-12", page_number: 1, lineage_id: "L1",
          what_matters_now: null,
          content_json: JSON.stringify({
            type: "doc",
            content: [
              { type: "paragraph", content: [
                { type: "localImage", attrs: { localPath: "/abs/path/to/01HIMG1-screenshot.png", display: "block" } },
              ]},
            ],
          }),
          created_at: "x", updated_at: "x",
        },
        {
          id: "P2", date: "2026-05-13", page_number: 1, lineage_id: "L1",
          what_matters_now: null,
          content_json: JSON.stringify({
            type: "doc",
            content: [
              { type: "paragraph", content: [
                { type: "localImage", attrs: { localPath: "/other/path/01HIMG1-screenshot.png", display: "block" } },
              ]},
              { type: "paragraph", content: [
                { type: "localImage", attrs: { localPath: "/abs/path/01HIMG2-other.jpg", display: "block" } },
              ]},
            ],
          }),
          created_at: "x", updated_at: "x",
        },
      ],
    }), writes, copies);

    const summary = await runExport("/tmp/export");
    expect(summary.imageCount).toBe(2); // 2 unique filenames

    const filenames = copies.map((c) => c.destFilename).sort();
    expect(filenames).toEqual(["01HIMG1-screenshot.png", "01HIMG2-other.jpg"]);
  });

  it("copies attachment images by resolving their blob hash to a path", async () => {
    const writes = [], copies = [];
    bindMock(fixture({
      lineages: [{ id: "L1", name: "book", mode: "discrete", parent_id: null, created_at: "x" }],
      pages: [
        {
          id: "P1", date: "2026-05-12", page_number: 1, lineage_id: "L1",
          what_matters_now: null,
          content_json: JSON.stringify({
            type: "doc",
            content: [
              { type: "paragraph", content: [
                { type: "attachment", attrs: { kind: "image", blob_hash: "aaaaaaaaaa", filename: "shot.png" } },
                // Same blob twice — copied once.
                { type: "attachment", attrs: { kind: "image", blob_hash: "aaaaaaaaaa", filename: "shot.png" } },
                // A file attachment's bytes aren't part of the export.
                { type: "attachment", attrs: { kind: "file", blob_hash: "ffffffffff", filename: "report.pdf" } },
              ]},
            ],
          }),
          created_at: "x", updated_at: "x",
        },
      ],
    }), writes, copies, null, { aaaaaaaaaa: "/data/blobs/aa/aaaaaaaaaa" });

    const summary = await runExport("/tmp/export");

    expect(summary.imageCount).toBe(1);
    expect(copies).toHaveLength(1);
    expect(copies[0].srcPath).toBe("/data/blobs/aa/aaaaaaaaaa");
    expect(copies[0].destFilename).toBe("aaaaaaaa-shot.png");
    // The markdown link and the copied filename must agree.
    const pageMd = writes.find((w) => w.relativePath.endsWith("2026-05-12.md"));
    expect(pageMd.content).toContain("../images/aaaaaaaa-shot.png");
  });

  it("skips an attachment image whose blob isn't on this device", async () => {
    const writes = [], copies = [];
    bindMock(fixture({
      lineages: [{ id: "L1", name: "book", mode: "discrete", parent_id: null, created_at: "x" }],
      pages: [
        {
          id: "P1", date: "2026-05-12", page_number: 1, lineage_id: "L1",
          what_matters_now: null,
          content_json: JSON.stringify({
            type: "doc",
            content: [
              { type: "paragraph", content: [
                { type: "attachment", attrs: { kind: "image", blob_hash: "gone", filename: "shot.png" } },
              ]},
            ],
          }),
          created_at: "x", updated_at: "x",
        },
      ],
    }), writes, copies, null, {});

    const summary = await runExport("/tmp/export");

    expect(summary.imageCount).toBe(0);
    expect(copies).toHaveLength(0);
  });
});

describe("runExport — pins on source page", () => {
  it("includes pin frontmatter on the source page only", async () => {
    const writes = [], copies = [];
    bindMock(fixture({
      lineages: [{ id: "L1", name: "book", mode: "discrete", parent_id: null, created_at: "x" }],
      pages: [
        { id: "P1", date: "2026-05-12", page_number: 1, lineage_id: "L1",
          what_matters_now: null, content_json: '{"type":"doc","content":[]}',
          created_at: "x", updated_at: "x" },
        { id: "P2", date: "2026-05-13", page_number: 1, lineage_id: "L1",
          what_matters_now: null, content_json: '{"type":"doc","content":[]}',
          created_at: "x", updated_at: "x" },
      ],
      pins: [
        { id: "PIN1", lineage_id: "L1", source_page_id: "P1", object_type: "board",
          title: "a pin", position: 0, auto_insert: false, content: "pin content",
          created_at: "x", updated_at: "x" },
      ],
    }), writes, copies);

    await runExport("/tmp/export");
    const p1Md = writes.find((w) => w.relativePath === "book/2026-05-12.md").content;
    const p2Md = writes.find((w) => w.relativePath === "book/2026-05-13.md").content;
    expect(p1Md).toContain("- id: PIN1");
    expect(p2Md).not.toContain("PIN1");
  });
});

describe("runExport — overwrite handling", () => {
  it("propagates non-empty folder error", async () => {
    const writes = [], copies = [];
    bindMock(fixture(), writes, copies, "folder is not empty");
    await expect(runExport("/tmp/export")).rejects.toBeDefined();
  });
});

// ── the phone's zip: the same files, packed ─────────────────────────────

const page = (id, date, lineage_id, n = 1) => ({
  id, date, page_number: n, lineage_id, what_matters_now: null,
  content_json: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `words of ${id}` }] }] }),
  created_at: "x", updated_at: "x",
});

const EVERYTHING = fixture({
  lineages: [
    { id: "L1", name: "book", mode: "discrete", parent_id: null, created_at: "x" },
    { id: "L2", name: "chapter", mode: "continuous", parent_id: "L1", created_at: "x" },
  ],
  pages: [
    page("P1", "2026-05-12", "L1"),
    page("P2", "2026-05-12", "L1", 2),
    page("P3", "2026-05-13", "L2"),
    page("P4", "2026-05-14", null),
  ],
});

describe("planExport", () => {
  it("lists every page the device holds, each in its trail's folder", async () => {
    const { planExport } = await import("./run.js");
    const plan = planExport(EVERYTHING);
    expect(plan.pageCount).toBe(4);
    expect(plan.files.map((f) => f.path)).toEqual([
      "book/_trail.md",
      "book/2026-05-12.md",
      "book/2026-05-12 (2).md",
      "book/chapter/_trail.md",
      "book/chapter/_doc.md",
      "untrailed/2026-05-14.md",
    ]);
    for (const id of ["P1", "P2", "P3", "P4"]) {
      expect(plan.files.some((f) => f.content.includes(`page_id: ${id}`) && f.content.includes(`words of ${id}`))).toBe(true);
    }
  });
});

describe("runExportZip", () => {
  it("hands Rust the folder export's files, README included, and the images on this device", async () => {
    const mod = await import("./run.js");
    const data = fixture({
      ...EVERYTHING,
      pages: [...EVERYTHING.pages, {
        ...page("P5", "2026-05-15", null),
        content_json: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [
          { type: "localImage", attrs: { localPath: "/data/images/a.png" } },
          { type: "attachment", attrs: { kind: "image", blob_hash: "abcdef1234", filename: "shot.png" } },
          { type: "attachment", attrs: { kind: "image", blob_hash: "99999999ff", filename: "elsewhere.png" } },
        ] }] }),
      }],
    });

    // What the desktop's folder export writes, for the same rows.
    const writes = [];
    bindMock(data, writes, [], null, { abcdef1234: "/data/blobs/ab/abcdef1234" });
    await mod.runExport("/tmp/export");

    let shared = null;
    invokeMock.mockImplementation((cmd, args) => {
      if (cmd === "export_trail_folder_list_data") return Promise.resolve(data);
      if (cmd === "attachment_local_src") return Promise.resolve(args.blobHash === "abcdef1234" ? "/data/blobs/ab/abcdef1234" : null);
      // Rust packs one of the two: the other turned out unreadable.
      if (cmd === "export_trail_zip_share") { shared = args; return Promise.resolve({ fileCount: args.files.length + 1, imageCount: 1 }); }
      return Promise.reject(new Error("unexpected invoke: " + cmd));
    });
    const summary = await mod.runExportZip();

    expect(summary).toEqual({ pageCount: 5, trailCount: 2, imageCount: 1 });
    // The same paths and the same page files as the folder export. The
    // README differs only in its export time, and goes over on its own.
    expect([...shared.files.map((f) => f.path), shared.readme.path]).toEqual(writes.map((w) => w.relativePath));
    const byPath = new Map(writes.map((w) => [w.relativePath, w.content]));
    for (const f of shared.files) expect(f.content).toBe(byPath.get(f.path));
    expect(shared.readme.content).toContain("page_count: 5");
    // The README leaves the image count to Rust, which writes the number
    // the zip holds (trail_export.rs, IMAGE_COUNT_SLOT): counting here
    // promised images Rust then skipped (review minor #7).
    expect(shared.readme.content).toContain(`image_count: ${mod.IMAGE_COUNT_SLOT}`);
    expect(mod.IMAGE_COUNT_SLOT).toBe("IMAGE_COUNT_PACKED");
    expect(shared.images).toEqual([
      { srcPath: "/data/images/a.png", destFilename: "a.png" },
      { srcPath: "/data/blobs/ab/abcdef1234", destFilename: "abcdef12-shot.png" },
    ]);
  });
});

// ── review #1: two trails must never share a path once their names are
// slugged. The zip refuses a repeated entry, which failed the phone's whole
// export; a folder overwrites, which lost one trail's files in silence.
// Windows and macOS file systems fold case, so "Book/" and "book/" are one
// folder there: uniqueness is checked case-insensitively.
describe("planExport — every path is its own", () => {
  const lin = (id, name, parent_id = null) => ({ id, name, mode: "discrete", parent_id, created_at: "x" });
  const lowerDupes = (paths) => {
    const seen = new Set(), dupes = [];
    for (const p of paths) {
      const k = p.toLowerCase();
      if (seen.has(k)) dupes.push(p);
      seen.add(k);
    }
    return dupes;
  };

  it("keeps trails apart whose names differ only in case or punctuation", async () => {
    const { planExport } = await import("./run.js");
    const plan = planExport(fixture({
      lineages: [lin("A1", "Book"), lin("B2", "book"), lin("C3", "job search"), lin("D4", "job-search")],
      pages: [page("P1", "2026-11-01", "A1"), page("P2", "2026-11-01", "B2"), page("P3", "2026-11-01", "C3"), page("P4", "2026-11-01", "D4")],
    }));
    const paths = plan.files.map((f) => f.path);
    expect(lowerDupes(paths)).toEqual([]);
    expect(paths.filter((p) => p.endsWith("_trail.md"))).toHaveLength(4);
    for (const id of ["P1", "P2", "P3", "P4"]) {
      expect(plan.files.filter((f) => f.content.includes(`page_id: ${id}`))).toHaveLength(1);
    }
  });

  it("never puts a trail in the untrailed or images folder", async () => {
    const { planExport } = await import("./run.js");
    const plan = planExport(fixture({
      lineages: [lin("U1", "Untrailed"), lin("I1", "Images")],
      pages: [page("P1", "2026-11-02", "U1"), page("P2", "2026-11-02", null), page("P3", "2026-11-02", "I1")],
    }));
    const paths = plan.files.map((f) => f.path);
    expect(lowerDupes(paths)).toEqual([]);
    expect(paths).toContain("untrailed/2026-11-02.md");
    const trailFolders = paths.filter((p) => p.endsWith("_trail.md")).map((p) => p.split("/")[0].toLowerCase());
    expect(trailFolders).not.toContain("untrailed");
    expect(trailFolders).not.toContain("images");
  });

  it("keeps nested siblings apart too, and ids that differ only in case", async () => {
    const { planExport } = await import("./run.js");
    const plan = planExport(fixture({
      lineages: [lin("R1", "book"), lin("abcdef1", "Notes", "R1"), lin("ABCDEF2", "notes", "R1"), lin("abcdef3", "NOTES!", "R1")],
      pages: [page("P1", "2026-11-01", "abcdef1"), page("P2", "2026-11-01", "ABCDEF2"), page("P3", "2026-11-01", "abcdef3")],
    }));
    expect(lowerDupes(plan.files.map((f) => f.path))).toEqual([]);
    expect(plan.files.filter((f) => f.path.endsWith("_trail.md"))).toHaveLength(4);
  });
});
