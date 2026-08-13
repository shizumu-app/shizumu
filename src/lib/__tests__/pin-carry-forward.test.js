import { describe, it, expect } from "vitest";
import { buildCarryForwardNodes, pinToNodes } from "../pin-carry-forward.js";

describe("buildCarryForwardNodes", () => {
  it("carries the title forward for a plain paragraph (note) pin, and parses its content instead of inserting raw JSON", () => {
    const notePin = {
      id: "pin-1",
      object_type: "note",
      title: "the real point",
      content: JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "the actual pinned sentence." }] }],
      }),
    };

    const nodes = buildCarryForwardNodes([notePin]);

    // Title survives as its own labeled line, not silently dropped.
    expect(nodes[0]).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "the real point", marks: [{ type: "bold" }] }],
    });
    // Content is the real parsed node, not the raw JSON string as literal text.
    expect(nodes[1]).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "the actual pinned sentence." }],
    });
    expect(nodes).toHaveLength(2);
  });

  it("omits the title line when a note pin has no title", () => {
    const notePin = {
      id: "pin-2",
      object_type: "note",
      title: "",
      content: JSON.stringify({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "untitled note." }] }],
      }),
    };

    const nodes = buildCarryForwardNodes([notePin]);
    expect(nodes).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "untitled note." }] },
    ]);
  });

  it("still stamps blockTitle onto board-type pins (unchanged behavior)", () => {
    const boardPin = {
      id: "pin-3",
      object_type: "board",
      title: "quote worth keeping",
      content: JSON.stringify({
        type: "doc",
        content: [{ type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "a quote" }] }] }],
      }),
    };

    const nodes = buildCarryForwardNodes([boardPin]);
    expect(nodes).toEqual([
      {
        type: "blockquote",
        content: [{ type: "paragraph", content: [{ type: "text", text: "a quote" }] }],
        attrs: { blockTitle: "quote worth keeping" },
      },
    ]);
  });

  // This used to assert `[]` — that a note whose content isn't JSON is
  // dropped. That codified a bug: TipTapEditor stores a note's content as
  // PLAIN TEXT on one creation path (`pinContent = blockText`) and as a
  // JSON doc on another. Treating "doesn't parse" as "throw the pin away"
  // meant every plain-text note pin vanished from a freshly-trailed page,
  // title and all.
  it("treats unparseable content as the plain text it is, keeping the pin", () => {
    const textPin = { id: "pin-4", object_type: "note", title: "t", content: "not json" };
    expect(buildCarryForwardNodes([textPin])).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "t", marks: [{ type: "bold" }] }] },
      { type: "paragraph", content: [{ type: "text", text: "not json" }] },
    ]);
  });

  it("drops a pin with no usable content at all", () => {
    expect(buildCarryForwardNodes([{ id: "p", object_type: "note", title: "t", content: "   " }])).toEqual([]);
    expect(buildCarryForwardNodes([{ id: "p", object_type: "note", title: "t", content: null }])).toEqual([]);
  });
});

// The single conversion both the carry-forward sweep and the panel's
// "inject here" button go through. They used to have separate
// implementations that each broke the case the other handled.
describe("pinToNodes", () => {
  const jsonDoc = (text) => JSON.stringify({
    type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });

  it("keeps the title of a plain-text note", () => {
    const nodes = pinToNodes({ object_type: "note", title: "the frame clicked", content: "a line I wrote" });
    expect(nodes[0].content[0].text).toBe("the frame clicked");
    expect(nodes[1].content[0].text).toBe("a line I wrote");
  });

  it("keeps the title of a JSON note and does not insert raw JSON as text", () => {
    const nodes = pinToNodes({ object_type: "note", title: "second thought", content: jsonDoc("a line I wrote") });
    expect(nodes[0].content[0].text).toBe("second thought");
    expect(nodes[1]).toEqual({ type: "paragraph", content: [{ type: "text", text: "a line I wrote" }] });
    // The failure this guards: the whole doc JSON rendered as visible text.
    expect(JSON.stringify(nodes)).not.toContain('\\"type\\":\\"doc\\"');
  });

  it("stamps blockTitle when the pin has a board node to carry it", () => {
    const nodes = pinToNodes({
      object_type: "board", title: "quote worth keeping",
      content: JSON.stringify({ type: "doc", content: [{ type: "blockquote", content: [] }] }),
    });
    expect(nodes).toHaveLength(1);
    expect(nodes[0].attrs.blockTitle).toBe("quote worth keeping");
  });

  it("falls back to a label line when the content has no board node to hold a title", () => {
    // A pinned list or heading is not a board type, so there is no
    // blockTitle slot — the title used to be dropped on the floor here.
    const nodes = pinToNodes({
      object_type: "note", title: "three things",
      content: JSON.stringify({ type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [] }] }),
    });
    expect(nodes[0].content[0].text).toBe("three things");
    expect(nodes[1].type).toBe("heading");
  });

  it("never mutates the caller's node objects", () => {
    const board = { type: "blockquote", content: [], attrs: { blockTitle: null } };
    const pin = { object_type: "board", title: "t", content: JSON.stringify({ type: "doc", content: [board] }) };
    const nodes = pinToNodes(pin);
    expect(nodes[0].attrs.blockTitle).toBe("t");
    expect(board.attrs.blockTitle).toBe(null);
  });

  it("returns nothing for an empty or absent pin", () => {
    expect(pinToNodes(null)).toEqual([]);
    expect(pinToNodes({ object_type: "note", content: "" })).toEqual([]);
  });
});

