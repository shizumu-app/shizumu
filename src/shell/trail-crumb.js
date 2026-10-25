// What the page header says a page's trail is, when that trail lives inside
// another.
//
// THE GAP: the header showed a bare leaf name. A writer on `chapter two`
// could not see they were inside `the book` without opening the trail sheet,
// which is the one place nesting was visible at all — so the structure they
// built was invisible on the surface they spend the day looking at.
//
// THE CONSTRAINT: line 1 of that header already carries three targets
// (the date, find, pins) and line 2 carries the trail tag, the page dots and
// the `+`. There is room for a few more characters, not for a path.
//
// SO THE NAME WINS. The trail's own name is never what gets cut — it is the
// thing being named, and it is what the writer would answer if asked where
// they are. Ancestors fill whatever budget is left, nearest first, and a
// leading ellipsis says some were dropped. This is the opposite of what the
// trail sheet used to do, where a 36-character cut from the end ate the leaf
// and left `product › export api › v2 be…` — a label that hides its answer.

/** The separator every surface in this app already uses for a trail path:
 *  memory's breadcrumb chips, the pin rows, the trail sheet's second
 *  column. One vocabulary for one idea. */
const SEP = " › ";

/** Characters the whole crumb may occupy. Measured for the shell's header
 *  at the phone's --ui-scale, where line 2 shares its row with the dots and
 *  the `+`. It is a budget, not a guarantee: a trail named longer than this
 *  on its own still takes the whole line, because the alternative is a
 *  header that will not say where you are. */
const CRUMB_MAX = 28;

/**
 * @param {object} [args]
 * @param {string|null} [args.name]  the trail's own name
 * @param {string[]} [args.parents]  its ancestors, root first, self excluded
 * @param {number} [args.max]  characters the crumb may occupy
 * @returns {string} "the book › chapter two", "… › chapter two",
 *   "chapter two", or "" when there is no trail
 */
export function trailCrumb({ name = null, parents = [], max = CRUMB_MAX } = {}) {
  const leaf = clean(name);
  if (!leaf) return "";

  const ancestors = (Array.isArray(parents) ? parents : []).map(clean).filter(Boolean);
  if (ancestors.length === 0) return leaf;

  // Nearest ancestor first: `the book › chapter two` tells a writer more
  // than `the book › … › chapter two` does, and the immediate parent is the
  // one they just chose.
  const kept = [];
  let width = leaf.length;
  for (const ancestor of [...ancestors].reverse()) {
    const next = width + SEP.length + ancestor.length;
    // Room for this one AND for the ellipsis that would replace whatever is
    // still above it. Checking only `next <= max` would spend the last of
    // the budget on an ancestor and then overrun saying there are more.
    if (next > max) break;
    kept.unshift(ancestor);
    width = next;
  }

  // Nothing fitted, but something exists: say so. A bare leaf here would
  // claim the trail is top-level, which is worse than saying nothing — it
  // is the same thing the header said before this module existed.
  if (kept.length === 0) return `…${SEP}${leaf}`;

  const dropped = ancestors.length - kept.length;
  return `${dropped > 0 ? `…${SEP}` : ""}${kept.join(SEP)}${SEP}${leaf}`;
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
