// What the desktop's page rail draws: a dot per page, or a count.
//
// MEASURED ON A DESKTOP: a day with twenty-odd pages drew twenty-odd dots in
// a row that never yields, and it ran straight into the header's chips — the
// synced indicator and the trail control. The phone met the same wall at
// twenty-eight pages, where the dots pushed `+` off the screen and squeezed
// the trail control to nothing, and answered it in shell/page-dots.js: dots
// while they can be counted, a count after that. A row of identical marks
// stops being countable long before it stops fitting.
//
// The desktop takes the same rule and the same cap, so the two surfaces say
// the same thing about the same day. One difference: on the desktop the dots
// were also how you clicked to another page, so the count comes with a step
// either side of it.
//
// CLAUDE.md: a decision lives in a pure module, where a test can reach it.

/** The most dots that still read as a quantity — the phone's number. */
export const DOT_CAP = 8;

/**
 * @param {object} args
 * @param {number} args.count  pages in the rail
 * @param {number} args.index  the open page's position among them, or -1
 * @returns {{ kind: "dots" } | { kind: "count", label: string, prev: number|null, next: number|null }}
 */
export function railDots({ count, index }) {
  if (count <= DOT_CAP) return { kind: "dots" };
  if (index < 0 || index >= count) {
    // The open page is not one of these (a past day, while the rail lists
    // today's): there is no position to show, and no step to take from it.
    return { kind: "count", label: `${count} pages`, prev: null, next: null };
  }
  return {
    kind: "count",
    label: `${index + 1} / ${count}`,
    prev: index > 0 ? index - 1 : null,
    next: index < count - 1 ? index + 1 : null,
  };
}