describe("pinToNodes — pin id retention", () => {
  const pin = {
    id: "PIN-1",
    title: "Linux tasks/issues",
    content: JSON.stringify({
      type: "doc",
      content: [
        {
          type: "taskList",
          attrs: { pinId: "PIN-1" },
          content: [
            { type: "taskItem", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] },
          ],
        },
      ],
    }),
  };

  // Carry-forward appends a fresh day's working copy. It must NOT claim the
  // pin, or the new page would take ownership of a pin the user never touched.
  it("strips the pin id by default", () => {
    const nodes = pinToNodes(pin);
    const list = nodes.find((n) => n.type === "taskList");
    expect(list.attrs?.pinId).toBeUndefined();
  });

  // Inject means "work on this pin here". Without the id the injected block
  // is inert: refresh_pin_caches has nothing to match, so every edit updates
  // the page and never the pin. That is the regression this guards.
  it("keeps the pin id when asked, so an injected block IS the pin", () => {
    const nodes = pinToNodes(pin, { keepPinIds: true });
    const list = nodes.find((n) => n.type === "taskList");
    expect(list.attrs.pinId).toBe("PIN-1");
  });
});

describe("withTitle via pinToNodes — the block's own title wins, else fill", () => {
  const list = (bt) => ({
    type: "list",
    attrs: bt ? { blockTitle: bt } : {},
    content: [{ type: "listItem", attrs: { marker: "task" }, content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] }],
  });
  const doc = (n) => JSON.stringify({ type: "doc", content: [n] });
  const bt = (nodes) => nodes.find((n) => n.type === "list")?.attrs?.blockTitle;

  it("keeps a real blockTitle even when a title is passed", () => {
    // The block's own slot title must never be overwritten by a passed title —
    // that is how an injected board kept a line of body text as its title.
    const nodes = pinToNodes({ title: "prepare flathub", content: doc(list("Linux tasks/issues")) });
    expect(bt(nodes)).toBe("Linux tasks/issues");
  });

  it("fills an empty slot from the title", () => {
    const nodes = pinToNodes({ title: "My Tasks", content: doc(list(null)) });
    expect(bt(nodes)).toBe("My Tasks");
  });

  it("leaves an empty slot empty when there is no title at all", () => {
    // A board with neither a slot title nor a pin title has nothing to stamp;
    // the caller (inject) supplies a derived fallback, not withTitle.
    const nodes = pinToNodes({ title: "", content: doc(list(null)) });
    expect(bt(nodes) ?? "").toBe("");
  });
});

// The production bug: confirmPin writes {type:"doc", content:[node]}, but the
// Rust refresh_pin_caches re-caches the BARE pinned node on every save —
// {type:"list", content:[listItem, listItem]}. Reading `.content` off that
// bare board node returns its own listItems, dropping the `list` wrapper that
// holds the blockTitle slot. withTitle then saw no board and prepended a bold
// title line: the "title outside the block" symptom. Every pin ends up in this
// shape after its first save, so this is the shape inject/carry-forward hit.
describe("pinToNodes — the bare board node shape refresh_pin_caches writes", () => {
  const bareList = (bt) =>
    JSON.stringify({
      type: "list",
      attrs: { pinId: "pin-1", ...(bt ? { blockTitle: bt } : {}) },
      content: [
        { type: "listItem", attrs: { marker: "task" }, content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] },
        { type: "listItem", attrs: { marker: "task" }, content: [{ type: "paragraph", content: [{ type: "text", text: "b" }] }] },
      ],
    });

  it("keeps the list as ONE board node instead of hoisting its listItems", () => {
    const nodes = pinToNodes({ object_type: "board", title: "my tasks", content: bareList(null) }, { keepPinIds: true });
    // The regression produced [paragraph(bold title), listItem, listItem].
    // Correct is a single list node — no stray top-level listItems, no bold
    // title paragraph.
    expect(nodes.map((n) => n.type)).toEqual(["list"]);
  });

  it("stamps the title into the board's slot, not as a bold line above it", () => {
    const nodes = pinToNodes({ object_type: "board", title: "my tasks", content: bareList(null) }, { keepPinIds: true });
    expect(nodes[0].type).toBe("list");
    expect(nodes[0].attrs.blockTitle).toBe("my tasks");
    // No prepended bold-title paragraph.
    expect(nodes.some((n) => n.type === "paragraph")).toBe(false);
  });

  it("keeps the block's own slot title over the pin title on this shape too", () => {
    const nodes = pinToNodes({ object_type: "board", title: "pin title", content: bareList("slot title") }, { keepPinIds: true });
    expect(nodes[0].attrs.blockTitle).toBe("slot title");
  });
});
