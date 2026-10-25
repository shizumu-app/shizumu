// pin-toast.js — what the phone says about pins, in the one band a
// breadcrumb gets: after a pin lands, and after choosing a trail put pins
// on the page (`carryForwardMessage`, added in P2f Task 3). Two messages,
// one file, because they share the part that is easy to get wrong —
// `trailPhrase`, which is the fix for a writer's own trail name rendering
// as "the the book trail". A second module would be a second place to
// re-derive it, and the bug it guards was found by rendering real names.
//
// Spec §3 (:225-227): "pinning shows the pin-time breadcrumb (`joins 11
// pins on the book trail`) as a Toast under the nav bar — the v2 trail
// dashboard's load-bearing pointer, placed now."
//
// A module rather than a template literal in ShellApp because every line
// below is a decision — which number, whose trail, what a first pin says,
// when there is nothing honest to say — and CLAUDE.md's first testing rule
// puts a decision where a test can reach it. The find bar shipped "0 of 3"
// on the desktop for want of exactly this.
//
// ── this is NOT the desktop's toast ───────────────────────────────────
//
// The desktop says `pinned · <title>` (TipTapEditor:1848 and :1993). That
// is a RECEIPT: it repeats the thing you just did back at you, and the
// only new information in it is that the app did not drop the press. The
// spec asks the phone for something else — where the pin LANDED, and what
// was already there. The two are one tap apart and easy to conflate, so:
// nothing in this module ever renders the pin's own title, and the count
// is never of the thing just made.
//
// ── "joins N pins" counts the OTHERS ──────────────────────────────────
//
// The caller has the trail's total in hand after the write, so the total
// includes the pin that just landed. `joins 11 pins` plainly means eleven
// pins were already there, so the number rendered is total − 1. Reading
// the spec's string the other way — the total, as a company the pin is now
// among — would make the toast overcount by one forever, which is the
// hardest kind of wrong number to notice and the one a writer would only
// catch by counting the trail's list by hand.
//
// A first pin therefore has zero others, and `joins 0 pins on the book
// trail` is not a sentence anyone writes. It gets its own line.
//
// ── which pins the count includes ─────────────────────────────────────
//
// Whatever `getPins(lineageId)` returns, and the caller passes the length
// unfiltered. Two properties of that query are worth stating rather than
// leaving to be rediscovered (commands.rs `get_pins_inner`):
//
//   - it walks parent_id UPWARD, so a nested trail's count includes the
//     pins its ancestors carry. That is right for this claim: those pins
//     are visible on this trail, and a pin landing here lands beside them.
//   - it filters on no status, so closed and orphaned rows count too.
//     Also right, and for a plainer reason: this toast is a POINTER at a
//     list, and the list it points at shows the same rows (PinRow renders
//     closed and orphaned dimmed, not absent). A count that disagreed
//     with the list it names would be worse than no count.
//
// ── the number must be measured, never assumed ────────────────────────
//
// `pinCount` below is the length of a fetch made AFTER the write. It is
// not a remembered number plus one, and it is not a number the caller
// carries across pins. A toast that renders a stale or hardcoded count is
// worse than no toast at all: it is a claim about the writer's own trail,
// made by the one surface they have no way to check it against. Hence the
// `pinCount < 1` line — a count that cannot even see the pin that was just
// written is a fetch that failed or raced, and the honest answer to that
// is silence, not a guess.
//
// ── an untrailed page has no trail to join ────────────────────────────
//
// Step 3 of the plan, answered here as the empty string and answered again
// at the call site, where the fetch is skipped entirely.
//
// A page with no lineage_id joins nothing. There IS a number available for
// it — `get_pins(null)` returns every pin ever made on an untrailed page,
// app-wide and for all time — and that number is precisely what must not
// be rendered. It is a heap, not a trail; it has no name to put in the
// sentence; and reporting its size as company the pin has joined would
// state the pile the product exists to refuse.
//
// So the toast does not appear at all, and that silence is not a dropped
// press. Task 1 built the other half of this on purpose: the same
// `pinIntent` call that writes the pin feeds `disabledIds`, so the control
// goes DEAD on a block that is already kept, on every path and with no
// trail required. The writer gets a confirmation on an untrailed page —
// it is just the button, not a sentence. See ShellApp's `pin` for the
// matching comment, and ShellApp.test.js's "says nothing on an untrailed
// page" for the assertion.
//
// The same empty string covers a trail whose NAME did not load (the
// lineage read has its own try/catch in ShellApp and may leave
// loadedTrailName null while lineage_id stands). A breadcrumb that cannot
// name where it points is not a breadcrumb.
//
// ── brand canon ───────────────────────────────────────────────────────
//
// Lowercase, present tense, fewest words, no exclamation mark, and no
// terminal period: it is a label rather than a sentence, and it is the
// spec's own string verbatim — which the gallery's catalogue entry and
// Toast's own header both already quote, so a period here would make two
// documented examples wrong about what the app renders.
//
// It threads two of the three verbs — PIN and TRAIL —
// and claims nothing about what a pin IS. The canon's corrected pin claim
// is "your thinking happens on the page. the pins are where you left it",
// and a breadcrumb saying where the pin landed is the smallest possible
// version of that: a pointer back, not a claim that the thinking moved.
// The retired word (sink and its forms) appears in neither branch.

