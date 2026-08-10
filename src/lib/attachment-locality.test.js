import { describe, it, expect } from "vitest";
import {
  AWAY_LABEL,
  attachmentLocality,
  blobLocality,
  pinFileLocality,
  fileRowDetail,
  awayCount,
} from "./attachment-locality.js";

function filePin(blobHash) {
  return {
    object_type: "file",
    content: JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "attachment",
              attrs: { blob_hash: blobHash, filename: "contract.pdf", size_bytes: 37 },
            },
          ],
        },
      ],
    }),
  };
}

function notePin() {
  return { object_type: "note", content: "hello world", title: "" };
}

describe("attachmentLocality", () => {
  it("maps blob_hash to has_local", () => {
    const m = attachmentLocality([
      { blob_hash: "a", has_local: true },
      { blob_hash: "b", has_local: false },
    ]);
    expect(m.get("a")).toBe(true);
    expect(m.get("b")).toBe(false);
  });

  it("returns an empty map for a missing or non-array list", () => {
    // Empty, not null: a caller that failed to load passes null and gets a
    // usable-but-empty map only if it asks for one. The "unknown" state is
    // carried by passing no map at all (see pinFileLocality below), so an
    // empty map here means "the list loaded and it was empty", which is a
    // real answer.
    expect(attachmentLocality(null).size).toBe(0);
    expect(attachmentLocality(undefined).size).toBe(0);
    expect(attachmentLocality("nope").size).toBe(0);
  });

  it("skips rows with no usable hash", () => {
    const m = attachmentLocality([{ has_local: true }, { blob_hash: "", has_local: true }, null]);
    expect(m.size).toBe(0);
  });
});

describe("blobLocality", () => {
  const m = attachmentLocality([
    { blob_hash: "here", has_local: true },
    { blob_hash: "away", has_local: false },
  ]);

  it("reads has_local off the row", () => {
    expect(blobLocality("here", m)).toBe("here");
    expect(blobLocality("away", m)).toBe("away");
  });

  it("makes no claim for a hash with no row", () => {
    // Deliberate: a pin can sync ahead of the attachment row it points at.
    // Reporting "away" there would put "not on this device" under a file
    // that arrives seconds later. null means the row shows the size alone.
    expect(blobLocality("unknown-hash", m)).toBe(null);
  });

  it("makes no claim without a hash or without a loaded map", () => {
    expect(blobLocality(null, m)).toBe(null);
    expect(blobLocality("here", null)).toBe(null);
    expect(blobLocality("here", undefined)).toBe(null);
  });
});

describe("pinFileLocality", () => {
  const m = attachmentLocality([
    { blob_hash: "h1", has_local: true },
    { blob_hash: "h2", has_local: false },
  ]);

  it("reports a pinned file whose bytes are gone as away", () => {
    expect(pinFileLocality(filePin("h2"), m)).toBe("away");
  });

  it("reports a pinned file whose bytes are here", () => {
    expect(pinFileLocality(filePin("h1"), m)).toBe("here");
  });

  it("makes no claim about a pin that is not a file", () => {
    // A text pin has no bytes to be missing — the row must not grow a
    // locality line just because the attachment list happens to be loaded.
    expect(pinFileLocality(notePin(), m)).toBe(null);
  });

  it("makes no claim before the attachment list has loaded", () => {
    // The panel passes null until the list lands. Rendering "not on this
    // device" during that window would flag every file pin on open.
    expect(pinFileLocality(filePin("h2"), null)).toBe(null);
  });

  it("makes no claim for a file pin whose cache carries no hash", () => {
    // Legacy/malformed caches exist; without a hash there is nothing to
    // look up, so the row falls back to the plain size line.
    const noHash = { object_type: "file", content: JSON.stringify({ type: "doc", content: [{ type: "attachment", attrs: { filename: "x.pdf" } }] }) };
    expect(pinFileLocality(noHash, m)).toBe(null);
  });
});

describe("fileRowDetail", () => {
  it("appends the state only when the bytes are away", () => {
    expect(fileRowDetail("2.4 MB", "away")).toBe(`2.4 MB — ${AWAY_LABEL}`);
    expect(fileRowDetail("2.4 MB", "here")).toBe("2.4 MB");
    expect(fileRowDetail("2.4 MB", null)).toBe("2.4 MB");
  });

  it("stands alone when there is no size to lead with", () => {
    expect(fileRowDetail("", "away")).toBe(AWAY_LABEL);
    expect(fileRowDetail("", "here")).toBe("");
  });
});

describe("awayCount", () => {
  it("counts rows the device is not holding bytes for", () => {
    expect(
      awayCount([
        { blob_hash: "a", has_local: true },
        { blob_hash: "b", has_local: false },
        { blob_hash: "c", has_local: false },
      ]),
    ).toBe(2);
  });

  it("is zero for an empty, missing or all-local list", () => {
    expect(awayCount([])).toBe(0);
    expect(awayCount(null)).toBe(0);
    expect(awayCount([{ blob_hash: "a", has_local: true }])).toBe(0);
  });
});
