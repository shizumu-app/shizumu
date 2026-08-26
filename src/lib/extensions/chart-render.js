// CIRCULAR IMPORT, deliberately: chart.js imports renderMermaidInto from
// this module and this module imports these three back from chart.js. It is
// safe only because all three are hoisted `export function` DECLARATIONS
// (chart.js) and the memoised `mermaidPromise` they close over is read at
// CALL time, never at module-init time. Rewriting any of them as
// `export const fn = () => …` makes the binding live in the temporal dead
// zone while this module's body evaluates, and the app crashes at startup —
// in production bundles first, where module order differs from dev. Keep
// them as function declarations, or break the cycle into a third module.
import { assembleMermaid, loadMermaid, peekMermaidPromise } from "./chart.js";

/**
 * Shared Mermaid render — the single place that turns structured chart
 * state into DOM. Used by the chart NodeView (live editor) and the
 * ChartBuilder's live preview so the two paths can't drift.
 *
 * Never throws: an assembly/render failure writes the `.chart-error`
 * fallback markup instead, matching the NodeView's long-standing
 * behavior (a chart the user hasn't finished specifying should read as
 * "needs more detail", not crash the caller).
 */

// Monotonic counter so each render call gets a unique Mermaid id
// (Mermaid requires unique ids per render call within a page lifetime).
// Shared across both call sites — a single counter, not one per caller.
let renderCounter = 0;

export async function renderMermaidInto(el, { kind, source, idPrefix = "chart" }) {
  if (!el) return { ok: false };
  const mermaid = await loadMermaid();
  const syntax = assembleMermaid({ kind, source });
  if (!syntax.trim()) {
    el.innerHTML = `<div class="chart-loading"><span class="chart-placeholder-glyph">◇</span><span class="chart-placeholder-label">empty chart</span></div>`;
    return { ok: false };
  }
  const id = `${idPrefix}-${++renderCounter}`;
  try {
    const { svg } = await mermaid.render(id, syntax);
    el.innerHTML = svg;
    return { ok: true };
  } catch (err) {
    el.innerHTML = `<div class="chart-error"><span class="chart-placeholder-glyph">◇</span><span class="chart-placeholder-label">chart needs more detail</span></div>`;
    return { ok: false };
  }
}

// Re-init mermaid with refreshed theme tokens. Called when the canvas
// tone changes (data-tone mutates on documentElement). No-ops if Mermaid
// hasn't been loaded yet (nothing to re-theme; the next loadMermaid()
// call will initialize with the current theme anyway).
export async function reinitMermaidTheme() {
  const pending = peekMermaidPromise();
  if (!pending) return;
  const mermaid = await pending;
  const { buildMermaidTheme, buildMermaidThemeCSS } = await import("../render/mermaid-theme.js");
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables: buildMermaidTheme(),
    themeCSS: buildMermaidThemeCSS(),
    flowchart: {
      useMaxWidth: true,
      htmlLabels: false,
      curve: "basis",
      padding: 16,
    },
    mindmap: { useMaxWidth: true, padding: 12 },
  });
}
