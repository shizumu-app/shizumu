// The chart NodeView's theme-driven re-render, isolated from chart.test.js
// (whose header promises it never touches Mermaid) — this file mounts a
// REAL chart NodeView with mermaid mocked, the same way
// ChartBuilder.test.js does for the builder's own live preview.
//
// Task 6 finding: a MutationObserver fires on every `setAttribute` call
// regardless of whether the value actually changed. The chart NodeView's
// themeObserver (chart.js) used to re-run reinitMermaidTheme() + a full
// Mermaid re-render on EVERY data-tone/class mutation, including one that
// rewrote the same value — which is exactly what happens on the VR boot
// path (bootstrap.js sets data-tone once, then App.svelte's onMount calls
// applyTone(tone) again with the same value) and in production any time a
// user re-saves the same theme or reopens the theme menu without changing
// it. The redundant second render raced the VR screenshot, catching a
// chart mid-rebuild in roughly 1 in N captures
// (page-chart-content/page-empty-chart's load-time baselines).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Chart } from "./chart.js";

const renderMock = vi.fn(async (id, syntax) => ({ svg: `<svg data-syntax="${syntax.length}"></svg>` }));

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: (...args) => renderMock(...args),
  },
}));

function makeChartEditor() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = new Editor({
    element: host,
    extensions: [StarterKit, Chart],
    content: {
      type: "doc",
      content: [
        {
          type: "chart",
          attrs: {
            kind: "flowchart",
            source: {
              direction: "TB",
              nodes: [{ id: "a", label: "x" }, { id: "b", label: "y" }],
              edges: [{ from: "a", to: "b", label: "" }],
            },
          },
        },
      ],
    },
  });
  return { editor, cleanup: () => { editor.destroy(); host.remove(); } };
}

describe("chart theme observer", () => {
  beforeEach(() => {
    renderMock.mockClear();
    document.documentElement.setAttribute("data-tone", "cream");
  });

  afterEach(() => {
    document.documentElement.removeAttribute("data-tone");
  });

  it("does not re-render when data-tone is set to the value it already had", async () => {
    const { editor, cleanup } = makeChartEditor();
    try {
      await vi.waitFor(() => expect(renderMock).toHaveBeenCalled());
      const initialCalls = renderMock.mock.calls.length;

      // The VR double-set (and a production re-save of the same theme):
      // same value, still a real setAttribute call.
      document.documentElement.setAttribute("data-tone", "cream");
      // Give a no-op mutation a real chance to (wrongly) trigger a
      // render before asserting it didn't — a bare assertion right after
      // setAttribute would pass even with the bug, since the redundant
      // render is itself async.
      await new Promise((r) => setTimeout(r, 50));
      expect(renderMock.mock.calls.length).toBe(initialCalls);

      // A REAL tone change must still re-render.
      document.documentElement.setAttribute("data-tone", "dark");
      await vi.waitFor(() => expect(renderMock.mock.calls.length).toBeGreaterThan(initialCalls));
    } finally {
      cleanup();
    }
  });
});
