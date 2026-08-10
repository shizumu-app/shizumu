/**
 * Mermaid theme overrides for shizumu's design system.
 *
 * Mermaid accepts `themeVariables` at init; the keys below override the
 * defaults so charts render with shizumu's typography + color palette.
 * Theme tokens (`--ink`, `--warm-accent`, etc.) can't be passed as CSS
 * variables directly — Mermaid bakes the resolved colors into the SVG
 * at render time. So we resolve the current CSS values at chart-render
 * time and pass them as strings.
 *
 * Charts re-render on canvas-tone change because the chart NodeView
 * watches the `data-tone` attribute on documentElement.
 */

/** Resolve a CSS variable's current value from a host element (defaults
 *  to documentElement so theme tone is picked up correctly). */
function cssVar(name, host) {
  const el = host || (typeof document !== "undefined" ? document.documentElement : null);
  if (!el) return "";
  return getComputedStyle(el).getPropertyValue(name).trim();
}

/** Mix-style helper that mirrors CSS color-mix in srgb — Mermaid wants
 *  flat color strings, not CSS functions, so we approximate by blending
 *  the resolved ink/canvas pair at percentages. */
function mix(a, b, amount) {
  // Tiny client-side blend; Mermaid never sees color-mix() syntax.
  // amount 0..1 = how much of `a`. Both inputs should be #rrggbb.
  function hexToRgb(h) {
    const v = h.replace("#", "");
    return [
      parseInt(v.substring(0, 2), 16),
      parseInt(v.substring(2, 4), 16),
      parseInt(v.substring(4, 6), 16),
    ];
  }
  function toHex(n) {
    return Math.round(n).toString(16).padStart(2, "0");
  }
  try {
    const A = hexToRgb(a);
    const B = hexToRgb(b);
    return (
      "#" +
      A.map((ch, i) => toHex(ch * amount + B[i] * (1 - amount))).join("")
    );
  } catch {
    return a;
  }
}

/** Read shizumu's tokens off documentElement and translate to Mermaid's
 *  themeVariables shape. Called at chart-render time so theme changes
 *  (cream / white / dark) propagate via a re-render. */
export function buildMermaidTheme() {
  const ink = cssVar("--ink") || "#1a1410";
  const canvas = cssVar("--canvas-bg") || "#f5f0e8";
  const accent = cssVar("--warm-accent") || "#c44d28";

  // Mermaid measures node dimensions via canvas text metrics using
  // themeVariables.fontFamily. We pass a system stack that's
  // guaranteed available at measurement time — using Lora here
  // caused nodes to under-size before the web font loaded, and the
  // rendered text then overflowed the box.
  return {
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
    fontSize: "14px",
    // Node fills: tinted canvas (slight contrast against the page).
    primaryColor: mix(ink, canvas, 0.04),
    primaryTextColor: ink,
    primaryBorderColor: mix(ink, canvas, 0.25),
    // Edges + arrows.
    lineColor: mix(ink, canvas, 0.55),
    // Secondary / tertiary used for variant nodes Mermaid auto-styles.
    secondaryColor: mix(accent, canvas, 0.15),
    secondaryTextColor: ink,
    secondaryBorderColor: mix(accent, canvas, 0.4),
    tertiaryColor: mix(ink, canvas, 0.06),
    tertiaryTextColor: ink,
    tertiaryBorderColor: mix(ink, canvas, 0.18),
    // Mind-map specific tokens. all depths share the same fill so the
    // user reads branches as siblings, not as a color-coded hierarchy.
    cScale0: mix(ink, canvas, 0.04),
    cScale1: mix(ink, canvas, 0.04),
    cScale2: mix(ink, canvas, 0.04),
    // Timeline tokens. alternation kept but softened so it reads as
    // rhythm, not category contrast.
    sectionBkgColor: mix(ink, canvas, 0.04),
    altSectionBkgColor: mix(ink, canvas, 0.06),
  };
}

/** Extra CSS Mermaid injects per-render. Tightens stroke widths and
 *  kills animations Mermaid sometimes adds. */
export function buildMermaidThemeCSS() {
  return `
    /* Node shapes — slightly heavier stroke so they read clearly at small
       sizes without going clinical. */
    .node rect, .node circle, .node polygon, .node path {
      stroke-width: 1.25px !important;
    }
    /* Edge lines — pull toward the ink palette so arrows read as quiet
       structure rather than a competing accent. */
    .edgePath .path {
      stroke-width: 1.25px !important;
    }
    .flowchart-link { transition: none !important; }
    .arrowMarkerPath { fill: currentColor; }

    text, tspan {
      font-family: system-ui, -apple-system, sans-serif !important;
      text-rendering: optimizeLegibility;
    }

    /* Edge labels: small pill behind the text so they don't sit awkwardly
       on top of the arrow. */
    .edgeLabel {
      font-size: 0.6875rem !important;
    }
    .edgeLabel rect {
      rx: 4 !important;
      ry: 4 !important;
    }
  `;
}
