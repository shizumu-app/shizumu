import { describe, it, expect } from "vitest";
import { assembleMermaid, emptySource } from "./chart.js";

// Pure-helper tests — never touch Mermaid itself (lazy-imported only in
// the live NodeView). These cover the structured-source → Mermaid syntax
// translation that every chart relies on at render time.
describe("assembleMermaid — flowchart", () => {
  it("emits a TB flowchart with quoted node labels", () => {
    const out = assembleMermaid({
      kind: "flowchart",
      source: {
        direction: "TB",
        nodes: [
          { id: "a", label: "parse" },
          { id: "b", label: "convert" },
        ],
        edges: [{ from: "a", to: "b", label: "" }],
      },
    });
    expect(out).toMatch(/^flowchart TB/);
    expect(out).toContain('a["parse"]');
    expect(out).toContain('b["convert"]');
    expect(out).toContain("a --> b");
  });

  it("renders LR direction when source.direction === LR", () => {
    const out = assembleMermaid({
      kind: "flowchart",
      source: { direction: "LR", nodes: [], edges: [] },
    });
    expect(out).toMatch(/^flowchart LR/);
  });

  it("emits labeled edges with -->| syntax", () => {
    const out = assembleMermaid({
      kind: "flowchart",
      source: {
        direction: "TB",
        nodes: [{ id: "a", label: "x" }, { id: "b", label: "y" }],
        edges: [{ from: "a", to: "b", label: "then" }],
      },
    });
    expect(out).toContain('a -->|"then"| b');
  });

  it("escapes embedded quotes in labels", () => {
    const out = assembleMermaid({
      kind: "flowchart",
      source: {
        direction: "TB",
        nodes: [{ id: "n", label: 'has "quotes"' }],
        edges: [],
      },
    });
    // Raw " characters would terminate the label — must be escaped.
    expect(out).not.toContain('"has "quotes""');
    expect(out).toContain("#quot;");
  });

  it("sanitizes ids that contain non-alphanumeric characters", () => {
    const out = assembleMermaid({
      kind: "flowchart",
      source: {
        direction: "TB",
        nodes: [{ id: "a-1!", label: "x" }],
        edges: [],
      },
    });
    expect(out).toContain('a_1_["x"]');
  });
});

describe("assembleMermaid — mindmap", () => {
  it("emits mindmap with central root and one-deep branches", () => {
    const out = assembleMermaid({
      kind: "mindmap",
      source: {
        central: "shizumu",
        branches: [
          { id: "b1", label: "page", children: [] },
          { id: "b2", label: "thread", children: [] },
        ],
      },
    });
    expect(out).toMatch(/^mindmap/);
    expect(out).toContain('root(("shizumu"))');
    expect(out).toContain("page");
    expect(out).toContain("thread");
  });

  it("indents nested children one level deeper per depth", () => {
    const out = assembleMermaid({
      kind: "mindmap",
      source: {
        central: "root",
        branches: [
          {
            id: "b1",
            label: "outer",
            children: [{ id: "c1", label: "inner", children: [] }],
          },
        ],
      },
    });
    const lines = out.split("\n");
    const outerLine = lines.find((l) => l.includes("outer"));
    const innerLine = lines.find((l) => l.includes("inner"));
    expect(outerLine.search(/\S/)).toBeLessThan(innerLine.search(/\S/));
  });
});

describe("assembleMermaid — timeline", () => {
  it("emits timeline with date : label pairs", () => {
    const out = assembleMermaid({
      kind: "timeline",
      source: {
        events: [
          { date: "2026-01-10", label: "v0.2 shipped" },
          { date: "2026-03-22", label: "pin system rewrite" },
        ],
      },
    });
    expect(out).toMatch(/^timeline/);
    expect(out).toContain("2026-01-10 : v0.2 shipped");
    expect(out).toContain("2026-03-22 : pin system rewrite");
  });

  it("includes optional title when provided", () => {
    const out = assembleMermaid({
      kind: "timeline",
      source: { title: "release history", events: [] },
    });
    expect(out).toContain("title release history");
  });

  it("skips empty events (both date and label blank)", () => {
    const out = assembleMermaid({
      kind: "timeline",
      source: { events: [{ date: "", label: "" }] },
    });
    expect(out.trim()).toBe("timeline");
  });
});

describe("assembleMermaid — flowchart shapes", () => {
  it("defaults to rect when shape is missing", () => {
    const out = assembleMermaid({
      kind: "flowchart",
      source: { direction: "TB", nodes: [{ id: "a", label: "x" }], edges: [] },
    });
    expect(out).toContain('a["x"]');
  });

  it("emits rounded brackets for rounded shape", () => {
    const out = assembleMermaid({
      kind: "flowchart",
      source: { direction: "TB", nodes: [{ id: "a", label: "x", shape: "rounded" }], edges: [] },
    });
    expect(out).toContain('a("x")');
  });

  it("emits diamond braces for diamond shape", () => {
    const out = assembleMermaid({
      kind: "flowchart",
      source: { direction: "TB", nodes: [{ id: "a", label: "x", shape: "diamond" }], edges: [] },
    });
    expect(out).toContain('a{"x"}');
  });

  it("emits double-paren circle for circle shape", () => {
    const out = assembleMermaid({
      kind: "flowchart",
      source: { direction: "TB", nodes: [{ id: "a", label: "x", shape: "circle" }], edges: [] },
    });
    expect(out).toContain('a(("x"))');
  });
});

describe("assembleMermaid — timeline milestone", () => {
  it("renders a regular event without a glyph prefix", () => {
    const out = assembleMermaid({
      kind: "timeline",
      source: { events: [{ date: "2026", label: "release", kind: "event" }] },
    });
    expect(out).toContain('2026 : release');
    expect(out).not.toContain('★');
  });

  it("prepends a star glyph to milestone labels", () => {
    const out = assembleMermaid({
      kind: "timeline",
      source: { events: [{ date: "2026", label: "v1", kind: "milestone" }] },
    });
    expect(out).toContain('2026 : ★ v1');
  });

  it("treats missing kind as a regular event", () => {
    const out = assembleMermaid({
      kind: "timeline",
      source: { events: [{ date: "2026", label: "release" }] },
    });
    expect(out).toContain('2026 : release');
    expect(out).not.toContain('★');
  });
});

describe("emptySource", () => {
  it("returns a flowchart skeleton with two nodes + one edge", () => {
    const s = emptySource("flowchart");
    expect(s.direction).toBe("TB");
    expect(s.nodes).toHaveLength(2);
    expect(s.edges).toHaveLength(1);
  });

  it("returns a mindmap skeleton with empty central + two branches", () => {
    const s = emptySource("mindmap");
    expect(s.central).toBe("");
    expect(s.branches).toHaveLength(2);
  });

  it("returns a timeline skeleton with two empty events", () => {
    const s = emptySource("timeline");
    expect(s.events).toHaveLength(2);
  });
});
