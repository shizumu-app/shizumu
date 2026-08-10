import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildMermaidTheme, buildMermaidThemeCSS } from "../mermaid-theme.js";

// buildMermaidTheme reads CSS variables off documentElement. In jsdom, we
// stub getComputedStyle so the values are deterministic across runs.
const STUB_VARS = {
  "--ink": "#1a1410",
  "--canvas-bg": "#f5f0e8",
  "--warm-accent": "#c44d28",
};

let originalGCS;

beforeEach(() => {
  originalGCS = window.getComputedStyle;
  window.getComputedStyle = vi.fn(() => ({
    getPropertyValue: (name) => STUB_VARS[name] ?? "",
  }));
});

afterEach(() => {
  window.getComputedStyle = originalGCS;
});

describe("buildMermaidTheme — unified visual language invariants", () => {
  it("uses 14px body font size", () => {
    const theme = buildMermaidTheme();
    expect(theme.fontSize).toBe("14px");
  });

  it("equalizes mindmap depth coloring (cScale0 === cScale1 === cScale2)", () => {
    const theme = buildMermaidTheme();
    expect(theme.cScale0).toBe(theme.primaryColor);
    expect(theme.cScale1).toBe(theme.primaryColor);
    expect(theme.cScale2).toBe(theme.primaryColor);
  });

  it("softens timeline alternation (altSection is closer to primary than the old 0.08 mix)", () => {
    const theme = buildMermaidTheme();
    expect(theme.sectionBkgColor).toBe(theme.primaryColor);
    expect(theme.altSectionBkgColor).not.toBe(theme.primaryColor);
    expect(theme.altSectionBkgColor).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("buildMermaidThemeCSS — text-rendering hint", () => {
  it("includes text-rendering: optimizeLegibility for text and tspan", () => {
    const css = buildMermaidThemeCSS();
    expect(css).toMatch(/text-rendering\s*:\s*optimizeLegibility/);
    expect(css).toMatch(/text,\s*tspan/);
  });
});
