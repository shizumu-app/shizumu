// Who owns this gesture. One table, one owner per row, checked in order.
//
// Every phone release so far has had at least one bug of the form "two
// things responded to the same drag": the edge swipe that fought Android's
// system back, the sheet that dismissed itself while the user scrolled its
// list, the canvas swipe that switched spaces mid-block-drag. Those are not
// individually preventable — they are what happens when ownership is decided
// by whichever handler runs first. So it is decided here instead, once, and
// every row below is a test.
//
// Order is the design, and the order is: a live block drag, the header
// dots, the left edge, the canvas, sheets, blocks.
//
// A live block drag wins outright: while a block is lifted, an edge drag
// must not ALSO mean back, or one motion loses both the block and the
// screen.
//
// The header dots come second because they are the only other row that
// claims "drag-right", and a dots strip drawn within EDGE_PX of the screen
// edge is a real layout, not a hypothetical one. Put the edge first and a
// thumb on those dots navigates back instead of switching pages. The dots
// are a named, visible affordance; the edge is a geometric fallback, and
// where the two overlap the named target wins.
//
// The left edge comes third — ahead of the canvas, not after it — because
// the canvas row TERMINATES: its "drag-right" falls out as "element"
// instead of continuing down the table. So the first screen to mark a
// full-bleed canvas as a region swallows the edge whole and kills back on
// the one screen type a phone shell is mostly made of. That is also why
// `atLeftEdge` is its own input rather than a value in the region
// vocabulary: where the finger landed and what element it landed on are
// two independent facts, and spelling both of them "left-edge" forced a
// caller to pick one before the table ever saw them — which is the table
// deciding nothing and the caller deciding everything.
//
// Whether the shell may draw back at all is still not settled here:
// edgeBackArmed comes from platformProfile, and this module never looks at
// the OS itself. Everything the shell has not explicitly claimed falls
// through to "element", which is the rule that the shell takes no gesture
// it has not named.
//
// This is not `src/lib/gesture-arming.js` or `src/lib/swipe-intent.js`,
// though both look adjacent. `gesture-arming.js` answers a narrower, earlier
// question — may a view-switch gesture arm AT ALL — as a single boolean
// gate checked at touchstart, before this table is ever consulted; its
// keyboardOpen gate is what `editing` below folds in here; a flick that
// lands on the editor mid-keystroke (e.g. a fast return-key drag) must never
// read as swipe-to-memory. `swipe-intent.js` answers a different question
// over a different vocabulary: what a COMMITTED edge drag means
// ("back"|"prev"|"next"|"create"|null) for the horizontal page-rail
// gestures — including the RIGHT edge, which this table does not claim at
// all: §1 removed the right-edge swipe from ownership here after it was
// found fighting the platform's own edge gestures, so `swipeIntent` is where
// "a finished horizontal drag → page navigation" gets decided; this module
// only ever arbitrates the left edge, canvas, sheets and blocks above it.

// How wide the left-edge region is, measured in px from x=0. It belongs
// here, with the table, because the table is what owns regions.
//
// It spent P1a as a private const inside Stack.svelte, which made that
// component the only definition anywhere of what "left-edge" means — a
// region constant living inside one of the handlers that competes for the
// region. That is the same shape as the bugs the header above describes:
// a shell that says 24 in one file and 20 in another has two left edges,
// and which one the user's thumb finds depends on which handler ran first.
// One region, one number, next to the row that reads it.
export const EDGE_PX = 24;

/**
 * @param {object} g
 * @param {string} g.region  the MARKED region under the finger —
 *                           "canvas"|"header-dots"|"sheet-handle"|
 *                           "sheet-content"|"block"|"gutter-handle"|string.
 *   Not "left-edge": that is geometry, and it arrives as `atLeftEdge`.
 * @param {string} g.gesture "drag-up"|"drag-down"|"drag-left"|"drag-right"|
 *                           "pan-horizontal"|"tap"|"long-press"
 * @param {boolean} [g.atLeftEdge]     the stroke STARTED within EDGE_PX of x=0
 *   (pointer-gesture.js measures it; the caller passes it straight through).
 *   Independent of `region` on purpose — a marked region that happens to
 *   cover the edge does not stop being marked, and an edge stroke does not
 *   stop starting at the edge.
 * @param {boolean} [g.dragActive]      a block drag is in flight
 * @param {boolean} [g.atScrollTop]     the scroller under the finger is at its top
 * @param {boolean} [g.atScrollBottom]  ...or at its bottom
 * @param {"page"|"memory"|string} [g.space]
 * @param {boolean} [g.edgeBackArmed]   from platformProfile: may the shell draw edge back
 * @param {boolean} [g.editing]    a text field actually has focus — see
 *   gesture-arming.js's incident: a flick that lands on the editor mid-keystroke must
 *   never be read as a space switch. While true, the two space-switch outcomes
 *   ("memory" and "page") degrade to "scroll"; nothing else is affected.
 *
 *   IT USED TO BE `keyboardOpen`, which is a BELIEF about the device, and a Galaxy A34
 *   proved that belief can get stuck: its webview froze every viewport height at the
 *   keyboard-up value, so the shell thought a keyboard was up for the whole session and
 *   this table degraded the only gesture off the page — at the same time the bottom slot
 *   stopped drawing a tab bar, for the same reason. The hazard is real; the witness was
 *   wrong. "Is the writer typing" is a focus fact, which the DOM answers directly and
 *   which the writer can clear by tapping somewhere else. It is also the stronger
 *   witness on iOS, where only the visual viewport moves and keyboardOpen is weaker
 *   still.
 * @returns {"drag"|"back"|"system"|"scroll"|"memory"|"page"|"page-switch"|
 *   "sheet-dismiss"|"block-actions"|"block-lift"|"element"}
 */
export function gestureOwner({
  region,
  gesture,
  atLeftEdge = false,
  dragActive = false,
  atScrollTop = false,
  atScrollBottom = false,
  space = "page",
  edgeBackArmed = true,
  editing = false,
}) {
  if (dragActive) return "drag";

  if (
    region === "header-dots" &&
    (gesture === "pan-horizontal" || gesture === "drag-left" || gesture === "drag-right" || gesture === "tap")
  ) {
    return "page-switch";
  }

  if (atLeftEdge && gesture === "drag-right") {
    return edgeBackArmed ? "back" : "system";
  }

  if (region === "canvas") {
    if (gesture === "drag-up") {
      if (!atScrollBottom) return "scroll";
      return editing ? "scroll" : "memory";
    }
    if (gesture === "drag-down") {
      if (!(atScrollTop && space === "memory")) return "scroll";
      return editing ? "scroll" : "page";
    }
    return "element";
  }

  if (region === "sheet-handle" && gesture === "drag-down") return "sheet-dismiss";
  if (region === "sheet-content" && gesture === "drag-down") {
    return atScrollTop ? "sheet-dismiss" : "scroll";
  }

  if (region === "block" && gesture === "long-press") return "block-actions";
  if (region === "gutter-handle") {
    if (gesture === "tap") return "block-actions";
    if (gesture === "long-press") return "block-lift";
  }

  return "element";
}
