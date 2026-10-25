// What the header shows for "which page of today is this".
//
// A decision in its own module rather than a `{#if}` inside PageHeader,
// because CLAUDE.md's first testing rule puts a decision where a test can
// reach it — and because this one was wrong on a real device in a way no
// screenshot of a two-page day could ever show.
//
// ── MEASURED, NOT ARGUED ──────────────────────────────────────────────
//
// On an A16 with a day's real use on it (384px viewport, 28 pages):
//
//     dotCount 28   dotsSpan 329px
//     plus   l=364 r=408   with a viewport of 384  -> off the screen
//     trail  w=0                                   -> squeezed to nothing
//
// The dot row is `flex: 0 0 auto`, so it never yields: it took the whole
// row and pushed the `+` past the right edge and the trail control down to
// zero width. A writer with a busy day could not start a new page, and
// could not put the page they were on onto a trail — one of the app's three
// verbs, unreachable from the surface it applies to. Neither is a papercut.
//
// ── THE RULE, AT BOTH ENDS ────────────────────────────────────────────
//
// PageHeader already had half of it: "one dot is not a page indicator, it
// is a smudge". Twenty-eight dots are the same sentence from the other
// side. A row of identical 5px marks stops being countable long before it
// stops fitting, and past that point it is costing the writer a control in
// exchange for an impression.
//
// So: dots while they can be counted, a count after that. The control is
// the same control either way — one tap, the same pages sheet behind it —
// which is what makes the swap cheap. The sheet is where a writer actually
// chooses a page; the dots only ever said where they were, and "12 / 28"
// says that too, and says it better at twenty-eight.

/** The most dots that still read as a quantity rather than a texture.
 *
 *  Eight, for a reason with a number in it rather than a taste: at 384px
 *  the row has to hold the trail control and `+` (44px each at the shell's
 *  `--tap` floor) with the date row's gaps, which leaves a little over
 *  200px — and eight dots at 5px with `--space-2` between them sit well
 *  inside that on the narrowest phone the shell supports. It is also about
 *  where counting at a glance gives out, which is the part that matters to
 *  the writer rather than to the layout. */
export const DOT_CAP = 8;

/**
 * @param {object} [input]
 * @param {number | null} [input.pageCount]   pages on this date
 * @param {number | null} [input.pageNumber]  this page's POSITION in them,
 *   1-based — page-ordinal.js's `ordinalOf`, never `page_number`.
 * @returns {{ kind: "none" | "dots" | "count", dots: number[], label: string | null }}
 */
export function pageDots({ pageCount = null, pageNumber = null } = {}) {
  const count = Number.isInteger(pageCount) && pageCount >= 1 ? pageCount : 1;
  const here = Number.isInteger(pageNumber) && pageNumber >= 1 ? pageNumber : 1;

  // One dot is not a page indicator, it is a smudge. The header's own words,
  // kept here with the rest of the rule rather than left behind in it.
  if (count <= 1) return { kind: "none", dots: [], label: null };

  if (count <= DOT_CAP) {
    return {
      kind: "dots",
      dots: Array.from({ length: count }, (_, i) => i + 1),
      label: null,
    };
  }

  // `12 / 28`, not `page 12 of 28`: the row is chrome beside a date and a
  // trail name, and the header's whole register is the fewest words that
  // still say it. The pages sheet behind this control spells "page 12" out
  // in full, which is where a writer is choosing rather than glancing.
  //
  // The position is clamped into the count rather than trusted: a header
  // reading `31 / 28` is arithmetic leaking onto the screen, and the honest
  // answer while a load is mid-flight is the first page, not an impossible
  // one. page-model.js floors the same two numbers for the same reason.
  return {
    kind: "count",
    dots: [],
    label: `${Math.min(here, count)} / ${count}`,
  };
}
