// What a chart builder opens on, what a kind switch costs, and when the
// draft may be written to the document.
//
// These are the three decisions `ChartBuilder.svelte` makes AROUND its
// forms — its re-seed `$effect` (:94), its `pickKind` (:108) and its
// `canSave` (:128) — and they are the ones the shell re-decides, because
// spec §3 re-hosts the FORMS and replaces the frame. They live here rather
// than inline in ShellApp for CLAUDE.md's rule: a decision inside a
// `.svelte` file is a decision no test can reach.
//
// THIS IS A HAND-COPY, and it is the third one in this workstream
// (`insertionPoint` and `matchesSlashQuery` are the first two, and each
// says so where it sits). ChartBuilder holds all three rules inline in a
// component, so they can be READ from src/lib but not IMPORTED from it.
// Extracting them upstream is the real fix and wants a `main`-side commit;
// until then the divergence lands here, deliberately, in one file with a
// suite on it rather than spread through a sheet's markup.
//
// One rule is copied SHORTER than its original, on purpose. ChartBuilder's
// `canSave` opens with `if (events.length === 0) return true;` before its
// `every`. `[].every(...)` is already true, so the early return decides
// nothing; it is dropped rather than transcribed, because a branch that
// cannot change an answer is a branch the next reader has to disprove.

import { emptySource } from "../lib/extensions/chart.js";

/** The three kinds `emptySource` and `assembleMermaid` both know about.
 *  Listed so an attrs bag carrying anything else — a chart written by a
 *  newer build, a hand-edited doc — opens on flowchart rather than on a
 *  form that renders nothing. */
const KINDS = ["flowchart", "mindmap", "timeline"];

/** ChartBuilder's `deepClone` (:106), same shape and same swallow: a
 *  source that will not round-trip through JSON is handed back as-is,
 *  because refusing to open the builder is worse than sharing a reference
 *  with the node for one editing session. */
function clone(v) {
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return v;
  }
}

/**
 * The draft a builder opens on, from the `openChartBuilder` params.
 *
 * Two shapes arrive here, both from `chart.js`'s one command: `{mode:
 * "create"}` from the slash surface, and `{mode: "edit", pos, attrs}` from
 * a tap on a chart already in the document.
 *
 * `pos` is kept ONLY in edit mode. A create-mode params bag has no
 * position to carry, and a stray number on one would otherwise route the
 * commit through `updateChart` at a position nothing was opened for.
 *
 * The source test is ChartBuilder's and it asks two questions, because
 * "nothing to seed from" reaches here in two shapes. `chart.js` defaults
 * the `source` attribute to null and its `parseHTML` returns null for a
 * `data-source` that is missing or will not parse (:216-222), so the
 * presence half carries the common case; the empty-object half covers a
 * doc whose `data-source` round-tripped to `{}`. Either way the form opens
 * on `emptySource(kind)` rather than on an editor with no rows in it.
 *
 * @param {{mode?: string, pos?: number, attrs?: {kind?: string, source?: object, blockTitle?: string}}|null} params
 * @returns {{mode: "create"|"edit", pos: number|null, kind: string, source: object, blockTitle: string}}
 */
export function chartDraft(params) {
  const p = params || {};
  const mode = p.mode === "edit" ? "edit" : "create";
  const kind = KINDS.includes(p.attrs?.kind) ? p.attrs.kind : "flowchart";
  const inbound = p.attrs?.source;
  const seeded =
    inbound && typeof inbound === "object" && Object.keys(inbound).length > 0;
  return {
    mode,
    pos: mode === "edit" && typeof p.pos === "number" ? p.pos : null,
    kind,
    source: seeded ? clone(inbound) : emptySource(kind),
    blockTitle: (p.attrs?.blockTitle || "").trim(),
  };
}

/**
 * The draft after the writer picks a different kind.
 *
 * The source is REPLACED, not converted, which is ChartBuilder's call and
 * the right one: a flowchart's `{nodes, edges}` and a timeline's
 * `{events}` share no field, so there is nothing to carry across and a
 * merged bag would assemble into Mermaid syntax for whichever kind is now
 * selected while holding the other's data.
 *
 * The title survives, because it belongs to the BLOCK rather than to the
 * diagram inside it — the same `blockTitle` attribute every board carries.
 *
 * A no-op for the kind already selected, so the writer who taps the tab
 * they are already on does not lose what they have typed.
 */
export function withKind(draft, kind) {
  if (!KINDS.includes(kind) || kind === draft.kind) return draft;
  return { ...draft, kind, source: emptySource(kind) };
}

/**
 * May this draft be written to the document?
 *
 * Timeline only, and it is a real gate rather than a tidiness rule: an
 * event with no date renders as an orphaned box floating beside the spine
 * (see `assembleTimeline`, chart.js:108 — a dateless event assembles as
 * `· : label`), so the chart loses the one thing a timeline is for. No
 * other kind has an equivalent: a flowchart node with no label is an empty
 * box, which is a drawing in progress rather than a broken diagram.
 */
export function chartCanCommit(draft) {
  if (draft?.kind !== "timeline") return true;
  const events = draft.source?.events || [];
  return events.every((e) => (e?.date || "").trim().length > 0);
}

/**
 * The node attributes this draft commits — the same bag `insertChart` and
 * `updateChart` both take (chart.js:313 and :331), so create and edit hand
 * the document the identical shape.
 *
 * The clone is load-bearing on this surface in a way it is not on the
 * desktop's. A Svelte 5 `$state` object is a deep PROXY, and the shell
 * holds the draft in one; storing that proxy straight into a ProseMirror
 * attribute would put a live reactive object inside the document, where
 * every later edit of the builder's own state would mutate a node nobody
 * dispatched a transaction for. `JSON.parse(JSON.stringify(...))` is what
 * takes a plain object back out of it.
 *
 * `blockTitle` collapses to null rather than to "", matching ChartBuilder
 * (:118). The attribute is not chart's own — `block-title.js:72` adds it
 * to every board type with a null default — and both its renderHTML and
 * the NodeView test it for truthiness, so an empty string would be a
 * second way to say "no title" that only one of the two paths produces.
 */
export function chartAttrs(draft) {
  return {
    kind: draft.kind,
    source: clone(draft.source),
    blockTitle: (draft.blockTitle || "").trim() || null,
  };
}