/** How long the breadcrumb stays before the caller clears it.
 *
 *  It has to leave on its own. Toast is stateless — no timer, no dismiss,
 *  no lifecycle at all (its first call is what surfaced that) — so an
 *  uncleared message outlives the pin it describes and goes on asserting a
 *  count that later pins have moved past. Four seconds is a comfortable
 *  read of eight words and short enough that it is gone before the writer
 *  finishes the sentence they were in. */
export const PIN_TOAST_MS = 4000;

/**
 * The breadcrumb, or "" when there is nothing honest to say.
 *
 * @param {object} [args]
 * @param {string|null} [args.trailName]  the loaded lineage's name — the
 *   trail the pin's row actually carries, not the header's label, which a
 *   harness may override (ShellApp's header comment).
 * @param {number} [args.pinCount]  `getPins(lineageId).length`, fetched
 *   AFTER the write, so it counts the new pin too.
 * @returns {string}
 */
export function pinToastMessage({ trailName = null, pinCount = 0 } = {}) {
  const name = clean(trailName);
  if (!name) return "";
  if (!Number.isFinite(pinCount) || pinCount < 1) return "";

  const trail = trailPhrase(name);
  // The pin just written is in the count; the others are what it joined.
  const others = pinCount - 1;
  if (others === 0) return `the first pin on ${trail}`;
  return `joins ${others} ${others === 1 ? "pin" : "pins"} on ${trail}`;
}

/**
 * What the phone says when choosing a trail put pins on the page.
 *
 * Assigning a previously untrailed page to a trail for the first time
 * injects every `auto_insert` pin OWNED BY that trail onto the page itself
 * (`get_carry_forward_pins`; `injectCarryForwardPins` in Page.svelte).
 *
 * "and its ancestors" is what this line used to say, and it is wrong — as
 * is CLAUDE.md's context clause, which says the same. The query is strict:
 * `WHERE so.lineage_id = ?1 AND so.auto_insert = 1 AND so.status !=
 * 'orphaned'` (commands.rs:3890-3899), and its own doc comment spells out
 * why — "a pin lives where its lineage_id points and is not inherited up
 * or down the trail tree. Display-time pin listing (`get_pins`) still
 * walks ancestors so users see context — only injection is scoped strict."
 * The two queries differing is exactly what makes the claim easy to get
 * wrong: the pins SCREEN does inherit, and the injection does not.
 *
 * Nothing in this module's output changes — the message carries no count
 * and names no pin (see below) — but P3 Task 2 withholds a `carry forward`
 * row on the strength of that WHERE clause, so a second copy of the wrong
 * reading was worth not leaving here.
 *
 * CLAUDE.md's context clause is what that mechanic is FOR —
 * "choose a trail and the page picks up context: the pins you already kept
 * there, already on the page" — and it fires once, on first assignment, so
 * the writer sees it happen exactly when they have no reason to expect it.
 *
 * WHICH IS WHY THIS EXISTS AT ALL. Blocks appearing in a document nobody
 * typed them into is, without a sentence, indistinguishable from a bug —
 * and the writer's first instinct would be to undo them, which is the one
 * response that throws the context away. The line names the trail they
 * just chose, so the appearance has an author.
 *
 * IT CARRIES NO COUNT, and that is a decision rather than an omission —
 * the opposite one from `pinToastMessage` above, which is nothing without
 * its number. The two toasts point in opposite directions. "joins 11 pins"
 * points at a LIST THE WRITER CANNOT SEE, so the number is the whole
 * message. This one points at the screen they are already looking at: the
 * pins are on the page, in the document, under the sentence they were
 * about to write. Counting what is visible adds nothing and adds a claim
 * that can be wrong — `appendNodesToDoc` drops any node whose shape the
 * doc already holds, and a pin can fan out to more than one node, so
 * "3 pins" would be a number this file cannot measure. The caller measures
 * the only thing that matters instead: whether anything landed at all.
 *
 * The words are CLAUDE.md's context clause, near enough verbatim — "the
 * pins you already kept there, already on the page" — because that clause
 * is the canon's own plain-language explanation of this exact mechanic and
 * re-deriving it would be inventing a second one. Nothing here says what a
 * pin IS: the corrected claim is "your thinking happens on the page. the
 * pins are where you left it", and this is the page picking up where they
 * were left.
 *
 * A trail whose name did not load returns "" — a breadcrumb that cannot
 * name where it points is not a breadcrumb, which is `pinToastMessage`'s
 * rule above and the same reason.
 *
 * @param {object} [args]
 * @param {string|null} [args.trailName]
 * @returns {string}
 */
export function carryForwardMessage({ trailName = null } = {}) {
  const name = clean(trailName);
  if (!name) return "";
  return `the pins you kept on ${trailPhrase(name)}, on the page`;
}

/** "book" → "the book trail". Both fixed words are added only when the
 *  name does not already carry them.
 *
 *  A trail's name is whatever the writer typed in the trail sheet, and
 *  both halves of the phrase are things people actually type. "the book"
 *  is the name in this repo's own test fixtures and would render "on the
 *  the book trail"; "reading trail" would render "on the reading trail
 *  trail". Either one reads as a broken app rather than as a name — and it
 *  would be the writer's OWN name that looked broken, in a sentence about
 *  their own trail. */
function trailPhrase(name) {
  const article = /^the\b/i.test(name) ? "" : "the ";
  const suffix = /\btrails?$/i.test(name) ? "" : " trail";
  return `${article}${name}${suffix}`;
}

/** One line, one space between words. A trail name is free text and can
 *  hold a newline; a toast is one line by the time anything renders it. */
function clean(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}
