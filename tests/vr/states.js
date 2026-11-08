// Drivers that put a loaded scene into an interaction state before capture.
//
// Every one uses real input — a tap, a click, a viewport change — rather
// than a hook inside the app. That is the point: the bugs these guard
// against lived in the reveal and layout paths themselves, so a driver that
// set state directly would pass while the real path stayed broken.
//
// Each driver returns once the state is settled and the screenshot is safe
// to take. Throwing is correct if the state can't be reached: a capture
// named for a state the app never entered is worse than a missing one.
import { STATES } from "../../src/lib/vr/scenes.js";
import { TRAILED_DAY_PINS } from "../../src/lib/vr/fixtures.js";
import { BLOCK_ACTION_LABELS } from "../../src/lib/editor/block-actions.js";
import { CONVERTIBLE_TYPES } from "../../src/lib/editor/block-convert.js";
import {
  WIDGET_MODE, keyboardFixture, visibleBand, offScreenReason,
} from "../../src/lib/vr/keyboard-viewport.js";

// Whether a board type offers "convert to…" is DERIVED from
// CONVERTIBLE_TYPES, never listed separately. A hand-maintained negation of
// that list ("chart", "table") reopened the vacuous-pass hole the boardType
// throw below was added to close: a board type in neither list would skip
// both assertion blocks in silence. One list, two branches — a new board
// type lands in exactly one of them, always.

/** A short height on the same width — what an open soft keyboard leaves. */
const KEYBOARD_VIEWPORT_HEIGHT = 360;

/**
 * The iOS keyboard's height, on the phone `ios-webkit` emulates.
 *
 * 336px is the number Sheet.svelte's own comment records for "a 390×844
 * phone with a 336px keyboard" — the measurement that put its `height:
 * 50%` rule on `--app-height` in the first place. iPhone 14 is 390pt wide
 * and 664px tall in Playwright's descriptor, so this leaves a 328px band,
 * which is the same order as the 360px the Android states shrink to.
 *
 * A height rather than a target viewport, unlike KEYBOARD_VIEWPORT_HEIGHT
 * above, because under resizes-visual there IS no target viewport: the
 * layout viewport does not move, and the keyboard's height is the only
 * number the fixture has to state. keyboardFixture derives the rest.
 */
const IOS_KEYBOARD_PX = 336;

// The writing that makes the shell page taller than its own band, for the
// COLLAPSED state below. It is typed, one keystroke at a time, through the
// real editor — the only way a shell page acquires content, since the shell
// has no import, no paste path and no second surface yet.
//
// Twenty-two short lines rather than four long ones because a paragraph
// costs ~36px (its line plus its margins) while a wrapped line costs ~24px,
// so short lines buy the height at roughly half the keystrokes. Measured:
// 22 lines put .shell-screen-content at scrollHeight 848 against a 749px
// band, which leaves 99px of travel — comfortably past navCollapsed's 24px
// collapse threshold with room for a font metric to move without taking the
// state with it. Twelve lines reached 429px and did not scroll at all.
//
// The lines are real prose from the product's own canon rather than filler,
// because this text is IN the baseline: a reader opening the image has to
// be able to tell a page of writing from a page of lorem, which is the
// difference between "the header folded over a page someone wrote" and "the
// header folded over whatever the test needed".
const SHELL_PAGE_LINES = [
  "the page is where the thinking gets done.",
  "not the pins. the pins come after.",
  "you write to think, and the sentence is the work.",
  "what matters now is a question, not a label.",
  "keep the ones that survive the paragraph.",
  "the rest stays in memory, and that is what makes this honest.",
  "a page that keeps everything is written for posterity.",
  "a page that starts empty is written to think.",
  "a trail is for a project, not a day.",
  "a book. a job search. anything you return to.",
  "choose one and the page picks up its context.",
  "the pins you kept there, already on the page.",
  "the pins are where you left it.",
  "return, re-read, unpin what stopped mattering.",
  "that is re-thinking, not filing.",
  "everything else lives in memory.",
  "search it, or open one trail, one date.",
  "the header folds once the writing runs past it.",
  "so the writing gets the screen and the chrome steps back.",
  "and the writing keeps going.",
  "one more line, and the fold has room to prove itself.",
  "and one after that.",
];

// ── the modal bottom slot (P2c) ──────────────────────────────────────────
// One line of writing. The selection strip cannot exist without it — there
// is nothing to select on a blank page — and the block strip is shot over
// the same line so the two images differ in exactly one thing.
//
// It is NOT here to make `undo` live, which is what the first draft of this
// comment claimed and what the plan's "5 of 8 live" count implies. Broken
// and checked, as the house rule requires: the untyped capture already in
// the suite (shell-page @ keyboard, whose driver only clicks and shrinks)
// renders `undo` in the same ink as `bold`. (When that was checked the
// strip was eight wide and `type`, `pin` and `insert` were the greyed
// three; since the visual pass a control that cannot apply is absent, not
// grey, so that untyped capture now shows five — `pin` gone from the empty
// line — with `undo` still live.) So canUndo is ALREADY true on a shell
// page nobody has typed into — EditorCore's mount leaves something on the
// history stack — and the count holds with or without the typing. Recorded
// rather than asserted here: it is a finding about the editor, not a fact
// this photograph should lock in, and a test that goes red when someone
// stops dirtying the history at mount would be punishing the fix.
const SHELL_STRIP_LINE = "pin what matters. the rest stays in memory.";

// The tail of that line, selected with real keystrokes for the selection
// strip. The driver presses Shift+ArrowLeft once per character of THIS
// string from the end of the line and then asserts the DOM's selection
// equals it — so it must be a strict suffix of SHELL_STRIP_LINE (the
// keystrokes walk backwards from the caret the typing left) and shorter
// than the line, or the run walks off the start of the paragraph and
// collapses into a selection of nothing. Long enough to read as a
// highlight in the baseline. Held below at load rather than by hand, so
// a retyped line with an unchanged tail fails the whole run by name
// before a single shutter, not as one driver's "selected the wrong text".
const SHELL_SELECTION_TAIL = "stays in memory.";
if (
  !SHELL_STRIP_LINE.endsWith(SHELL_SELECTION_TAIL) ||
  SHELL_SELECTION_TAIL.length >= SHELL_STRIP_LINE.length
) {
  throw new Error(
    `SHELL_SELECTION_TAIL "${SHELL_SELECTION_TAIL}" must be a strict suffix of ` +
    `SHELL_STRIP_LINE "${SHELL_STRIP_LINE}" — the selection driver walks back ` +
    "from the end of the line by the tail's length",
  );
}

// ── row 2, the find strip (P2c-2) ────────────────────────────────────────
// The query typed into the find FIELD — not into the page. It is chosen for
// what it makes the label say rather than for being easy to find: "matters"
// occurs exactly once in SHELL_STRIP_LINE, so the strip reads "1 of 1", and
// that is the only total at which Task 1's judgement call is visible at all.
// `prev` and `next` stay LIVE on a single match, because the sentence beside
// them says there is a match to sit on and a greyed arrow would contradict
// it; at every other non-zero total the two arrows render identically, so no
// other query photographs the decision. Its emptiness is what the driver
// asserts, by name.
const SHELL_FIND_QUERY = "matters";

// ── row 4, the suggestion chips (P2c-2) ──────────────────────────────────
// Typed into the DOCUMENT, which is the only producer there is: the chips
// exist while the slash plugin reports a live trigger and not otherwise, so
// a driver that wanted them without typing `/` would have to reach into the
// plugin, which is the hook this whole file refuses.
//
// Three characters rather than a bare `/`. `/` alone matches every command
// there is — every title contains the empty string — and fills the strip
// with a scroll, which photographs as a first chip half under the mask fade
// and says nothing about whether chips fit. `/he` resolves against the REAL
// commandItems to exactly the three headings, which is both the case a
// writer is actually in and the case where "the chips fit one row at 412px"
// is a claim the picture can make. The driver names all three, so a new
// command whose title carries "he" fails here rather than quietly joining
// the photograph.
//
// It goes on a FRESH LINE, and that is not neatness. @tiptap/suggestion only
// opens a session when the trigger char follows a line start or a space
// (allowedPrefixes), and shellStripSetup leaves the caret after a full stop
// — so a `/` typed where the setup ends is just a slash in a sentence.
const SHELL_SLASH_QUERY = "/he";

// ── the lift (P2e) ───────────────────────────────────────────────────────
// Six lines, typed, for the drag state below. Six rather than the one line
// the strips use because a reorder needs somewhere to go: with two blocks
// every drop is the same drop, and the hairline has one gap to be in.
//
// They are chosen so the PHOTOGRAPH is self-describing. The block that gets
// lifted says so in its own text, and the two lines the hairline lands
// between are ordinary prose around it — so a reader opening the PNG can
// see which block is in the air and which gap it is aimed at without
// counting paragraphs against this file. Real canon lines rather than
// filler, for SHELL_PAGE_LINES' reason.
//
// Short enough that six of them do not fill the content band: the drag is
// shot with the keyboard DOWN (see scenes.js's BLOCK_LIFT) and the driver
// asserts the band never scrolled, which is only an honest assertion if
// there was nothing to scroll in the first place.
const SHELL_DRAG_LINES = [
  "the page is where the thinking gets done.",
  "this is the line the finger is carrying.",
  "a trail is for a project, not a day.",
  "the pins are where you left it.",
  "return, re-read, unpin what stopped mattering.",
  "everything else lives in memory, searchable.",
];

// ── the page's own chrome (P2f) ──────────────────────────────────────────
// The four states below run on `shell-trail-page`, whose fixture is
// FIXTURES.trailedDay. Everything they assert about that page is written
// out here rather than imported from the model that produced it — the
// caption rule assertStripButtons states — with ONE exception, the pin
// count, which comes from the SEED. That is not the same thing: deriving
// the sentence from pinToastMessage would make the caption unfalsifiable,
// while deriving the number from the fixture is what keeps two files from
// disagreeing about how many pins were planted.

/** The block the pin is taken from. Index into the fixture's paragraphs;
 *  the middle one, so the caret is placed rather than inherited — a
 *  freshly opened page restores the cursor to the LAST block, which is the
 *  trap P2d lost four first-draft tests to. */
const SHELL_PIN_BLOCK = 1;

/** The trail the fixture puts the page on, and the sentence the toast is
 *  expected to say about it. `the book` already starts with "the", which
 *  is exactly the case trailPhrase exists for — a name-blind template
 *  would render "on the the book trail" — so the photograph is also the
 *  regression shot for that. */
const SHELL_TRAIL_NAME = "the book";

/** The breadcrumb, character for character, WRITTEN OUT rather than
 *  composed by `pinToastMessage` — the caption rule again, and it bites
 *  hardest here because every interesting decision in that module is a
 *  string decision. The count is the fixture's seed (the toast renders
 *  total − 1 after the driver's own pin lands, so eleven planted pins read
 *  as eleven joined); the two fixed words around the name are the ones
 *  `trailPhrase` decides to omit, so a regression to "on the the book
 *  trail" fails here by name rather than becoming ~40px of ink under a
 *  0.002 gate. No terminal period: it is a label, not a sentence, and the
 *  spec's own example has none. */
const SHELL_PIN_TOAST = `joins ${TRAILED_DAY_PINS} pins on ${SHELL_TRAIL_NAME} trail`;

/** The day sheet's rows, at the frozen VR clock (2026-01-15, UTC).
 *  Today is synthesised unconditionally and shows `showing`; the other two
 *  are the days the fixture wrote on. */
const SHELL_DAY_ROWS = ["today", "yesterday", "13 jan"];

/** The pages sheet's rows and the note beside each — the page's own "what
 *  matters now", cut at 32 characters by `pageRows`. Both of the fixture's
 *  lines are under the cut deliberately: the ellipsis past it is
 *  unit-tested in page-picker, and a row value this caption has to
 *  reproduce by hand is a caption that can be wrong about its own
 *  photograph.
 *
 *  `page 1` / `page 2` are ORDINALS. page-ordinal.js records why: the
 *  page_number column is minted per device and renumbered on merge, so the
 *  same page is "1" on the phone and "4" on the desktop. */
const SHELL_PAGE_ROWS = [
  ["page 1", "showing"],
  ["page 2", "a second thread, before lunch"],
  ["delete page 1", ""],
];

/** The trail sheet's four rows, in `trailSheetRows`' own order: the way
 *  off a trail first, then the trails themselves. No `start the trail …` row,
 *  because nothing is typed into the field — that row appears only for a
 *  name no trail already carries, and this state photographs the sheet as
 *  it opens.
 *
 *  The three values are the three states a trail can be in relative to
 *  this page, which is why the fixture seeds one of each: the page's own
 *  ("this page"), one it could move to (no value, a live row), and a
 *  continuous one it cannot ("living doc"). */
const SHELL_TRAIL_ROWS = [
  ["no trail", ""],
  [`manage “${SHELL_TRAIL_NAME}”`, ""],
  ["field notes", "living doc"],
  ["job search", ""],
  [SHELL_TRAIL_NAME, "this page"],
];

/** The block the handle is pressed on. Index into SHELL_DRAG_LINES. */
const SHELL_DRAG_FROM = 1;

/** The gap the finger is aimed at, counted over the blocks as they are
 *  still laid out: 4 is the boundary above block 4, i.e. between "the pins
 *  are where you left it." and "return, re-read…". The finger goes to that
 *  block's TOP edge, which leaves half a block of slack on either side of
 *  the two midpoints dropTargetIndex decides between. */
const SHELL_DRAG_TO_GAP = 4;

/** What the drop would answer, and it is derived by HAND rather than by
 *  calling insertionLineIndex — a caption computed by the module it
 *  describes cannot disagree with it, which is the same rule the strip
 *  captions follow. A downward drag's post-removal index is one less than
 *  the gap it is drawn in, because the block's own rect stops counting the
 *  moment it moves. */
const SHELL_DRAG_TO_INDEX = SHELL_DRAG_TO_GAP - 1;

// ── the builders and the pickers (P2f-2) ─────────────────────────────────
// Everything below is a CAPTION, written out by hand rather than imported
// from the module that produces it — the rule assertStripButtons states, and
// the rule these states need most: at a 0.002 gate a row, a caption or a
// commit value is a rounding error, so the assertion is the only thing that
// can be wrong out loud.

/** Every row the insert sheet offers, in ShellApp's INSERT_ROWS order.
 *
 *  ELEVEN, and the number is spelled out nowhere else because it has been
 *  wrong three times by being remembered: seven when P2d shot this state,
 *  nine after Task 1 stopped pretending `image` and `file` needed a system
 *  picker built for them, ten after Task 4's grid, eleven after Task 5's
 *  builder.
 *
 *  EIGHTEEN SINCE THE FOURTH DEVICE PASS, and they are the slash menu's
 *  own titles in its own order: a writer who knew `/task` typed `task`
 *  into the finder and got nothing, because `heading` and `list` had been
 *  one row each over three commands apiece. insert-menu.js decides the
 *  list; it is written out here rather than imported, because a caption
 *  derived from the app is a caption that agrees with a broken app. */
const SHELL_INSERT_ROWS = [
  "paragraph", "heading 1", "heading 2", "heading 3",
  "task", "bullet", "numbered",
  "code block", "blockquote", "divider",
  "table", "outline", "recipe", "decision", "chart", "q&a", "image", "file",
];
/** The block sheet over a written PARAGRAPH. `pin` leads because
 *  `blockActionsFor` puts it first and this file passes that order through
 *  untouched. `turn into` is HERE since the visual pass: CONVERTIBLE_TYPES
 *  still holds board types only, but turn-into-model.js gives a paragraph
 *  two targets of its own (list, heading) and the sheet's row and the
 *  strip's button read one gate, so the row appears the day the button
 *  does. Both facts are in the list rather than in a comment on the image. */
const SHELL_BLOCK_ROWS = ["pin", "copy", "turn into", "move up", "move down", "delete"];

/** The block sheet over a BOARD, which is the only shape that offers
 *  `title` — the row Task 3 unblocked. `pin` and `copy` are absent and
 *  their absence is the assertion: `canPin` is "has text worth keeping",
 *  and a q&a inserted a moment ago has none. A board with no text is also
 *  still deletable (`canPin || isBoard`), which is what keeps `delete` on
 *  the list. */
const SHELL_BOARD_ROWS = ["title", "turn into", "move up", "move down", "delete"];

/** The cell the thumb lands on in the size grid, 0-based, cols-across and
 *  rows-down. NOT the default (2, 2): the sheet opens on that, so a
 *  photograph of it would be a photograph of nothing having been tapped.
 *
 *  ASYMMETRIC on purpose. `gridCellsFor` reads "{cols} × {rows}" in that
 *  order and clamps rows to a floor of 2, so a square pick photographs a
 *  transposed reading identically to a correct one — 5 columns by 4 rows
 *  does not. */
const SHELL_TABLE_CELL = { row: 3, col: 4 };

/** What that cell says, character for character, in BOTH places the sheet
 *  says it: the caption above the grid and the value on the commit row.
 *  Written out rather than derived from `gridCellsFor`, for this block's
 *  rule — and the `×` is U+00D7, not the letter, which is the kind of
 *  substitution a screenshot cannot report. */
const SHELL_TABLE_READING = "5 × 4";

/** The twenty cells that light up for it: every (row, col) with row < 4 and
 *  col < 5. Derived by hand for the caption rule, and it is the assertion
 *  that ties the highlight to the caption — two readings of one tap that
 *  can drift apart, and a photograph in which a wrong highlight is just a
 *  different arrangement of the same beige. */
const SHELL_TABLE_LIT = 20;

/** The segmented control's three, in ChartForm's KIND_OPTIONS order. The
 *  labels are ChartBuilder's own, deliberately — a writer who made a chart
 *  on the desktop finds the same three words in the same order. */
const SHELL_CHART_KINDS = ["flowchart", "mind map", "timeline"];

/** What the commit row says when a timeline cannot be written yet.
 *  `emptySource("timeline")` seeds two events with no dates and
 *  `chartCanCommit` refuses exactly that, so the row is INERT and carries
 *  the reason instead of a kind. An inert row is all but invisible in a
 *  photograph: no chevron on it and none on the live `action` row either
 *  (row-kind.js draws one for a push alone), no line of its own on either
 *  (RowGroup owns the lines), the same label — only the tone differs,
 *  accent for the offer and ink for the fact, and a tone at 412px is not
 *  what a diff gate reads reliably. So this string and the inertness are
 *  asserted together. */
const SHELL_CHART_BLOCKED = "every event needs a date";

// ── memory, the pins, and the stack (P3) ─────────────────────────────────
// Captions again, by hand, for the reason the block above states — and for
// one more that is this group's alone. Four of the seven states below are
// SCREENS rather than sheets, and a screen fills the frame: at a 0.002 gate
// a whole nav bar's back control is ~44px on a 412×915 device, which is
// 0.001 of it. P2c-2 watched a control that size vanish with the baseline
// green, and every one of these screens hangs its only way out on one.
//
// FIVE OF THE SEVEN HAVE NO BASELINE ON PURPOSE, and it is worth knowing
// before reading a red run. Every state here that photographs a PUSHED
// screen reaches its shutter with every assertion below green and produces
// an unreadable image: nothing between `.shell-root` and a screen paints a
// background, and `Stack` keeps two entries in one grid cell, so the screen
// underneath is painted THROUGH the one on top. scenes.js's P3 block
// carries the whole finding and why the PNGs are absent rather than
// recorded. Nothing in this file was relaxed to get past it.

/** Every pin row on the pins screen, in the order `get_pins` returns them.
 *
 *  ELEVEN, which is `TRAILED_DAY_PINS`, and the number is IMPORTED rather
 *  than typed: the same seed feeds the pin toast's sentence one state over,
 *  and two files disagreeing about how many pins were planted is the
 *  failure the toast's caption already guards. The TEXT is written out,
 *  because `what chapter N is actually about` is the fixture's own title
 *  and `pinRowLabel`'s first branch — the row would still render if that
 *  branch fell through to the snippet, and it would render differently. */
const SHELL_PIN_ROWS = Array.from(
  { length: TRAILED_DAY_PINS },
  (_, i) => `what chapter ${i + 1} is actually about`,
);

/** Memory's nav bar, at rest: the title, and its two actions in NavBar's
 *  own left-to-right order. `filters` carries no count because nothing is
 *  filtered, and `trails` says what it OPENS rather than what is on,
 *  because no scope is set — one control rather than a control plus an
 *  indicator (trail-index.js's `trailActionLabel`). Both labels change the
 *  moment either is used, which is why they are captioned rather than left
 *  to the picture. */
const SHELL_MEMORY_ACTIONS = ["filters", "trails"];

/** The mode segment, in `MEMORY_MODES` order, and which one memory opens
 *  on. `trail map` is the desktop's word for the timeline §2 describes and
 *  is `DEFAULT_MODE`, so this is also the assertion that the screen opens
 *  on the view the spec calls its content rather than on the pages list. */
const SHELL_MEMORY_MODES = ["pages", "trail map", "pins"];
const SHELL_MEMORY_MODE_ON = "trail map";

/** The search field that rides in the bar. Its placeholder is the only
 *  thing on screen that says what it searches, and an empty field with a
 *  lost placeholder photographs as a blank card. */
const SHELL_MEMORY_SEARCH = "search your writing…";

/** The timeline's day headings, newest first, at the frozen VR clock.
 *  Same three days `SHELL_DAY_ROWS` names in the date sheet — deliberately
 *  the same words from a different module (`dayLabel` reached through
 *  memory's own `yesterdayOf` rather than through the page picker), which
 *  is what would catch the two drifting apart. */
const SHELL_MEMORY_DAYS = ["today", "yesterday", "13 jan"];

/** The filters sheet: two headings, two segments, one toggle row, and no
 *  clear row. The values are the desktop's own presets (DatePopover's four,
 *  MemoryFiltersPanel's two), in its order. */
const SHELL_FILTER_RANGES = ["all", "today", "this week", "this month"];
const SHELL_FILTER_SORTS = ["date", "edited"];
const SHELL_FILTER_ROWS = ["pinned only"];

/** The memory row the reading view is pushed from, and everything the
 *  screen then says about it.
 *
 *  YESTERDAY, DELIBERATELY. `pageReadonly` freezes a past date on a
 *  discrete trail, and the read-only arm of `readingRows` is the half of
 *  this screen §2 asks for ("open yesterday in memory, write today on
 *  PAGE") — a row tapped on today's page would photograph `continue`
 *  alone and prove nothing about the rule. The label is the page's own
 *  focus line, which is what `pageRowLabel` puts on a timeline row. */
const SHELL_READING_ROW = "the middle chapters, and what they owe each other";
const SHELL_READING_TITLE = "yesterday";

/** EMPTY, since the visual pass (Task 7). The trail used to be the bar's
 *  second line; it is a chip under the title now, the desktop's anatomy
 *  (ThreadPageView's `.pv-matters` over `.pv-content`, PinArtifactModal's
 *  chip beside its title). A bar that still said it would name the trail
 *  twice, once in chrome and once on the subject. */
const SHELL_READING_SUBTITLE = "";

/** The provenance line under the title. `written yesterday` is the
 *  page's own `date` (the fixture's yesterday); `edited today` is its
 *  `updated_at`, which the mock stamps off the frozen clock at creation
 *  and `save_page_content` does not move — so both columns are the
 *  fixture's today and the day it was FOR is the day before. The words
 *  are provenance.js's (`readingProvenance`), held there against injected
 *  dates; what this holds is that the host handed the screen the frozen
 *  clock rather than the machine's. */
const SHELL_READING_PROVENANCE = `${SHELL_TRAIL_NAME} · written yesterday · edited today`;

/** The sentence over the row on a read-only page — ThreadPageView's own,
 *  kept whole. It was an inert ROW until Task 7: a 44px control that did
 *  nothing, told apart from the live row beside it by a chevron alone.
 *  It is a `Note` now, a paragraph of prose above the group, and there is
 *  nothing in the row list for it to be confused with. */
const SHELL_READING_NOTE = "this page is done. today is on the page.";

/** The one row under the writing on a read-only page: the offer that
 *  replaces `continue`, because a writer sent to a canvas that refuses
 *  every keystroke has nothing on a pushed screen telling them why. An
 *  ACTION (row-kind.js) — it leaves for the page root and opens no screen
 *  — so it draws no chevron; the driver asserts the kind because at the
 *  0.002 gate a glyph at a row's end is not the pixels' to report. */
const SHELL_READING_ROWS = ["write today"];

/** The pin view's provenance line. `from the book` is the lineage the
 *  fixture kept its pins on; `kept today` is `created_at` off the frozen
 *  clock, and `edited` is absent because `updated_at` names the same day
 *  (provenance.js omits it — one fact said twice). */
const SHELL_PIN_PROVENANCE = `from ${SHELL_TRAIL_NAME} · kept today`;

/** The trail index, drawn as a map since the visual pass (Task 8): every
 *  row on the screen and the value beside each, then what each block
 *  carries — all of it read off `FIXTURES.trailedDay`.
 *
 *  Two scope rows that always exist, then the fixture's three trails in
 *  NAME order (`field notes`, `job search`, `the book` — not creation
 *  order, which is the order the fixture makes them in and would pass a
 *  sloppier assertion), each a block's header row. `showing` marks the
 *  scope that is on, and every other header carries its MODE, so the two
 *  are mutually exclusive by sharing one column. `untrailed` carries
 *  neither, because it is not a lineage and has no mode to name.
 *
 *  Under `the book`'s header come its PAGE rows, newest day first: the
 *  fixture trails today's first page and the two earlier days onto it
 *  (`set_focus_lineage` on each), and leaves today's second page
 *  untrailed — which is why `a second thread, before lunch` is NOT here.
 *  The values are empty because a page row has no value column; the
 *  labels are each page's own focus line (`pageRowLabel`). `field notes`
 *  and `job search` have no pages at all, so nothing follows their
 *  headers. */

// ── settings, sync, and the camera (P4) ──────────────────────────────────

/** The settings root's five rows, in three named groups, with the value
 *  column. The groups are `SHELL_SETTINGS_EYEBROWS` below; the rows read
 *  straight through them in the desktop's order.
 *
 *  THREE OF THE FIVE VALUES ARE EMPTY AND ALL THREE ARE DECISIONS.
 *  `labs` holds a toggle whose state belongs beside the toggle; `about`
 *  would otherwise print the build twice on two screens; and `sync` is
 *  `syncStateLabel(null)`, which answers "" rather than "not set up"
 *  because "nothing has been read yet" and "this install has never synced"
 *  are different facts. The browser mock answers `sync_status` with null
 *  and no fixture can seed it otherwise, so "" is the only value this
 *  suite can ever photograph here — see scenes.js's P4 block.
 *
 *  `tone` and `font` read the app's live values rather than the model's
 *  defaults: App.svelte's VR branch sets `tone` from the scene's theme, and
 *  every interaction state runs at LAYOUT_THEME. So `cream` here is the
 *  harness's own theme arriving through the host's prop, and a capture at
 *  another theme would legitimately read differently. */
const SHELL_SETTINGS_ROWS = [
  ["tone", "cream"],
  ["font", "lora"],
  ["data", ""],
  // The account's one lock (2026-11-07): its row says whether this device
  // is locked; the VR mock answers check_encryption_status false.
  ["lock", "off"],
  ["sync", ""],
  ["labs", ""],
  ["about", ""],
];

/** The three eyebrows over the root's groups, in order — `page` (tone,
 *  font), `sync` (sync), `app` (labs, about). settings-model.js says why
 *  each word; what this file holds is that the photograph shows three
 *  inset groups under exactly these names, because a group is the whole
 *  visual difference between "five settings" and "three things a phone
 *  can be set about". */
const SHELL_SETTINGS_EYEBROWS = ["page", "data", "lock", "sync", "app"];

/** The tone section: four choice rows, and the word in the value column
 *  that says which one is current.
 *
 *  A WORD RATHER THAN A MARK is settings-model.js's decision and
 *  TrailIndexScreen's before it — `Row` has no selected variant, and a word
 *  reads the same to a screen reader as a tick does not. `CHOSEN` is
 *  exported from the model precisely so a test asserts the string the
 *  screen renders instead of a second copy of it. */
const SHELL_TONE_SECTION_ROWS = [
  ["cream", "in use"],
  ["white", ""],
  ["dark", ""],
  ["system", ""],
];

/** The bar over a pushed section: its title, and the blurb riding the
 *  subtitle line NavBar already has. Both come from the model, and the
 *  blurb is the reason the section screen needs no description slot on
 *  `Row` — the bar drops its second line under a scroll for free. */
const SHELL_TONE_SECTION_BAR = {
  title: "tone",
  subtitle: "canvas color underneath everything you write.",
};

const SHELL_LABS_SECTION_BAR = {
  title: "labs",
  subtitle: "opt-in experiments. may move or vanish.",
};

/** Labs' rows. Each carries a TOGGLE and therefore no value column at all,
 *  which is why the row list and the toggle list are asserted separately —
 *  in `screenState`'s `rows` a toggle row and a bare label are the same
 *  shape. `crdt` is deliberately absent from the first label: the desktop's
 *  own wording minus a word that explains the mechanism to someone who
 *  already knows it.
 *
 *  THE SECOND ROW IS THE WAY OUT of the shell (src/shell/shell-switch.js),
 *  and it photographs ON here because `withShellFlag` seeds
 *  `try_new_shell: "true"` for every shell scene. Its OFF state draws a
 *  third element — a note saying when the layout changes — which is not
 *  captured: reaching it means throwing the switch, so a scene for it would
 *  be an interaction state of its own, and the shell's baselines are
 *  already waiting on the re-record this row moves. Recorded rather than
 *  quietly skipped.
 *
 *  The first entry is the one `SHELL_LABS_TOGGLE_ROW` names, because the
 *  toggle assertion below reads `rows[0]`. */
const SHELL_LABS_TOGGLE_ROW = "yjs for continuous trails";
const SHELL_LABS_ROWS = [
  [SHELL_LABS_TOGGLE_ROW, ""],
  ["new phone layout", ""],
];

/** The devices screen, at the only status the mock can produce.
 *
 *  Row 1 is the state, INERT — there is nothing behind it to open, and
 *  turning sync on and off from this row is the desktop's (sync-model.js's
 *  omissions; the setup wizard's done step is the one place the phone
 *  turns it on). It sits in a group under the eyebrow `status`. Rows 2
 *  and 3 are the two ways onto an account, ACTIONS (accent, no chevron,
 *  in a flush group of their own): `pair this device` rather than `add a
 *  device` because `pairSide(null)` is "join" — a device that is not on
 *  an account joins one, it does not hand out invitations — and `set up
 *  sync`, which `setupRowShows` offers at this status because a status
 *  not read yet is the same "not on an account". The third row was
 *  missing until 2026-09-17, and a phone that was someone's only device
 *  read the second with nothing to pair with. No `devices` group at this
 *  status — there is no list to head. */
const SHELL_SYNC_DEVICE_ROWS = [
  ["sync", ""],
  ["pair this device", ""],
  ["set up sync", ""],
];

/** The setup wizard's phrase step, on the have-a-phrase side: the
 *  segment's second option, the one field's label, and 24 words typed
 *  into it. `w1 … w24` rather than real bip39 words: nothing is sent, the
 *  count is the only thing the screen checks before `next`, and words
 *  that look like a real phrase in a committed PNG are words someone
 *  will one day try. */
const SHELL_SETUP_MODE_TYPED = "have a phrase";
const SHELL_SETUP_PHRASE_FIELD = "recovery phrase";
const SHELL_SETUP_PHRASE = Array.from({ length: 24 }, (_, i) => `w${i + 1}`).join(" ");

/** The relay step: the desktop's own sentence over the choice, the
 *  hosted relay named without its scheme under `syncs to`, the one field
 *  left when hosted is chosen, and the two acts — the filled `connect`
 *  and the row back to the words. */
const SHELL_SETUP_RELAY_PROMPT = "choose where your encrypted writing syncs.";
const SHELL_SETUP_HOSTED = "hosted";
const SHELL_SETUP_RELAY_NAME = "relay.shizumu.app";
const SHELL_SETUP_LABEL_FIELD = "a name for this device";
const SHELL_SETUP_CHANGE_ROW = "change the phrase";

/** What the join side of the pair screen says, character for character.
 *  `pairPrompt("join", "waiting")` — the one sentence in the sync stack
 *  that tells the reader to go and do something on another device, which
 *  is the whole of what a phone with no account can do. */
const SHELL_PAIR_PROMPT =
  "on the device that already has your writing, open settings, sync, add a device. " +
  "then scan the code it shows.";

/** The join side's one row, and the only door to the scanner. */
const SHELL_PAIR_ROW = "scan a code";

/** QrScanner's consent gate — its own prose and its own control, before
 *  any `getUserMedia` has been called. The rationale is the borrowed
 *  desktop component's, and it is photographed as-is: the shell mounts
 *  QrScanner rather than reimplementing it, so this text is what a phone
 *  actually shows. */
const SHELL_SCAN_CTA = "start camera";

/** The three sentences `scannerNote` can put on this screen, and nothing
 *  else.
 *
 *  A SET RATHER THAN ONE EXPECTED STRING, because which failure a browser
 *  reports for a machine with no camera is the environment's answer and
 *  not the app's — measured as two different answers on two Linux hosts:
 *  the Docker image raises `NotFoundError: Requested device not found`,
 *  which `classifyCameraError` reads as `absent`, and a bare Fedora host
 *  raises something matching neither mark and falls through to `failed`.
 *  Pinning either string would leave this state red on the other host for
 *  a reason that has nothing to do with the shell.
 *
 *  What IS the app's answer, and what is asserted exactly, is that the
 *  sentence is one of these three and not the desktop's. The driver logs
 *  the raw error beside the note so a run can always say which arm it
 *  travelled and why. */
const SHELL_SCAN_NOTES = [
  "shizumu has no camera permission. grant it in system settings, then start the camera again.",
  "no camera on this device.",
  "the camera did not open. go back and try again.",
];

/** The sentence that must never reach a phone. QrScanner's own error branch
 *  tells the reader to switch to the "type words" tab — a tab that exists
 *  in `src/components/SyncSettings.svelte` and nowhere in this tree, so on
 *  the shell it is an instruction to do something impossible.
 *  SyncScanScreen unmounts the component on `onError` so it cannot be
 *  reached; this is the string that proves it. */
const SHELL_SCAN_DESKTOP_TEXT = "type words";

/**
 * What the bottom slot's editing strip is showing, read off the rendered
 * DOM rather than off the model that decided it. toolbar-model.js and
 * toolbar-state.js are already unit-tested to death; what has never been
 * checked is whether their answer reaches the screen — which is the seam
 * every previously-uncalled module in this workstream failed at.
 */
async function stripState(page) {
  return page.evaluate(() => {
    const strip = document.querySelector(".shell-toolbar-strip");
    if (!strip) return null;
    const buttons = [...strip.querySelectorAll("button")];
    const rect = strip.getBoundingClientRect();
    return {
      ids: buttons.map((b) => b.dataset.buttonId),
      disabled: buttons.filter((b) => b.disabled).map((b) => b.dataset.buttonId),
      // Distinct top edges. One row is one value; a strip that wrapped is a
      // second row of chrome stacked vertically, which §1 forbids outright
      // and ToolbarStrip's own header calls out as the thing it must never
      // do. Measured rather than trusted to `flex-wrap: nowrap`, because the
      // failure mode is a container that stopped being the flex parent.
      rows: [...new Set(buttons.map((b) => Math.round(b.getBoundingClientRect().top)))].length,
      bottom: Math.round(rect.bottom),
      tabbar: !!document.querySelector(".shell-tabbar"),
      // The nav row's own box. It is a SIBLING of the strip inside the band
      // now, not a competitor for it, and the two claims worth measuring are
      // that it is below the strip and that it is not under the keyboard —
      // the second being the one no model can make, which is why it is here
      // and not in a unit test.
      nav: (() => {
        const el = document.querySelector(".shell-slot-nav");
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) };
      })(),
      viewport: window.innerHeight,
      selected: (window.getSelection()?.toString() ?? ""),
    };
  });
}

/**
 * The viewport as the ENGINE reports it, plus what keyboard-state.js made
 * of it. Read together in one round trip because every judgement about a
 * keyboard-up capture is a comparison between the two — and because the
 * failure messages below are only useful if they can print both.
 */
async function viewportFacts(page) {
  return page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const num = (name) => {
      const v = Number.parseFloat(cs.getPropertyValue(name));
      return Number.isFinite(v) ? Math.round(v) : null;
    };
    const vv = window.visualViewport;
    return {
      innerHeight: window.innerHeight,
      vvHeight: vv ? Math.round(vv.height) : null,
      vvOffsetTop: vv ? Math.round(vv.offsetTop) : null,
      kbInset: num("--kb-inset"),
      kbOverlay: num("--kb-overlay"),
      appHeight: num("--app-height"),
    };
  });
}

/**
 * Raise the soft keyboard in the shape the given platform reports it, and
 * prove the app saw the shape that was asked for.
 *
 * TWO MODES, ONE CALL SITE. Until this existed there was one technique —
 * shrink the viewport — and it is Android's: index.html asks for
 * `interactive-widget=resizes-content`, the IME shrinks the LAYOUT
 * viewport, and `page.setViewportSize` reproduces that faithfully because
 * it moves `innerHeight` and `visualViewport.height` together. Every
 * keyboard baseline in this suite was shot that way, so every one of them
 * was shot with `--kb-overlay` at 0 and the resizes-visual branch of
 * keyboardOverlayPx has never appeared in a photograph.
 *
 * THE IOS PATH IS A SEAM, AND IT IS NOT REAL INPUT. Say so plainly, per
 * the fourth testing rule: no Playwright API moves the visual viewport
 * independently of the layout one — setViewportSize moves both, which was
 * measured on this host before this was written — so the only way to put
 * WebKit into resizes-visual is to shadow `visualViewport.height` and
 * dispatch the engine's own resize event at the app's own listener.
 *
 * What that costs, exactly, so nobody reads the capture as more than it
 * is: it cannot prove WKWebView reports these numbers. That is the §5 flag
 * the spec already says can only be settled on a device, and it stays
 * there.
 *
 * What it does NOT cost is the rest of the path. The shadowed value is a
 * single number that no CSS reads: `visualViewport.height` is JS-only, and
 * keyboard-state.js is its only reader in the whole of src/ — its own
 * header says so, and shell-rules.test.js holds the shell half of it by
 * forbidding the identifier anywhere under src/shell/. So the app's
 * listener, computeKeyboardState, keyboardOverlayPx,
 * the CSS custom properties, Svelte's reactivity, and every quantity the
 * ENGINE resolves — fixed positioning against the real full-height layout
 * viewport, `margin-bottom: var(--kb-overlay)`, `calc(var(--app-height) *
 * var(--detent-fraction))`, the safe-area insets — are all untouched and
 * all genuinely WebKit's. The layout viewport is deliberately left at the
 * full device height for that reason: it is what makes `position: fixed;
 * bottom: 0` land under the keyboard, which is the whole geometry under
 * test.
 *
 * Returns the plan and the measured facts, so a caller can go on asserting
 * against numbers it did not have to re-derive.
 */
async function raiseKeyboard(page, mode, label) {
  const size = page.viewportSize();
  if (!size) throw new Error(`${label}: no viewport to raise a keyboard against`);

  // Under resizes-content the fixture is stated as a TARGET HEIGHT
  // (KEYBOARD_VIEWPORT_HEIGHT, unchanged since the first keyboard state)
  // and the keyboard's height falls out of it; under resizes-visual there
  // is no target height, because the layout viewport does not move, so the
  // keyboard's height is stated instead. Same fixture either way once
  // keyboardFixture has it.
  const keyboardPx = mode === WIDGET_MODE.RESIZES_CONTENT
    ? size.height - KEYBOARD_VIEWPORT_HEIGHT
    : IOS_KEYBOARD_PX;
  const plan = keyboardFixture({ mode, deviceHeight: size.height, keyboardPx });

  if (plan.nativeKeyboard) {
    // NATIVE-IME: the activity's half, and the only mode where the harness
    // moves no viewport at all. Android 15 does not resize an edge-to-edge
    // window for the IME (targetSdk 35+, and this app targets 36), so there
    // is nothing to shrink and nothing to shadow — the keyboard's height
    // arrives from the activity, and the way in is the same receiver the
    // Kotlin calls: window.__nativeKeyboard (keyboard-state.js installs it;
    // scripts/patch-android-keyboard.py is the caller on a phone).
    //
    // That makes this the one keyboard fixture whose input is the app's real
    // production input rather than a seam. The seam is the opposite one from
    // iOS: there the numbers are real and the delivery is faked; here the
    // delivery is real and the number is chosen.
    const applied = await page.evaluate((state) => {
      if (typeof window.__nativeKeyboard !== "function") {
        return { ok: false, why: "the app installed no __nativeKeyboard receiver" };
      }
      window.__nativeKeyboard(state);
      return { ok: true };
    }, plan.nativeKeyboard);
    if (!applied.ok) {
      throw new Error(
        `${label}: cannot put this page into ${plan.mode} — ${applied.why}. The receiver is ` +
        "installed by startKeyboardState, so its absence means the viewport owner never " +
        "started and the capture would photograph a page with no keyboard machinery at all",
      );
    }
  } else if (plan.resizeTo !== null) {
    await page.setViewportSize({ width: size.width, height: plan.resizeTo });
  } else {
    const applied = await page.evaluate((vvHeight) => {
      const vv = window.visualViewport;
      if (!vv) {
        return { ok: false, why: "this engine exposes no visual viewport at all" };
      }
      if (!Object.isExtensible(vv)) {
        return { ok: false, why: "this engine's visual viewport is frozen" };
      }
      try {
        // An own accessor on the instance, shadowing the prototype's. The
        // OBJECT stays the engine's own, which is what matters: the
        // listener keyboard-state.js registered is on this object, and the
        // event below is delivered to it by the engine's own dispatch.
        // Replacing `window.visualViewport` wholesale would strand that
        // listener on an object nothing ever fires at again, and the state
        // would pass by never running the app's code at all.
        Object.defineProperty(vv, "height", {
          configurable: true,
          enumerable: true,
          get: () => vvHeight,
        });
      } catch (e) {
        return { ok: false, why: `redefining its height threw ${String(e)}` };
      }
      if (vv.height !== vvHeight) {
        return { ok: false, why: `the override did not take — height still reads ${vv.height}` };
      }
      vv.dispatchEvent(new Event("resize"));
      return { ok: true };
    }, plan.overrideVisualHeight);

    if (!applied.ok) {
      throw new Error(
        `${label}: cannot put this engine into ${plan.mode} — ${applied.why}. The iOS ` +
        "keyboard fixture shadows visualViewport.height because no Playwright API moves " +
        "the visual viewport independently of the layout one; an engine that refuses the " +
        "shadow leaves this capture to the device pass rather than to a weaker assertion",
      );
    }
  }
  await settle(page, 700);

  const got = await viewportFacts(page);
  const facts =
    `innerHeight ${got.innerHeight} · visualViewport.height ${got.vvHeight} ` +
    `(offsetTop ${got.vvOffsetTop}) · --kb-inset ${got.kbInset}px · ` +
    `--kb-overlay ${got.kbOverlay}px · --app-height ${got.appHeight}px`;

  // THE TWO VIEWPORTS ARE THE MODE. Asserted here rather than left to each
  // caller because getting them wrong is silent in both directions: a
  // resizes-visual run that also resized the layout viewport photographs
  // Android's numbers under an iPhone filename, and a resizes-content run
  // whose resize did not take photographs a keyboard that is not up. 2px
  // for sub-pixel rounding, the same slack releaseHarnessKeyboard allows
  // --app-height.
  if (Math.abs(got.innerHeight - plan.innerHeight) > 2) {
    throw new Error(
      `${label}: the layout viewport is ${got.innerHeight}px, expected ${plan.innerHeight}px ` +
      `under ${plan.mode} — this is not the widget mode the fixture asked for. ${facts}`,
    );
  }
  if (got.vvHeight === null || Math.abs(got.vvHeight - plan.vvHeight) > 2) {
    throw new Error(
      `${label}: the visual viewport is ${got.vvHeight}px, expected ${plan.vvHeight}px ` +
      `under ${plan.mode}. ${facts}`,
    );
  }

  return { plan, measured: got, facts };
}

/**
 * Put the shell page into "keyboard up, caret in written text" — the state
 * both strips start from. Real input the whole way on the Android path: a
 * click to focus, real keystrokes for the writing, and the same viewport
 * shrink KEYBOARD uses, which is what isKeyboardOpen() reads.
 *
 * `mode` selects which platform's keyboard is raised, and defaults to the
 * one every caller but IOS_KEYBOARD_SHEET wants. See raiseKeyboard for
 * what the iOS path can and cannot claim.
 *
 * Asserts the band starts as the NAV ROW ALONE and then gains a strip above
 * it. That is the P1c lesson stated as a precondition: fourteen baselines
 * once passed every automated check while showing the wrong tree entirely,
 * and the thing that would have caught it is a state proving it changed
 * something. A capture of a bare nav row filed under "block-strip" is
 * exactly that failure in miniature.
 *
 * What it does NOT assert any more is that the nav row goes away. It never
 * should — see assertStripShape, where the opposite assertion is what let
 * the Galaxy A34 lockout through.
 */
async function shellStripSetup(page, label, mode = WIDGET_MODE.RESIZES_CONTENT) {
  const editor = page.locator(".ProseMirror").first();
  await editor.waitFor({ state: "visible" });

  const before = await stripState(page);
  if (before !== null) {
    throw new Error(
      `${label}: an editing strip is already in the slot at load — the capture could not ` +
      "be told apart from the load-time one, and would prove no keyboard ever opened",
    );
  }
  if (!(await page.locator(".shell-tabbar").count())) {
    throw new Error(
      `${label}: the slot holds neither the tab bar nor a strip at load — the shell did ` +
      "not boot, or the frame stopped reserving the slot",
    );
  }

  // The click first, and it is not politeness: computeKeyboardState gates
  // `isOpen` on a focused text field, so a keyboard raised over an
  // unfocused page publishes --kb-inset 0 and nothing below this happens.
  await editor.click();
  const raised = await raiseKeyboard(page, mode, label);

  // The keyboard arm, asserted before a single character is typed. This is
  // the seam that had never been exercised: keyboardOpen reaching ShellApp,
  // toolbarFor answering something other than "none", and ToolbarStrip
  // rendering it. If it fails here, both states below fail for one reason
  // with one message instead of two states failing on their own contents.
  const opened = await stripState(page);
  if (!opened) {
    throw new Error(
      `${label}: raising the keyboard put no strip above the nav row — keyboardOpen never ` +
      `reached ShellApp, so toolbarFor is still answering "none". ${raised.facts}`,
    );
  }
  // `undo`, since the visual pass took `keyboard-down` off the strip: it
  // is the block strip's last control and on no other strip, and unlike
  // `pin` it cannot be hidden by the caret's block (toolbar-state.js draws
  // that line — `undo` is dead, never absent).
  if (!opened.ids.includes("undo")) {
    throw new Error(
      `${label}: the slot opened onto [${opened.ids.join(",")}] — with a caret in text and ` +
      "no selection this must be the block strip, which ends in `undo`",
    );
  }

  await page.keyboard.type(SHELL_STRIP_LINE);
  await settle(page, 300);
  return raised;
}

/**
 * The assertions both strips share: it is the only thing in the slot, it is
 * one row, and it sits inside the shrunken viewport rather than under the
 * keyboard that shrank it.
 */
function assertStripShape(strip, label) {
  if (!strip) {
    throw new Error(
      `${label}: no .shell-toolbar-strip in the slot with the keyboard up — the slot is ` +
      "still the tab bar, so toolbarFor's editing rows never reached the screen",
    );
  }
  // THIS ASSERTION USED TO READ THE OTHER WAY, and that is how the lockout
  // shipped: a tab bar beside the strip was called a layering bug, so the
  // suite was green on exactly the arrangement the fix requires. The band is
  // two rows now — strip above, nav below — and navigation is not a thing a
  // keyboard belief may take away.
  if (!strip.tabbar) {
    throw new Error(
      `${label}: the nav row is gone from under the strip — the band is modal again, which ` +
      "is the Galaxy A34 lockout: no page, no memory, no settings, until the app restarts",
    );
  }
  if (!strip.nav) {
    throw new Error(`${label}: a .shell-tabbar exists but not inside .shell-slot-nav`);
  }
  if (strip.nav.top < strip.bottom) {
    throw new Error(
      `${label}: the nav row's top is at ${strip.nav.top}, above the strip's bottom edge at ` +
      `${strip.bottom} — the strip must be the UPPER row, so the nav stays anchored to the ` +
      "band's bottom and the tab does not move out from under a thumb mid-tap",
    );
  }
  if (strip.nav.height < 44) {
    throw new Error(
      `${label}: the nav row is ${strip.nav.height}px tall, under the 44px --tap floor`,
    );
  }
  if (strip.nav.bottom > strip.viewport) {
    throw new Error(
      `${label}: the nav row's bottom edge is at ${strip.nav.bottom} in a ${strip.viewport}px ` +
      "viewport — the keyboard is covering the one row that must always be reachable",
    );
  }
  if (strip.rows !== 1) {
    throw new Error(
      `${label}: the strip's buttons sit on ${strip.rows} rows — it wrapped. A strip with ` +
      "more controls than screen must SCROLL; a second row is chrome stacking vertically",
    );
  }
  // The whole reason the slot exists. The viewport here is what an open
  // soft keyboard leaves, so a strip whose bottom edge is past it is a strip
  // the keyboard is covering — the control you cannot reach without closing
  // the thing you are trying to keep open.
  if (strip.bottom > strip.viewport) {
    throw new Error(
      `${label}: the strip's bottom edge is at ${strip.bottom} in a ${strip.viewport}px ` +
      "viewport — the keyboard is covering it",
    );
  }
}

/**
 * Exactly these ids, exactly these dead. Written out here rather than
 * imported from toolbar-model.js on purpose: this is the caption on the
 * photograph, and a caption derived from the thing it describes cannot
 * disagree with it. A button that quietly comes alive — or quietly dies —
 * fails here, by name, instead of being absorbed into a pixel diff.
 */
function assertStripButtons(strip, label, expectedIds, expectedDisabled) {
  const ids = strip.ids.join(",");
  if (ids !== expectedIds.join(",")) {
    throw new Error(`${label}: strip renders [${ids}], expected [${expectedIds.join(",")}]`);
  }
  const dead = [...strip.disabled].sort().join(",");
  const wanted = [...expectedDisabled].sort().join(",");
  if (dead !== wanted) {
    throw new Error(
      `${label}: disabled controls are [${dead}], expected [${wanted}] — a control with no ` +
      "command must render dead, and one with a command must not",
    );
  }
}

/** The text the editor's document actually holds. Ground truth for the two
 *  P2c-2 states below, which type into two different places and each need
 *  to prove the keystrokes went where the state claims: the find query goes
 *  into a field and must leave the page ALONE, and the slash trigger goes
 *  into the page and must be there for the plugin to have seen it. */
async function docText(page) {
  return page.evaluate(
    () => (document.querySelector(".ProseMirror")?.textContent ?? "").trim(),
  );
}

/**
 * The find strip, read off the rendered DOM.
 *
 * `.shell-find-strip`, not `.shell-toolbar-strip`, and that difference is
 * the reason this reader exists rather than being a parameter on
 * `stripState`. Row 2 has its own renderer (FindStrip) because a text field
 * is not a button — so `stripState` returns null over an open find strip,
 * and a driver that reused it would have measured nothing and said so
 * quietly.
 *
 * `[data-button-id]`, not every button: `Field` renders its own `clear`
 * glyph as an id-less ToolbarButton once there is a value, and counting it
 * among the strip's controls would make a four-control FIND_STRIP look
 * five wide the moment somebody typed.
 */
async function findStripState(page) {
  return page.evaluate(() => {
    const strip = document.querySelector(".shell-find-strip");
    if (!strip) return null;
    const box = (el) => {
      const b = el.getBoundingClientRect();
      return {
        left: Math.round(b.left), right: Math.round(b.right),
        top: Math.round(b.top), bottom: Math.round(b.bottom),
        width: Math.round(b.width), height: Math.round(b.height),
      };
    };
    const rect = strip.getBoundingClientRect();
    const buttons = [...strip.querySelectorAll("[data-button-id]")];
    const wrap = strip.querySelector(".shell-field");
    const input = strip.querySelector(".shell-field-input");
    const count = strip.querySelector(".shell-find-count");
    return {
      ids: buttons.map((b) => b.dataset.buttonId),
      disabled: buttons.filter((b) => b.disabled).map((b) => b.dataset.buttonId),
      boxes: Object.fromEntries(buttons.map((b) => [b.dataset.buttonId, box(b)])),
      label: (count?.textContent ?? "").trim(),
      countBox: count ? box(count) : null,
      // The tappable target is the `.shell-field` card, not the bare input
      // inside it — that is what carries the 44px floor and what a thumb
      // lands on.
      field: wrap ? box(wrap) : null,
      value: input ? input.value : null,
      // The mode is unusable without this: find is opened from the header
      // with the keyboard DOWN, so the strip's own field is the only thing
      // that raises it, and an unfocused field is a search you cannot type.
      focused: !!input && document.activeElement === input,
      // 16px or the phone zooms the whole viewport on focus and every fixed
      // element is the wrong size until the user pinches back (Field's own
      // header). Read resolved, because --text-input is a max() of a token
      // that is 14px at the phone's --ui-scale.
      fontPx: input ? Math.round(parseFloat(getComputedStyle(input).fontSize)) : null,
      // FindStrip does not scroll — `overflow: hidden`, by design, so the
      // one typable thing in the mode cannot be scrolled off screen. The
      // cost of that choice is that an over-subscribed strip CLIPS instead,
      // silently, and `close` is last in the order: the mode's only exit is
      // the first thing a pixel too many would take away.
      scrollWidth: Math.round(strip.scrollWidth),
      clientWidth: Math.round(strip.clientWidth),
      top: Math.round(rect.top), bottom: Math.round(rect.bottom),
      left: Math.round(rect.left), right: Math.round(rect.right),
      height: Math.round(rect.height),
      viewport: window.innerHeight,
      // What else is in the slot. Row 2 outranks every row but an open
      // sheet, so any of these three alongside it is two things in one slot.
      tabbar: !!document.querySelector(".shell-tabbar"),
      toolbarStrip: !!document.querySelector(".shell-toolbar-strip"),
      suggestionStrip: !!document.querySelector(".shell-suggestion-strip"),
      // The search itself, on the page rather than in the strip. A count
      // that says "1 of 1" over a document with no highlight in it is a
      // strip reporting a search the editor never ran.
      marks: document.querySelectorAll(".find-match").length,
      activeMarks: document.querySelectorAll(".find-match-active").length,
    };
  });
}

/**
 * The suggestion strip, read off the rendered DOM. A third renderer, a
 * third reader, for the reason FindStrip needed the second one.
 *
 * `.slash-command-menu` is read here and nowhere else in this file. It is
 * the DESKTOP's floating menu, and §3 refuses it outright on the phone —
 * a refusal that had no producer until `95bfc854` passed
 * `floatingChrome={false}`, and no observer at all until this state,
 * because the element only exists while a trigger is live and no capture
 * in the suite had ever had one.
 */
async function suggestionStripState(page) {
  return page.evaluate(() => {
    const strip = document.querySelector(".shell-suggestion-strip");
    if (!strip) return null;
    const rect = strip.getBoundingClientRect();
    const chips = [...strip.querySelectorAll(".shell-toolbar-button")];
    return {
      labels: chips.map((c) => (c.textContent ?? "").trim()),
      // A chip cannot be dead by construction — the list and the command
      // table are the same list (suggestion-strip-model.js) — so this is
      // the assertion that the construction still holds.
      disabled: chips.filter((c) => c.disabled).map((c) => (c.textContent ?? "").trim()),
      rows: [...new Set(chips.map((c) => Math.round(c.getBoundingClientRect().top)))].length,
      // Every chip inside the strip's own box, measured. This strip DOES
      // scroll (unlike find's), so a chip outside the box is not
      // necessarily a bug — it is a fact about which chips this photograph
      // contains, and the driver turns it into one only for a query whose
      // whole answer fits.
      chipsInside: chips.filter((c) => {
        const b = c.getBoundingClientRect();
        return b.left >= rect.left - 1 && b.right <= rect.right + 1;
      }).length,
      scrollWidth: Math.round(strip.scrollWidth),
      clientWidth: Math.round(strip.clientWidth),
      top: Math.round(rect.top), bottom: Math.round(rect.bottom),
      height: Math.round(rect.height),
      viewport: window.innerHeight,
      tabbar: !!document.querySelector(".shell-tabbar"),
      toolbarStrip: !!document.querySelector(".shell-toolbar-strip"),
      findStrip: !!document.querySelector(".shell-find-strip"),
      floatingMenu: !!document.querySelector(".slash-command-menu"),
    };
  });
}

/**
 * What is true of any occupant of the STRIP ROW, whichever renderer drew it:
 * it is the only strip in there, and it sits inside the viewport the
 * keyboard left rather than under the keyboard that shrank it.
 *
 * The nav row is not among the things it may not share the band with. It is
 * the row underneath, always, and listing it here is how the band came to be
 * modal in the first place — see assertStripShape.
 *
 * The geometry half is the P2d lesson written as a precondition. Both
 * sheets asserted the right sheet, the right rows and the right height and
 * photographed a blank band, because nothing asserted WHERE the box was.
 * Presence is not visibility.
 */
function assertSlotOccupant(state, label, others) {
  if (state.bottom > state.viewport || state.top >= state.viewport) {
    throw new Error(
      `${label}: the strip's box is ${state.top}..${state.bottom} in a ${state.viewport}px ` +
      "viewport — the keyboard is covering the slot it is supposed to sit above",
    );
  }
  for (const [name, present] of Object.entries(others)) {
    if (present) {
      throw new Error(
        `${label}: ${name} is on screen alongside this strip — the slot is showing two ` +
        "things at once, which is the layering bug the single-slot rule exists to prevent",
      );
    }
  }
}

/**
 * The open sheet, read off the rendered DOM — the same discipline
 * stripState follows, and for the same reason. Sheet's detents, its
 * navstack claim and its replace-if-open branch are all unit-tested;
 * what has never been checked is whether any of it reaches a screen,
 * because until P2d the only thing that mounted a Sheet was the gallery.
 *
 * `--app-height` is read here rather than assumed to equal the viewport:
 * it is the number the half detent is a fraction OF (Sheet.svelte's
 * `height: calc(var(--app-height) * var(--detent-fraction))`), so
 * comparing the measured height against the viewport instead would be
 * asserting a coincidence rather than the rule.
 */
async function sheetState(page) {
  return page.evaluate(() => {
    const sheet = document.querySelector(".shell-sheet");
    if (!sheet) return null;
    const rect = sheet.getBoundingClientRect();
    const rows = [...sheet.querySelectorAll(".shell-row")];
    const appHeight = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--app-height"),
    );
    return {
      tag: sheet.dataset.sheet,
      detent: sheet.dataset.detent,
      labels: rows.map((r) => (r.querySelector(".shell-row-label")?.textContent ?? "").trim()),
      // Each row's value, and whether it is a CONTROL at all. `Row`
      // renders a real `<button>` only when it does something and a plain
      // `<div>` otherwise, so inertness is the element's own tag — and it
      // is the one property of the header's three sheets that a
      // photograph cannot carry at all: same label, no chevron on either
      // (a choice row draws none, row-kind.js), no line of its own on
      // either (RowGroup draws the lines), the same ink. A tap is the
      // only difference. `labels` above cannot see it, which is
      // why this is a second field rather than a richer first one — every
      // state written before P2f captions itself with labels alone and
      // none of them should have to change to say so.
      rows: rows.map((r) => ({
        label: (r.querySelector(".shell-row-label")?.textContent ?? "").trim(),
        value: (r.querySelector(".shell-row-value")?.textContent ?? "").trim(),
        inert: r.tagName.toLowerCase() !== "button",
      })),
      // Rows the half detent actually SHOWS, as opposed to rows the sheet
      // holds. `.shell-sheet-content` scrolls, so a row can exist and be
      // below the fold, and "seven rows" would otherwise read as a claim
      // about the picture that the picture does not make.
      visibleRows: rows.filter((r) => {
        const b = r.getBoundingClientRect();
        return b.top >= rect.top - 1 && b.bottom <= rect.bottom + 1;
      }).length,
      height: Math.round(rect.height),
      bottom: Math.round(rect.bottom),
      // The widest row against the sheet it sits in. A row wider than its
      // own sheet is a label the phone width has pushed off the edge —
      // legibility measured rather than left to the reader of the PNG.
      widestRow: Math.max(0, ...rows.map((r) => Math.round(r.getBoundingClientRect().width))),
      width: Math.round(rect.width),
      top: Math.round(rect.top),
      appHeight: Number.isFinite(appHeight) ? Math.round(appHeight) : null,
      // The number that decides where a fixed sheet's bottom edge lands.
      // Read here so the failure below can name its own cause instead of
      // reporting a rectangle and leaving the diagnosis to the reader.
      kbInset: Math.round(
        Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue("--kb-inset"),
        ) || 0,
      ),
      // The number `.shell-sheet` actually lifts by (`margin-bottom:
      // var(--kb-overlay, 0px)`), which is NOT the one above: --kb-inset
      // is the keyboard's height and --kb-overlay is the part of it the
      // layout viewport did not already take. They are 479 and 0 in every
      // Android capture and equal in every iOS one, and reading only the
      // first is how a lift of the wrong size reads as a lift of the right
      // one.
      kbOverlay: Math.round(
        Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue("--kb-overlay"),
        ) || 0,
      ),
      // The cap on a detent's height (Sheet's `max-height: calc(
      // var(--app-height) - var(--safe-top))`). It binds on nothing at the
      // half detent and could bind at full on a device with a status bar,
      // so it is read rather than assumed to be zero — the same rule
      // --app-height above follows.
      safeTop: Math.round(
        Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue("--safe-top"),
        ) || 0,
      ),
      // The fields a sheet holds. Two of the shell's sheets have one, and
      // a field is not a `.shell-row`, so `labels` above cannot see it: a
      // sheet whose field failed to render would otherwise pass every row
      // assertion and photograph a list where the writer expected to type.
      fields: [...sheet.querySelectorAll(".shell-field-input")].map((input) => ({
        placeholder: input.placeholder ?? "",
        label: input.getAttribute("aria-label") ?? "",
        value: input.value,
        focused: document.activeElement === input,
      })),
      // Does the sheet's own scroller have anything left to scroll.
      // `.shell-sheet-content` is `overflow-y: auto`, so a body that
      // outgrows its detent silently becomes a scroll — and a photograph
      // of a scrolled sheet is indistinguishable from a photograph of one
      // that fits, because the part that did not make it is simply not in
      // the frame. The two builders below are what this is for: both take
      // the FULL detent precisely because their bodies do not fit half of
      // one, and "it fits" is the claim that choice was making.
      content: (() => {
        const c = sheet.querySelector(".shell-sheet-content");
        if (!c) return null;
        return { clientHeight: c.clientHeight, scrollHeight: c.scrollHeight };
      })(),
      viewport: window.innerHeight,
      // The VISUAL viewport beside the layout one, because under
      // resizes-visual they are different numbers and only this pair says
      // which part of the layout viewport the user can see. Read for every
      // sheet rather than only the iOS one so a reader of a failure gets
      // both numbers whichever mode produced it; see assertSheetShape's
      // note on what its own `viewport` check can and cannot catch.
      vvHeight: window.visualViewport ? Math.round(window.visualViewport.height) : null,
      vvOffsetTop: window.visualViewport ? Math.round(window.visualViewport.offsetTop) : null,
      strip: !!document.querySelector(".shell-toolbar-strip"),
      tabbar: !!document.querySelector(".shell-tabbar"),
    };
  });
}

/**
 * What a photograph of an open sheet has to be true of, whichever sheet it
 * is: it is the sheet that was asked for, the slot behind it is EMPTY
 * rather than reserved, it is half the app's height, and it ends inside
 * the viewport the keyboard left rather than under the keyboard.
 *
 * The emptied slot is the claim P2c could not make. `toolbarFor`'s row 1
 * returns `strip: "none"` on `sheetOpen`, and until this phase `sheetOpen`
 * had no producer at all, so nothing had ever observed `hasSlot` going
 * false. Asserting BOTH `.shell-toolbar-strip` and `.shell-tabbar` are
 * gone is deliberate: the tab bar is what the slot falls back to whenever
 * the keyboard closes, so a sheet that dropped the keyboard on its way up
 * would leave a tab bar behind it and still look like a sheet in the PNG.
 */
function assertSheetShape(sheet, label, tag, detent = "half") {
  if (!sheet) {
    throw new Error(
      `${label}: no .shell-sheet on screen — the tap never opened a sheet, so this would ` +
      "have been a photograph of the strip it was taken from",
    );
  }
  if (sheet.tag !== tag) {
    throw new Error(
      `${label}: the open sheet is "${sheet.tag}", expected "${tag}" — one tap opened the ` +
      "other sheet, and the two are told apart only by their rows in the image",
    );
  }
  if (sheet.strip || sheet.tabbar) {
    throw new Error(
      `${label}: the slot still holds ${sheet.strip ? "an editing strip" : "the tab bar"} ` +
      "behind the sheet — toolbarFor's `sheetOpen` row never fired, so the slot is " +
      "reserved under a sheet that owns the bottom of the display",
    );
  }
  if (sheet.detent !== detent) {
    throw new Error(
      `${label}: the sheet is at the "${sheet.detent}" detent, expected "${detent}"`,
    );
  }
  // Measured, not declared. `data-detent` is an attribute the host passes
  // in and says nothing about the height the browser actually resolved —
  // the whole point of §3 naming a half detent is that the sheet leaves
  // the page visible above it, and of the trail sheet taking full is that
  // it does not. 2px for sub-pixel rounding, no more.
  //
  // The fractions are written out here rather than imported from
  // Sheet.svelte's DETENT_FRACTION, for the reason assertStripButtons
  // gives: a caption derived from the thing it describes cannot disagree
  // with it. The `max-height` cap is applied because Sheet applies it, and
  // at 0.92 on a device with a status bar it is the number that decides.
  const app = sheet.appHeight ?? sheet.viewport;
  const wanted = Math.round(
    Math.min(app * (detent === "full" ? 0.92 : 0.5), app - (sheet.safeTop ?? 0)),
  );
  if (Math.abs(sheet.height - wanted) > 2) {
    throw new Error(
      `${label}: the sheet is ${sheet.height}px tall against a ${sheet.appHeight}px ` +
      `--app-height (--safe-top ${sheet.safeTop}px) — a ${detent} detent is ${wanted}px, ` +
      "so this is not the detent it claims",
    );
  }
  // WHERE the sheet is, not just how tall. Two failures, one check: a
  // bottom edge past the viewport is the keyboard covering the rows
  // nearest the thumb, and a box entirely outside it is a sheet that is
  // not on screen at all — which is what a passing suite and a blank
  // photograph looked like together, and is the P1c failure in miniature.
  //
  // IT FAILED WHEN IT WAS WRITTEN, ON A DEFECT AND NOT ON THE HARNESS, and
  // that is history now rather than the present tense this comment used to
  // claim. `.shell-sheet` was `position: fixed; bottom: 0` plus
  // `margin-bottom: var(--kb-inset)` while index.html asks for
  // `interactive-widget=resizes-content` — so the soft keyboard shrank the
  // LAYOUT viewport, `bottom: 0` was already keyboard-clear before the
  // margin was added, and the margin lifted the sheet a second full
  // keyboard-height off the top of the screen (y -299..-119 in a 360px
  // viewport). The same double-count caret-visible.js's header forbids for
  // a measured band. Sheet.svelte now reads `var(--kb-overlay, 0px)`
  // instead, which is 0 under resizes-content and the keyboard's height
  // under resizes-visual, and block-sheet recorded its baseline on that
  // commit. ShellRoot's note that a fixed surface "has to re-supply the
  // offset itself" was true only under resizes-visual (iOS), and it has
  // been corrected there too.
  //
  // TWO EDGES, TWO CHECKS, and they are not the same number on every
  // platform. The top edge is measured against the top of the layout
  // viewport, because a box above y=0 is above the screen in any widget
  // mode. The bottom edge is measured against the VISIBLE band
  // (visibleBand, src/lib/vr/keyboard-viewport.js), which is the layout
  // viewport under resizes-content and only the top of it under
  // resizes-visual. Reading `sheet.viewport` for the bottom edge — which
  // this check did until the iOS fixture landed — is correct on Android
  // and vacuous on iOS: there a sheet whose lift resolved to 0 sits flat
  // on the full-height layout viewport, entirely behind the keyboard, and
  // `bottom > innerHeight` is false for it. That case is unit-tested by
  // name in keyboard-viewport.test.js and photographed by
  // IOS_KEYBOARD_SHEET.
  if (sheet.top < 0) {
    throw new Error(
      `${label}: the sheet's box is ${sheet.top}..${sheet.bottom} in a ${sheet.viewport}px ` +
      `layout viewport, with --kb-inset at ${sheet.kbInset}px — its top edge is off the ` +
      "top of the screen. A fixed `bottom: 0` under interactive-widget=resizes-content is " +
      "already above the keyboard, so lifting it by the keyboard's height subtracts the " +
      "same keyboard twice",
    );
  }
  const band = visibleBand({
    innerHeight: sheet.viewport,
    vvHeight: sheet.vvHeight,
    vvOffsetTop: sheet.vvOffsetTop,
    // The app's own answer for the band, which is the only one that is right
    // in all three modes — under native-ime neither viewport moves, so
    // vvHeight is the full display and the band read without this says a
    // sheet entirely behind the keyboard is on screen. Equal to vvHeight in
    // the two modes that resize, so it changes no existing capture.
    appHeight: sheet.appHeight,
  });
  const offScreen = offScreenReason({ top: sheet.top, bottom: sheet.bottom }, band);
  if (offScreen) {
    throw new Error(
      `${label}: ${offScreen} (layout viewport ${sheet.viewport}px, visual viewport ` +
      `${sheet.vvHeight}px at offset ${sheet.vvOffsetTop}px, --kb-inset ${sheet.kbInset}px) ` +
      "— it is not where it can be seen",
    );
  }
  if (sheet.widestRow > sheet.width) {
    throw new Error(
      `${label}: a row is ${sheet.widestRow}px wide inside a ${sheet.width}px sheet — a ` +
      "label is off the edge at phone width",
    );
  }
}

/**
 * Exactly these rows, in this order. The caption on the photograph, written
 * out here rather than imported from block-sheet-model.js or ShellApp's
 * INSERT_ROWS, for the reason assertStripButtons gives: a caption derived
 * from the thing it describes cannot disagree with it. A row that quietly
 * appears — or one that quietly goes — fails here, by name.
 */
function assertSheetRows(sheet, label, expected) {
  const got = sheet.labels.join(" | ");
  if (got !== expected.join(" | ")) {
    throw new Error(
      `${label}: the sheet offers [${got}], expected [${expected.join(" | ")}]`,
    );
  }
}

/**
 * Exactly these rows are INERT, carrying exactly these values.
 *
 * The header's three sheets each name at least one row the writer is
 * already looking at — `showing`, `this page` — and one of them also names
 * a trail the shell refuses to assign into (`living doc`,
 * trail-sheet-model.js's whole argument). `Row` says all of that by
 * rendering a `<div>` rather than a `<button>`, and that difference does
 * not survive a screenshot: a choice row draws no chevron either
 * (row-kind.js), neither draws a line of its own, and nothing else
 * changes. Without
 * this, a sheet whose every row became tappable — offering to "open" the
 * day already open, or to merge a page into a living document — would
 * photograph identically to the correct one.
 *
 * The values are asserted alongside, because they are the words that
 * EXPLAIN the inertness on screen. A row that went inert and lost its
 * value would read as a broken row rather than as a fact.
 */
function assertInertRows(sheet, label, expected) {
  const shown = (r) => `${r.label} · ${r.value || "(no value)"}`;
  const got = sheet.rows.filter((r) => r.inert).map(shown).join(" | ");
  const want = expected.map(([l, v]) => `${l} · ${v || "(no value)"}`).join(" | ");
  if (got !== want) {
    throw new Error(
      `${label}: the inert rows are [${got}], expected [${want}] — a row that names what is ` +
      "already on screen must not offer a tap, and a row that offers one must not be dead; " +
      "neither difference is visible in the image",
    );
  }
}

/**
 * The screen on TOP of the stack, read off the rendered DOM. The fourth
 * reader in this file, and the first that is about a screen rather than
 * about the slot or an overlay.
 *
 * IT IS SCOPED TO `[data-top="true"]`, and that is the whole reason it
 * exists rather than a document-wide query. Stack keeps the top TWO
 * entries mounted in one grid cell (`live = entries.slice(-2)`), so with
 * the pins screen pushed over the page root a bare
 * `document.querySelectorAll(".shell-row")` also matches whatever the
 * screen underneath is rendering — and a caption counting rows from a
 * screen the photograph does not show is exactly the P2d failure with a
 * different subject. `data-top` is Stack's own answer to which entry is in
 * front; nothing here re-derives it.
 *
 * What it reads that no unit test can: every box. `Row`'s 44px floor, the
 * back control's target, the segment's height, whether a label is clipped
 * at 412px and whether the field sits inside the nav band or has scrolled
 * into the list — all of them are scoped-stylesheet facts, and jsdom
 * applies no scoped stylesheet.
 */
async function screenState(page) {
  return page.evaluate(() => {
    const box = (el) => {
      const b = el.getBoundingClientRect();
      return {
        top: Math.round(b.top), bottom: Math.round(b.bottom),
        left: Math.round(b.left), right: Math.round(b.right),
        width: Math.round(b.width), height: Math.round(b.height),
      };
    };
    const stack = document.querySelector(".shell-stack");
    const top = document.querySelector('.shell-stack-entry[data-top="true"]');
    if (!top) return null;
    const nav = top.querySelector(".shell-screen-nav");
    const bar = top.querySelector(".shell-navbar");
    const band = top.querySelector(".shell-screen-content");
    const back = top.querySelector(".shell-navbar-back");
    const rows = [...top.querySelectorAll(".shell-row")];
    const tab = document.querySelector('.shell-tab[aria-current="page"]');
    return {
      // Stack's own bookkeeping. `depth` is entries.length, so 1 is a root
      // alone and 2 is one pushed screen — which is also the number
      // Stack's own `start()` gate reads before it will arm an edge back.
      depth: Number(stack?.dataset.depth ?? 0),
      liveEntries: document.querySelectorAll(".shell-stack-entry").length,
      topId: top.dataset.entry ?? null,
      title: (top.querySelector(".shell-navbar-title")?.textContent ?? "").trim(),
      subtitle: (top.querySelector(".shell-navbar-subtitle")?.textContent ?? "").trim(),
      // The way out, and the reason this reader measures rather than
      // counts: it is a single glyph in a 44px box on a 412px frame.
      back: back ? { ...box(back), label: back.getAttribute("aria-label") ?? "" } : null,
      navBox: nav ? box(nav) : null,
      barBox: bar ? box(bar) : null,
      actions: [...top.querySelectorAll(".shell-navbar-action")].map((b) => ({
        label: (b.textContent ?? "").trim(),
        ...box(b),
      })),
      band: band
        ? {
            ...box(band),
            region: band.dataset.shellRegion ?? null,
            scrollTop: Math.round(band.scrollTop),
            clientHeight: band.clientHeight,
            scrollHeight: band.scrollHeight,
          }
        : null,
      rows: rows.map((r) => {
        const label = r.querySelector(".shell-row-label");
        return {
          label: (label?.textContent ?? "").trim(),
          value: (r.querySelector(".shell-row-value")?.textContent ?? "").trim(),
          // `Row` renders a real <button> only when it does something —
          // the one property of a list of rows that a screenshot cannot
          // carry at all. Same field `sheetState` reads, same reason.
          inert: r.tagName.toLowerCase() !== "button",
          // What the row says it is (row-kind.js), and whether it drew the
          // chevron. Only a push gets one; a choice row or an action row
          // with a chevron is the wart the visual pass removed, and at a
          // 0.002 gate a single glyph at the row's end is not something
          // the pixels can be trusted to report.
          kind: r.dataset.kind ?? null,
          chevron: !!r.querySelector(".shell-row-chevron"),
          // A label the phone width pushed off its own end. `.shell-row-label`
          // is `flex: 1 1 auto; min-width: 0`, so it SHRINKS rather than
          // overflowing the row — which means a clipped label is invisible
          // in the row's box and visible only here.
          clipped: !!label && label.scrollWidth > label.clientWidth + 1,
          ...box(r),
        };
      }),
      // Rows the band actually SHOWS, as opposed to rows the screen holds
      // — `sheetState`'s `visibleRows`, on a scroller. A list longer than
      // the band photographs identically to one that fits, because the
      // part that did not make it is simply not in the frame, so "eleven
      // rows" is a claim about the screen and this is the claim about the
      // picture.
      rowsInBand: band
        ? rows.filter((r) => {
            const b = r.getBoundingClientRect();
            const c = band.getBoundingClientRect();
            return b.top >= c.top - 1 && b.bottom <= c.bottom + 1;
          }).length
        : 0,
      // Every radiogroup on the screen, with which segment is lit. The
      // shell has no segmented control of its own (§2's open question,
      // answered in P3 Task 3 by reusing the desktop's), so this reads the
      // desktop primitive's markup on purpose.
      segments: [...top.querySelectorAll('[role="radiogroup"]')].map((g) => ({
        ariaLabel: g.getAttribute("aria-label") ?? "",
        ...box(g),
        options: [...g.querySelectorAll('[role="radio"]')].map((b) => ({
          label: (b.textContent ?? "").trim(),
          checked: b.getAttribute("aria-checked") === "true",
          ...box(b),
        })),
      })),
      fields: [...top.querySelectorAll(".shell-field-input")].map((input) => ({
        label: input.getAttribute("aria-label") ?? "",
        placeholder: input.placeholder ?? "",
        value: input.value,
        focused: document.activeElement === input,
        // 16px or the phone zooms the whole viewport on focus (Field's own
        // header). Resolved, because --text-input is a max() of a token.
        fontPx: Math.round(parseFloat(getComputedStyle(input).fontSize)),
        ...box(input.closest(".shell-field") ?? input),
      })),
      // Every toggle on the screen. `Row`'s toggle variant renders an inert
      // `.shell-row` wrapping `src/lib/ui/Toggle.svelte`, so the `rows`
      // reader above sees the row and CANNOT see the control: a toggle row
      // has no `.shell-row-value`, which makes it indistinguishable there
      // from a label with nothing beside it. Whether the switch is on is
      // also the one thing a photograph is worst at — two states of a 28px
      // track differing in a thumb position and a fill.
      toggles: [...top.querySelectorAll(".toggle input[type=checkbox]")].map((el) => ({
        label: el.getAttribute("aria-label") ?? "",
        checked: el.checked,
        ...box(el.closest(".toggle") ?? el),
      })),
      // The timeline's day labels, its trail headers, and the pages-mode
      // group headings. Since the visual pass (Task 9) the day is an
      // `Eyebrow` beside the dot and a pages-mode heading is the
      // RowGroup's eyebrow, so both are `.shell-eyebrow` and are told
      // apart by where they sit; neither is a row, so `rows` above cannot
      // see them, and they are what says WHEN the writing under them is.
      // The trail header IS a row — an inert `Row` outside any group, the
      // trail index's own header row shape — so `rows` sees it too, and
      // this reader is what says which of those rows are trails.
      dayLabels: [...top.querySelectorAll(".memory-day-head .shell-eyebrow")].map((el) =>
        (el.textContent ?? "").trim(),
      ),
      trailNames: [...top.querySelectorAll(".memory-trail-name")].map((el) =>
        (el.textContent ?? "").trim(),
      ),
      headings: [...top.querySelectorAll(".shell-row-group > .shell-eyebrow")].map((el) =>
        (el.textContent ?? "").trim(),
      ),
      // Whether the screen fell through to an empty state. Read by NAME so
      // "the list is empty" and "the list is missing" are different
      // failures — a screen whose fetch never landed photographs as a
      // tidy, wrong picture otherwise.
      empty: (top.querySelector(".empty-title")?.textContent ?? "").trim() || null,
      // The reading view's static prose, and the two things that would
      // mean it is not static. `.ProseMirror` is the editor's own root and
      // `[contenteditable="true"]` is the property a cursor hangs off; §2
      // asks for a reading view, and "not editable" as a CONSTRUCTION is
      // checkable in a way that a gate answering false is not. Read across
      // the whole document rather than the top entry, because a live
      // editor mounted on the screen UNDERNEATH is still a second
      // ProseMirror on the device with the least room for one.
      prose: (() => {
        const el = top.querySelector(".prose");
        return el ? { ...box(el), text: (el.textContent ?? "").trim() } : null;
      })(),
      // The head under the bar on the two reading surfaces (Task 7): the
      // desktop's `.modal-head` / `.pv-matters` anatomy as shell
      // primitives. `heading` is the `Title` (a pin's first line, a page's
      // focus line), `eyebrow` the kind over it on the pin view, `chip`
      // the trail, `provenance` the mono line of facts — each read by its
      // primitive's class, because the claim is that these are TEXT under
      // the bar and not rows in the list `rows` above reads.
      heading: (top.querySelector(".shell-title")?.textContent ?? "").trim() || null,
      eyebrow: (top.querySelector(".shell-eyebrow")?.textContent ?? "").trim() || null,
      chip: (top.querySelector(".shell-chip")?.textContent ?? "").trim() || null,
      // The subject's own line as a FIELD (TitleField, the second device
      // pass): the page's focus line, a pin's name. Read separately from
      // `fields` because it is not a Field — no box, no clear glyph —
      // and a photograph of a Field where a title should be is the
      // regression this distinguishes.
      titleField: (() => {
        const el = top.querySelector(".shell-title-field");
        return el ? { value: el.value, placeholder: el.getAttribute("placeholder") ?? "" } : null;
      })(),
      provenance: (top.querySelector(".shell-provenance")?.textContent ?? "").trim() || null,
      // Every note on the screen, in order. A `Note` is a <p>, so `rows`
      // cannot see it — and on the reading view that is the point.
      notes: [...top.querySelectorAll(".shell-note")].map((el) =>
        (el.textContent ?? "").trim(),
      ),
      // The card the writing sits in, and whether the prose is INSIDE it.
      // A screen that drew the card beside the prose would photograph
      // an empty raised box and a column of text on the canvas.
      card: (() => {
        const el = top.querySelector(".shell-card");
        return el ? { ...box(el), holdsProse: !!el.querySelector(".prose") } : null;
      })(),
      editors: document.querySelectorAll(".ProseMirror").length,
      editables: document.querySelectorAll('[contenteditable="true"]').length,
      // The bottom band. `toolbarFor`'s row 1 gives a pushed screen
      // `strip: "none"`, which makes `hasSlot` false and stops the frame
      // RESERVING the band at all — so the element's absence is the claim,
      // and it photographs identically to a slot whose contents failed.
      slot: !!document.querySelector(".shell-slot"),
      tabbar: !!document.querySelector(".shell-tabbar"),
      activeTab: tab ? (tab.textContent ?? "").trim() : null,
      strip: !!document.querySelector(".shell-toolbar-strip"),
      findStrip: !!document.querySelector(".shell-find-strip"),
      sheet: document.querySelector(".shell-sheet")?.dataset.sheet ?? null,
      // The floor every control in this tree is measured against — the
      // device's number, not this file's, because `--tap` is
      // `max(var(--touch-target), 44px)` and --touch-target scales with
      // --ui-scale.
      //
      // READ OFF A CONTROL, not off the custom property. `getPropertyValue`
      // on an unregistered custom property hands back the token sequence
      // after variable substitution — `max(44px, 44px)` — and `parseFloat`
      // of that is NaN, which would silently floor every assertion below
      // at 0. `min-height` is a real property, so its computed value is
      // resolved to pixels. The 44 at the end is the spec's own floor and
      // is unreachable while either element exists.
      tap: (() => {
        const of = (el) =>
          el ? Math.round(parseFloat(getComputedStyle(el).minHeight)) || 0 : 0;
        return of(back) || of(rows[0]) || 44;
      })(),
      viewport: window.innerHeight,
      viewportWidth: window.innerWidth,
    };
  });
}

/**
 * What every PUSHED screen has to be true of: it is on top of a stack two
 * deep, it carries a way back that a thumb can hit, and the frame is not
 * reserving a bottom band behind it.
 *
 * The back control is measured rather than counted, and that is this
 * helper's whole reason. At the 0.002 gate a 44px square is ~0.001 of a
 * 412×915 frame, so it can shrink, move, or vanish outright with the
 * baseline still green — which P2c-2 watched happen to a control exactly
 * this size. It is also the ONLY way off a pushed screen that does not
 * require a gesture: §2 gives the bottom slot to nothing here, so there is
 * no tab bar to fall back to, and the edge drag is a redundant shortcut
 * (Stack's own header) rather than the door.
 *
 * The absent slot is asserted for the opposite reason: nothing is what
 * SHOULD be there, and "nothing" is what a failure to render also looks
 * like. Naming `.shell-slot`, `.shell-tabbar` and `.shell-toolbar-strip`
 * separately means a slot that came back with a tab bar in it fails
 * differently from one that came back empty.
 *
 * `depth` DEFAULTS TO 2 and is passed only by the sync stack. Two was the
 * only answer a pushed screen could give until P4: everything before it is
 * one root plus one push. Sync is three deep (devices → pair → scanner) on
 * top of the settings root, and `Stack.entries.length` keeps counting even
 * though only the top two are mounted — so a caller down there has to say
 * which floor it is on, or the check would have to be dropped for the four
 * screens that most need it.
 */
function assertPushedScreen(state, label, title, depth = 2) {
  if (!state) {
    throw new Error(`${label}: no stack entry is on top — the shell rendered no screen at all`);
  }
  if (state.depth !== depth) {
    throw new Error(
      `${label}: the stack is ${state.depth} deep, expected ${depth} — one root and ` +
      `${depth - 1} pushed screen(s). At 1 nothing was pushed and this is a photograph of ` +
      "the root; at fewer than expected a tap somewhere above landed on the wrong row",
    );
  }
  if (state.title !== title) {
    throw new Error(
      `${label}: the top screen's bar reads "${state.title}", expected "${title}" — the tap ` +
      "pushed some other screen, and two pushed screens are told apart only by their rows",
    );
  }
  if (!state.back || state.back.label !== "back") {
    throw new Error(
      `${label}: the nav bar carries no labelled back control — a pushed screen has no tab ` +
      "bar behind it (toolbarFor row 1), so this is the only way out that is not a gesture",
    );
  }
  if (state.back.width < state.tap || state.back.height < state.tap) {
    throw new Error(
      `${label}: the back control is ${state.back.width}×${state.back.height} against a ` +
      `${state.tap}px floor — a single glyph in a box a thumb misses`,
    );
  }
  if (state.back.top < 0 || state.back.left < 0 || state.back.right > state.viewportWidth) {
    throw new Error(
      `${label}: the back control's box is ${state.back.left}..${state.back.right} × ` +
      `${state.back.top}.. in a ${state.viewportWidth}px viewport — it is off the frame`,
    );
  }
  if (state.slot || state.tabbar || state.strip) {
    throw new Error(
      `${label}: the frame is still showing ` +
      `${state.tabbar ? "the tab bar" : state.strip ? "an editing strip" : "a reserved slot"} ` +
      "under a pushed screen — toolbarFor's row 1 answers `strip: \"none\"` on `pushedScreen`, " +
      "so the band should not be reserved at all",
    );
  }
}

/**
 * Every row on the screen is legible at this width: inside the frame, tall
 * enough to hit, and not cut off at its own end.
 *
 * The clipping half is what a photograph cannot report. `.shell-row-label`
 * is `flex: 1 1 auto; min-width: 0`, so a label too long for the row
 * SHRINKS — the row's box stays perfect and the words go missing inside
 * it, which reads in a PNG as a shorter label rather than as a truncated
 * one. Pin titles and a page's own focus line are both writer-supplied and
 * arbitrarily long, so this is the check the two list screens need most.
 */
function assertRowsLegible(state, label) {
  for (const row of state.rows) {
    if (row.height < state.tap) {
      throw new Error(
        `${label}: the row "${row.label}" is ${row.height}px tall against a ${state.tap}px ` +
        "floor — Row's min-height stopped applying",
      );
    }
    if (row.left < 0 || row.right > state.viewportWidth) {
      throw new Error(
        `${label}: the row "${row.label}" spans ${row.left}..${row.right} in a ` +
        `${state.viewportWidth}px viewport — it is off the frame`,
      );
    }
    if (row.clipped) {
      throw new Error(
        `${label}: the row label "${row.label}" is cut off at ${state.viewportWidth}px — the ` +
        "label shrinks rather than overflowing, so this is invisible in the image",
      );
    }
  }
}

/** Exactly these rows, in this order, with exactly these values — the
 *  screen's version of `assertSheetRows` plus `assertInertRows` in one
 *  pass, because on a screen the value column IS the subject (the trail
 *  index's `showing` against a mode, memory's trail name beside a page). */
function assertScreenRows(state, label, expected) {
  const shown = (r) => `${r.label} · ${r.value || "(no value)"}`;
  const got = state.rows.map(shown).join(" | ");
  const want = expected.map(([l, v]) => `${l} · ${v || "(no value)"}`).join(" | ");
  if (got !== want) {
    throw new Error(`${label}: the screen lists [${got}], expected [${want}]`);
  }
}

/**
 * Memory, reached the way a writer reaches it: a real tap on the tab bar.
 *
 * Shared by the four states that start there — memory itself, its filter
 * sheet, the reading view and the trail index — so the root switch is
 * performed once and by one path. That matters more here than convenience:
 * `goRoot` is what drops the push stack AND what re-reads the archive, so
 * a driver that reached memory some other way would photograph a list the
 * boot left lying around rather than one this tap caused.
 *
 * It asserts the page root was really on screen first, for
 * `shellPageAtRest`'s reason: a switch that changed nothing is
 * indistinguishable from a switch that never happened.
 */
async function goToShellMemory(page, label) {
  await shellPageAtRest(page, label);

  const tab = page.locator('.shell-tab[data-tab-id="memory"]');
  await tab.waitFor({ state: "visible" });
  await tab.tap();
  // The list is three fetches deep (`getThread`, `getLineages`, then a
  // `getPins` per lineage plus the global one), so the arrival is waited
  // ON rather than settled for: the timeline only exists once the pages
  // land, and a fixed wait long enough for the slow side would be a
  // guess on the fast one.
  await page
    .locator(".memory-day-head .shell-eyebrow")
    .first()
    .waitFor({ state: "visible", timeout: 10000 });
  await settle(page, 400);

  const state = await screenState(page);
  if (!state || state.title !== "memory") {
    throw new Error(
      `${label}: the tab bar tap left "${state?.title ?? "(no screen)"}" on top, expected ` +
      '"memory" — goRoot never ran, so everything below photographs the page root',
    );
  }
  if (!state.tabbar || state.activeTab !== "memory") {
    throw new Error(
      `${label}: the tab bar is ${state.tabbar ? `current on "${state.activeTab}"` : "gone"} ` +
      "after the switch — memory is a ROOT, so toolbarFor's `space` row must answer `tab-bar`",
    );
  }
  return state;
}

/**
 * Settings, reached the way a writer reaches it: a real tap on the third
 * tab.
 *
 * `goToShellMemory`'s shape and its argument, on the other root. The switch
 * is what makes the list on screen a fetch this tap caused — `goRoot` calls
 * `loadSettings()` on arrival, which reads the labs flag and the sync
 * status — rather than a list the boot left lying around. Settings is
 * additionally the root NOTHING loads at boot, so without the tap there is
 * no state here at all.
 *
 * Shared by all six states that start here: the root, its two sections, and
 * the three levels of the sync stack.
 */
async function goToShellSettings(page, label) {
  await shellPageAtRest(page, label);

  const tab = page.locator('.shell-tab[data-tab-id="settings"]');
  await tab.waitFor({ state: "visible" });
  await tab.tap();
  // Waited ON rather than settled for, `goToShellMemory`'s reason: the
  // root's value column carries two round trips' worth of answers (the labs
  // flag, the sync status), and a fixed wait long enough for the slow side
  // is a guess on the fast one. The bar's own title is what says the switch
  // landed.
  await page
    .locator('.shell-navbar-title:text-is("settings")')
    .waitFor({ state: "visible", timeout: 10000 });
  await settle(page, 400);

  const state = await screenState(page);
  if (!state || state.title !== "settings") {
    throw new Error(
      `${label}: the tab bar tap left "${state?.title ?? "(no screen)"}" on top, expected ` +
      '"settings" — goRoot never ran, so everything below photographs the page root',
    );
  }
  if (state.depth !== 1) {
    throw new Error(
      `${label}: the stack is ${state.depth} deep on arrival at a ROOT — goRoot drops the ` +
      "push stack, so anything above 1 means the switch left a pushed screen behind it",
    );
  }
  if (!state.tabbar || state.activeTab !== "settings") {
    throw new Error(
      `${label}: the tab bar is ${state.tabbar ? `current on "${state.activeTab}"` : "gone"} ` +
      "after the switch — settings is a ROOT, so toolbarFor's `space` row must answer " +
      "`tab-bar`",
    );
  }
  if (state.back) {
    throw new Error(
      `${label}: the settings root carries a back control — Stack registers no navstack ` +
      "entry for its first element, so back at a root belongs to the OS and a button here " +
      "offers what the gesture and the system button both correctly refuse",
    );
  }
  return state;
}

/**
 * Tap one row of the screen on top of the stack, by the label a reader of
 * the photograph would tap.
 *
 * `tapSheetRow`'s shape, scoped to `[data-top="true"]` rather than to a
 * sheet tag — and the scoping is the whole reason it is not the same
 * function. Stack keeps the top TWO entries mounted in one grid cell, so an
 * unscoped `.shell-row` matches the screen underneath as well: from the
 * settings root the word `sync` would also match nothing, but from the
 * devices screen `sync` matches its own state row AND anything the settings
 * root beneath it still holds. Found by exact label rather than index for
 * `tapSheetRow`'s reason: a driver keyed on position keeps passing while
 * opening the wrong screen.
 */
async function tapScreenRow(page, label) {
  const row = page
    .locator('.shell-stack-entry[data-top="true"] .shell-row')
    .filter({ has: page.locator(`.shell-row-label:text-is("${label}")`) });
  await row.waitFor({ state: "visible" });
  await row.tap();
}

/**
 * The prose the sync stack puts on screen, and the state of the camera it
 * ends in.
 *
 * A reader of its own because none of it is a row. `syncStateNote`,
 * `pairPrompt` and `scannerNote` each render through `Note` — a sentence
 * to read rather than a label to scan, in the prose face — and
 * `screenState`'s `rows` cannot see any of them. Nor can it see QrScanner,
 * which is a borrowed desktop component with its own markup entirely.
 *
 * THE NOTES ARE READ FROM THE TOP ENTRY, BY TONE. Every sentence in the
 * sync stack is the same `.shell-note` since the visual pass — so is the
 * labs section's note one screen down, and a sheet's greeting — so an
 * unscoped read would hand back whichever rendered first. The top entry
 * is the screen being photographed; on the pair screen the prompt is the
 * note in plain ink and the error is the warm one, and on the scanner the
 * sentence sits inside `.scan-band`, the band the preview owns.
 *
 * THE DESKTOP'S TEXT IS STILL READ ACROSS THE WHOLE DOCUMENT, and
 * deliberately: the claim `sync-scan-refused` exists to make is that the
 * DESKTOP's error text is nowhere on the device, and a reader scoped to
 * the top screen would answer "not here" for a sentence rendered one entry
 * down.
 */
async function syncScreenFacts(page) {
  return page.evaluate(() => {
    const text = (sel) => {
      const el = document.querySelector(sel);
      return el ? (el.textContent ?? "").trim() : null;
    };
    const top = '.shell-stack-entry[data-top="true"]';
    return {
      syncNote: text(`${top} .shell-note`),
      pairPrompt: text(`${top} .shell-note[data-tone="ink"]`),
      pairWords: text(`${top} .pair-words`),
      pairError: text(`${top} .shell-note[data-tone="warm"]`),
      scanNote: text(`${top} .scan-band .shell-note`),
      // The setup wizard's three: every plain-ink sentence on the step
      // (a step carries up to two), the transcribable mono block (the
      // generated phrase, or the hosted relay's name), the segment's
      // current option, and the filled button's label.
      setupPrompts: [...document.querySelectorAll(`${top} .shell-note[data-tone="ink"]`)].map(
        (el) => (el.textContent ?? "").trim(),
      ),
      setupWords: text(`${top} .setup-words`),
      activeSegment: text(`${top} .seg-btn.active`),
      primaryAction: text(`${top} .shell-primary-action .shell-toolbar-button`),
      // QrScanner's own three pieces. `mounted` is the switch
      // SyncScanScreen's `{#if cameraLive(status)}` throws — mounting is
      // the only lever this shell has over a borrowed component's stream,
      // so its presence IS whether the camera may be live.
      scannerMounted: !!document.querySelector(".scanner"),
      scannerCta: text(".rationale-cta"),
      scannerRationale: text(".rationale-body"),
      // The desktop's error branch, which must never render here.
      scannerError: text(".scanner-error"),
      documentText: (document.body.textContent ?? "").trim(),
    };
  });
}

/**
 * The setup wizard's phrase step, on the have-a-phrase side, with the
 * words typed. Shared by the two setup states: the relay state is this
 * plus one tap on `next`.
 *
 * The segment is tapped by its label and the words go in by real keys
 * — the field is tapped first so the caret is in it — for the rule
 * every interaction state follows: driven by input, never by a hook.
 * The new-account side the screen opens on is not photographed; the
 * scenes.js block says why (the mock's `sync_generate_phrase` is null).
 */
async function goToShellSetupPhrase(page, label) {
  await goToShellSettings(page, label);
  await tapScreenRow(page, "sync");
  await settle(page, 700);
  await tapScreenRow(page, SHELL_SYNC_DEVICE_ROWS[2][0]);
  await settle(page, 700);

  const segment = page
    .locator('.shell-stack-entry[data-top="true"] .seg-btn')
    .filter({ hasText: SHELL_SETUP_MODE_TYPED });
  await segment.waitFor({ state: "visible" });
  await segment.tap();
  await settle(page, 300);

  const field = page.locator(
    `.shell-stack-entry[data-top="true"] [aria-label="${SHELL_SETUP_PHRASE_FIELD}"]`,
  );
  await field.waitFor({ state: "visible" });
  await field.tap();
  await page.keyboard.type(SHELL_SETUP_PHRASE);
  await settle(page, 400);
}

function assertSetupScreen(state, facts, label) {
  // Depth 3: setup is pair's sibling, pushed from the devices screen.
  assertPushedScreen(state, label, "set up", 3);
  assertRowsLegible(state, label);
  // No warm note. A failure sentence here means the mode switch did
  // not clear the null-phrase error, or `next` was refused — either
  // way a state this capture is not meant to be in.
  if (facts.pairError !== null) {
    throw new Error(
      `${label}: a failure sentence is on screen ("${facts.pairError}") — the segment tap ` +
      "clears the generate failure, and nothing on this path should have refused",
    );
  }
  for (const field of state.fields) {
    if (field.fontPx < 16) {
      throw new Error(
        `${label}: the "${field.label}" field is ${field.fontPx}px — under the 16px floor, ` +
        "mobile Safari zooms the viewport on focus (Field's own header)",
      );
    }
  }
}

/**
 * The insert sheet, open, reached the only way a phone can reach it:
 * keyboard up, a real tap on the `+` the block strip carries.
 *
 * Extracted because FOUR states now enter through it — the sheet itself,
 * the two builders and the board sheet — and a fifth copy of the entry
 * would be a fifth chance for one of them to enter through a `+` that had
 * gone dead without the others noticing.
 *
 * It asserts the whole row list on the way past. That is not redundant with
 * INSERT_SHEET's own assertion: three of the four callers tap a row BY
 * NAME, so a row that vanished upstream would otherwise surface as a
 * locator timeout in an unrelated state rather than as "the sheet offers
 * ten rows, expected eleven".
 */
async function openShellInsertSheet(
  page,
  label,
  mode = WIDGET_MODE.RESIZES_CONTENT,
  { refocusField = false } = {},
) {
  await shellStripSetup(page, label, mode);

  const plus = page.locator('.shell-toolbar-strip [data-button-id="insert"]');
  await plus.waitFor({ state: "visible" });
  if (await plus.isDisabled()) {
    throw new Error(
      `${label}: the \`+\` renders disabled on an open page — the insert row's gate is ` +
      "`readonly`, so either the fixture's page is closed or the gate inverted",
    );
  }
  await plus.tap();
  await settle(page, 500);

  // A SHEET TAKES THE KEYBOARD DOWN AS IT OPENS (Sheet's
  // takeKeyboardDown): a menu and a keyboard were sharing the bottom of
  // the screen, and the first tap on a row was landing where the row had
  // been a moment earlier. Every caller here raised the keyboard to get
  // the strip that opens this sheet, so by this line it is down again —
  // which is the right geometry for every state but one.
  //
  // `refocusField` is that one. IOS_KEYBOARD_SHEET exists to photograph a
  // sheet lifted over a keyboard under resizes-visual, and the way a
  // writer has one now is to tap the field INSIDE it — the finder, which
  // is also the only thing in this shell that raises a keyboard from a
  // sheet at all. Tapped before the shape is asserted, because with the
  // keyboard down and the layout viewport still full (that mode's whole
  // premise) a sheet at the bottom of it is behind the keyboard, and
  // assertSheetShape would reject it for being exactly where it belongs.
  if (refocusField) {
    const finder = page.locator('.shell-sheet[data-sheet="insert"] .shell-field-input');
    await finder.waitFor({ state: "visible" });
    await finder.tap();
    await settle(page, 400);
  }

  const sheet = await sheetState(page);
  assertSheetShape(sheet, label, "insert", "full");
  assertSheetRows(sheet, label, SHELL_INSERT_ROWS);
  return sheet;
}

/**
 * Tap one row of the open sheet, by the label a reader of the photograph
 * would tap.
 *
 * Found through `.shell-row-label` with an exact text match rather than by
 * index: the insert sheet's order is the spec's and has moved twice this
 * phase, and a driver keyed on position would keep passing while opening
 * the wrong builder. The sheet's `data-sheet` is in the selector for the
 * same reason `assertSheetShape` checks it — two sheets are told apart
 * only by their rows.
 */
async function tapSheetRow(page, tag, label) {
  const row = page
    .locator(`.shell-sheet[data-sheet="${tag}"] .shell-row`)
    .filter({ has: page.locator(`.shell-row-label:text-is("${label}")`) });
  await row.waitFor({ state: "visible" });
  await row.tap();
}

/**
 * Put the harness keyboard down, once the APP has said it is entitled to
 * go down.
 *
 * The VR keyboard is a viewport shrink the driver performs, so lowering it
 * is a driver decision — and a driver that decided it on its own would be
 * photographing a state it had invented. What entitles it here is
 * measured, not assumed: `Row` is a plain `<button>` with no pointerdown
 * `preventDefault` (ToolbarButton has one precisely to keep the caret in
 * the doc), and `runInsertRow` sets `openSheet = null` BEFORE it runs the
 * row — so the tapped element leaves the DOM in the same turn and focus
 * lands on `<body>`. `computeKeyboardState` gates the keyboard on a
 * focused field, so with nothing focused a device's IME is already
 * retracting while the builder comes up.
 *
 * This function asserts that first and shrinks second. If the editor ever
 * keeps focus across a sheet row, the restore stops being honest and this
 * fails by name instead of quietly baselining a taller sheet than the app
 * can produce.
 *
 * It matters to what the picture is worth. At the keyboard-open viewport a
 * full detent is 0.92 × 360 ≈ 331px and the size grid alone is ~384px, so
 * the builders shot keyboard-up would have baselined a scrolled, clipped
 * sheet no writer ever sees.
 */
async function releaseHarnessKeyboard(page, label, size) {
  const held = await page.evaluate(() => {
    const ae = document.activeElement;
    return {
      inEditor: !!(ae && ae.closest && ae.closest(".ProseMirror")),
      field: !!(
        ae && ae.matches && ae.matches("input, textarea, [contenteditable='true']")
      ),
      tag: ae ? ae.tagName.toLowerCase() : "(none)",
      cls: ae && typeof ae.className === "string" ? ae.className : "",
    };
  });
  if (held.inEditor || held.field) {
    throw new Error(
      `${label}: focus is still on <${held.tag} class="${held.cls}"> after the sheet row — ` +
      "the IME would stay up on a device, so lowering the harness keyboard here would " +
      "photograph a full detent measured against a viewport the app never gets",
    );
  }

  await page.setViewportSize(size);
  await settle(page, 700);

  const app = await page.evaluate(() =>
    Math.round(
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--app-height"),
      ) || 0,
    ),
  );
  // The app re-measured, rather than the window merely being taller.
  // --app-height is what every detent is a fraction OF, so a stale one
  // would leave the sheet at the keyboard's height over a full-height
  // page — which is a picture, and a wrong one.
  if (Math.abs(app - size.height) > 2) {
    throw new Error(
      `${label}: --app-height is ${app}px with the viewport back at ${size.height}px — ` +
      "the shell never observed the keyboard leaving, so the detent below is measured " +
      "against a keyboard that is no longer there",
    );
  }
}

/**
 * The size grid, measured. Everything Task 4 argued about a thumb, asked of
 * the rendered page in one round trip.
 *
 * jsdom has seen this component's markup and can see none of this: the
 * cells are sized by `minmax(var(--tap), 1fr)` and squared by
 * `aspect-ratio`, the caption is placed by document order inside a flex
 * column, and all three are scoped-stylesheet facts. What is left for a
 * unit test is the numbers `gridCellsFor` returns, which were already
 * covered — so this reader is the only thing that can say the 6×6 the
 * arithmetic promised is the 6×6 on the screen.
 */
async function tableGridState(page) {
  return page.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return {
        top: Math.round(r.top), bottom: Math.round(r.bottom),
        left: Math.round(r.left), right: Math.round(r.right),
        width: Math.round(r.width), height: Math.round(r.height),
      };
    };
    const caption = document.querySelector(".shell-table-grid-caption");
    const cellsEl = document.querySelector(".shell-table-grid-cells");
    const cells = [...document.querySelectorAll(".shell-table-grid-cell")];
    const rects = cells.map((c) => c.getBoundingClientRect());
    return {
      caption: caption
        ? { ...box(caption), text: (caption.textContent ?? "").trim() }
        : null,
      cells: cellsEl ? box(cellsEl) : null,
      count: cells.length,
      // Distinct left edges — the number of COLUMNS the browser actually
      // laid out, which is the question "do all six fit" is really asking.
      // A seventh column, or a reflow to five, changes this and nothing
      // else the DOM would report.
      columns: new Set(rects.map((r) => Math.round(r.left))).size,
      lit: cells
        .filter((c) => c.classList.contains("in-range"))
        .map((c) => `${c.dataset.row},${c.dataset.col}`),
      // The floor, and the squareness. Both are the cell's own CSS and
      // both are what makes a 36-target grid usable by a thumb at all.
      minSide: Math.round(
        Math.min(...rects.map((r) => Math.min(r.width, r.height))),
      ),
      maxSkew: Math.round(Math.max(...rects.map((r) => Math.abs(r.width - r.height)))),
    };
  });
}

/**
 * The chart builder's borrowed body, measured.
 *
 * Two things it can say that nothing else in the suite can. The SEGMENTED
 * CONTROL is a desktop leaf (`lib/ui/SegmentedControl.svelte`) the shell
 * borrows, and the rules test does not walk it — so the only thing holding
 * its three segments to the 44px floor is ChartForm's own `:global` rule,
 * a scoped-stylesheet fact jsdom resolves to nothing. And every CONTROL
 * inside the imported forms is in the same position: a `×` at 0.25rem of
 * padding and a shape picker of ~28px buttons are what those files ship,
 * and the floor over them is declared once, here, in a stylesheet only a
 * real engine applies.
 */
async function chartFormState(page) {
  return page.evaluate(() => {
    const form = document.querySelector(".shell-chart-form");
    if (!form) return null;
    // `.shell-chart-form-kinds`, not `.seg-btn` on its own. The FLOWCHART
    // form carries a SegmentedControl of its own — `top-down` /
    // `left-right` — so an unscoped selector reads five segments on one
    // kind and three on the other two, and the assertion that the sheet
    // offers exactly ChartBuilder's three would have been a different
    // assertion per kind. Found by writing it the loose way and watching
    // it report `[flowchart | mind map | timeline | top-down |
    // left-right]`.
    const seg = [...form.querySelectorAll(".shell-chart-form-kinds .seg-btn")].map((b) => ({
      label: (b.textContent ?? "").trim(),
      checked: b.getAttribute("aria-checked") === "true",
      height: Math.round(b.getBoundingClientRect().height),
      width: Math.round(b.getBoundingClientRect().width),
    }));
    const controls = [...form.querySelectorAll("button, input, select, textarea")];
    const short = controls
      .map((el) => ({
        el,
        h: el.getBoundingClientRect().height,
        w: el.getBoundingClientRect().width,
      }))
      // Only what is actually laid out: a control inside a branch the
      // current kind does not render has a zero box and is not on screen
      // to be missed.
      .filter((c) => c.h > 0 && c.h < 44)
      .map((c) => `${c.el.tagName.toLowerCase()}.${c.el.className || "(none)"} ${Math.round(c.h)}px`);
    return {
      segments: seg,
      controlCount: controls.length,
      shortControls: short,
      // Task 5's two inherited breakages, and the only surface that can
      // judge either. The handle is real markup with a real `draggable`
      // attribute, so it LOOKS like a control in the photograph and is
      // inert under a finger; the preview pane the desktop has is simply
      // not here.
      dragHandles: form.querySelectorAll('.drag-handle[draggable="true"]').length,
      preview: !!document.querySelector(".builder-preview, .chart-render"),
      placeholders: [...form.querySelectorAll("input")].map((i) => i.placeholder ?? ""),
    };
  });
}

/**
 * The three kind segments, in order, with exactly one checked — and it is
 * the one the state says was chosen.
 *
 * `aria-checked` rather than a class, because that is what SegmentedControl
 * publishes and what a screen reader reads. In the photograph the selected
 * segment is a fill and two of the three words are three characters apart,
 * so which one is lit is close to the smallest difference this suite can be
 * asked to notice.
 */
function assertChartKinds(form, label, chosen) {
  if (!form) {
    throw new Error(
      `${label}: no .shell-chart-form on screen — the builder's body never mounted, so ` +
      "this would be a photograph of a title field and a commit row",
    );
  }
  const got = form.segments.map((s) => s.label).join(" | ");
  if (got !== SHELL_CHART_KINDS.join(" | ")) {
    throw new Error(
      `${label}: the kind control offers [${got}], expected ` +
      `[${SHELL_CHART_KINDS.join(" | ")}] — the words and the order are ChartBuilder's, ` +
      "so a writer who made a chart on the desktop finds the same three",
    );
  }
  const lit = form.segments.filter((s) => s.checked).map((s) => s.label);
  if (lit.length !== 1 || lit[0] !== chosen) {
    throw new Error(
      `${label}: [${lit.join(", ")}] read as selected, expected exactly "${chosen}" — the ` +
      "segment is a fill behind a word and nothing else, which is under the pixel gate on " +
      "its own",
    );
  }
}

/**
 * Nothing inside the borrowed subtree is under the thumb floor.
 *
 * This is the obligation that came with importing three desktop form
 * components into a phone sheet. The shell's rules test walks
 * `src/shell/**` and stops there, so none of these files is scanned; every
 * control in them is sized for a pointer a few pixels wide (a shape picker
 * of ~28px buttons, a `×` at 0.25rem of padding, chips at 0.625rem). The
 * one thing holding them to 44px is ChartForm's `:global` block, and a
 * scoped stylesheet is exactly what jsdom does not apply — so this
 * assertion has no unit-test equivalent and could not have one.
 */
function assertChartThumbFloor(form, label) {
  if (form.controlCount < 5) {
    throw new Error(
      `${label}: the borrowed form rendered ${form.controlCount} controls — too few to be ` +
      "the form this state is captioned for, so the floor below would be vacuously true",
    );
  }
  if (form.shortControls.length) {
    throw new Error(
      `${label}: ${form.shortControls.length} controls are under the 44px floor ` +
      `[${form.shortControls.join(", ")}] — ChartForm's \`:global\` rule is the only thing ` +
      "holding the borrowed components to it, and no unit test can see a scoped stylesheet",
    );
  }
}

/**
 * The pin's breadcrumb, and everything the photograph of it has to be
 * checked against — read in ONE round trip because this state has a clock
 * in it. The toast clears itself after PIN_TOAST_MS (4000ms) and every
 * extra `evaluate` spends part of that window before the shutter.
 *
 * `.shell-toast-live` is read separately from `.shell-toast`, and that is
 * the pair Toast's own first-caller finding is about: the `role="status"`
 * region is mounted ALWAYS and the visible band is what the `{#if}`
 * guards, because a live region inserted with its message already in it is
 * announced unreliably and TalkBack — the shell's first target — stays
 * silent. A capture cannot see any of that; this reader can.
 */
async function toastState(page) {
  return page.evaluate(() => {
    const live = document.querySelector(".shell-toast-live");
    const el = document.querySelector(".shell-toast");
    const header = document.querySelector(".ph");
    const band = document.querySelector(".shell-screen-content");
    const r = el ? el.getBoundingClientRect() : null;
    const pin = document.querySelector('.shell-toolbar-strip [data-button-id="pin"]');
    return {
      liveRegion: !!live,
      role: live?.getAttribute("role") ?? null,
      politeness: live?.getAttribute("aria-live") ?? null,
      present: !!el,
      text: el ? el.textContent.trim() : null,
      top: r ? Math.round(r.top) : null,
      bottom: r ? Math.round(r.bottom) : null,
      left: r ? Math.round(r.left) : null,
      right: r ? Math.round(r.right) : null,
      height: r ? Math.round(r.height) : null,
      // The sentence against the box drawn around it. A breadcrumb whose
      // own text overflows its band is a count the writer cannot read,
      // which is the entire message.
      clipped: el ? el.scrollWidth > el.clientWidth + 1 : null,
      headerBottom: header ? Math.round(header.getBoundingClientRect().bottom) : null,
      bandTop: band ? Math.round(band.getBoundingClientRect().top) : null,
      // Task 1's other half, in the same trip: the same `pinIntent` call
      // that writes the pin feeds the strip, so the control LEAVES on a
      // block that is already kept — absent since the visual pass, where it
      // used to dim in place (ShellApp's `unavailableIds` says why). The
      // toast is the confirmation; the gap where `pin` was is the other
      // half of it. `pinDisabled` is kept so a `pin` that stayed and went
      // grey — the old rendering coming back — is named rather than read
      // as "present".
      pinPresent: !!pin,
      pinDisabled: pin ? pin.disabled : null,
      viewport: window.innerHeight,
      viewportWidth: window.innerWidth,
    };
  });
}

/**
 * The shell page at rest, with the slot proven to be the TAB BAR — which
 * is the precondition every P2f sheet state needs and none of them can
 * get from `shellStripSetup`.
 *
 * That helper opens the keyboard, and these surfaces are reached with the
 * keyboard DOWN: the header's three controls live in a band the fold
 * exists to protect. Driving them through a viewport shrink would
 * photograph a state no writer is in.
 *
 * What it keeps is the half of `shellStripSetup` that matters afterwards.
 * `assertSheetShape` asserts the slot holds NEITHER a strip nor the tab
 * bar once the sheet is up; that claim means nothing unless the slot held
 * something first, and P1c's fourteen wrong-tree baselines are what a
 * state that never proved it changed anything looks like.
 */
async function shellPageAtRest(page, label) {
  const editor = page.locator(".ProseMirror").first();
  await editor.waitFor({ state: "visible" });

  const strip = await stripState(page);
  if (strip !== null) {
    throw new Error(
      `${label}: an editing strip is already in the slot at load — this state is reached ` +
      "with the keyboard down, so a strip here means the scene booted into some other state",
    );
  }
  if (!(await page.locator(".shell-tabbar").count())) {
    throw new Error(
      `${label}: the slot holds neither the tab bar nor a strip at load — the shell did ` +
      "not boot, or the frame stopped reserving the slot, and `assertSheetShape`'s emptied-" +
      "slot claim would then be true of a slot that was never full",
    );
  }
}

/** The three numbers the shell page's fold is decided by. */
async function bandState(page) {
  return page.evaluate(() => {
    const band = document.querySelector(".shell-screen-content");
    if (!band) return null;
    return {
      clientHeight: band.clientHeight,
      scrollHeight: band.scrollHeight,
      scrollTop: Math.round(band.scrollTop),
      folded: !document.querySelector(".ph-line2"),
    };
  });
}

async function settle(page, ms = 450) {
  await page.waitForTimeout(ms);
}

/**
 * Everything the lift state measures, in one round trip: the blocks as they
 * are laid out, the canvas and the scrolling band they sit in, the lifted
 * block if there is one, and the drop indicator if there is one.
 *
 * One reader rather than four, and it is called twice — once before the
 * press and once during the drag — because every assertion the state makes
 * is a comparison between those two moments. Splitting it would mean four
 * round trips per moment and two chances for the second set to be measured
 * against a page that had moved on between calls.
 *
 * The computed `transform` and `boxShadow` are read here and nowhere else in
 * this file, and that is the point of them: §3's "slight scale, strong
 * shadow tier" is a CSS rule on a class the app applies imperatively, and
 * jsdom — which is all that has ever seen `.ps-lifted` — resolves neither.
 * A class present with no rule behind it is a lift nobody can see.
 */
async function liftGeometry(page) {
  return page.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return {
        top: Math.round(r.top), bottom: Math.round(r.bottom),
        left: Math.round(r.left), right: Math.round(r.right),
        width: Math.round(r.width), height: Math.round(r.height),
      };
    };
    const canvas = document.querySelector(".ps-canvas");
    const band = document.querySelector(".shell-screen-content");
    const line = document.querySelector(".ps-drop-line");
    const lifted = [...document.querySelectorAll(".ps-lifted")];
    const gutter = document.querySelector(".ps-gutter");
    return {
      canvas: canvas ? box(canvas) : null,
      band: band
        ? {
            ...box(band),
            scrollTop: Math.round(band.scrollTop),
            clientHeight: band.clientHeight,
            scrollHeight: band.scrollHeight,
          }
        : null,
      // The doc's top-level children as the browser laid them out — the same
      // list measureSiblings walks in the app, which is why it is `> *` and
      // not `> p`: a stray widget or a node that is not a paragraph belongs
      // in the count, so the driver's assertion on the texts fails loudly
      // instead of a filter here hiding it.
      blocks: [...document.querySelectorAll(".ps-canvas .ProseMirror > *")].map((el) => ({
        ...box(el),
        text: el.textContent.trim(),
        // The block's first line box, as the app reads it (PageScreen's
        // gutterHandle via gutter-handle-line.js): the computed line-height
        // resolved to px. What the handle is centred on, so the driver can
        // say the handle belongs to THIS block without hardcoding 25.6.
        lineHeight: parseFloat(getComputedStyle(el).lineHeight),
      })),
      lifted: lifted.map((el) => ({
        ...box(el),
        text: el.textContent.trim(),
        transform: getComputedStyle(el).transform,
        shadow: getComputedStyle(el).boxShadow,
      })),
      line: line ? { ...box(line), index: line.dataset.index } : null,
      handles: document.querySelectorAll('[data-button-id="block-handle"]').length,
      // The third piece of the drag that is on screen: the handle the finger
      // is holding takes the accent while a block is up (`.ps-gutter.lifting`).
      handleLit: !!gutter && gutter.classList.contains("lifting"),
      viewport: window.innerHeight,
    };
  });
}

/**
 * Tap the top-level line that holds an attachment and photograph the gutter
 * card it reveals. Shared by the image and file drivers below, because the
 * whole diagnostic value is that the two lines get the SAME assertions —
 * the defect was one branch quietly answering differently from the other.
 *
 * `innerSelector` picks the branch: AttachmentBlock.svelte renders
 * `.attachment-image` for an image and `.attachment-block` for a file, and
 * they share no class — which was the bug's hiding place.
 */
async function attachmentGutter(page, innerSelector, label) {
  const wrapper = page.locator(".tiptap-wrapper").first();
  await wrapper.waitFor({ state: "visible" });

  // The top-level block, found through the attachment it holds rather than
  // by index: the fixtures put a plain line before and after the
  // attachment, so `> p` first would tap prose and photograph nothing about
  // an attachment at all.
  const block = page
    .locator(`.tiptap-wrapper .ProseMirror > p:has(${innerSelector})`)
    .first();
  await block.waitFor({ state: "visible" });

  // Real touch tap, same gesture BLOCK_HANDLES_TOUCH uses and for the same
  // reason — a bare click would take the desktop-hover path instead.
  await block.tap();
  await settle(page, 200);

  const handles = page.locator(".block-handles");
  await handles.waitFor({ state: "visible" });
  for (const name of ["pin", "copy", "delete"]) {
    if ((await handles.locator(`[data-label="${name}"]`).count()) === 0) {
      throw new Error(
        `${label}: the "${name}" control is missing — an attachment line is not an empty line`,
      );
    }
  }
  // The other half of the defect, and the part that named it: `isEmpty` is
  // `canInsert && !canPin`, so an attachment line offering the insert "+"
  // means the app has classified it as a blank line to write under. That is
  // literally what was shipping — `["insert"]` and nothing else.
  if ((await handles.locator('[data-label="insert"]').count()) !== 0) {
    throw new Error(`${label}: the insert "+" rendered — the line is being read as empty`);
  }
}

export const STATE_DRIVERS = {
  // Gutter-polish pass: the chip-less touch handle (touch-block-handle.js)
  // renders "+" only on an EMPTY block, into the restored left gutter.
  // Doesn't tap it (that opens the slash menu, a different scene entirely)
  // — the point here is the glyph and its position in the gutter, not the
  // menu it leads to.
  [STATES.TOUCH_INSERT_HANDLE]: async (page) => {
    const wrapper = page.locator(".tiptap-wrapper").first();
    await wrapper.waitFor({ state: "visible" });
    const block = page.locator(".tiptap-wrapper .ProseMirror > p").first();
    await block.waitFor({ state: "visible" });
    // A plain tap, not an off-centre one: the handle lives in the left
    // gutter (outside the block's own box, see prose.css), so there's no
    // risk of landing on it by taking the element's default centre point.
    await block.tap();
    await settle(page, 200);

    const handle = block.locator(".touch-block-handle");
    await handle.waitFor({ state: "visible" });

    // Exactly ONE "+" in the gutter. An empty chip-less block is the one
    // case where the widget decoration above and the .block-handles card
    // both fire, into the same gutter, a few pixels apart — the reported
    // "why do we have two + buttons", the larger of the two being a card
    // several times the size of the glyph beside it. The decoration wins
    // here because it is anchored to the block and costs no chrome; the
    // card still appears for anything with content (it carries pin, copy
    // and delete, which the decoration never offers).
    const cardCount = await page.locator(".block-handles").count();
    if (cardCount !== 0) {
      const glyphs = await page.locator(".block-handles .block-handle").allTextContents();
      throw new Error(
        `touch-insert-handle: the .block-handles card is also showing (${glyphs.length} ` +
        `button(s): ${JSON.stringify(glyphs)}) — that is a second "+" in the same gutter ` +
        "as the decoration this state already asserted",
      );
    }
  },

  // Gutter-polish pass, the actual bug fix ("tap on block does not show
  // the toolbar in the left space"): tapping a chip-less block that
  // already has content reveals its pin/copy/delete controls in the
  // gutter — the same .block-handles column desktop hover populates, just
  // touch-triggered (TipTapEditor.svelte's handleEditorPointerDown →
  // revealBlockHandlesForNode). Replaces the earlier BottomSheet a
  // chip-less block used to reach via a synthetic "⋯" handle — that
  // handle is gone; this plain tap is the whole gesture now.
  //
  // Deliberately targets the FIRST fixture paragraph, which is short
  // enough to wrap to one line at phone width — the tallest-risk case the
  // coordinator asked to see photographed: three stacked controls next to
  // a single text line are taller than the block itself, so this proves
  // the overflow spills DOWN THE GUTTER beside the next block rather than
  // over that next block's own text.
  [STATES.BLOCK_HANDLES_TOUCH]: async (page) => {
    const wrapper = page.locator(".tiptap-wrapper").first();
    await wrapper.waitFor({ state: "visible" });
    const block = page.locator(".tiptap-wrapper .ProseMirror > p").first();
    await block.waitFor({ state: "visible" });
    const box = await block.boundingBox();
    if (!box) throw new Error("block-handles-touch: block not found in the viewport");
    // Not "nothing happens" bait — this documents WHY the block must be
    // one line: a taller fixture paragraph would still reveal the column,
    // just without exercising the overflow-below-the-block case this
    // state exists to prove is safe.
    if (box.height > 40) {
      throw new Error(
        `block-handles-touch: fixture's first paragraph is not one line (height ${box.height}px) — ` +
        "this state needs the one-line case to prove the toolbar doesn't paint over text when it overflows",
      );
    }

    // `.tap()`, not `.click()`: a plain click dispatches a bare mousemove/
    // mousedown/click with no preceding touch, which isTrustedMouseHover
    // (block-hover-guard.js) has no reason to reject — it would reveal the
    // desktop-hover column instead of exercising the touch path this state
    // guards. `.tap()` fires real touch events first (setting lastTouchAt
    // via handleEditorPointerDown, same as a real phone), so the compat
    // mousemove Chromium synthesizes right after lands inside the guard
    // window and is correctly ignored.
    await block.tap();
    await settle(page, 200);

    const handles = page.locator(".block-handles");
    await handles.waitFor({ state: "visible" });
    const pin = handles.locator('[data-label="pin"]');
    const copy = handles.locator('[data-label="copy"]');
    const del = handles.locator('[data-label="delete"]');
    if ((await pin.count()) === 0 || (await copy.count()) === 0 || (await del.count()) === 0) {
      throw new Error("block-handles-touch: pin/copy/delete controls did not all render");
    }
    // The insert "+" belongs to the empty-block path only (TOUCH_INSERT_
    // HANDLE) — a block WITH content must not also offer it, the same
    // has-content split the desktop hover column applies.
    if ((await handles.locator('[data-label="insert"]').count()) !== 0) {
      throw new Error("block-handles-touch: the insert '+' rendered on a block that has content");
    }
    // The hard constraint under test: the column must stay inside the
    // gutter, never over the block's own text — even though it overflows
    // BELOW the block's short one-line height (asserted above), it must
    // never spill to the RIGHT of where the block's text starts.
    const handlesBox = await handles.boundingBox();
    const blockBox = await block.boundingBox();
    if (!handlesBox || !blockBox) {
      throw new Error("block-handles-touch: could not measure the revealed column");
    }
    if (handlesBox.x + handlesBox.width > blockBox.x + 0.5) {
      throw new Error(
        `block-handles-touch: column right edge (${handlesBox.x + handlesBox.width}) ` +
        `reaches past the block's text start (${blockBox.x}) — painting over text`,
      );
    }

    // The other half of "usable": big enough to hit. Reported twice as
    // "hard to tap", and both times the cause was a size nothing checked —
    // most recently the phone density pass setting --ui-scale to 0.875,
    // which shrank rem-sized targets to 15.75x21px without touching this
    // file or failing anything. Measuring the RENDERED box is the point:
    // the CSS can keep saying 1.125rem while the device draws 15.75px.
    // Not 44 (Apple HIG) or 48 (Material), and deliberately so. A 44px
    // floor was tried and reverted: three stacked make a 137px column,
    // which on a two-item task list hangs past the block it belongs to and
    // over the next one — and reaching further is how the lower buttons
    // came to act on the wrong block. What this number is really guarding
    // is the regression that produced the report: tap targets sized in rem,
    // silently scaled to 15.75x21px by --ui-scale. 32 is clear of that and
    // still keeps the column beside its own block. Raising it needs the
    // overshoot answered first, not just a bigger number.
    const TAP_FLOOR_PX = 32;
    for (const button of await handles.locator("button").all()) {
      const label = await button.getAttribute("data-label");
      const box = await button.boundingBox();
      if (!box) throw new Error(`block-handles-touch: could not measure the "${label}" button`);
      if (box.height < TAP_FLOOR_PX - 0.5) {
        throw new Error(
          `block-handles-touch: "${label}" is ${box.height}px tall, under the ${TAP_FLOOR_PX}px ` +
          `touch floor — three of these are stacked, so a near miss hits the neighbour`,
        );
      }
      // Width cannot take the same floor — the gutter is 1.5rem and the
      // assertion above forbids crossing into the text, so 44px of width
      // does not exist to give. What CAN be required is that the button
      // spends the whole gutter instead of centring itself in it: the
      // ~1.6px-per-side slack that used to go unused is the only width
      // actually available to these controls, and leaving it unspent is
      // what this catches.
      if (box.width < handlesBox.width - 2.5) {
        throw new Error(
          `block-handles-touch: "${label}" is ${box.width}px wide inside a ` +
          `${handlesBox.width}px column — gutter width is going unused`,
        );
      }
    }
  },

  // ── the attachment gutter, image and file ───────────────────────────
  // The `/image` defect: hovering an image line offered ONLY the "+"
  // insert handle, while the identical file line offered pin/copy/delete.
  // blockPinFacts decided "is this an attachment" from `.attachment-block`,
  // a class only AttachmentBlock.svelte's FILE branch renders; the image
  // branch renders `.local-image-wrap .attachment-image`. So an image was
  // never exempt, and an attachment is an inline atom with no node text —
  // not exempt + no text = an EMPTY LINE, which is what `["insert"]` meant.
  //
  // page-image-content and page-file-content were both load-time-only
  // scenes, so the whole suite stayed green through it. These two drivers
  // are the missing half: the control only exists once you touch the line.
  //
  // Written as a pair on purpose — the file line is the control sample. On
  // its own "an image offers no pin" reads like a design decision; beside a
  // file line that offers all three, it reads as the bug it was.
  [STATES.IMAGE_BLOCK_HANDLES_TOUCH]: async (page) =>
    attachmentGutter(page, ".attachment-image", "image-block-handles"),
  [STATES.FILE_BLOCK_HANDLES_TOUCH]: async (page) =>
    attachmentGutter(page, ".attachment-block", "file-block-handles"),

  // The touch pin flow, end to end. Every prior mobile block-action fix in
  // this app's history was reasoned about ONE seam — the reveal, or the
  // popup, or the button — and passed here while still failing on a real
  // phone, because nothing exercised the whole gesture chain a phone
  // actually walks. This state does: tap the block (reveal) → tap PIN
  // (the gutter button, not a shortcut) → assert a pin now exists, both
  // in the backend the app itself talks to AND in the toolbar's own
  // already-pinned indicator. If handlePinBlock regresses — the popup
  // eats the tap again, block resolution goes stale, the quick-pin path
  // breaks — this fails HERE.
  [STATES.PIN_FLOW_TOUCH]: async (page) => {
    const wrapper = page.locator(".tiptap-wrapper").first();
    await wrapper.waitFor({ state: "visible" });
    const block = page.locator(".tiptap-wrapper .ProseMirror > p").first();
    await block.waitFor({ state: "visible" });

    // Ground truth lives in the mock invoke the app itself calls
    // (window.__VR_INVOKE__, installed by src/lib/vr/bootstrap.js) — not
    // in what merely rendered. Asserting an INCREASE, not a fixed count,
    // holds even if a future fixture starts seeding its own pins.
    const before = await page.evaluate(() =>
      window.__VR_INVOKE__("get_pins", { lineageId: null }),
    );

    // Real touch tap — same reveal BLOCK_HANDLES_TOUCH exercises.
    await block.tap();
    await settle(page, 200);

    const handles = page.locator(".block-handles");
    await handles.waitFor({ state: "visible" });
    const pin = handles.locator('[data-label="pin"]');
    await pin.waitFor({ state: "visible" });
    const classBefore = (await pin.getAttribute("class")) || "";
    if (classBefore.includes("already-pinned")) {
      throw new Error("pin-flow-touch: fixture's block already reads as pinned before the flow starts");
    }

    // The actual reported bug: tapping PIN did nothing on touch.
    await pin.tap();
    await settle(page, 250);

    // The editor must still hold focus. This is root cause 1 stated
    // directly, and it needs no simulated device timing: if the button
    // takes focus, the editor blurs, the IME closes, the viewport grows,
    // the shell reflows, and the button moves out from under the finger
    // before the click resolves. Every other toolbar in TipTapEditor
    // (bubble-btn, table-btn) swallows mousedown for exactly this reason;
    // this column did not, and "nothing happens and the keyboard
    // disappears" is what that felt like.
    const focusKept = await page.evaluate(() =>
      !!document.activeElement?.closest?.(".ProseMirror"),
    );
    if (!focusKept) {
      const where = await page.evaluate(() => {
        const a = document.activeElement;
        return a ? `${a.tagName}.${(a.className || "").toString().split(" ")[0]}` : "null";
      });
      throw new Error(
        `pin-flow-touch: tapping PIN moved focus out of the editor (now ${where}) — ` +
        "on a device that closes the keyboard and reflows the page mid-tap",
      );
    }

    const after = await page.evaluate(() =>
      window.__VR_INVOKE__("get_pins", { lineageId: null }),
    );
    if (after.length !== before.length + 1) {
      throw new Error(
        `pin-flow-touch: expected ${before.length + 1} pin(s) after tapping PIN, backend has ${after.length} — the tap produced no pin`,
      );
    }
    const blockText = ((await block.textContent()) || "").trim();
    const newest = after[after.length - 1];
    const expectedTitle = blockText.slice(0, 50);
    if (!newest || newest.title !== expectedTitle) {
      throw new Error(
        `pin-flow-touch: newest pin's title ("${newest?.title}") doesn't match the tapped block's text ` +
        `("${expectedTitle}") — pinned the wrong content, or pinned nothing recognizable`,
      );
    }

    // The toolbar's own already-pinned indicator must reflect the new pin
    // immediately, not on some later re-reveal — a screenshot taken now
    // proves both facts at once (a pin exists AND the UI knows it).
    const classAfter = (await pin.getAttribute("class")) || "";
    if (!classAfter.includes("already-pinned")) {
      throw new Error("pin-flow-touch: pin button did not flip to already-pinned after pinning");
    }

    // ...and it must still be VISIBLE in that state. The already-pinned
    // style faded the glyph to 0.3 on a muted accent over cream, which on a
    // phone reads as the button vanishing the instant you use it ("tap on
    // the pin button, the icon disappear"). Desktop gets away with an even
    // fainter 0.15 because hover restores it; touch has no hover, so the
    // faded value is the final one. A floor here keeps "pinned" a state
    // rather than an absence.
    const opacity = await pin.evaluate((el) => parseFloat(getComputedStyle(el).opacity));
    if (!(opacity >= 0.5)) {
      throw new Error(
        `pin-flow-touch: after pinning, the pin glyph sits at opacity ${opacity} — ` +
        "at that value it reads as having disappeared, not as pinned",
      );
    }
  },

  // The same flow as PIN_FLOW_TOUCH, on a BOARD block. PIN_FLOW_TOUCH runs
  // on a plain <p>, which has no title slot — so the reveal-tap there adds
  // only the absolutely-positioned gutter column and moves nothing. A
  // board reveals its title IN FLOW on that same tap, shifting its own
  // content down a line, and THAT is the case the "tapping a toolbar
  // button does nothing" device report came from. Same assertions as
  // PIN_FLOW_TOUCH (backend ground truth via __VR_INVOKE__, not just what
  // rendered) so a regression is reported in the same terms.
  [STATES.PIN_FLOW_TOUCH_BOARD]: async (page) => {
    const wrapper = page.locator(".tiptap-wrapper").first();
    await wrapper.waitFor({ state: "visible" });
    const block = page.locator(".tiptap-wrapper .ProseMirror > .block-shell").first();
    await block.waitFor({ state: "visible" });

    const before = await page.evaluate(() =>
      window.__VR_INVOKE__("get_pins", { lineageId: null }),
    );

    await block.tap();
    await settle(page, 250);

    const handles = page.locator(".block-handles");
    await handles.waitFor({ state: "visible" });
    const pin = handles.locator('[data-label="pin"]');
    await pin.waitFor({ state: "visible" });

    // Where the button IS, at the moment before the tap. Captured so a
    // failure can say whether the button moved out from under the finger
    // (the in-flow title reveal shifting the block) rather than the click
    // handler itself doing nothing — two very different bugs that look
    // identical from the outside.
    const boxBefore = await pin.boundingBox();

    await pin.tap();
    await settle(page, 250);

    const after = await page.evaluate(() =>
      window.__VR_INVOKE__("get_pins", { lineageId: null }),
    );
    if (after.length !== before.length + 1) {
      const boxAfter = await pin.boundingBox();
      const moved = boxBefore && boxAfter
        ? Math.round(Math.abs(boxAfter.y - boxBefore.y))
        : "unknown";
      throw new Error(
        `pin-flow-touch-board: expected ${before.length + 1} pin(s) after tapping PIN, ` +
        `backend has ${after.length} — the tap produced no pin. ` +
        `Pin button moved ${moved}px vertically across the tap.`,
      );
    }

    // The two halves of "the button did something", both of which a titled
    // board used to skip: the glyph dims, and the toast names what landed.
    // Neither is cosmetic here — with the pin already created, they are the
    // ONLY difference between a working button and a dead one, and their
    // absence is the whole of the device report.
    const classAfter = (await pin.getAttribute("class")) || "";
    if (!classAfter.includes("already-pinned")) {
      throw new Error("pin-flow-touch-board: pin button did not flip to already-pinned after pinning");
    }
    const toast = page.locator(".quick-pin-toast");
    if (!(await toast.isVisible())) {
      throw new Error(
        "pin-flow-touch-board: no toast after the pin landed — the tap gave the user " +
        "no feedback at all, which is indistinguishable from a dead button",
      );
    }
    const toastText = ((await toast.textContent()) || "").trim();
    if (!toastText.startsWith("pinned ·")) {
      throw new Error(`pin-flow-touch-board: unexpected toast text "${toastText}"`);
    }

    // Tapping it again must also say something. This is the guard the
    // second tap hits, and it returned mute — so a user who missed the
    // first confirmation got nothing on the retry either.
    await pin.tap();
    await settle(page, 250);
    const toastAgain = ((await page.locator(".quick-pin-toast").textContent()) || "").trim();
    if (toastAgain !== "already pinned. press again to unpin") {
      throw new Error(
        `pin-flow-touch-board: second tap said "${toastAgain}" — expected "already pinned. press again to unpin"`,
      );
    }
    const afterTwo = await page.evaluate(() =>
      window.__VR_INVOKE__("get_pins", { lineageId: null }),
    );
    if (afterTwo.length !== after.length) {
      throw new Error(
        `pin-flow-touch-board: second tap created a duplicate pin (${after.length} → ${afterTwo.length})`,
      );
    }
  },

  // ONE tap on a LOWER toolbar button, on a SHORT block — the two things
  // every other state here happens to avoid, and together they are the
  // whole of "you have to tap many times before anything happens".
  //
  // The toolbar is taller than a one-line block, so its second and third
  // buttons hang past that block's own Y range and sit over whatever comes
  // next. handleEditorPointerUp resolved every touch — including one that
  // started on a toolbar button — to findBlockAtY(e.clientY), so tapping
  // those buttons reassigned touchActiveBoard to the block UNDER the
  // button. That moves .block-active-touch, which reveals/collapses title
  // slots in flow, which reflows the page between pointerup and click:
  // the button leaves from under the finger and the click never lands on
  // it. Nothing happens, repeatedly, until a tap happens to catch a layout
  // that isn't moving.
  //
  // Delete is the assertion because its effect is unmissable (the block is
  // gone or it is not) and because it is the furthest button from the
  // block, i.e. the worst case. Pin — the button every other state taps —
  // is the ONLY one that still lands inside a one-line block, which is
  // exactly why this bug survived a suite that already covered "tap pin".
  [STATES.DELETE_FLOW_TOUCH]: async (page) => {
    const wrapper = page.locator(".tiptap-wrapper").first();
    await wrapper.waitFor({ state: "visible" });
    const blocks = page.locator(".tiptap-wrapper .ProseMirror > *");
    const countBefore = await blocks.count();
    const block = blocks.first();
    await block.waitFor({ state: "visible" });
    const textBefore = ((await block.textContent()) || "").trim();

    await block.tap();
    await settle(page, 250);
    const handles = page.locator(".block-handles");
    await handles.waitFor({ state: "visible" });
    const del = handles.locator('[data-label="delete"]');
    await del.waitFor({ state: "visible" });

    // ── the device's ordering, spelled out ───────────────────────────
    // A plain .tap() here CANNOT catch the reported bug. Playwright fires
    // touchend, mouseup and click in one task, so anything scheduled for
    // "the next frame" lands after the click and the tap survives. A real
    // phone leaves a real gap between touchend and click — the IME is
    // closing, the compat mouse events are queued — and the editor's blur
    // fires inside that gap, at a moment when document.activeElement is
    // still BODY because the button is not focused until mouseup.
    //
    // So drive it the way the device does: press, blur, let frames pass,
    // and only then release. If the toolbar dismisses itself in between,
    // the release lands on nothing. That is "you have to tap many times".
    const box = await del.boundingBox();
    if (!box) throw new Error("delete-flow-touch: delete button has no box");
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await page.dispatchEvent('.block-handles [data-label="delete"]', "pointerdown", {
      pointerType: "touch", clientX: cx, clientY: cy, bubbles: true,
    });
    await page.evaluate(() => document.querySelector(".ProseMirror")?.blur());
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await settle(page, 120);

    if ((await handles.count()) === 0) {
      throw new Error(
        "delete-flow-touch: the toolbar dismissed itself between the press and the " +
        "release — the tap can no longer become a click on it, which is exactly the " +
        '"nothing happens until you tap several times" report',
      );
    }

    // Which block is "active" before the release, so the next assertion can
    // tell whether the release moved it.
    const activeBefore = await page.evaluate(() => {
      const pm = document.querySelector(".tiptap-wrapper .ProseMirror");
      return [...pm.children].findIndex((c) => c.classList.contains("block-active-touch"));
    });

    await page.dispatchEvent('.block-handles [data-label="delete"]', "pointerup", {
      pointerType: "touch", clientX: cx, clientY: cy, bubbles: true,
    });
    await settle(page, 60);

    // The release must not re-point the active block. This button hangs
    // BELOW its own block (the whole reason the state uses a short one), so
    // resolving the release by its Y coordinate lands on a different block
    // — which moves an in-flow title reveal and reflows the page mid-tap.
    const activeAfter = await page.evaluate(() => {
      const pm = document.querySelector(".tiptap-wrapper .ProseMirror");
      return [...pm.children].findIndex((c) => c.classList.contains("block-active-touch"));
    });
    if (activeAfter !== activeBefore) {
      throw new Error(
        `delete-flow-touch: releasing on the toolbar moved the active block ` +
        `${activeBefore} -> ${activeAfter} — the tap was resolved to whatever sits ` +
        `under the button, which reflows the page out from under the finger`,
      );
    }

    await del.click();
    await settle(page, 300);

    const countAfter = await blocks.count();
    if (countAfter !== countBefore - 1) {
      throw new Error(
        `delete-flow-touch: one delete left ${countAfter} blocks, expected ${countBefore - 1}`,
      );
    }
    const firstText = ((await blocks.first().textContent()) || "").trim();
    if (firstText === textBefore) {
      throw new Error(
        `delete-flow-touch: block count dropped but "${textBefore}" is still first — ` +
        "the wrong block was deleted",
      );
    }
  },

  // PARKED (Task 6, fix round 1) — not applied to any scene right now.
  // Kept here, working as far as its own assertions go, so whoever lifts
  // the block below has a starting point instead of a blank page.
  //
  // The sheet swaps in place to a "← back" row plus the target list
  // (Task 5) when "convert to…" is tapped. Opening the sheet appears to
  // fire a genuine `mouseleave` on `.tiptap-wrapper` — the dialog's
  // top-layer promotion covers the previously-hovered chip — which arms
  // handleEditorMouseLeave's HOVER_HIDE_DELAY_MS (320ms) hide timer
  // (hover-reveal.js, wired up in TipTapEditor.svelte). That timer is a
  // desktop-hover mechanism never gated on touch, so it fires here too and,
  // once it lands, wipes hoveredBlock out from under this exact submenu:
  // the target rows render correctly for roughly the first ~150ms after
  // the convert tap, then collapse back to just "back" with no further
  // action from the user.
  //
  // First attempt asserted `rowCount >= 2` right after the tap and
  // returned — passed (the assertion ran inside the live window) while
  // `toHaveScreenshot`'s own re-shoot-until-stable loop kept sampling AFTER
  // the driver returned, past the 320ms mark, and committed the COLLAPSED
  // frame as the baseline. Second attempt held the pointer on a target row
  // (`.hover()`) on the theory that a resting hover, not a mouseleave,
  // would keep the timer from arming — asserted twice, once right after
  // the tap and again after the hold, both passing reliably. It still did
  // not work: re-running the SAME driver against Docker twice produced one
  // scene open (page-qa-content) and the other collapsed (page-board-
  // content) in the same run, with neither assertion ever failing — proof
  // the collapse happens strictly between this driver returning and
  // `toHaveScreenshot`'s own capture landing, a window this driver cannot
  // reach into no matter what it asserts beforehand. Whatever the timer is
  // actually reacting to, it is not simulateable from outside without
  // editing `handleEditorMouseLeave` itself (gate it on
  // `!isCoarsePointer()`, matching how the rest of the touch-reveal path
  // already treats this class of desktop-only mechanism) — and that file
  // is frozen for this task. See task-6-report.md's "Concerns" section.
  //
  // Until that lands, this state cannot honestly produce a stable
  // screenshot and must not be applied to a scene (scenes.js) or have a
  // baseline committed for it.
  [STATES.BLOCK_CONVERT_SHEET_TOUCH]: async (page) => {
    const chip = page.locator(".block-type-chip").first();
    await chip.waitFor({ state: "visible" });
    await chip.tap();

    const sheet = page.locator(".block-action-sheet");
    await sheet.waitFor({ state: "visible" });
    const convertRow = sheet.locator(".block-action-row", { hasText: BLOCK_ACTION_LABELS.convert });
    await convertRow.waitFor({ state: "visible" });
    await convertRow.tap();

    const backRow = sheet.locator(".block-action-row").filter({ hasText: "back" });
    await backRow.waitFor({ state: "visible" });
    const rows = sheet.locator(".block-action-row");
    const openCount = await rows.count();
    // back row + at least one target row.
    if (openCount < 2) {
      throw new Error(
        `block-convert-sheet: expected the back row plus at least one target row, got ${openCount} row(s)`,
      );
    }

    // Real-input hold, kept for whoever picks this up next — does not fix
    // the race (see the comment above) but is still the honest thing to
    // do while this driver is being exercised at all.
    await rows.nth(1).hover();

    const heldCount = await rows.count();
    if (heldCount < 2) {
      throw new Error(
        `block-convert-sheet: the sheet collapsed back to "${heldCount} row(s)" while holding the pointer on a target row — the hover hold did not prevent the hide timer`,
      );
    }
  },

  // The header collapses to a pill and the shell resizes when the keyboard
  // is up. Shrinking the viewport is enough to trigger it: isKeyboardOpen()
  // reads a drop in innerHeight below the tallest seen, precisely so the
  // resizes-content viewport mode is detected — which makes the state
  // reachable here without emulating visualViewport.
  [STATES.KEYBOARD]: async (page) => {
    const size = page.viewportSize();
    if (!size) throw new Error("keyboard: no viewport to shrink");
    await page.locator(".ProseMirror").first().click();
    await page.setViewportSize({ width: size.width, height: KEYBOARD_VIEWPORT_HEIGHT });
    await settle(page, 700);
  },

  // The shell page's nav bar folded by a real SCROLL, on a page with real
  // writing on it. The other half of nav-collapse.js: KEYBOARD above travels
  // the `if (keyboardOpen) return true` arm and never reads a scroll
  // position at all, so it can pass while the scroll arm is broken.
  //
  // Why this state did not exist until now. P2a measured the same scene at
  // clientHeight 705 / scrollHeight 705 and declined to register a state a
  // device could not reach; the canvas was a placeholder, so there was
  // nothing to scroll and a real wheel left scrollTop at 0. P2b mounted
  // EditorCore in that canvas, and a page can now be longer than its band.
  //
  // How it gets long: the writer types. That is not a convenience — it is
  // the only way a shell page acquires content today (no import, no paste
  // path, no second surface), and every character here goes through the
  // real key pipeline into ProseMirror rather than being planted through
  // an evaluate(). A baseline forced by injected content photographs the
  // test; this one photographs a page somebody wrote.
  //
  // A wheel, not a touch drag: Playwright exposes taps but no swipe, and a
  // synthesized touch fling would be testing the gesture synthesis rather
  // than the rule. What is under test is that a genuine scroll — a real
  // event, through the real listener on .shell-screen-content — reaches
  // navCollapsed. The wheel produces exactly that scroll event.
  //
  // NOT covered here, and worth knowing before someone reads a pass as
  // wider than it is: .ph-folded-trail, the trail name PROMOTED into line 1
  // when the bar folds. This scene's fixture (emptyPage) seeds no lineage,
  // so there is no name to promote — the shot proves line 2 leaves, not
  // that the trail survives it. Nothing in any suite covers that promotion,
  // which is the half of the fold PageHeader's own header calls the one
  // thing a writer needs to read at a glance.
  //
  // It was checked by hand rather than left unknown: this scene's fixture
  // was temporarily pointed at FIXTURES.continuousTrail, this driver run
  // against it, and line 1 came back reading "today ▾ · the book … pins" —
  // the promotion renders. That probe was reverted rather than committed,
  // because changing which page the shell's only screen scene shows is a
  // catalogue decision and not a VR-state one. A trailed shell scene
  // belongs with P2f's trail sheet, and this is the coverage it buys.
  [STATES.COLLAPSED]: async (page) => {
    const band = page.locator(".shell-screen-content");
    await band.waitFor({ state: "visible" });
    const editor = page.locator(".ProseMirror").first();
    await editor.waitFor({ state: "visible" });

    // The bar must start UNFOLDED, or the capture cannot be distinguished
    // from the load-time one and a fold that never happened would still
    // produce a plausible image. This is the assertion P1c's four wrong-but-
    // green baselines argue for: a state has to prove it changed something.
    const start = await bandState(page);
    if (!start) throw new Error("collapsed: no .shell-screen-content on this scene");
    if (start.folded) {
      throw new Error(
        "collapsed: the nav bar is already folded at load — this capture would be " +
        "indistinguishable from the load-time one, and would prove no scroll happened",
      );
    }

    await editor.click();
    for (const [i, line] of SHELL_PAGE_LINES.entries()) {
      if (i) await page.keyboard.press("Enter");
      await page.keyboard.type(line);
    }
    await settle(page, 400);

    const written = await bandState(page);
    if (written.scrollHeight < written.clientHeight + 24) {
      throw new Error(
        `collapsed: after ${SHELL_PAGE_LINES.length} typed lines the page is still not ` +
        `scrollable past the fold threshold (scrollHeight ${written.scrollHeight} vs a ` +
        `${written.clientHeight}px band, 24px needed) — either the editor stopped taking ` +
        "the typing, or the canvas stopped growing with its content",
      );
    }

    // Typing has already pushed the caret down the page, so the bar is
    // folded by now via PageScreen's caret correction. Scroll back to the
    // TOP first: the bar must come back. A fold that latches is the desktop
    // tree's own chrome-visibility bug, and photographing a folded bar
    // without ever seeing it unfold would not notice it here either.
    const box = await band.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 8; i += 1) {
      const at = await bandState(page);
      if (at.scrollTop <= 8) break;
      // Small deltas on purpose: a single large one (-4000) was measured
      // moving the band not at all, while -100 took it straight to 0.
      await page.mouse.wheel(0, -200);
      await settle(page, 150);
    }
    const top = await bandState(page);
    // TWO ARMS, REPORTED APART. They were one message until P4, and the
    // message named the wrong one: it said "a bar that stays folded has
    // latched" for a result that is measured at scrollTop 22 on this build —
    // where 22 is ABOVE navCollapsed's 8px expand threshold, so a folded bar
    // is the correct answer and the thing that actually failed is the band
    // refusing to come back to the top at all. A red test that diagnoses
    // itself wrongly costs the next reader the same hour twice.
    //
    // WHAT USED TO HOLD THE BAND OFF 0, kept because this arm is the only
    // thing standing between that bug and a shipped phone. It was a product
    // bug, not this driver failing to drive. Measured on 2026-09-02 with a
    // spy on the band's own scrollTop and every wheel logged, the band did
    // not rest anywhere — it oscillated:
    //
    //     pre-wheel   scrollTop 198
    //     wheel 1     198 -> 0, and a scrollBy immediately puts it at 222
    //     wheel 2     222 -> 22   (no correction: 22 > 8, the bar stays folded)
    //     wheel 3      22 -> 0, and a scrollBy puts it back at 222
    //     ...         22 <-> 222, for as many wheels as it is given
    //
    // 22 was not a resting place, it was 222 minus one wheel, and an even
    // number of wheels would have reported 222 instead.
    //
    // That scrollBy was PageScreen's `keepCaretVisible`, reached from the
    // `$effect` that reads `keyboardOpen` and NOT from onSelectionUpdate.
    // The chain, re-verified in jsdom before it was fixed: PageScreen's
    // `handleScroll` reads its `collapsed` derived; Screen calls that
    // handler synchronously from its own mount `$effect`, so Screen's effect
    // is a subscriber to this screen's fold state; every fold and unfold
    // re-ran it and it re-handed its scroller object to PageScreen; and
    // `$state` proxies that assignment, so the identical object came back as
    // a new identity and invalidated anyway. The caret effect read it
    // through `scroller?.bounds()` and corrected — against a caret still at
    // the end of the document, well below the band, so caretScrollDelta
    // answered the whole distance and pulled the page back down to it.
    //
    // Three checks that it was this and not something near it, kept because
    // they are what a recurrence should be re-tested against: blurring the
    // editor first changed nothing, so it was not focus; it did not fire at
    // all with the caret on line 1, so it was the caret's position and not
    // the scroll's; and wheels that never crossed the 8px expand threshold
    // produced no correction, so it was the fold state changing and not the
    // scrolling.
    //
    // Two things the earlier account of this got wrong, corrected here
    // rather than left for the next reader to trip over. It was not "the
    // bar's height change re-renders Screen": Screen's element never
    // changes and its effect has no dependency on the bar's height — the
    // subscription to `collapsed` is the whole route. And it fired on the
    // FOLD as well as the unfold; anything that CHANGES `collapsed` re-hands
    // the scroller. The unfold was simply the only one visible from here,
    // because after a correction the caret is in the band and the following
    // fold's correction is zero.
    //
    // Fixed by caret-visible.js's `caretRecheckWarranted`: the correction
    // answers to a keyboard flip or a selection event, never to a re-run.
    // PageScreen.test.js's "leaves the page where the writer scrolled it
    // when the nav bar folds and unfolds" is the fast guard; this arm is the
    // one that sees a real wheel on a real band.
    if (top.scrollTop > 8) {
      throw new Error(
        `collapsed: eight upward wheels left the band at scrollTop ${top.scrollTop} ` +
        `(folded=${top.folded}) — it never held the top, so the unfold below was never ` +
        "asked for. The fold is NOT latched at this number: above navCollapsed's 8px " +
        "expand threshold a folded bar is the right answer. What used to hold the band " +
        "off 0 was PageScreen's caret correction firing on the nav bar's fold state " +
        "changing — see the comment above this throw. If that is back, the band will be " +
        "oscillating rather than resting: log every wheel and check whether a scrollBy " +
        "follows each arrival at 0",
      );
    }
    if (top.folded) {
      throw new Error(
        `collapsed: the band is at scrollTop ${top.scrollTop}, below navCollapsed's 8px ` +
        "expand threshold, and the bar is still folded — this one IS a latch, and it is " +
        "the desktop tree's own chrome-visibility bug arriving here",
      );
    }

    // ...and now the scroll that the capture is of. 60px clears the 24px
    // collapse threshold with room to spare and stays well inside the ~99px
    // of travel the page has, so the resting position is a fixed 60 rather
    // than wherever the document happens to end.
    await page.mouse.wheel(0, 60);
    await settle(page, 300);

    const end = await bandState(page);
    if (end.scrollTop < 24 || !end.folded) {
      throw new Error(
        `collapsed: after a real scroll the band is at scrollTop ${end.scrollTop} with ` +
        `folded=${end.folded} — past 24px navCollapsed must return true, and the header ` +
        "must have dropped .ph-line2",
      );
    }
  },

  // ── the modal bottom slot, both editing strips ──────────────────────
  // The slot stopped being a tab bar in P2c: keyboard down it is navigation,
  // caret in text it is the block strip, text selected it is the selection
  // strip. Before this pair, every shell-page baseline in the suite was of
  // the tab bar — including the one taken with the keyboard up, which was
  // shot before the slot was modal and photographs a combination the app can
  // no longer produce.
  //
  // Written as a PAIR for the reason the attachment states are: the two
  // strips share two controls and the same row of chrome, so one capture
  // proves the slot renders A strip and not that it renders the RIGHT one.
  // Each driver therefore asserts a control the OTHER strip does not carry —
  // `undo` here, `strike`/`copy` below — which is what makes them two
  // photographs rather than one taken twice.

  // Caret in written text, no selection. SIX controls, NONE of them dead —
  // the visual pass's strip (toolbar-model.js's BLOCK_STRIP). Two rules
  // changed at once and both are photographed here:
  //
  //   the members   `list` went under `turn into` (turn-into-model.js) and
  //                 `keyboard-down` left the strip; the eight became six.
  //   presence      a control that cannot apply to this block or page is
  //                 ABSENT, not greyed (toolbar-state.js's `stripPresence`
  //                 draws the line; ShellApp's `unavailableIds` feeds it).
  //                 So the old "dead and visible, not hidden" rule this
  //                 caption carried is gone, and with it the one dead
  //                 control it named.
  //
  // THE COUNT HAD ALREADY FALLEN TWICE before that, and this caption was
  // wrong for a phase before P4 read it. P2c photographed three dead; P2d
  // gave `type` and `insert` their sheets and the driver went red naming
  // `insert`; P2f Task 1 gave `pin` its command — `pinIntent` in
  // pin-intent.js is where the category and title EditorCore leaves to its
  // host now live — and this caption was NOT carried, so from that commit
  // until P4 the driver threw before the shutter and the state took no
  // photograph at all. That is the exact-disabled-set doing its job and
  // nobody reading the answer: a stale caption on a strip is not a
  // nuisance, it is a state that has silently stopped being captured.
  [STATES.BLOCK_STRIP]: async (page) => {
    await shellStripSetup(page, "block-strip");

    const strip = await stripState(page);
    assertStripShape(strip, "block-strip");
    assertStripButtons(
      strip,
      "block-strip",
      // `type` leads only because the caret is inside a block — toolbarFor
      // prepends it when activeBlock is set, and a caret in a paragraph
      // always sets it (readActiveBlock, editor-snapshot.js). Its absence
      // here would mean the snapshot never reached the slot — OR that a
      // paragraph lost its two turn-into targets, since `type` is hidden
      // beside a block with nowhere to go. Either is worth the red.
      //
      // `pin` is present because the caret sits in a line the driver just
      // typed, so `pinIntent` answers a block with content. On the empty
      // paragraph the caret spends half its life in it is ABSENT (its gate
      // is `livePinIntent`, and an empty block is a fact about the block,
      // not the moment), which is the state this capture is deliberately
      // not in: SHELL_STRIP_LINE is typed before the shutter precisely so
      // the strip has something real under it.
      ["insert", "type", "bold", "italic", "pin", "undo"],
      // NONE dead. `undo` is the one control on this strip that CAN render
      // dead — with nothing on the history stack — and it is live here,
      // which it already was before the typing, on a page nobody had
      // written on. See SHELL_STRIP_LINE's comment: that is a finding about
      // EditorCore's mount, checked against the untyped capture rather than
      // assumed. Asserted as an empty set so the day a control goes grey on
      // a written line it is named here rather than absorbed.
      [],
    );
  },

  // The same page with a range selected, by real keystrokes. SIX controls,
  // NONE dead — and it was seven with one dead (`link`) until the visual
  // pass. `link` has nowhere in the shell to type a URL, and no position of
  // the caret changes that, so it is the type case of "cannot apply":
  // ShellApp's `unavailableIds` drops it before the strip renders, and
  // toolbarFor's SELECTION_STRIP still lists it so the day a URL field
  // exists the button appears in its place without a model change.
  //
  // `pin-selection` was the dead one before `link`, and this caption kept
  // saying so through P2f Task 1, which gave it a command — so this driver,
  // like the block strip's above, threw before the shutter for a whole
  // phase and quietly stopped photographing anything. Its gate now is
  // `liveSelectionPinIntent`, and the range these keystrokes make is plain
  // text with content in it, so here it is live. It is still DEAD — dead,
  // not absent; ShellApp's `disabledIds` says why a range being drawn is
  // on that side of the line — on a non-empty selection holding nothing
  // pinnable, a node selection on a divider, which is the case ShellApp
  // added the gate for and which no capture in this suite reaches.
  //
  // The lit-and-dead `link` this caption used to describe (the caret
  // inside a link, the strip unable to act on it) cannot happen any more:
  // there is no `link` button for the mark to light, and ShellApp's
  // MARK_ACTIVE no longer reads it.
  [STATES.SELECTION_STRIP]: async (page) => {
    await shellStripSetup(page, "selection-strip");

    // Real input, and the only kind available: Playwright exposes taps and
    // clicks but no drag primitive that ProseMirror reads as a text drag,
    // and a synthesized mousedown/mousemove/mouseup would be testing the
    // synthesis. Shift+Arrow goes through the browser's own selection
    // machinery in the contenteditable, which is the path a phone's own
    // selection handles end at too.
    for (let i = 0; i < SHELL_SELECTION_TAIL.length; i += 1) {
      await page.keyboard.press("Shift+ArrowLeft");
    }
    await settle(page, 300);

    const strip = await stripState(page);
    assertStripShape(strip, "selection-strip");

    // Ground truth before the strip's own opinion of it: the DOM really has
    // a range, and it is the range the keystrokes asked for. A strip that
    // said "selection" over a collapsed caret would otherwise photograph
    // perfectly well.
    if (strip.selected !== SHELL_SELECTION_TAIL) {
      throw new Error(
        `selection-strip: the keystrokes selected "${strip.selected}", expected ` +
        `"${SHELL_SELECTION_TAIL}" — no stable range, so this is not a photograph of a ` +
        "selection",
      );
    }

    assertStripButtons(
      strip,
      "selection-strip",
      // No `link`: see the header. The model still carries it; the strip
      // does not draw it.
      ["bold", "italic", "strike", "code", "pin-selection", "copy"],
      // See the header: `pin-selection` left this set in P2f Task 1 and the
      // line was carried a phase late; `link` left it — by leaving the strip
      // — in the visual pass. Nothing on this strip is dead over a plain
      // text range.
      [],
    );
    // The half that says this is a DIFFERENT strip rather than the block one
    // relabelled: `undo` is the block strip's last control and has no place
    // here — the block strip acts on the block the caret is in, and this one
    // on the range the writer drew, so a history step over a live range
    // would take the selection with it.
    if (strip.ids.includes("undo")) {
      throw new Error(
        "selection-strip: the strip carries `undo` — that is the block strip, " +
        "rendered under the selection strip's name",
      );
    }
  },

  // The block actions sheet, opened the only way a phone can open it: a
  // real tap on the 44px gutter handle that appears beside the block the
  // caret is in.
  //
  // `pin` LEADS THE LIST NOW, and it did not when this state was written.
  // The paragraph in the picture has text, so `blockActionsFor` has always
  // offered the row; what withheld it was ShellApp's BLOCK_ROW_ACTIONS,
  // the table of rows that have an action behind them, and P2f-2 Task 2
  // gave it one (`pinSheetBlock`, over the block the sheet was opened ON
  // rather than over wherever the caret has since gone). The old caption
  // here read "the four this phase can honour" and explained the absence;
  // there are five, and the absence is gone.
  //
  // `turn into` IS HERE since the visual pass, after two phases absent for
  // a reason that has not changed: block-convert's CONVERTIBLE_TYPES holds
  // board types only, so an ordinary paragraph has nowhere to go THERE.
  // turn-into-model.js gives a paragraph two targets of its own (list and
  // heading, both in place — its header says why not more), and the sheet's
  // row and the strip's `type` button read one gate, so the row came the
  // day the button did. BLOCK_SHEET_BOARD is the other half of the pair —
  // the same sheet over a q&a, where the row's targets are the converter's
  // and `title` arrives with it.
  //
  // Both are asserted by name, so the day either changes it fails here
  // rather than being absorbed into a pixel diff.
  [STATES.BLOCK_SHEET]: async (page) => {
    await shellStripSetup(page, "block-sheet");

    // Found by its id, not by its glyph. `⋮` is one character of chrome and
    // a locator keyed on it would silently start matching something else
    // the day the glyph changes; `data-button-id` is what PageScreen
    // actually renders it under.
    const handle = page.locator('[data-button-id="block-handle"]');
    const count = await handle.count();
    if (count !== 1) {
      throw new Error(
        `block-sheet: ${count} gutter handles on screen, expected exactly 1 — the handle ` +
        "shows only on the block the caret is in, and the caret is in the line just typed",
      );
    }
    // A real touch tap. ToolbarButton acts on `pointerdown` and calls
    // preventDefault precisely so the tap never moves focus off the editor
    // — which is what keeps `activeBlock` alive across the gesture — so a
    // synthesized click would be exercising a path the phone never takes.
    await handle.tap();
    await settle(page, 500);

    const sheet = await sheetState(page);
    assertSheetShape(sheet, "block-sheet", "block-actions");
    assertSheetRows(sheet, "block-sheet", SHELL_BLOCK_ROWS);
    // Every row is a control. The pair to this is BLOCK_SHEET_BOARD, which
    // has none either — the shell's inert rows all live on the header's
    // three sheets, and asserting the emptiness here is what makes that a
    // fact about this sheet rather than a fact nobody checked.
    assertInertRows(sheet, "block-sheet", []);
  },

  // The insert sheet, opened by the `+` on the block strip — the button
  // that rendered dead through all of P2c because nothing implemented it.
  //
  // EVERY ROW §3 ASKS FOR, which is new and is why this baseline was
  // deleted and re-born rather than left standing. The caption here used
  // to read "seven rows, not the spec's eleven", and named four absences
  // with four different reasons; P2f-2 answered all four. `image` and
  // `file` never needed a system picker built for them (Task 1 — the
  // desktop's own command appends an `<input type=file>` to the body and
  // there was nothing to hand off to), `table` got its grid (Task 4) and
  // `chart` got its builder (Task 5). Nothing is withheld from this sheet
  // now, so the absent-not-dead rule has nothing left to hide here.
  //
  // The count is in SHELL_INSERT_ROWS and nowhere else. It has been wrong
  // three times in this file's own comments by being remembered rather
  // than counted.
  //
  // What the image shows is that eleven rows are well past what a half
  // detent holds at a keyboard-open viewport — `visibleRows` is asserted
  // below so the clipping is on the record rather than left to whoever
  // next reads the PNG and wonders whether the sheet broke.
  //
  // This is also the regression photograph for Sheet's opening-click seal.
  // The `+` sits inside the rectangle the half detent covers, so the click
  // that a tap fires AFTER the pointerdown ToolbarButton acts on used to be
  // hit-tested against a DOM this sheet had just entered, and ran whichever
  // row landed at the button's y — one tap, sheet opened and dismissed, a
  // list board nobody chose. Without the seal this driver fails at
  // `sheetState` again, with the same "no .shell-sheet on screen" it failed
  // with for two commits, which is why the 500ms settle below is load-bearing
  // rather than politeness: a shorter one would photograph the sheet in the
  // moment between opening and being taken away.
  [STATES.INSERT_SHEET]: async (page) => {
    const sheet = await openShellInsertSheet(page, "insert-sheet");
    // Every row is a control — there is no such thing as a dead insert
    // row, which is the whole content of the absent-not-dead rule now
    // that nothing is absent.
    assertInertRows(sheet, "insert-sheet", []);
    // THE FINDER SITS OVER THE ROWS. The second device pass ("insert
    // choice have no search field") put a Field at the top of the sheet
    // and took the sheet to the full detent so the row the field narrows
    // to is visible rather than a scroll away (ShellApp's sheet comment).
    // The field is asserted by its placeholder, the only thing on screen
    // that says what it finds; its VALUE is empty on open by construction
    // (openInsertSheet resets it) and a photograph of a pre-filled finder
    // would be captioned as the wrong sheet.
    if (sheet.fields.length !== 1 || sheet.fields[0].placeholder !== "find a block") {
      throw new Error(
        `insert-sheet: the sheet holds ${sheet.fields.length} fields ` +
        `(${JSON.stringify(sheet.fields)}), expected one placeheld "find a block"`,
      );
    }
    if (sheet.fields[0].value !== "") {
      throw new Error(
        `insert-sheet: the finder opened holding "${sheet.fields[0].value}" — openInsertSheet ` +
        "resets the query on every open",
      );
    }
    // THE SECTIONS ARE ON SCREEN. The fourth device pass made this sheet
    // the slash menu itself (insert-menu.js) — every block command, in
    // the menu's four sections — and the eyebrows are what keep twenty
    // rows readable at a glance. Their absence would photograph as one
    // long undifferentiated list, which is what the sheet looked like
    // when it held eleven hand-written rows.
    const eyebrows = await page.$$eval(
      '.shell-sheet[data-sheet="insert"] .shell-eyebrow',
      (nodes) => nodes.map((n) => (n.textContent ?? "").trim()),
    );
    if (eyebrows[0] !== "structure" || eyebrows.length < 2) {
      throw new Error(
        `insert-sheet: the section eyebrows read [${eyebrows.join(" | ")}], expected to open ` +
        'with "structure" — the sheet groups the menu by its own sections',
      );
    }
  },

  // THE SAME SHEET, WITH THE KEYBOARD IOS ACTUALLY REPORTS.
  //
  // Read STATES.IOS_KEYBOARD_SHEET (scenes.js) first: what the two widget
  // modes are, why the shrink every other keyboard state performs is
  // Android's and only Android's, that the iOS half is a harness SEAM
  // rather than real input because no engine API will move the visual
  // viewport on its own, and what the seam therefore cannot prove. None of
  // that is repeated here.
  //
  // WHY THE INSERT SHEET, and not a bare keyboard-up page. Under
  // resizes-visual the only surface whose geometry differs from Android's
  // is a `position: fixed` one: everything else in the shell is in the
  // flow inside `.shell-root`, which sizes to `--app-height` and is
  // therefore keyboard-clear by construction in BOTH modes. A
  // "keyboard-ios" state with no sheet on screen would be a state that
  // cannot fail on the thing it exists for — the two mechanisms hiding
  // each other, with the redundant one holding the shutter. Sheet.svelte
  // is one of exactly two files the rules test lets leave the flow, and it
  // is the one that went off the top of the display.
  //
  // WHAT IS ASSERTED THAT NO OTHER STATE CAN. `--kb-overlay` carrying a
  // keyboard rather than 0, and the sheet's bottom edge landing ON the
  // visible bottom rather than merely somewhere inside the layout
  // viewport. The second is the one with teeth: a sheet that did not lift
  // at all sits flat at `bottom: 0` of a full-height layout viewport,
  // which is entirely behind the keyboard while `bottom > innerHeight` is
  // false for it — the reason assertSheetShape now judges that edge
  // against the visible band instead.
  //
  // PROVEN RED, AND PROVEN RED WHERE NOTHING ELSE GOES RED. Sheet.svelte's
  // `margin-bottom: var(--kb-overlay, 0px)` was temporarily replaced with
  // `0px` — the exact defect the P2d fix cured — and both projects were run
  // over `insert-sheet` and this state together. This one failed with
  //
  //   the box is 500..664 and the visible band is 0..328 — its bottom edge
  //   is under the keyboard
  //
  // and `android-webview @ insert-sheet` PASSED, in the same run, with the
  // same broken stylesheet. That pair is the whole argument for the state:
  // on a viewport mode where the layout viewport already shrank, removing
  // the lift changes nothing, so no Android capture can ever see it. The
  // lift was restored and both went green again.
  [STATES.IOS_KEYBOARD_SHEET]: async (page) => {
    const label = "ios-keyboard-sheet";
    const size = page.viewportSize();
    if (!size) throw new Error(`${label}: no viewport to measure the phone by`);

    // The caption, computed from the phone and the keyboard rather than
    // read back off the app. raiseKeyboard derives the same plan in order
    // to DO the work; this one exists to be compared against what the app
    // then did, which is the only arrangement in which either can be
    // wrong on its own.
    const plan = keyboardFixture({
      mode: WIDGET_MODE.RESIZES_VISUAL,
      deviceHeight: size.height,
      keyboardPx: IOS_KEYBOARD_PX,
    });

    // Same entry as INSERT_SHEET, one argument different. It carries the
    // whole chain — the strip opening, the eleven rows, the detent, the
    // opening-click seal — so a regression in any of them fails here for
    // the reason it fails there, and only the geometry below is new.
    const sheet = await openShellInsertSheet(page, label, WIDGET_MODE.RESIZES_VISUAL, {
      // The keyboard this state is about belongs to the sheet's own
      // finder now — see openShellInsertSheet.
      refocusField: true,
    });

    const facts =
      `sheet ${sheet.top}..${sheet.bottom} (h ${sheet.height}) · layout viewport ` +
      `${sheet.viewport}px · visual viewport ${sheet.vvHeight}px at offset ` +
      `${sheet.vvOffsetTop}px · --kb-inset ${sheet.kbInset}px · --kb-overlay ` +
      `${sheet.kbOverlay}px · --app-height ${sheet.appHeight}px`;
    console.log(`[${label}] ${facts}`);

    // The variable that is 0 in every other photograph in this suite. It
    // is checked before the geometry because it is the CAUSE of it: a
    // failure here says the app never entered resizes-visual, and a
    // failure below says it did and got the arithmetic wrong.
    if (sheet.kbOverlay !== plan.kbOverlay) {
      throw new Error(
        `${label}: --kb-overlay is ${sheet.kbOverlay}px, expected ${plan.kbOverlay}px — ` +
        "under resizes-visual it must carry the whole keyboard, because the layout viewport " +
        "took none of it. At 0 this capture is the Android geometry under an iPhone " +
        `filename, which is the one thing the state exists to rule out. ${facts}`,
      );
    }
    if (sheet.kbInset !== plan.kbInset) {
      throw new Error(
        `${label}: --kb-inset is ${sheet.kbInset}px, expected ${plan.kbInset}px — the two ` +
        "custom properties agree in this mode and only in this mode, so a disagreement here " +
        `is keyboard-state.js measuring a keyboard of a size nobody asked for. ${facts}`,
      );
    }

    // WHERE THE BOTTOM EDGE LANDS. assertSheetShape has already rejected a
    // box outside the visible band; this is the stronger claim, and the
    // one the whole fixture is for: the sheet sits ON the lowest visible
    // pixel. A sheet 100px above it is inside the band and still wrong —
    // a strip of dead space between the sheet and the keyboard, which is
    // what an overlay computed from the wrong number looks like when it is
    // merely too small rather than zero. 1px for the rounding
    // visualViewport's fractional height introduces.
    //
    // ONE CHECK, NOT TWO. The obvious companion — `bottom >= innerHeight`,
    // naming the never-lifted sheet outright — would never once run: the
    // never-lifted box is 336px away from the edge, so this fires first and
    // always. A second condition that cannot execute is a check nobody can
    // prove, so the case it would have named is named in this message
    // instead.
    if (Math.abs(sheet.bottom - plan.visibleBottom) > 1) {
      throw new Error(
        `${label}: the sheet's bottom edge is at ${sheet.bottom}, and the lowest pixel the ` +
        `keyboard leaves visible is ${plan.visibleBottom} — a fixed surface anchored to the ` +
        "bottom and lifted by --kb-overlay lands on that edge in either widget mode. At " +
        `${sheet.viewport} it never lifted at all and is wholly behind the keyboard (and ` +
        "`bottom > innerHeight` is false for exactly that box, which is why the band and not " +
        `the layout viewport is what judges it). ${facts}`,
      );
    }
  },

  // Row 2, opened the only way a phone can open it: a real tap on the page
  // header's own `find`.
  //
  // It enters with the keyboard already up, and that is a harness fact
  // rather than a claim about the app. Find was put on the header
  // precisely because it is reachable with the keyboard DOWN, and the
  // strip's field is what raises it — but the VR keyboard is a viewport
  // shrink the DRIVER performs, so no driver can photograph focus raising
  // anything. What the photograph can show is the other half, which is
  // the half that has been wrong before: the strip sitting above the
  // keyboard rather than under it. Entering through shellStripSetup buys
  // that plus the writing there is to search, which a shell page can only
  // acquire by being typed into.
  //
  // The caret is where the typing left it — said out loud, because a
  // freshly opened page does NOT leave it at the top (EditorCore restores
  // it to the last block) and the sheet drivers above lost tests to that.
  // Here it does not matter to find, which searches the whole document;
  // it matters that the line exists.
  [STATES.FIND_STRIP]: async (page) => {
    await shellStripSetup(page, "find-strip");
    // The page as the writing left it. Asserted again at the end: the
    // whole point of a field in the slot is that the keystrokes stop going
    // into the document, and the failure mode of getting that wrong is
    // silent — the query is simply typed into the page instead.
    const wrote = await docText(page);

    // On line 1 of the header, so it survives the fold the open keyboard
    // has already caused. A raw `<button>`, unlike everything in the slot:
    // it takes focus off the editor, which is fine here and would not be
    // on a strip control (see ToolbarButton's preventDefault).
    const find = page.locator(".ph-find");
    await find.waitFor({ state: "visible" });
    await find.tap();
    await settle(page, 500);

    const opened = await findStripState(page);
    if (!opened) {
      throw new Error(
        "find-strip: the header's `find` opened no strip — `findOpen` has no producer, or " +
        "it stopped outranking the row the keyboard was already showing",
      );
    }
    // The one thing that makes the mode usable, asserted before anything is
    // typed into it. If this is false the keystrokes below land in the
    // document and the strip photographs an empty field beside a page that
    // grew a word.
    if (!opened.focused) {
      throw new Error(
        "find-strip: the field does not hold focus on open — nothing raises the keyboard, " +
        "and the only typable thing in the mode cannot be typed into",
      );
    }
    // An untyped field says NOTHING, not "no matches". A search nobody has
    // run has not failed, and the frame the strip opens on is the frame the
    // user has had least chance to do anything on.
    if (opened.label !== "") {
      throw new Error(
        `find-strip: the strip opened saying "${opened.label}" — an untyped field reporting ` +
        "a result accuses the user of a search they have not made",
      );
    }
    if ([...opened.disabled].sort().join(",") !== "next,prev") {
      throw new Error(
        `find-strip: on open the dead controls are [${opened.disabled.join(",")}], expected ` +
        "[next,prev] — with no query there is nothing for either arrow to step between",
      );
    }

    await page.keyboard.type(SHELL_FIND_QUERY);
    await settle(page, 400);

    const strip = await findStripState(page);
    assertSlotOccupant(strip, "find-strip", {
      "a block strip": strip.toolbarStrip,
      "the chip strip": strip.suggestionStrip,
    });

    // Exactly these three, in this order, and the field is not among them —
    // it is an `<input>`, which is the whole reason row 2 has its own
    // renderer. Between Task 2 and Task 3 `field` rendered as a
    // ToolbarButton labelled "find": a button standing where a text input
    // goes, which photographs perfectly well.
    if (strip.ids.join(",") !== "prev,next,close") {
      throw new Error(
        `find-strip: the strip's controls are [${strip.ids.join(",")}], expected ` +
        "[prev,next,close] beside the field",
      );
    }
    if (strip.value !== SHELL_FIND_QUERY) {
      throw new Error(
        `find-strip: the field holds "${strip.value}", expected "${SHELL_FIND_QUERY}" — the ` +
        "keystrokes went somewhere else, so this is not a photograph of a search",
      );
    }
    const after = await docText(page);
    if (after !== wrote) {
      throw new Error(
        "find-strip: the document changed while the query was typed — the field is not " +
        `holding the keystrokes. Page now reads "${after}", was "${wrote}"`,
      );
    }
    // The search actually ran, on the page, and not only in the strip's
    // opinion of it. One match, and it is the active one — a count with no
    // highlight under it is a label reporting a search the editor never did.
    if (strip.marks !== 1 || strip.activeMarks !== 1) {
      throw new Error(
        `find-strip: the page carries ${strip.marks} highlight(s), ${strip.activeMarks} of ` +
        `them active — "${SHELL_FIND_QUERY}" occurs once in the typed line, so the strip ` +
        "and the document disagree about the search",
      );
    }
    if (strip.label !== "1 of 1") {
      throw new Error(
        `find-strip: the count reads "${strip.label}", expected "1 of 1" — the label is what ` +
        "this photograph exists to show, and the arrows beside it are judged against it",
      );
    }
    // THE JUDGEMENT CALL, asserted by name. Task 1 kept both arrows live at
    // a single match on purpose: the label says "1 of 1", so a greyed arrow
    // would be the strip contradicting its own sentence, and the extension
    // accepts both (it mods by matches.length and re-lands on the one
    // match). This is the only state that can see it. The day someone greys
    // them, this fails here rather than moving pixels nobody re-reads.
    if (strip.disabled.length !== 0) {
      throw new Error(
        `find-strip: [${strip.disabled.join(",")}] render dead beside a "1 of 1" label — at ` +
        "one match both arrows are deliberately live no-ops, because a greyed arrow beside " +
        "that sentence contradicts it",
      );
    }

    // The strip does not scroll (`overflow: hidden`, by design — the one
    // typable thing in the mode must not be scrollable off screen), so an
    // over-subscribed strip clips instead, and `close` is last in the
    // order: the mode's only exit is the first thing a pixel too many
    // takes away.
    if (strip.scrollWidth > strip.clientWidth + 1) {
      throw new Error(
        `find-strip: content is ${strip.scrollWidth}px wide inside a ${strip.clientWidth}px ` +
        "strip that cannot scroll — something is clipped off the end, and `close` is last",
      );
    }
    for (const [id, b] of Object.entries(strip.boxes)) {
      if (b.left < strip.left - 1 || b.right > strip.right + 1) {
        throw new Error(
          `find-strip: \`${id}\` sits at ${b.left}..${b.right} in a strip spanning ` +
          `${strip.left}..${strip.right} — it is off the edge at phone width`,
        );
      }
    }
    // Tall enough to tap and large enough not to zoom the viewport on
    // focus. Both floors are the shell's own (--tap, --text-input); read
    // resolved rather than trusted, because both are max() of tokens that
    // land under the floor at the phone's --ui-scale.
    if (!strip.field || strip.field.height < 44) {
      throw new Error(
        `find-strip: the field's box is ${strip.field?.height}px tall — under the 44px floor ` +
        "every shell control carries",
      );
    }
    if (strip.fontPx < 16) {
      throw new Error(
        `find-strip: the input renders at ${strip.fontPx}px — under 16px mobile Safari zooms ` +
        "the viewport on focus and every fixed element is wrong until the user pinches back",
      );
    }
    // "The field absorbs the width" is FindStrip's stated reason for not
    // scrolling, and this is that sentence as a measurement. The field is
    // the only `flex: 1 1 auto` in the strip; if it is not the widest thing
    // in there, the three fixed controls have eaten the slack and the
    // reason the strip does not scroll has stopped being true.
    const widest = Math.max(...Object.values(strip.boxes).map((b) => b.width));
    if (strip.field.width <= widest) {
      throw new Error(
        `find-strip: the field is ${strip.field.width}px against a widest control of ` +
        `${widest}px — it has stopped absorbing the width, which is the only reason this ` +
        "strip is allowed not to scroll",
      );
    }
    // Between the field and the arrows, which is where the strip's own
    // sentence reads left to right: what you typed, what it found, where to
    // go next. Its position is not a prop — it is rendered inside the
    // `field` branch of the loop — so this is the assertion that keeps it
    // tied to the id it captions.
    if (
      !strip.countBox ||
      strip.countBox.left < strip.field.right ||
      strip.countBox.right > strip.boxes.prev.left
    ) {
      throw new Error(
        `find-strip: the count sits at ${strip.countBox?.left}..${strip.countBox?.right}, ` +
        `outside the gap between the field (ends ${strip.field.right}) and \`prev\` ` +
        `(starts ${strip.boxes.prev.left})`,
      );
    }
  },

  // Row 4, produced the only way anything produces it: a `/` typed into the
  // document. There is no other door — the chips are derived from the slash
  // plugin's own live state (computeSnapshot's `snapshot.query`), and a
  // driver that wanted them without typing would have to reach into the
  // plugin, which is the hook this file exists to refuse.
  //
  // The trigger goes on a FRESH LINE because @tiptap/suggestion only opens
  // a session after a line start or a space, and shellStripSetup leaves the
  // caret after a full stop. Enter first, then the query — the caret is
  // placed by real keystrokes and where it is placed is load-bearing, which
  // is the trap the sheet drivers above already paid for once.
  [STATES.SUGGESTION_STRIP]: async (page) => {
    await shellStripSetup(page, "suggestion-strip");

    await page.keyboard.press("Enter");
    // A per-keystroke delay, not politeness: the plugin opens its session
    // on the transaction carrying `/` and re-filters on each one after, and
    // the strip is derived from the state that leaves behind.
    await page.keyboard.type(SHELL_SLASH_QUERY, { delay: 60 });
    await settle(page, 400);

    // Ground truth before the strip's own opinion of it: the trigger is
    // really in the document. A chip strip over a page with no `/` on it
    // would be chips resolved from a stale query — which is exactly the
    // latch Task 4 first shipped and `95bfc854` deleted.
    const text = await docText(page);
    if (!text.endsWith(SHELL_SLASH_QUERY)) {
      throw new Error(
        `suggestion-strip: the page reads "${text}", which does not end in ` +
        `"${SHELL_SLASH_QUERY}" — the trigger never reached the document, so whatever is ` +
        "in the slot was not produced by it",
      );
    }

    const strip = await suggestionStripState(page);
    if (!strip) {
      throw new Error(
        `suggestion-strip: "${SHELL_SLASH_QUERY}" left no chip strip in the slot — row 4 ` +
        "declined, which is what it does when the query resolves to nothing at all",
      );
    }
    assertSlotOccupant(strip, "suggestion-strip", {
      "a block strip": strip.toolbarStrip,
      "the find strip": strip.findStrip,
    });

    // §3's refusal, observed rather than declared. `95bfc854` gave it a
    // producer (`floatingChrome={false}` swaps SlashCommands' renderer for
    // silentSuggestionRender); this is the first thing in the suite that
    // can see it, because the element only exists while a trigger is live
    // and no capture before this one ever had a live trigger. Two menus on
    // one `/` is what the phone had until that commit.
    if (strip.floatingMenu) {
      throw new Error(
        "suggestion-strip: the desktop's floating .slash-command-menu is on screen beside " +
        "the chips — `/` opens two menus on the phone, which is the §3 refusal " +
        "`floatingChrome={false}` exists to honour",
      );
    }

    // The caption, written out rather than imported from
    // suggestion-strip-model.js — a caption derived from the thing it
    // describes cannot disagree with it. A new command whose title carries
    // "he" fails here instead of quietly joining the photograph.
    const got = strip.labels.join(" | ");
    const expected = ["heading 1", "heading 2", "heading 3"].join(" | ");
    if (got !== expected) {
      throw new Error(
        `suggestion-strip: the chips read [${got}], expected [${expected}] for ` +
        `"${SHELL_SLASH_QUERY}"`,
      );
    }
    // No chip can be dead: the chip list and the command table are the same
    // list, so a chip exists exactly when its command does. That is a
    // property of the construction, and this is the assertion that it still
    // holds on screen.
    if (strip.disabled.length !== 0) {
      throw new Error(
        `suggestion-strip: [${strip.disabled.join(",")}] render dead — a chip is derived ` +
        "from the command it runs, so a dead one means the two have come apart",
      );
    }
    if (strip.rows !== 1) {
      throw new Error(
        `suggestion-strip: the chips sit on ${strip.rows} rows — the strip wrapped, and a ` +
        "second row is chrome stacking vertically, which §1 forbids outright",
      );
    }
    // This strip DOES scroll, unlike find's, and that is why the query is
    // three characters rather than a bare `/`: the answer to `/he` is three
    // chips, so "the chips fit the strip" is a claim this photograph can
    // make. A capture whose chips ran off the end would be a picture of a
    // scroll position instead.
    if (strip.chipsInside !== strip.labels.length || strip.scrollWidth > strip.clientWidth + 1) {
      throw new Error(
        `suggestion-strip: ${strip.chipsInside} of ${strip.labels.length} chips are inside ` +
        `the strip's box, with ${strip.scrollWidth}px of content in ${strip.clientWidth}px ` +
        "— this query's whole answer is meant to fit one row at phone width",
      );
    }
  },

  // A block held off the page, photographed with the pointer STILL DOWN.
  //
  // The only mid-stroke capture in this file, and it has to be: the drag
  // ends at pointerup and what pointerup produces is a drop or a cancel, so
  // a released lift is a picture of the document afterwards rather than of
  // §3's gesture. The driver therefore never lets go, and the assertion
  // that the document is still in its typed order is what says so.
  //
  // THE POINTER IS THE MOUSE, and that is a harness limit stated rather
  // than worked around. Playwright's touchscreen offers `tap()` and nothing
  // else — there is no held touch stroke to be had — while `page.mouse` is
  // real trusted input dispatched through the browser, which raises the
  // same pointerdown / pointermove sequence PageScreen listens for on
  // `window`. Every decision in that path is pointerType-blind, so the
  // gesture under test is the real one. The one thing it therefore CANNOT
  // exercise is `touch-action`, which only a touch stroke consults — and
  // that is already a recorded device-pass item (PageScreen's header),
  // not something this state is quietly claiming to have covered.
  //
  // WHAT THE PROBE BELOW IS FOR. Nothing here would otherwise distinguish
  // "the hold armed the lift" from "pointerdown armed it" — the shutter
  // sees only the end state. A `setTimeout` scheduled by the real
  // pointerdown reads the DOM 150ms into the press, inside the 350ms hold,
  // and reports whether a block was already up. It observes; it does not
  // drive, which is the line this file draws — the state is still reached
  // by input alone.
  [STATES.BLOCK_LIFT]: async (page) => {
    const editor = page.locator(".ProseMirror").first();
    await editor.waitFor({ state: "visible" });

    // Typing is the only way a shell page acquires content — no import, no
    // paste path, no second surface (SHELL_PAGE_LINES says the same).
    await editor.click();
    for (const [i, line] of SHELL_DRAG_LINES.entries()) {
      await page.keyboard.type(line);
      if (i < SHELL_DRAG_LINES.length - 1) await page.keyboard.press("Enter");
    }
    await settle(page, 300);

    // THE CARET IS PLACED, not inherited. Typing leaves it on the LAST line,
    // and the handle is derived from the snapshot's activeBlock — so a
    // driver that pressed whatever handle was on screen would lift block 5
    // and photograph a drag it did not choose. P2d lost four first-draft
    // tests to the sibling of this (a freshly opened page restores the
    // cursor to the last block, not the first).
    await page.locator(".ps-canvas .ProseMirror > p").nth(SHELL_DRAG_FROM).click();
    await settle(page, 300);

    const before = await liftGeometry(page);
    if (!before.canvas || !before.band) {
      throw new Error("block-lift: no .ps-canvas or .shell-screen-content — the shell did not boot");
    }
    const texts = before.blocks.map((b) => b.text);
    if (texts.join(" | ") !== SHELL_DRAG_LINES.join(" | ")) {
      throw new Error(
        `block-lift: the page holds [${texts.join(" | ")}], expected ` +
        `[${SHELL_DRAG_LINES.join(" | ")}] — the typing did not land as one block per line, ` +
        "so every index below addresses a different block than it names",
      );
    }
    // The precondition P1c's fourteen wrong baselines are the argument for:
    // a capture named for a state has to prove the state was entered, and
    // that means proving the screen did not already look like this.
    if (before.lifted.length || before.line || before.handleLit) {
      throw new Error(
        "block-lift: a block is already lifted at rest — the capture could not be told " +
        "apart from a load-time one",
      );
    }
    if (before.handles !== 1) {
      throw new Error(
        `block-lift: ${before.handles} gutter handles on screen, expected exactly 1 — the ` +
        "handle shows only on the block the caret is in",
      );
    }
    // Nothing to scroll. Asserted before the drag rather than after, because
    // "the band never moved" only means anything if the band COULD not move:
    // on a scrollable band a still document would prove auto-scroll dead
    // instead of proving the finger was outside its bands.
    if (before.band.scrollHeight > before.band.clientHeight) {
      throw new Error(
        `block-lift: the band scrolls (${before.band.scrollHeight} in ` +
        `${before.band.clientHeight}) — six lines have outgrown it, and a drag over a ` +
        "scrollable band photographs whichever auto-scrolled frame the shutter caught",
      );
    }

    const handle = page.locator('[data-button-id="block-handle"]');
    const hbox = await handle.boundingBox();
    if (!hbox) throw new Error("block-lift: the gutter handle has no box");
    const from = before.blocks[SHELL_DRAG_FROM];
    // The handle's 44px box is CENTRED ON ITS BLOCK'S FIRST LINE
    // (PageScreen's gutterHandle, gutter-handle-line.js) — not hung from
    // the block's top, which is what this used to assert and what put the
    // glyph a line low on a Samsung. So the comparison is centre to centre:
    // the box's middle against the block's top plus half its first line.
    // This is the assertion that the handle about to be pressed belongs to
    // the block the caret was put in — the one thing a screenshot of a
    // 44px glyph in a column cannot say for itself — and, now, that it sits
    // ON that block's line rather than merely near it.
    if (!Number.isFinite(from.lineHeight)) {
      throw new Error(
        `block-lift: block ${SHELL_DRAG_FROM} ("${from.text}") has no px line-height ` +
        "— the handle is centred on it, so without it the placement cannot be judged",
      );
    }
    const handleMid = hbox.y + hbox.height / 2;
    const lineMid = from.top + from.lineHeight / 2;
    if (Math.abs(handleMid - lineMid) > 2) {
      throw new Error(
        `block-lift: the handle's centre is at y=${Math.round(handleMid)} and the first ` +
        `line of block ${SHELL_DRAG_FROM} ("${from.text}") is centred at ` +
        `${Math.round(lineMid)} (top ${from.top}, line ${from.lineHeight}px) — the handle ` +
        "is beside a different block than the caret is in, or off its line",
      );
    }

    const gapBlock = before.blocks[SHELL_DRAG_TO_GAP];
    const targetY = gapBlock.top;
    // §3's 60px auto-scroll bands, at the two edges of the content band. The
    // finger has to land outside both or the canvas scrolls for as long as
    // it is down and the photograph is of a moving document. Checked rather
    // than assumed, because it is a fact about how tall this scene happens
    // to be and a font metric could move it.
    if (targetY < before.band.top + 60 || targetY > before.band.bottom - 60) {
      throw new Error(
        `block-lift: the drop point y=${targetY} is inside one of the 60px auto-scroll ` +
        `bands of a band spanning ${before.band.top}..${before.band.bottom}`,
      );
    }

    // Reads the DOM 150ms into the hold. Scheduled BY the real pointerdown
    // so the window is measured from the event rather than from whenever a
    // round trip happened to land — see this state's header.
    await page.evaluate(() => {
      window.__vrLiftProbe = "no pointerdown was seen";
      window.addEventListener(
        "pointerdown",
        () => {
          setTimeout(() => {
            window.__vrLiftProbe = document.querySelector(".ps-lifted")
              ? "a block was already lifted"
              : "nothing was lifted yet";
          }, 150);
        },
        { once: true, capture: true },
      );
    });

    const px = Math.round(hbox.x + hbox.width / 2);
    const py = Math.round(hbox.y + hbox.height / 2);
    await page.mouse.move(px, py);
    await page.mouse.down();
    // Past LONG_PRESS_MS (350) with room, and with NO movement in between:
    // the slop is re-checked inside the timer, so a driver that nudged the
    // pointer here would arm nothing and the failure would look like a dead
    // timer.
    await settle(page, 600);

    const probe = await page.evaluate(() => window.__vrLiftProbe);
    if (probe !== "nothing was lifted yet") {
      throw new Error(
        `block-lift: 150ms into the press, ${probe} — the lift is supposed to be the ` +
        "timer's answer at 350ms, and a block up this early means pointerdown armed it",
      );
    }

    const held = await liftGeometry(page);
    // Two failures, told apart, because they have nothing to do with each
    // other. This one is "the hold never armed": no drag state at all.
    if (!held.handleLit || !held.line) {
      throw new Error(
        `block-lift: holding the handle for 600ms armed nothing — the handle is ` +
        `${held.handleLit ? "lit" : "unlit"} and the indicator is ` +
        `${held.line ? "drawn" : "absent"}, so lift() never ran`,
      );
    }
    // And this one is the drag arming with nothing to see, which is where
    // this state found its defect. See the header block above it.
    if (held.lifted.length !== 1) {
      throw new Error(
        `block-lift: the drag armed — the frame carries .shell-root.dragging, the handle is ` +
        "lit and the indicator is drawn — but no element carries .ps-lifted, so §3's scale " +
        "and shadow are on nothing. This is the defect this state was written for, and the " +
        "shape it takes: the mark has to be a ProseMirror DECORATION " +
        "(EditorCore.setLiftedBlock), because a class written onto a node the editor renders " +
        "is a foreign mutation its DOMObserver re-syncs away — measured with a " +
        "MutationObserver, it lands on the paragraph and the node is replaced within ~100ms, " +
        "leaving the class on an orphan, on any paragraph and not just the lifted one. If " +
        "this fires again, the lift has gone back to mutating the editor's DOM, or the " +
        "decoration is no longer being applied. NOT a defect in this driver",
      );
    }
    // The lift alone proposes no move. Both raw answers a press inside its
    // own block can produce collapse to fromIndex, so this is true by
    // construction rather than by luck — and it is the one assertion that
    // separates "the indicator appeared" from "the indicator says
    // something".
    if (!held.line || held.line.index !== String(SHELL_DRAG_FROM)) {
      throw new Error(
        `block-lift: on lift the indicator reads ${held.line ? held.line.index : "absent"}, ` +
        `expected ${SHELL_DRAG_FROM} — a block that has not been dragged anywhere lands ` +
        "back where it came from",
      );
    }

    // The drag. Down the gutter, in steps, so the move handler sees a
    // stroke rather than a teleport — and with x held in the 44px column,
    // which is where a finger holding the handle actually travels.
    await page.mouse.move(px, targetY, { steps: 12 });
    await settle(page, 300);

    const now = await liftGeometry(page);

    // ── the lifted block ────────────────────────────────────────────────
    if (now.lifted.length !== 1) {
      throw new Error(
        `block-lift: ${now.lifted.length} blocks carry .ps-lifted mid-drag, expected 1`,
      );
    }
    const [lifted] = now.lifted;
    if (lifted.text !== SHELL_DRAG_LINES[SHELL_DRAG_FROM]) {
      throw new Error(
        `block-lift: the block in the air reads "${lifted.text}", expected ` +
        `"${SHELL_DRAG_LINES[SHELL_DRAG_FROM]}" — the wrong block was lifted`,
      );
    }
    // §3's "slight scale", resolved rather than declared. A matrix whose
    // x-scale is 1 is the class applied with no rule behind it.
    const scale = Number(/^matrix\(([^,]+),/.exec(lifted.transform)?.[1]);
    if (!(scale > 1)) {
      throw new Error(
        `block-lift: the lifted block's transform is "${lifted.transform}" — it resolves to ` +
        "no scale at all, so nothing on screen says the block left the page",
      );
    }
    if (!lifted.shadow || lifted.shadow === "none") {
      throw new Error(
        `block-lift: the lifted block's box-shadow is "${lifted.shadow}" — §3's shadow tier ` +
        "is half of what makes a lift legible",
      );
    }
    // P2d's trap, and the reason a model assertion is not enough: both sheet
    // states asserted the right sheet with the right rows at the right
    // height while photographing a blank band, because the sheet sat off the
    // top of the display. A lifted block outside the viewport is the same
    // failure with a different subject.
    if (lifted.top < 0 || lifted.bottom > now.viewport) {
      throw new Error(
        `block-lift: the lifted block's box is ${lifted.top}..${lifted.bottom} in a ` +
        `${now.viewport}px viewport — it is not in the photograph`,
      );
    }
    if (!now.handleLit) {
      throw new Error(
        "block-lift: the gutter handle is not lit — `.ps-gutter.lifting` is what says the " +
        "control under the finger is the one holding the block",
      );
    }

    // ── the indicator, and the model behind it ──────────────────────────
    // The whole reason data-index exists. This hairline is 2px on a 412px
    // frame against a 0.002 gate, so it can move a block, or stop being
    // drawn, without the baseline noticing — P2c-2 watched a 44px control
    // disappear that way. The number is the drop's own answer, read off the
    // element the drop will use.
    if (!now.line) {
      throw new Error(
        "block-lift: no .ps-drop-line mid-drag — the indicator is not drawn, and a drag " +
        "with no indicator tells the writer nothing about where the block will land",
      );
    }
    if (now.line.index !== String(SHELL_DRAG_TO_INDEX)) {
      throw new Error(
        `block-lift: the indicator says the block lands at index ${now.line.index}, ` +
        `expected ${SHELL_DRAG_TO_INDEX} for a finger at the top of block ` +
        `${SHELL_DRAG_TO_GAP} ("${gapBlock.text}")`,
      );
    }
    // And where it is DRAWN, which is the other list and the other question
    // (drop-target.js grew insertionLineIndex for exactly this). The line is
    // centred on the boundary — `margin-top: -1px` on a 2px rule — so its
    // own top sits one pixel above the block it points above.
    if (Math.abs(now.line.top - (gapBlock.top - 1)) > 2) {
      throw new Error(
        `block-lift: the indicator is drawn at y=${now.line.top} and the gap it names is at ` +
        `${gapBlock.top} — the hairline is pointing at a different boundary than the drop ` +
        "would use, which is worse than drawing nothing",
      );
    }
    if (now.line.left < now.canvas.left || now.line.right > now.canvas.right) {
      throw new Error(
        `block-lift: the indicator spans ${now.line.left}..${now.line.right} outside the ` +
        `canvas (${now.canvas.left}..${now.canvas.right})`,
      );
    }

    // ── and nothing has happened to the document ────────────────────────
    // Not a "no error was thrown" check. The drop is pointerup's work and
    // the finger has not come off, so a document that had already reordered
    // would mean the move fired on a pointermove — a block that jumps out
    // from under the finger mid-drag, which no unit test asserts against
    // because none of them get to look at the doc mid-stroke.
    if (now.band.scrollTop !== 0) {
      throw new Error(
        `block-lift: the band scrolled to ${now.band.scrollTop} — the finger is outside ` +
        "both 60px bands, so auto-scroll has armed where it should not have",
      );
    }
    const text = await docText(page);
    if (text !== SHELL_DRAG_LINES.join("")) {
      throw new Error(
        `block-lift: the document reads "${text}" mid-drag — nothing may move until the ` +
        "finger comes off, and this one already has",
      );
    }
    // Deliberately no pointerup. The shutter is next.
  },

  // ── the page's own chrome (P2f) ────────────────────────────────────────
  //
  // Five states, four of them on `shell-trail-page` and one on the empty
  // `shell-page`. scenes.js carries the catalogue argument for that split;
  // what follows is what the DRIVERS had to do about it.
  //
  // Only the pin needs the keyboard. Every other surface here is reached
  // with it DOWN — that is the point of putting them on the header and at
  // the end of the canvas — so four of the five enter through
  // `shellPageAtRest` rather than `shellStripSetup`, and the one that does
  // shrink the viewport says why at the line that does it.

  // The pin's breadcrumb, and the only state in this file with a clock
  // running against it (PIN_TOAST_MS, 4000ms — see scenes.js and
  // toastState). Nothing settles after the toast appears: the wait IS the
  // settle, and the shutter is next.
  //
  // THE CARET IS PLACED, NOT INHERITED. A freshly opened page restores the
  // cursor to the LAST block (EditorCore), and the last block of this
  // fixture is a different sentence from the one this photograph is
  // captioned with — P2d lost four first-draft tests to exactly that. The
  // click on the middle paragraph is what makes the pin's own title
  // predictable, so the block's text is asserted before the click as well
  // as the strip's state after it.
  [STATES.PIN_TOAST]: async (page) => {
    const editor = page.locator(".ProseMirror").first();
    await editor.waitFor({ state: "visible" });

    const before = await stripState(page);
    if (before !== null) {
      throw new Error(
        "pin-toast: an editing strip is already in the slot at load — the capture could not " +
        "be told apart from the load-time one, and would prove no keyboard ever opened",
      );
    }

    // `.ps-canvas`, not `.tiptap-wrapper`: the shell renders EditorCore
    // directly and the wrapper is TipTapEditor's own element, so a locator
    // borrowed from a desktop state would match nothing here (BLOCK_LIFT
    // is the shell precedent).
    const block = page.locator(".ps-canvas .ProseMirror > p").nth(SHELL_PIN_BLOCK);
    await block.waitFor({ state: "visible" });
    const blockText = (await block.textContent())?.trim();
    if (!blockText) {
      throw new Error(
        `pin-toast: paragraph ${SHELL_PIN_BLOCK} is empty — pinIntent answers null on a ` +
        "block with no content, so `pin` would be absent from the strip and there would be " +
        "nothing to photograph. The fixture's paragraphs moved",
      );
    }
    await block.click();

    // The keyboard, because this state photographs the STRIP's pin: the
    // block sheet has a `pin` row too (P2f-2 Task 2 gave it one), but the
    // strip is the surface whose control leaves after the press, and the
    // strip exists only while the keyboard is up. Same shrink
    // shellStripSetup performs, without its typing — this page arrives
    // with writing on it.
    const size = page.viewportSize();
    if (!size) throw new Error("pin-toast: no viewport to shrink");
    await page.setViewportSize({ width: size.width, height: KEYBOARD_VIEWPORT_HEIGHT });
    await settle(page, 700);

    const strip = await stripState(page);
    assertStripShape(strip, "pin-toast");
    // Present before the press, and this is not decoration: `pin` rendered
    // DEAD through the whole of P2c and P2d, and since the visual pass a
    // `pin` that cannot apply is ABSENT rather than dead — so a pinIntent
    // that answered null on this written paragraph would show up here as
    // a strip with no `pin` in it, and a driver that went looking for the
    // button anyway would fail on a missing locator instead of on the
    // cause. Absent and dead are both named below, because the second is
    // the old rendering coming back and would be a different defect.
    if (!strip.ids.includes("pin")) {
      throw new Error(
        `pin-toast: the slot opened onto [${strip.ids.join(",")}] — with a caret in a written ` +
        "paragraph and no selection this must be the block strip, and on a written block " +
        "it carries `pin`. Either the wrong strip is up, or pinIntent answered null and " +
        "the control was hidden, so no press can produce a breadcrumb",
      );
    }
    if (strip.disabled.includes("pin")) {
      throw new Error(
        "pin-toast: `pin` renders dead on a written paragraph of a trailed page — a control " +
        "that cannot apply is hidden, not greyed, since the visual pass, so a grey `pin` is " +
        "the old rendering back and the tap below would sit waiting for a toast no press asked for",
      );
    }

    await page.locator('.shell-toolbar-strip [data-button-id="pin"]').tap();

    // Wait on the toast's OWN appearance rather than on a fixed settle.
    // The pin is three awaits deep (confirmPin → the row → getPins) and
    // then has four seconds of life; a settle long enough to be safe on
    // the slow side would eat the window on the fast side, and the frame
    // after the toast leaves is a pin flow with no confirmation in it,
    // committed as correct.
    await page.locator(".shell-toast").waitFor({ state: "visible", timeout: 5000 });

    const toast = await toastState(page);

    // The sentence, character for character. The band is ~24px on an 839px
    // frame — well under the 0.002 ratio the gate compares at — so every
    // decision in pin-toast.js (whose number, which article, what a
    // first pin says) is invisible to the picture that is supposed to be
    // photographing it.
    if (toast.text !== SHELL_PIN_TOAST) {
      throw new Error(
        `pin-toast: the breadcrumb reads "${toast.text}", expected "${SHELL_PIN_TOAST}" — ` +
        "the count is the fixture's own seed plus this press, and the two fixed words are " +
        "trailPhrase's",
      );
    }
    // The live region, which no photograph can contain at all. It is
    // mounted ALWAYS and the band is what the `{#if}` guards, because a
    // region inserted with its message already in it is announced
    // unreliably and TalkBack stays silent — and this toast is the only
    // channel saying where a pin landed.
    if (!toast.liveRegion || toast.role !== "status" || toast.politeness !== "polite") {
      throw new Error(
        `pin-toast: the live region is ${toast.liveRegion ? "" : "absent"}` +
        `${toast.liveRegion ? `role="${toast.role}" aria-live="${toast.politeness}"` : ""} — ` +
        'expected a persistent role="status" aria-live="polite" wrapper around the band',
      );
    }

    // WHERE it is. Under the nav bar and above the content band is the
    // whole placement decision (PageScreen's own comment: the content band
    // scrolls, and a pin is taken wherever the caret is), and "under the
    // nav bar" is a claim about two boxes that the image shows only if the
    // reader already knows which band is which.
    if (toast.top < toast.headerBottom - 1) {
      throw new Error(
        `pin-toast: the toast's top is ${toast.top} against a header ending at ` +
        `${toast.headerBottom} — it is over the header, not under it`,
      );
    }
    if (toast.bottom > toast.bandTop + 1) {
      throw new Error(
        `pin-toast: the toast ends at ${toast.bottom} and the content band starts at ` +
        `${toast.bandTop} — it is inside the scroll container, which is where it would be ` +
        "above the fold for any writer who has scrolled",
      );
    }
    // On screen, and legible. A toast whose own sentence overflows its
    // band is a count the writer cannot read, which is the entire message.
    if (toast.height < 1 || toast.top < 0 || toast.bottom > toast.viewport) {
      throw new Error(
        `pin-toast: the toast's box is ${toast.top}..${toast.bottom} (h ${toast.height}) in a ` +
        `${toast.viewport}px viewport — it is not where it can be seen`,
      );
    }
    if (toast.left < 0 || toast.right > toast.viewportWidth || toast.clipped) {
      throw new Error(
        `pin-toast: the toast spans ${toast.left}..${toast.right} in a ${toast.viewportWidth}px ` +
        `viewport${toast.clipped ? " and its own text overflows it" : ""} — the sentence is cut`,
      );
    }

    // The other half of the confirmation, in the same round trip: the same
    // pinIntent call that wrote the pin feeds the strip, so the control has
    // LEFT the strip on a block that is already kept. It used to dim in
    // place — the phone's version of the desktop's dimmed pin glyph — and
    // since the visual pass it is absent, on the rule that a control which
    // cannot apply to this block is not drawn (ShellApp's `unavailableIds`
    // argues the kept block onto that side of the line, and records what
    // the leaving costs the thumb). The toast is the confirmation; this is
    // the one state that can see the control go with it.
    //
    // Both wrong answers are named. A `pin` still live would let a second
    // press overwrite the node's pinId and orphan the row it just wrote
    // (P2f Task 1; the desktop still has this on quickPinFromCursor). A
    // `pin` present and dead is the pre-pass rendering back.
    if (toast.pinPresent) {
      throw new Error(
        `pin-toast: after the pin, \`pin\` is still on the strip${toast.pinDisabled ? " (dead)" : " (live)"} — ` +
        (toast.pinDisabled
          ? "a control that cannot apply is hidden, not greyed, since the visual pass"
          : "a second press would overwrite the node's pinId and orphan the row it just wrote"),
      );
    }
  },

  // The date sheet, opened by a real tap on the header's own `today ▾`.
  //
  // Three rows: today, and the two days the fixture wrote on. Today is
  // synthesised unconditionally — it is the way back from a past page and
  // the shell's whole answer to midnight (page-picker.js) — and it is the
  // inert one here, because it is the day already on screen.
  [STATES.DATE_SHEET]: async (page) => {
    await shellPageAtRest(page, "date-sheet");

    const control = page.locator(".ph-date");
    await control.waitFor({ state: "visible" });
    await control.tap();
    await settle(page, 500);

    const sheet = await sheetState(page);
    assertSheetShape(sheet, "date-sheet", "date");
    assertSheetRows(sheet, "date-sheet", SHELL_DAY_ROWS);
    assertInertRows(sheet, "date-sheet", [["today", "showing"]]);
    // The month calendar sits above the days now, so the half detent shows
    // today and the rest scroll: what must hold is that a day is in the
    // picture at all, under the calendar.
    if (sheet.visibleRows < 1) {
      throw new Error(
        `date-sheet: ${sheet.visibleRows} of ${sheet.labels.length} rows fit the detent — ` +
        "three days should not need a scroll, so either the detent or the rows moved",
      );
    }
  },

  // The pages sheet, opened by a real tap on the dots.
  //
  // The dots are a CONTROL only above one page (P2a), which is exactly
  // when this sheet has something to offer — so the fixture's second page
  // of the day is what makes this state reachable at all, and a locator
  // that found the inert spacer instead would tap nothing and time out on
  // the sheet.
  //
  // `page 1`/`page 2` are ORDINALS, not `page_number`: the column is
  // minted per device and renumbered on merge (page-ordinal.js), so the
  // label in this image is the one number that agrees across devices.
  [STATES.PAGES_SHEET]: async (page) => {
    await shellPageAtRest(page, "pages-sheet");

    const control = page.getByRole("button", { name: "pages of the day" });
    await control.waitFor({ state: "visible" });
    await control.tap();
    await settle(page, 500);

    const sheet = await sheetState(page);
    assertSheetShape(sheet, "pages-sheet", "pages");
    assertSheetRows(sheet, "pages-sheet", SHELL_PAGE_ROWS.map(([label]) => label));
    assertInertRows(sheet, "pages-sheet", [["page 1", "showing"]]);
    // The VALUES, and this sheet is the one where they carry the whole
    // weight: `page 1` and `page 2` are indistinguishable as labels, and
    // the writer's own "what matters now" beside them is the only thing
    // that says which page is which. A sheet that lost them would still
    // photograph two tidy rows.
    const values = sheet.rows.map((r) => `${r.label} · ${r.value}`).join(" | ");
    const wanted = SHELL_PAGE_ROWS.map(([l, v]) => `${l} · ${v}`).join(" | ");
    if (values !== wanted) {
      throw new Error(
        `pages-sheet: the rows read [${values}], expected [${wanted}] — the note beside a row ` +
        "is the page's own focus line, and it is all that tells two pages of one day apart",
      );
    }
  },

  // The trail sheet, opened by a real tap on the trail tag, and the only
  // sheet in the shell at the FULL detent — so this is also the first
  // capture of `--detent-fraction: 0.92` resolving against --app-height.
  //
  // Four rows and a field: `no trail`, the page's own trail, a discrete
  // trail it could move to, and a continuous one it cannot. The last is
  // the row this photograph exists for — listed so the writer can see the
  // trail exists and cannot name a duplicate, inert because assigning a
  // page into a canonical is a merge the shell will not perform
  // (trail-sheet-model.js).
  [STATES.TRAIL_SHEET]: async (page) => {
    await shellPageAtRest(page, "trail-sheet");

    const control = page.locator(".ph-trail-button");
    await control.waitFor({ state: "visible" });
    if ((await control.textContent())?.trim() !== SHELL_TRAIL_NAME) {
      throw new Error(
        `trail-sheet: the header's tag reads "${(await control.textContent())?.trim()}", ` +
        `expected "${SHELL_TRAIL_NAME}" — the fixture's page is not on the trail this ` +
        "state's rows are captioned for",
      );
    }
    await control.tap();
    await settle(page, 500);

    const sheet = await sheetState(page);
    assertSheetShape(sheet, "trail-sheet", "trail", "full");
    assertSheetRows(sheet, "trail-sheet", SHELL_TRAIL_ROWS.map(([label]) => label));
    assertInertRows(sheet, "trail-sheet", [
      ["field notes", "0 pages · 0 pins"],
      [SHELL_TRAIL_NAME, "3 pages · 11 pins"],
    ]);

    // The field, which `labels` cannot see and which is half the reason
    // this sheet takes full detent: a sheet whose field failed to render
    // would pass every row assertion above and photograph a list where
    // the writer expected to type.
    if (sheet.fields.length !== 1 || sheet.fields[0].placeholder !== "find a trail…") {
      throw new Error(
        `trail-sheet: the sheet holds ${sheet.fields.length} fields ` +
        `(${JSON.stringify(sheet.fields)}), expected one placeheld "find a trail…" — with no ` +
        "field a fresh phone can never make its first trail",
      );
    }
    // NOT FOCUSED, and that is the assertion this state was written for
    // rather than an absence nobody minded. LineageSelector's own finding
    // is that a mobile webview raises the IME only for focus tracing to a
    // user gesture, so a programmatic focus here opens a sheet with an
    // un-typable field and no keyboard to lift it — which is what that
    // sheet shipped with. FindStrip autofocuses because mounting it IS
    // opening find; this sheet has a list to read first.
    if (sheet.fields[0].focused) {
      throw new Error(
        "trail-sheet: the name field took focus on open — LineageSelector's coarse-pointer " +
        "finding says the IME will not follow it, so this is an un-typable field over an " +
        "unlifted sheet",
      );
    }
  },

  // ── P2f-2: the builders, and the rows that stopped being absent ──────
  //
  // The size grid at the full detent, with a size picked by a thumb.
  //
  // TWO TAPS, WHICH IS THE DESIGN. The desktop previews on `pointerenter`
  // and commits on click; a coarse pointer fires no `pointerenter` at all,
  // so its own fallback is a direct commit — and a direct commit is a
  // BLIND commit here, because a 44px cell is smaller than the fingertip
  // on it and the top row commits two rows where the finger is pointing at
  // one. So the tap selects, the caption reads, and the `insert` row acts.
  // This state photographs the moment between the two, which is the only
  // moment in which that argument is visible.
  //
  // THE CAPTION IS THE SUBJECT AND IT IS ~30px OF GREY. The gate is 0.002
  // — about 750px on this frame — so the reading could be absent, stale or
  // transposed with the baseline still green, which is precisely what
  // P2c-2 watched a 44px control do. It is asserted character for
  // character, in both places the sheet says it, along with the twenty
  // cells the same tap lit up: two readings of one pick, drifting apart is
  // the failure, and beige on beige is what it would look like.
  //
  // AND THE DOCUMENT IS ASSERTED UNTOUCHED. Task 4's whole shape is that
  // nothing runs when the sheet opens — `insertionPoint`'s fresh line and
  // the `insertTable` land in one synchronous turn from the commit row —
  // and a photograph of a grid over a page that has already grown a blank
  // paragraph looks exactly like a photograph of one that has not.
  [STATES.TABLE_SHEET]: async (page) => {
    const size = page.viewportSize();
    if (!size) throw new Error("table-sheet: no viewport to shrink");

    await openShellInsertSheet(page, "table-sheet");
    const wrote = await docText(page);

    await tapSheetRow(page, "insert", "table");
    await settle(page, 500);
    await releaseHarnessKeyboard(page, "table-sheet", size);

    const cell = page.locator(
      `.shell-table-grid-cell[data-row="${SHELL_TABLE_CELL.row}"]` +
      `[data-col="${SHELL_TABLE_CELL.col}"]`,
    );
    await cell.waitFor({ state: "visible" });
    await cell.tap();
    await settle(page, 300);

    const sheet = await sheetState(page);
    assertSheetShape(sheet, "table-sheet", "table", "full");
    assertSheetRows(sheet, "table-sheet", ["insert"]);
    // `insert` is a live control, and it has to be said: the chart sheet's
    // one row goes inert on a timeline with no dates, and the two sheets
    // are otherwise the same picture of a row at the bottom of a body.
    assertInertRows(sheet, "table-sheet", []);

    const row = sheet.rows[0];
    if (row.value !== SHELL_TABLE_READING) {
      throw new Error(
        `table-sheet: the commit row reads "${row.label} · ${row.value}", expected ` +
        `"insert · ${SHELL_TABLE_READING}" — the row is the control that acts and it must ` +
        "say what it is about to make",
      );
    }

    const grid = await tableGridState(page);
    if (grid.count !== 36 || grid.columns !== 6) {
      throw new Error(
        `table-sheet: the grid laid out ${grid.count} cells in ${grid.columns} columns, ` +
        "expected 36 in 6 — the desktop's 6×6 was supposed to transfer whole at 412px, and " +
        "a reflow to five columns changes which sizes are on offer",
      );
    }
    if (grid.minSide < 44) {
      throw new Error(
        `table-sheet: the smallest cell is ${grid.minSide}px — \`minmax(var(--tap), 1fr)\` ` +
        "is the shell's 44px floor and 36 targets under a thumb is where it matters most",
      );
    }
    if (grid.maxSkew > 1) {
      throw new Error(
        `table-sheet: a cell is ${grid.maxSkew}px off square — \`aspect-ratio: 1\` is what ` +
        "makes the grid read as a table rather than as a bar chart of column counts",
      );
    }
    if (grid.caption?.text !== SHELL_TABLE_READING) {
      throw new Error(
        `table-sheet: the caption reads "${grid.caption?.text}", expected ` +
        `"${SHELL_TABLE_READING}" — it is the one thing a writer can see past their own ` +
        "hand, and ~30px of grey is invisible to the pixel gate",
      );
    }
    // ABOVE the grid, not below it as on the desktop. A hand reaching a
    // phone covers everything under the cell it is on and nothing over it,
    // so this is the whole of Task 4's thumb argument expressed as a
    // rectangle — and the two boxes swapping would be a legible-looking
    // photograph of an unusable sheet.
    if (!grid.cells || grid.caption.bottom > grid.cells.top) {
      throw new Error(
        `table-sheet: the caption's box ends at ${grid.caption.bottom} and the cells start ` +
        `at ${grid.cells?.top} — the reading has to sit ABOVE the grid, where a thumb ` +
        "cannot be",
      );
    }
    if (grid.lit.length !== SHELL_TABLE_LIT
        || !grid.lit.includes(`${SHELL_TABLE_CELL.row},${SHELL_TABLE_CELL.col}`)
        || grid.lit.includes("4,0")) {
      throw new Error(
        `table-sheet: ${grid.lit.length} cells are lit [${grid.lit.join(" ")}], expected ` +
        `${SHELL_TABLE_LIT} covering (0,0) to (${SHELL_TABLE_CELL.row},` +
        `${SHELL_TABLE_CELL.col}) — the highlight and the caption are two readings of one ` +
        "tap, and beige on beige is what a disagreement looks like",
      );
    }
    // The body fits its detent. This is the claim `detent="full"` was
    // making, and it is also why the harness keyboard went down first: at
    // 331px it would not have.
    if (sheet.content && sheet.content.scrollHeight > sheet.content.clientHeight + 1) {
      throw new Error(
        `table-sheet: the sheet's content is ${sheet.content.scrollHeight}px in a ` +
        `${sheet.content.clientHeight}px scroller — the grid does not fit the full detent, ` +
        "so part of what this image is captioned for is below the frame",
      );
    }
    const after = await docText(page);
    if (after !== wrote) {
      throw new Error(
        `table-sheet: the document changed from "${wrote}" to "${after}" while the grid was ` +
        "open — nothing may be written until the `insert` row runs, and a page that has " +
        "already grown a blank paragraph photographs identically to one that has not",
      );
    }
  },

  // The chart builder as it OPENS: flowchart, the kind `chartDraft`
  // defaults to, two empty nodes and one edge between them.
  //
  // IT IS HALF A PAIR. On its own a photograph of a segmented control
  // proves that one segment is selected and nothing about whether tapping
  // another does anything — the same argument the two strips and the two
  // block sheets are pairs for. CHART_SHEET_TIMELINE is the other half.
  //
  // WHAT ONLY THIS SURFACE CAN JUDGE. Three of the components in the frame
  // are borrowed — SegmentedControl from the desktop's own leaves, and the
  // three chart forms beneath it — and the rules test walks `src/shell/**`
  // only, so nothing scans them for the 44px floor or the 16px input size.
  // The floor over them is one `:global` block in ChartForm, which is a
  // scoped-stylesheet fact jsdom resolves to nothing at all. So a unit
  // test can say the form mounted; only this can say a thumb could use it.
  [STATES.CHART_SHEET]: async (page) => {
    const size = page.viewportSize();
    if (!size) throw new Error("chart-sheet: no viewport to shrink");

    await openShellInsertSheet(page, "chart-sheet");
    const wrote = await docText(page);

    await tapSheetRow(page, "insert", "chart");
    await settle(page, 500);
    await releaseHarnessKeyboard(page, "chart-sheet", size);

    const sheet = await sheetState(page);
    assertSheetShape(sheet, "chart-sheet", "chart", "full");
    assertSheetRows(sheet, "chart-sheet", ["insert"]);
    assertInertRows(sheet, "chart-sheet", []);
    if (sheet.rows[0].value !== "flowchart") {
      throw new Error(
        `chart-sheet: the commit row reads "${sheet.rows[0].label} · ${sheet.rows[0].value}", ` +
        'expected "insert · flowchart" — the value is the kind, and it is the only place ' +
        "the sheet names what it is about to write",
      );
    }
    // The title field is the HOST's, not the form's — `blockTitle` is the
    // attribute every board carries, so it is a shell `Field` beside the
    // borrowed body rather than something a flowchart has and a timeline
    // does not.
    if (sheet.fields.length !== 1 || sheet.fields[0].placeholder !== "title (optional)") {
      throw new Error(
        `chart-sheet: the sheet holds ${sheet.fields.length} shell fields ` +
        `(${JSON.stringify(sheet.fields)}), expected one placeheld "title (optional)"`,
      );
    }
    if (sheet.fields[0].focused) {
      throw new Error(
        "chart-sheet: the title field took focus on open — LineageSelector's coarse-pointer " +
        "finding is that a mobile webview raises the IME only for focus tracing to a user " +
        "gesture, so this is an un-typable field over a sheet nothing lifted",
      );
    }

    const form = await chartFormState(page);
    assertChartKinds(form, "chart-sheet", "flowchart");
    assertChartThumbFloor(form, "chart-sheet");
    // The pane the desktop has and this sheet does not, asserted rather
    // than left to a reader counting what is missing from a PNG. Task 5
    // spent three reasons on the omission (the hand covers where it would
    // go, ~600kB of Mermaid, and the forms already fill a full detent) and
    // recorded the cost: the first commit of a new chart is made without
    // having seen the diagram.
    if (form.preview) {
      throw new Error(
        "chart-sheet: a preview pane rendered inside the builder — the shell dropped it " +
        "deliberately, so either it came back or a chart NodeView is mounted under the sheet",
      );
    }
    if (sheet.content && sheet.content.scrollHeight > sheet.content.clientHeight + 1) {
      throw new Error(
        `chart-sheet: the sheet's content is ${sheet.content.scrollHeight}px in a ` +
        `${sheet.content.clientHeight}px scroller — the flowchart form does not fit the ` +
        "full detent it was given, and the commit row is below the frame",
      );
    }
    const after = await docText(page);
    if (after !== wrote) {
      throw new Error(
        `chart-sheet: the document changed from "${wrote}" to "${after}" while the builder ` +
        "was open — `chart` writes nothing until the commit row runs, which is the whole " +
        "shape Task 5 gave it",
      );
    }
  },

  // The same builder, one real tap later, on the segment that changes the
  // most.
  //
  // TIMELINE IS THE ONE WORTH TAPPING. `emptySource("timeline")` seeds two
  // events with no dates, `chartCanCommit` refuses a dateless event
  // because it assembles as an orphaned box beside the spine, and the
  // commit row therefore goes INERT carrying the reason — the one row in
  // the shell whose value is a sentence about what to type next rather
  // than a fact or a choice. `Row` says that by rendering a `<div>`
  // instead of a `<button>` — and, since the live row is an `action`
  // that draws no chevron either, the only thing the picture keeps of it
  // is the tone (ink for the fact, accent for the offer): exactly the
  // difference `assertInertRows` exists for, and one a photograph cannot
  // carry reliably.
  //
  // IT IS ALSO THE ONLY CAPTURE OF WHAT CAME ACROSS BROKEN. ChartFormTimeline
  // reorders with native HTML5 drag-and-drop, which §3 rejected for the
  // shell's own block drag as unreliable on touch — so its `⋮⋮` renders,
  // looks like a control, and is inert under a finger. The driver counts
  // the handles rather than hoping a reader notices two glyphs in a PNG,
  // and the count going to zero would mean it had been fixed, which is a
  // finding either way.
  [STATES.CHART_SHEET_TIMELINE]: async (page) => {
    const size = page.viewportSize();
    if (!size) throw new Error("chart-sheet-timeline: no viewport to shrink");

    await openShellInsertSheet(page, "chart-sheet-timeline");
    const wrote = await docText(page);

    await tapSheetRow(page, "insert", "chart");
    await settle(page, 500);
    await releaseHarnessKeyboard(page, "chart-sheet-timeline", size);

    // The KIND control, scoped — the flowchart form beneath it carries a
    // segmented control of its own (`top-down` / `left-right`), so a bare
    // `.seg-btn` is ambiguous on exactly the kind this state starts on.
    const segment = page.locator(".shell-chart-form-kinds .seg-btn", {
      hasText: /^timeline$/,
    });
    await segment.waitFor({ state: "visible" });
    await segment.tap();
    await settle(page, 400);

    const sheet = await sheetState(page);
    assertSheetShape(sheet, "chart-sheet-timeline", "chart", "full");
    assertSheetRows(sheet, "chart-sheet-timeline", ["insert"]);
    assertInertRows(sheet, "chart-sheet-timeline", [["insert", SHELL_CHART_BLOCKED]]);

    const form = await chartFormState(page);
    assertChartKinds(form, "chart-sheet-timeline", "timeline");
    assertChartThumbFloor(form, "chart-sheet-timeline");
    // Two events, seeded empty, which is what makes the commit row's
    // refusal the right refusal rather than a form that failed to render.
    const dates = form.placeholders.filter((p) => p === "date").length;
    if (dates !== 2) {
      throw new Error(
        `chart-sheet-timeline: the form shows ${dates} date fields, expected 2 — ` +
        "`emptySource(\"timeline\")` seeds two events, and the commit row's refusal is " +
        "about them",
      );
    }
    if (form.dragHandles !== 2) {
      throw new Error(
        `chart-sheet-timeline: ${form.dragHandles} draggable reorder handles rendered, ` +
        "expected 2 — Task 5 recorded them as inherited and INERT under a finger (HTML5 " +
        "drag, which §3 rejected for touch). Zero would mean they were fixed or removed, " +
        "which is a finding rather than a pass",
      );
    }
    if (sheet.content && sheet.content.scrollHeight > sheet.content.clientHeight + 1) {
      throw new Error(
        `chart-sheet-timeline: the sheet's content is ${sheet.content.scrollHeight}px in a ` +
        `${sheet.content.clientHeight}px scroller — the timeline form does not fit the full ` +
        "detent, and the row that explains why it cannot commit is below the frame",
      );
    }
    const after = await docText(page);
    if (after !== wrote) {
      throw new Error(
        `chart-sheet-timeline: the document changed from "${wrote}" to "${after}" — ` +
        "switching kind must not write, and neither must opening the builder",
      );
    }
  },

  // The block sheet over a BOARD, which is the only shape that offers
  // `title`.
  //
  // BLOCK_SHEET cannot host this and never could: it is shot on a
  // paragraph, and a paragraph renders no `.board-title-slot` to focus. So
  // the row Task 3 spent three phases unable to wire would still be absent
  // from every image in the suite — which is how it stayed absent, since
  // the defect was two files calling opposite booleans `hasTitle` and
  // nothing type-checking the difference.
  //
  // THE BOARD IS MADE, NOT SEEDED. A `q&a` inserted through the insert
  // sheet, by the same path the row under test is reached by — the scene's
  // fixture is an empty page and the shell has no import, so this is also
  // the only proof in the suite that an insert row lands a real board.
  //
  // ITS ROWS ARE THE ARGUMENT. `title` and `turn into` arrive together
  // because a board can be titled and a board has somewhere to convert to;
  // `pin` and `copy` are both gone, because `canPin` is "has text worth
  // keeping" and a board inserted a moment ago has none. `delete` survives
  // that on `canPin || isBoard`. Four facts, one list, none of them
  // legible in a photograph of five identical rows.
  [STATES.BLOCK_SHEET_BOARD]: async (page) => {
    await openShellInsertSheet(page, "block-sheet-board");

    await tapSheetRow(page, "insert", "q&a");
    await settle(page, 600);

    // The board landed. Asserted before the sheet is opened on it, because
    // a handle over a paragraph and a handle over a board are the same
    // 44px glyph and the rows below would be the only thing to notice.
    // `[data-board]` on the NodeView's own wrapper, which is also where
    // the `.board-title-slot` the `title` row focuses lives — so this is
    // the same element `core.hasBlockTitleSlot` will be asked about.
    const boards = await page
      .locator('.ps-canvas .ProseMirror .block-shell[data-board="qaBlock"]')
      .count();
    if (boards !== 1) {
      throw new Error(
        `block-sheet-board: ${boards} q&a boards in the document after the row was tapped — ` +
        "the insert row is what makes this state reachable, and without a board the sheet " +
        "below is the paragraph sheet under another name",
      );
    }
    // The board's own title slot, which is what `title` focuses and what
    // `core.hasBlockTitleSlot` is about to be asked for. Counted rather
    // than assumed from the node type — that assumption is the defect
    // Task 3 renamed its way out of, and the gate is deliberately a DOM
    // fact so that a board type shipping without a slot fails here.
    const slots = await page
      .locator('.ps-canvas .ProseMirror .block-shell[data-board="qaBlock"] .board-title-slot')
      .count();
    if (slots !== 1) {
      throw new Error(
        `block-sheet-board: the board renders ${slots} title slots, expected 1 — the ` +
        "`title` row's gate is whether one exists to focus, so without it this sheet would " +
        "correctly show four rows and the state would be captioned for five",
      );
    }

    const handle = page.locator('[data-button-id="block-handle"]');
    const count = await handle.count();
    if (count !== 1) {
      throw new Error(
        `block-sheet-board: ${count} gutter handles on screen, expected exactly 1 — the ` +
        "handle follows the caret's top-level block, and the caret is in the board just " +
        "inserted",
      );
    }
    await handle.tap();
    await settle(page, 500);

    const sheet = await sheetState(page);
    assertSheetShape(sheet, "block-sheet-board", "block-actions");
    assertSheetRows(sheet, "block-sheet-board", SHELL_BOARD_ROWS);
    assertInertRows(sheet, "block-sheet-board", []);
  },

  // ── P3: memory, the pins, and the stack ────────────────────────────
  //
  // The pins screen, pushed by a real tap on the header's `pins`. The
  // first photograph of `Stack` rendering anything at all: it was built in
  // P1d, reviewed, unit-tested and mounted by nothing until P3 Task 1, so
  // every claim about a screen sitting over another screen has until now
  // been jsdom's, where a grid cell has no geometry and a translate is a
  // string on a style object.
  [STATES.PINS_SCREEN]: async (page) => {
    await shellPageAtRest(page, "pins-screen");

    const control = page.locator(".ph-pins");
    await control.waitFor({ state: "visible" });
    await control.tap();

    // Waited ON rather than settled for: `openPins` pushes first and
    // fetches second, so the screen is up with its "reading the pins"
    // state before `getPins` resolves — and a fixed settle would be a
    // guess about which side of that window the shutter lands on. The
    // first row is the event.
    await page
      .locator('.shell-stack-entry[data-top="true"] .shell-row')
      .first()
      .waitFor({ state: "visible", timeout: 10000 });
    await settle(page, 400);

    const state = await screenState(page);
    assertPushedScreen(state, "pins-screen", "pins");
    assertRowsLegible(state, "pins-screen");

    const labels = state.rows.map((r) => r.label);
    if (labels.join(" | ") !== SHELL_PIN_ROWS.join(" | ")) {
      throw new Error(
        `pins-screen: the screen lists [${labels.join(" | ")}], expected ` +
        `[${SHELL_PIN_ROWS.join(" | ")}] — the count is the fixture's own seed and the text ` +
        "is `pinRowLabel`'s first branch, the pin's own title",
      );
    }
    // Every row a control. There is no inert row on this screen and there
    // should not be: a pin row's whole job is to open the actions sheet,
    // and `Row` renders a plain <div> with no tab stop when it is handed
    // no onSelect — which is what a host that forgot `onPin` produces, and
    // which photographs as a perfectly ordinary list.
    const dead = state.rows.filter((r) => r.inert).map((r) => r.label);
    if (dead.length > 0) {
      throw new Error(
        `pins-screen: [${dead.join(", ")}] render as inert markup — a pin row with no ` +
        "onSelect has no tab stop and opens nothing, and looks identical in the image",
      );
    }
    // NO SEGMENT, and the reason is asserted beside the absence rather
    // than left as an empty expectation. `pinFilterOptions` returns []
    // below two scopes, and all eleven of these pins are the page's own
    // trail's — so the control would be `all | this trail`, two segments
    // selecting the same eleven rows. If a fixture ever grows an inherited
    // or global pin this fails by name instead of the band quietly
    // appearing in a diff nobody re-reads.
    if (state.segments.length !== 0) {
      throw new Error(
        `pins-screen: a filter segment rendered (${JSON.stringify(state.segments.map((s) => s.ariaLabel))}) ` +
        "— every pin in this fixture is on the page's own trail, so there is one scope and " +
        "`pinFilterOptions` should offer nothing to choose between",
      );
    }
    // EVERY ROW IS IN THE PICTURE, said out loud so a reader does not
    // take the last visible row for the last row — the note the date
    // sheet carries, on a scroller rather than a detent. A row carries its
    // worded actions since 0.8.2, so eleven of them run past a 915px device
    // and the list scrolls; what must hold is that the picture is of rows,
    // starting from the first, and that the rest can be reached.
    if (state.rowsInBand < 5 || state.band.scrollHeight <= state.band.clientHeight) {
      throw new Error(
        `pins-screen: ${state.rowsInBand} of ${state.rows.length} rows are inside the band ` +
        `(${state.band.scrollHeight}/${state.band.clientHeight}) — expected a screenful of ` +
        "rows over a list that scrolls to the rest",
      );
    }
    if (state.band.scrollTop !== 0) {
      throw new Error(
        `pins-screen: the list opened scrolled to ${state.band.scrollTop} — a pushed screen ` +
        "starts at its own top",
      );
    }
  },

  // The pin's own screen, pushed from its ROW — the second device pass
  // ("click on row opens dropdown but how to see the content", then
  // "pins are not editable") took the actions sheet and the editor sheet
  // away and put the actions under the writing and the writing in a live
  // editor. One real tap past a pushed list, so it is an interaction
  // state by necessity: no load-time capture can reach it.
  //
  // WHAT ONLY THE PHOTOGRAPH CAN SAY: whether a pinned artifact laid out
  // through `.prose` at 412px is legible at all, and whether a LIVE
  // ProseMirror (PinEditor, the shell's second editor host) draws the
  // same as the static tree it replaced — every node-shape rule lives in
  // src/styles/prose.css, which no jsdom test in this suite loads. The
  // driver checks the boxes; the image is the rest.
  [STATES.PIN_ARTIFACT_SCREEN]: async (page) => {
    await STATE_DRIVERS[STATES.PINS_SCREEN](page);

    // By label, not by index: the pin this state is captioned for is
    // named, and a driver keyed on position would keep passing while
    // opening a different pin.
    const row = page
      .locator('.shell-stack-entry[data-top="true"] .shell-row')
      .filter({ has: page.locator(`.shell-row-label:text-is("${SHELL_PIN_ROWS[0]}")`) });
    await row.waitFor({ state: "visible" });
    await row.tap();
    // No round trip stands between the tap and the writing — the pin
    // caches its own content (CLAUDE.md's pointer clause) — so the editor
    // is up in the frame the screen is pushed in, and the wait is for the
    // push rather than for a fetch.
    await page
      .locator('.shell-stack-entry[data-top="true"] .ProseMirror')
      .waitFor({ state: "visible", timeout: 10000 });
    await settle(page, 400);

    const state = await screenState(page);
    // The bar names the KIND — `text`, since the fixture's pins are notes
    // whose content is a doc and `pinKind` reads the content — and the
    // pin's own label is the FIELD under it, not a Title: the same line
    // used to be on screen twice.
    assertPushedScreen(state, "pin-artifact-screen", "pin", 3);
    assertRowsLegible(state, "pin-artifact-screen");

    if (state.subtitle !== "") {
      throw new Error(
        `pin-artifact-screen: the bar's second line reads "${state.subtitle}" — the bar ` +
        "names the kind on its one line and nothing under it",
      );
    }
    if (
      !state.titleField ||
      state.titleField.value !== "" ||
      state.titleField.placeholder !== "name this pin"
    ) {
      throw new Error(
        `pin-artifact-screen: the title field is ${JSON.stringify(state.titleField)}, expected ` +
        `empty, placeheld "name this pin" — this pin's title only repeats its writing's opening ` +
        "words, which pinTitleDraft leaves out, and the placeholder is the only thing that says " +
        "the line can be typed into",
      );
    }
    if (state.heading !== null || state.eyebrow !== null || state.chip !== null) {
      throw new Error(
        `pin-artifact-screen: a Title ("${state.heading}"), an eyebrow ("${state.eyebrow}") ` +
        `or a chip ("${state.chip}") is on screen — all three were cut in the second device ` +
        "pass: the title is the field, the kind is the bar, the trail is the line",
      );
    }
    if (state.provenance !== SHELL_PIN_PROVENANCE) {
      throw new Error(
        `pin-artifact-screen: the provenance line reads "${state.provenance}", expected ` +
        `"${SHELL_PIN_PROVENANCE}" — the trail from the lookup, the day from the host's clock, ` +
        "which under this harness is the frozen one; a real date here is the machine's clock " +
        "reaching the screen",
      );
    }
    if (state.card) {
      throw new Error(
        "pin-artifact-screen: the writing is in a card — the card was cut in the second " +
        "device pass, and the prose sits on the canvas at the band's inset",
      );
    }
    if (!state.prose || !state.prose.text.trim()) {
      throw new Error(
        "pin-artifact-screen: the prose column is empty — `refresh_pin_caches` stores a " +
        "BARE node and the editor mounts nothing for a shape it cannot parse, so a blank " +
        "column here is pin-artifact-view.js's wrap having stopped running",
      );
    }
    if (state.prose.height < 1 || state.prose.left < 0 || state.prose.right > state.viewportWidth) {
      throw new Error(
        `pin-artifact-screen: the prose column's box is ${state.prose.left}..` +
        `${state.prose.right} × ${state.prose.height}px in a ${state.viewportWidth}px ` +
        "viewport — the pin's writing is not where it can be read",
      );
    }
    // THE ROWS ARE THE ACTIONS the sheet used to hold, under the writing:
    // the way back (a push, with its chevron), the carry (the fixture's
    // pins have a trail and are not orphaned, the exact pair
    // `get_carry_forward_pins`' WHERE clause reads), and `unpin`, last and
    // not destructive.
    // `trail` since task 9e: the pin's trail, a choice that opens the
    // picker sheet (pin-trail-sheet), so no chevron.
    assertScreenRows(state, "pin-artifact-screen", [
      ["open the page it came from", ""],
      ["trail", "the book"],
      ["carry forward", ""],
      ["unpin", ""],
    ]);
    if (state.rows[1].kind !== "choice" || state.rows[1].chevron) {
      throw new Error(
        `pin-artifact-screen: "trail" is kind "${state.rows[1].kind}" ` +
        `${state.rows[1].chevron ? "with" : "without"} a chevron — it opens a sheet, not a ` +
        "screen, so it is a choice and points nowhere",
      );
    }
    if (state.rows[0].kind !== "push" || !state.rows[0].chevron) {
      throw new Error(
        `pin-artifact-screen: the way back is kind "${state.rows[0].kind}" ` +
        `${state.rows[0].chevron ? "with" : "without"} a chevron — it opens the reading ` +
        "view, so it is the one row on this screen that points somewhere",
      );
    }
    for (const i of [2, 3]) {
      if (state.rows[i].kind !== "action" || state.rows[i].chevron) {
        throw new Error(
          `pin-artifact-screen: "${state.rows[i].label}" is kind "${state.rows[i].kind}" ` +
          `${state.rows[i].chevron ? "with" : "without"} a chevron — it acts and opens no ` +
          "screen, so it is an action with nothing to point at",
        );
      }
    }
    // MOUNTED, NOT RENDERED, and counted across the WHOLE document. Two:
    // the page root's editor, alive because Stack keeps the root at any
    // depth (its header — a root that unmounted at depth 3 came back as a
    // remount from load-time content, with the writer's newest lines
    // gone), and PinEditor's — the second editor host, and the whole of
    // "pins are editable". One is the static tree back, or the root
    // unmounting again; three is a screen that should not hold one.
    if (state.editors !== 2 || state.editables !== 2) {
      throw new Error(
        `pin-artifact-screen: ${state.editors} ProseMirror instances and ${state.editables} ` +
        "contenteditable elements are on screen, expected two of each — the page root's " +
        "(kept alive under the stack) and the pin's own (PinEditor)",
      );
    }
  },

  // Task 9e: the pin's trail picker, one real tap past the pin's screen.
  [STATES.PIN_TRAIL_SHEET]: async (page) => {
    await STATE_DRIVERS[STATES.PIN_ARTIFACT_SCREEN](page);
    await tapScreenRow(page, "trail");
    await page.locator('.shell-sheet[data-sheet="pin-trail"] .shell-row').first()
      .waitFor({ state: "visible", timeout: 10000 });
    await settle(page, 500);

    const sheet = await sheetState(page);
    assertSheetShape(sheet, "pin-trail-sheet", "pin-trail");
    // `no trail`, then the fixture's three trails in tree order (siblings
    // by name). The continuous one is offered: a pin on a living doc's
    // trail is a pin, not an assignment of the page into the doc.
    assertSheetRows(sheet, "pin-trail-sheet", ["no trail", "field notes", "job search", "the book"]);
    assertInertRows(sheet, "pin-trail-sheet", [["the book", "this pin"]]);
  },

  // Task 9e: a trail's screen, from memory's trails sheet. The first tap
  // on `the book` scopes memory (and must push nothing); the second, on
  // the row now `showing`, pushes the screen.
  [STATES.TRAIL_SCREEN]: async (page) => {
    await goToShellMemory(page, "trail-screen");

    const openScope = async () => {
      const control = page.locator('.shell-stack-entry[data-top="true"] [data-action-id="trails"]');
      await control.waitFor({ state: "visible" });
      await control.tap();
      await page.locator('.shell-sheet[data-sheet="trail-scope"] .shell-row').first()
        .waitFor({ state: "visible", timeout: 10000 });
      await settle(page, 500);
    };

    await openScope();
    await tapSheetRow(page, "trail-scope", "the book");
    await settle(page, 600);
    const scoped = await screenState(page);
    if (!scoped || scoped.depth !== 1) {
      throw new Error(
        `trail-screen: picking a trail to scope left the stack ${scoped?.depth ?? "(none)"} ` +
        "deep, expected 1 — scoping is still one tap and pushes nothing",
      );
    }

    await openScope();
    await tapSheetRow(page, "trail-scope", "the book");
    await page.locator('.shell-stack-entry[data-top="true"] input[aria-label="rename"]')
      .waitFor({ state: "visible", timeout: 10000 });
    await settle(page, 500);

    const state = await screenState(page);
    assertPushedScreen(state, "trail-screen", "trail", 2);
    assertRowsLegible(state, "trail-screen");
    assertScreenRows(state, "trail-screen", [
      ["move under…", "top level"],
      ["delete trail", ""],
    ]);
    const field = await page
      .locator('.shell-stack-entry[data-top="true"] input[aria-label="rename"]')
      .inputValue();
    if (field !== "the book") {
      throw new Error(`trail-screen: the rename field holds "${field}", expected "the book"`);
    }
  },

  // Task 9e: the delete's confirmation, opened and NOT pressed.
  [STATES.TRAIL_DELETE_SHEET]: async (page) => {
    await STATE_DRIVERS[STATES.TRAIL_SCREEN](page);
    await tapScreenRow(page, "delete trail");
    await page.locator('.shell-sheet[data-sheet="trail-delete"] .shell-row').first()
      .waitFor({ state: "visible", timeout: 10000 });
    await settle(page, 500);

    const sheet = await sheetState(page);
    assertSheetShape(sheet, "trail-delete-sheet", "trail-delete");
    assertSheetRows(sheet, "trail-delete-sheet", ["delete “the book”"]);
    const note = await page
      .locator('.shell-sheet[data-sheet="trail-delete"] .shell-note')
      .textContent();
    if (!note || !note.includes("its pages stay in memory")) {
      throw new Error(
        `trail-delete-sheet: the sheet says "${note}", expected it to say where the pages go ` +
        "before the row that deletes the trail",
      );
    }
  },

  // Memory, reached by a real tap on the tab bar. The root switch itself is
  // half the subject: `goRoot` drops the push stack and re-reads the
  // archive, and until this state nothing in the suite had ever changed
  // root at all.
  [STATES.MEMORY]: async (page) => {
    const state = await goToShellMemory(page, "memory");
    assertRowsLegible(state, "memory");

    if (state.depth !== 1) {
      throw new Error(
        `memory: the stack is ${state.depth} deep on a root — goRoot clears the pushed ` +
        "screens, so anything above 1 is a stack that survived a root switch",
      );
    }
    if (state.actions.map((a) => a.label).join(" | ") !== SHELL_MEMORY_ACTIONS.join(" | ")) {
      throw new Error(
        `memory: the bar carries [${state.actions.map((a) => a.label).join(" | ")}], expected ` +
        `[${SHELL_MEMORY_ACTIONS.join(" | ")}] — \`filters\` counts nothing because nothing ` +
        "is filtered, and `trails` names what it opens because no scope is on",
      );
    }

    // THE FIELD RIDES IN THE BAR. §2's words, and a claim about two boxes
    // rather than about one: a field at the top of a screen looks the same
    // whether it is inside the nav band or is simply the list's first row
    // at scroll 0. What makes it the bar's is that it sits INSIDE
    // `.shell-screen-nav` and ABOVE the content band's top edge, and that
    // it therefore does not move when the list does.
    if (state.fields.length !== 1 || state.fields[0].placeholder !== SHELL_MEMORY_SEARCH) {
      throw new Error(
        `memory: the bar holds ${state.fields.length} fields ` +
        `(${JSON.stringify(state.fields)}), expected one placeheld "${SHELL_MEMORY_SEARCH}" — ` +
        "the placeholder is the only thing on screen that says what the field searches",
      );
    }
    const search = state.fields[0];
    if (search.bottom > state.band.top + 1 || search.top < state.navBox.top - 1) {
      throw new Error(
        `memory: the search field's box is ${search.top}..${search.bottom} against a nav band ` +
        `starting at ${state.navBox.top} and a content band starting at ${state.band.top} — ` +
        "it is not riding in the bar, so it will scroll away with the list",
      );
    }
    if (search.height < state.tap) {
      throw new Error(
        `memory: the search field is ${search.height}px tall against a ${state.tap}px floor`,
      );
    }
    if (search.fontPx < 16) {
      throw new Error(
        `memory: the search field's text is ${search.fontPx}px — under 16 a phone zooms the ` +
        "viewport the moment it is focused",
      );
    }

    // THE MODE SEGMENT. Three options, the middle one lit, and every
    // option at the shell's own floor. It used to be the one control on
    // this screen whose height the shell did not own — the bare leaf,
    // `src/lib/ui/SegmentedControl.svelte`, floors a segment four pixels
    // under `--tap` on a coarse pointer, and this driver asserted THAT
    // floor and reported the shortfall. The visual pass wrapped the leaf
    // in the shell's `Segment`, which declares `min-height: var(--tap)`
    // on the leaf's segments from outside (Segment.test.js holds it by
    // source-read; MemoryScreen.test.js holds that memory renders the
    // wrapper). So the floor asserted here is `state.tap`, the device's
    // resolved number, and a 40px option is the P3 debt come back.
    const modes = state.segments.find((s) => s.ariaLabel === "memory mode");
    if (!modes) {
      throw new Error(
        `memory: no mode segment on screen (segments: ${JSON.stringify(state.segments.map((s) => s.ariaLabel))}) ` +
        "— three modes over an account with writing in it is what `hasAnything` gates",
      );
    }
    const modeLabels = modes.options.map((o) => o.label);
    if (modeLabels.join(" | ") !== SHELL_MEMORY_MODES.join(" | ")) {
      throw new Error(
        `memory: the segment offers [${modeLabels.join(" | ")}], expected ` +
        `[${SHELL_MEMORY_MODES.join(" | ")}]`,
      );
    }
    const lit = modes.options.filter((o) => o.checked).map((o) => o.label);
    if (lit.join(",") !== SHELL_MEMORY_MODE_ON) {
      throw new Error(
        `memory: [${lit.join(",")}] is lit, expected exactly "${SHELL_MEMORY_MODE_ON}" — ` +
        "memory opens on the timeline §2 calls its content, and which segment is lit is the " +
        "only thing saying which of the three the list below belongs to",
      );
    }
    for (const option of modes.options) {
      if (option.height < state.tap) {
        throw new Error(
          `memory: the "${option.label}" segment is ${option.height}px tall against the ` +
          `shell's ${state.tap}px floor — Segment's \`min-height: var(--tap)\` on the leaf's ` +
          "segments stopped applying, and the leaf's own 40px coarse-pointer floor is back",
        );
      }
      if (option.right > state.viewportWidth + 1) {
        throw new Error(
          `memory: the "${option.label}" segment ends at ${option.right} in a ` +
          `${state.viewportWidth}px viewport — Segment spreads the three modes across the ` +
          "band, so an option past the edge is the bare leaf's nowrap row back, with a " +
          "sideways scroll nothing advertises",
        );
      }
    }

    // THE TIMELINE. Three days, newest first, each naming the trail its
    // writing is on. The day labels are eyebrows beside the dots and not
    // rows, so `assertScreenRows` cannot see them and a timeline that lost
    // its spine would photograph as an undated list of focus lines. The
    // trail's name IS a row now — the index's inert header-row shape —
    // read by its own wrapper rather than found among the pages.
    if (state.dayLabels.join(" | ") !== SHELL_MEMORY_DAYS.join(" | ")) {
      throw new Error(
        `memory: the timeline's days are [${state.dayLabels.join(" | ")}], expected ` +
        `[${SHELL_MEMORY_DAYS.join(" | ")}] — both reference dates come from this screen's ` +
        "own `todayStr` through `yesterdayOf`, so a drift here is the two clocks parting",
      );
    }
    if (!state.trailNames.includes(SHELL_TRAIL_NAME)) {
      throw new Error(
        `memory: the timeline names [${state.trailNames.join(", ")}], and none of them is ` +
        `"${SHELL_TRAIL_NAME}" — every page in this fixture but one is on that trail`,
      );
    }
    // The row the reading view is pushed from, present here so that state
    // fails on the row rather than on a locator timeout three taps later.
    if (!state.rows.some((r) => r.label === SHELL_READING_ROW)) {
      throw new Error(
        `memory: no row reads "${SHELL_READING_ROW}" — the timeline labels a page with its ` +
        "own focus line (`pageRowLabel`), and this is yesterday's",
      );
    }
  },

  // Memory's filters, in a sheet. §2 gives this surface a sheet where it
  // gives pins a segment, and the pair is the argument: side by side, one
  // is a band inside a list and the other owns the bottom of the display.
  [STATES.MEMORY_FILTERS_SHEET]: async (page) => {
    await goToShellMemory(page, "memory-filters-sheet");

    // By accessible name, which normalises the whitespace the markup puts
    // around a button's label — a `hasText` regex anchored at both ends
    // matches the raw textContent and would never fire.
    const control = page.getByRole("button", { name: "filters", exact: true });
    await control.waitFor({ state: "visible" });
    await control.tap();
    await settle(page, 500);

    const sheet = await sheetState(page);
    assertSheetShape(sheet, "memory-filters-sheet", "memory-filters");
    // ONE row, and no `clear filters`. ShellApp offers that row only when
    // `memoryFilterCount` is non-zero, so its absence is the assertion
    // that the screen opened unfiltered — memory-model.js's own test of
    // this sheet ("a list silently cut at thirty days would be a filter
    // the writer cannot see") read from the other end.
    assertSheetRows(sheet, "memory-filters-sheet", SHELL_FILTER_ROWS);
    // `pinned only` is a TOGGLE, so `Row` renders it as a plain div with a
    // Toggle inside rather than as a button — inert in the sense
    // `assertInertRows` measures, and live in every sense a writer cares
    // about. Said here because the two readings of "inert" collide on
    // exactly this row and nowhere else in the suite.
    assertInertRows(sheet, "memory-filters-sheet", [["pinned only", ""]]);

    const groups = await page.evaluate(() => {
      const el = document.querySelector(".shell-sheet");
      if (!el) return null;
      const box = (n) => {
        const b = n.getBoundingClientRect();
        return { top: Math.round(b.top), bottom: Math.round(b.bottom),
          left: Math.round(b.left), right: Math.round(b.right),
          height: Math.round(b.height) };
      };
      return {
        // `.shell-eyebrow` is Eyebrow's own class, reached through the
        // RowGroup each segment sits in (ShellApp's filter sheet). The
        // sheet used to draw its own `.memory-filter-heading`; the visual
        // pass deleted that rule, and a driver still reading it would
        // report no headings at all.
        headings: [...el.querySelectorAll(".shell-eyebrow")].map((n) =>
          (n.textContent ?? "").trim(),
        ),
        segments: [...el.querySelectorAll('[role="radiogroup"]')].map((g) => ({
          ariaLabel: g.getAttribute("aria-label") ?? "",
          options: [...g.querySelectorAll('[role="radio"]')].map((b) => ({
            label: (b.textContent ?? "").trim(),
            checked: b.getAttribute("aria-checked") === "true",
            ...box(b),
          })),
        })),
        // A toggle is not a `.shell-row-value` and not a button, so
        // nothing `sheetState` reads can see whether it rendered at all.
        toggles: el.querySelectorAll('[role="switch"], input[type="checkbox"]').length,
        width: Math.round(el.getBoundingClientRect().width),
      };
    });
    if (groups.headings.join(" | ") !== "date | pick a day | sort") {
      throw new Error(
        `memory-filters-sheet: the sheet's headings are [${groups.headings.join(" | ")}], ` +
        'expected [date | pick a day | sort] — a heading names the control under it, and without one a ' +
        "segment reading `all · today · this week` says nothing about what it narrows",
      );
    }
    const ranges = groups.segments.find((s) => s.ariaLabel === "date range");
    const sorts = groups.segments.find((s) => s.ariaLabel === "sort order");
    if (!ranges || !sorts) {
      throw new Error(
        `memory-filters-sheet: the sheet holds ${groups.segments.length} segments ` +
        `(${JSON.stringify(groups.segments.map((s) => s.ariaLabel))}), expected a date range ` +
        "and a sort order",
      );
    }
    for (const [seg, want, name, on] of [
      [ranges, SHELL_FILTER_RANGES, "date range", "all"],
      [sorts, SHELL_FILTER_SORTS, "sort order", "date"],
    ]) {
      const got = seg.options.map((o) => o.label);
      if (got.join(" | ") !== want.join(" | ")) {
        throw new Error(
          `memory-filters-sheet: the ${name} segment offers [${got.join(" | ")}], expected ` +
          `[${want.join(" | ")}] — the presets are the desktop's own, in its order`,
        );
      }
      const lit = seg.options.filter((o) => o.checked).map((o) => o.label);
      if (lit.join(",") !== on) {
        throw new Error(
          `memory-filters-sheet: [${lit.join(",")}] is lit on the ${name} segment, expected ` +
          `"${on}" — the resting value is what the count on the bar is measured against`,
        );
      }
      // Every segment inside the sheet's own right edge. The band used to
      // scroll sideways (four nowrap segments were wider than a narrow
      // phone, and a segment past the edge was one a thumb reached only
      // by a swipe nothing advertised); since the visual pass the
      // control is the shell's `Segment`, which spreads its options
      // across the full width with `flex: 1 1 0`, so a segment past the
      // edge now means the flex stopped applying — the leaf's class names
      // changed under the wrapper's `:global` reach. Recorded per segment
      // so a failure names which.
      for (const option of seg.options) {
        if (option.right > groups.width + 1) {
          throw new Error(
            `memory-filters-sheet: the "${option.label}" ${name} segment ends at ` +
            `${option.right} inside a ${groups.width}px sheet — it is off the edge`,
          );
        }
      }
    }
    if (groups.toggles !== 1) {
      throw new Error(
        `memory-filters-sheet: ${groups.toggles} toggles in the sheet, expected 1 — ` +
        '"pinned only" renders its control inside an inert Row, so a Toggle that failed to ' +
        "mount leaves a label with nothing beside it and no assertion above can see it",
      );
    }
  },

  // The reading view, pushed from a memory row: a past page's writing,
  // read-only by construction.
  [STATES.READING_VIEW]: async (page) => {
    await goToShellMemory(page, "reading-view");

    const row = page
      .locator('.shell-stack-entry[data-top="true"] .shell-row')
      .filter({ has: page.locator(`.shell-row-label:text-is("${SHELL_READING_ROW}")`) });
    await row.waitFor({ state: "visible" });
    await row.tap();

    // `openReading` pushes, then fetches the WHOLE page by address — the
    // row memory holds is a summary with no `yjs_state` — so the screen is
    // up in its "reading the page" state first. The prose is the event.
    await page
      .locator('.shell-stack-entry[data-top="true"] .prose')
      .waitFor({ state: "visible", timeout: 10000 });
    await settle(page, 400);

    const state = await screenState(page);
    assertPushedScreen(state, "reading-view", SHELL_READING_TITLE);
    assertRowsLegible(state, "reading-view");

    if (state.subtitle !== SHELL_READING_SUBTITLE) {
      throw new Error(
        `reading-view: the bar's second line reads "${state.subtitle}", expected ` +
        `"${SHELL_READING_SUBTITLE}" — the trail is the provenance line's first word now, ` +
        "and a bar that still names it says it twice",
      );
    }
    // The writer's own sentence about the day, as the screen's title in
    // Lora under the bar (the desktop's `.pv-matters`). Absent rather than
    // "untitled" on a page with none — so a placeholder appearing here
    // would be the screen inventing a line.
    if (state.heading !== SHELL_READING_ROW) {
      throw new Error(
        `reading-view: the title under the bar reads "${state.heading}", expected ` +
        `"${SHELL_READING_ROW}" — it is the page's own "what matters now", which is also the ` +
        "row that was tapped to get here",
      );
    }
    // The line is where the trail AND the dates are. The trail comes from
    // memory's own lineage list, and a miss there falls back to a fetch
    // rather than to null — `untrailed` opening the line is that lookup
    // missing on a device. No chip: it said the trail a second time.
    if (state.chip !== null) {
      throw new Error(
        `reading-view: a chip reads "${state.chip}" — the chip was cut in the second device ` +
        "pass (the provenance line's first word is the trail), so one on screen is the old " +
        "anatomy back",
      );
    }
    if (state.provenance !== SHELL_READING_PROVENANCE) {
      throw new Error(
        `reading-view: the provenance line reads "${state.provenance}", expected ` +
        `"${SHELL_READING_PROVENANCE}" — the day is the page's own date and the edit is its ` +
        "updated_at, both labelled against the host's clock, which under this harness is the " +
        "frozen one",
      );
    }
    if (state.card) {
      throw new Error(
        "reading-view: the writing is in a card — the card was cut in the second device pass " +
        "(a raised box inside a screen inside a frame read as a quotation on a phone), and " +
        "the prose sits on the canvas at the band's inset",
      );
    }
    // The writing itself. Rendered through `ProseHTML` into the global
    // `.prose` stylesheet, which no jsdom test in this suite loads — so
    // until this capture nothing had ever seen a past page laid out.
    if (!state.prose || !state.prose.text.includes("kept, because it went somewhere.")) {
      throw new Error(
        `reading-view: the writing reads "${state.prose?.text ?? "(no .prose)"}" — the ` +
        "fixture's yesterday page holds two lines and the second is this one",
      );
    }
    if (state.prose.height < 1 || state.prose.left < 0 || state.prose.right > state.viewportWidth) {
      throw new Error(
        `reading-view: the prose column's box is ${state.prose.left}..${state.prose.right} ` +
        `× ${state.prose.height}px in a ${state.viewportWidth}px viewport — the writing is ` +
        "not where it can be read",
      );
    }
    // NOT EDITABLE, AS A CONSTRUCTION. Not one ProseMirror and not one
    // contenteditable anywhere in the document — including the screen
    // underneath, because Stack keeps the top two entries alive and the
    // whole argument for rendering rather than mounting here is that a
    // phone should not carry two editors at once. This is the strongest
    // form of §2's read-only view and it is the one a gate answering false
    // cannot make.
    if (state.editors !== 0 || state.editables !== 0) {
      throw new Error(
        `reading-view: ${state.editors} ProseMirror instances and ${state.editables} ` +
        "contenteditable elements are on screen — the reading view renders static HTML, and " +
        "a page you can put a cursor in is not the surface CLAUDE.md means by \"open " +
        "yesterday in memory\"",
      );
    }
    // The read-only arm of `readingRows`: a NOTE and an offer, not
    // `continue`. The note is the sentence that explains why the offer is
    // `write today` rather than the word §2 names, and it is a paragraph
    // over the group rather than a row in it — so the row list holds the
    // offer alone, and the sentence is read off `.shell-note`.
    if (state.notes.join(" | ") !== SHELL_READING_NOTE) {
      throw new Error(
        `reading-view: the notes on screen are [${state.notes.join(" | ")}], expected only ` +
        `["${SHELL_READING_NOTE}"] — the sentence is a Note, and a row carrying it instead ` +
        "would be the inert fact row the pass removed",
      );
    }
    assertScreenRows(state, "reading-view", SHELL_READING_ROWS.map((l) => [l, ""]));
    // The offer is an ACTION: it leaves for the page root and opens no
    // screen, so no chevron — and it is live. Neither is visible in the
    // image at the gate; both are the row's own attributes.
    const offer = state.rows[0];
    if (offer.inert || offer.kind !== "action" || offer.chevron) {
      throw new Error(
        `reading-view: "${offer.label}" is ${offer.inert ? "inert" : "live"}, kind ` +
        `"${offer.kind}", ${offer.chevron ? "with" : "without"} a chevron — expected a live ` +
        "action with no chevron; a dead offer sends nobody anywhere, and a chevron points at " +
        "a screen this row does not open",
      );
    }
  },

  [STATES.SETTINGS_ROOT]: async (page) => {
    const state = await goToShellSettings(page, "settings-root");
    assertRowsLegible(state, "settings-root");
    assertScreenRows(state, "settings-root", SHELL_SETTINGS_ROWS);

    // Every row here opens something, so none may be inert. `Row` renders a
    // control only when it has an `onSelect`, and an inert row is a label
    // on the group's surface — in a 412px photograph that is the same
    // picture as a live one minus a chevron. A settings root with a dead
    // row is a setting the phone cannot reach at all.
    const inert = state.rows.filter((r) => r.inert).map((r) => r.label);
    if (inert.length > 0) {
      throw new Error(
        `settings-root: [${inert.join(", ")}] render as inert markup — every root row ` +
        "pushes a screen (four sections and the sync stack), so a dead one is a section " +
        "with no way in",
      );
    }
    // And every one of them is a PUSH with its chevron: these are the rows
    // the chevron exists for, and the only ones in settings that get it.
    const unpointed = state.rows.filter((r) => r.kind !== "push" || !r.chevron).map((r) => r.label);
    if (unpointed.length > 0) {
      throw new Error(
        `settings-root: [${unpointed.join(", ")}] render without a push chevron — a root row ` +
        "opens a screen, which is the one promise the chevron makes",
      );
    }

    // THE GROUPS, which are the only thing in the image separating the five
    // rows into three things. Each is an inset `RowGroup` under an eyebrow;
    // the screen draws no rule of its own, so a group that failed to form
    // photographs as five rows on one surface with a name over the first,
    // and a missing eyebrow as a surface with no name. Read by name rather
    // than counted, because three groups under the wrong words is the
    // failure a count would wave through.
    const eyebrows = await page
      .locator('.shell-stack-entry[data-top="true"] .shell-row-group .shell-eyebrow')
      .allTextContents();
    const groups = await page.locator('.shell-stack-entry[data-top="true"] .shell-row-group').count();
    if (groups !== SHELL_SETTINGS_EYEBROWS.length) {
      throw new Error(
        `settings-root: ${groups} groups on screen, expected ${SHELL_SETTINGS_EYEBROWS.length} — ` +
        "ROOT_GROUPS is page, sync, app, and a group that did not form photographs as rows " +
        "run together on one surface",
      );
    }
    const words = eyebrows.map((t) => t.trim());
    if (words.join("|") !== SHELL_SETTINGS_EYEBROWS.join("|")) {
      throw new Error(
        `settings-root: the eyebrows read [${words.join(", ")}], expected ` +
        `[${SHELL_SETTINGS_EYEBROWS.join(", ")}] — the words are settings-model.js's decision, ` +
        "and a synonym here is a different screen",
      );
    }
  },

  [STATES.SETTINGS_TONE]: async (page) => {
    await goToShellSettings(page, "settings-tone");
    await tapScreenRow(page, "tone");
    await settle(page, 500);

    const state = await screenState(page);
    assertPushedScreen(state, "settings-tone", SHELL_TONE_SECTION_BAR.title);
    assertRowsLegible(state, "settings-tone");
    assertScreenRows(state, "settings-tone", SHELL_TONE_SECTION_ROWS);

    // The blurb, which rides NavBar's subtitle line rather than needing a
    // description slot on `Row`. Asserted by its characters because the bar
    // DROPS it under a collapse — so a blurb that failed to arrive and a
    // blurb the bar folded away are the same photograph.
    if (state.subtitle !== SHELL_TONE_SECTION_BAR.subtitle) {
      throw new Error(
        `settings-tone: the bar's second line reads "${state.subtitle}", expected ` +
        `"${SHELL_TONE_SECTION_BAR.subtitle}" — the section's blurb comes from ` +
        "settings-model.js and is the only description this screen has",
      );
    }

    // NOTHING IS INERT, including the row already in use. Dropping the
    // chosen row's onSelect to say "picking this does nothing" would swap
    // its element mid-list — `Row` renders a control only when it does
    // something — so that one row alone would lose its tab stop, and the
    // list would reflow as a reader moved through it. The word in the
    // value column is what says which one is current.
    const inert = state.rows.filter((r) => r.inert).map((r) => r.label);
    if (inert.length > 0) {
      throw new Error(
        `settings-tone: [${inert.join(", ")}] render as inert markup — every choice row ` +
        "stays selectable, including the chosen one, so the list does not reflow under a " +
        "reader moving through it",
      );
    }

    // AND NOTHING POINTS. Every row is a `choice` — it selects and pops —
    // and a choice draws no chevron (row-kind.js), because the chevron is
    // the promise that a tap opens a screen. Every option row carried one
    // until the visual pass; this is the DOM half of the photograph that
    // says the wart is gone, since a glyph at the row's end is under the
    // pixel gate.
    const pointed = state.rows.filter((r) => r.kind !== "choice" || r.chevron).map((r) => r.label);
    if (pointed.length > 0) {
      throw new Error(
        `settings-tone: [${pointed.join(", ")}] render as something other than an unpointed ` +
        "choice row — SettingsSectionScreen passes `kind=\"choice\"` on the option branch, " +
        "and without it a row with an onSelect is a push with a chevron by default",
      );
    }

    // Exactly one row carries the word, and it is the theme this capture is
    // being taken at. Two would mean `choiceRows` compared against nothing;
    // zero would mean the stored tone is one this build does not know, which
    // `optionLabel` deliberately falls back to rather than hiding.
    const chosen = state.rows.filter((r) => r.value !== "").map((r) => r.label);
    if (chosen.length !== 1 || chosen[0] !== "cream") {
      throw new Error(
        `settings-tone: [${chosen.join(", ") || "nothing"}] carries the in-use word, ` +
        "expected exactly `cream` — every interaction state is captured at the cream " +
        "theme, and App.svelte's VR branch is what puts that value on the host's prop",
      );
    }
  },

  [STATES.SETTINGS_LABS]: async (page) => {
    await goToShellSettings(page, "settings-labs");
    await tapScreenRow(page, "labs");
    await settle(page, 500);

    const state = await screenState(page);
    assertPushedScreen(state, "settings-labs", SHELL_LABS_SECTION_BAR.title);
    assertRowsLegible(state, "settings-labs");
    assertScreenRows(state, "settings-labs", SHELL_LABS_ROWS);

    if (state.subtitle !== SHELL_LABS_SECTION_BAR.subtitle) {
      throw new Error(
        `settings-labs: the bar's second line reads "${state.subtitle}", expected ` +
        `"${SHELL_LABS_SECTION_BAR.subtitle}"`,
      );
    }

    // THE ROW IS INERT AND THAT IS THE POINT of shooting this section beside
    // `tone`. A toggle row acts through the switch, not through the row, so
    // `Row` renders a plain element with no `onSelect` — the opposite answer
    // to every row on the tone section, from the same component, decided by
    // the `kind` the model handed it. A live row here would mean a tap
    // anywhere on the line did something the switch's own position does not
    // report.
    if (!state.rows[0]?.inert) {
      throw new Error(
        "settings-labs: the toggle row renders as a control — it acts through its switch, " +
        "so a row-wide tap target would fire something the switch cannot show",
      );
    }

    // The switch itself, which `screenState.rows` cannot see: a toggle row
    // has no value column, so there and in a photograph it is a label with
    // a small grey shape at the end of it.
    //
    // CHECKED, and not because the fixture said so. `isYjsEnabled` is
    // default-ON since v0.4 — "any value other than an explicit off sentinel
    // means enabled, including null for never-touched installs" — so this is
    // an install that has never opened labs, which is the state every reader
    // meets it in. Asserted rather than assumed, because the whole visible
    // difference between on and off is a thumb at one end of a 28px track.
    const [toggle] = state.toggles;
    if (!toggle || toggle.label !== SHELL_LABS_TOGGLE_ROW) {
      throw new Error(
        `labs: the section holds ${state.toggles.length} toggles ` +
        `(${state.toggles.map((t) => t.label).join(", ") || "none"}), expected the first ` +
        `named "${SHELL_LABS_TOGGLE_ROW}" — Row's toggle variant is the only control this ` +
        "section has",
      );
    }
    if (!toggle.checked) {
      throw new Error(
        "settings-labs: the yjs switch is off on an install that has never touched the " +
        "setting — feature-flag.js reads anything but an explicit off sentinel as enabled, " +
        "so this is the read inverting rather than a preference being honoured",
      );
    }
  },

  [STATES.SYNC_DEVICES]: async (page) => {
    await goToShellSettings(page, "sync-devices");
    await tapScreenRow(page, "sync");
    await settle(page, 700);

    const state = await screenState(page);
    // Depth 2: sync is pushed FROM the settings root, and it is the floor
    // the rest of the stack is measured up from.
    assertPushedScreen(state, "sync-devices", "sync", 2);
    assertRowsLegible(state, "sync-devices");
    assertScreenRows(state, "sync-devices", SHELL_SYNC_DEVICE_ROWS);

    // One inert row and one live one, named individually. Both are rows with
    // a label and no value in the photograph; the state row is inert because
    // there is nothing behind it to open (turning sync on and off is the
    // desktop's), and the pair row is the only way further into the stack.
    if (!state.rows[0]?.inert) {
      throw new Error(
        "sync-devices: the state row renders as a control — there is nothing behind it to " +
        "open, and a tab stop there promises there is",
      );
    }
    if (state.rows[1]?.inert) {
      throw new Error(
        "sync-devices: the pair row renders as inert markup — it is the ONLY door to the " +
        "pair screen and the scanner behind it, so a dead one ends the stack here",
      );
    }
    // An ACTION, not a push: starting a pairing is something this device
    // does, and the row reads in the accent with no chevron. Asserted on
    // the kind because the accent is a fill behind five words, under the
    // pixel gate, and the missing chevron is a missing glyph.
    if (state.rows[1]?.kind !== "action" || state.rows[1]?.chevron) {
      throw new Error(
        `sync-devices: the pair row is a "${state.rows[1]?.kind}" row` +
        `${state.rows[1]?.chevron ? " with a chevron" : ""} — SyncDevicesScreen passes ` +
        "`kind=\"action\"`, and without it a row with an onSelect is a push by default",
      );
    }
    // The setup row: live, and an action for the same reason. Its
    // presence is already held by assertScreenRows above; this is what
    // says it can be pressed, which is the whole of what the phone that
    // is someone's only device needs from this screen.
    if (state.rows[2]?.inert || state.rows[2]?.kind !== "action" || state.rows[2]?.chevron) {
      throw new Error(
        `sync-devices: the setup row is ${state.rows[2]?.inert ? "inert" : "live"}, ` +
        `a "${state.rows[2]?.kind}" row${state.rows[2]?.chevron ? " with a chevron" : ""} — ` +
        "it must be a pressable action, or the only-device phone is back to a pair row " +
        "with nothing to pair with",
      );
    }

    // THE GROUPS: `status` over the state row and nothing over the act.
    // No `devices` eyebrow at this status, because there is no list to
    // head — the mock's null status fetches nothing — and an eyebrow over
    // an empty surface would name a thing that is not there.
    const eyebrows = (
      await page.locator('.shell-stack-entry[data-top="true"] .shell-eyebrow').allTextContents()
    ).map((t) => t.trim());
    if (eyebrows.join("|") !== "status") {
      throw new Error(
        `sync-devices: the eyebrows read [${eyebrows.join(", ")}], expected [status] — ` +
        "`devices` heads a list only when there is one, and the pair row's flush group " +
        "has no name",
      );
    }

    // FOUR ABSENCES, and each photographs identically to a failure to
    // render, which is why they are named rather than left to the pixels.
    const facts = await syncScreenFacts(page);
    if (facts.syncNote !== null) {
      throw new Error(
        `sync-devices: a note rendered under the state row ("${facts.syncNote}") — ` +
        "STATE_NOTES holds sentences for `not set up` and `revoked` only, and this capture " +
        "is at the null status, whose label is \"\". A note here means syncStateLabel " +
        "answered something the mock cannot produce",
      );
    }
    if (state.empty !== null) {
      throw new Error(
        `sync-devices: the "reading the devices" empty state is on screen ` +
        `("${state.empty}") — \`loadSyncDevices\` returns [] WITHOUT fetching when the ` +
        "status is not configured, so a loading state here is a fetch that should never " +
        "have started",
      );
    }
  },

  [STATES.SYNC_PAIR]: async (page) => {
    await goToShellSettings(page, "sync-pair");
    await tapScreenRow(page, "sync");
    await settle(page, 700);
    await tapScreenRow(page, SHELL_SYNC_DEVICE_ROWS[1][0]);
    await settle(page, 700);

    const state = await screenState(page);
    assertPushedScreen(state, "sync-pair", "pair", 3);
    assertRowsLegible(state, "sync-pair");
    assertScreenRows(state, "sync-pair", [[SHELL_PAIR_ROW, ""]]);

    // The sentence, character for character. It is the only content on this
    // screen besides one row, and it is the JOIN side's — reached because
    // `pairSide(null)` is "join". `pairPrompt` answers "" for a side/phase
    // pair its table does not hold, which would leave this screen a single
    // row with no explanation and no failure anywhere.
    const facts = await syncScreenFacts(page);
    if (facts.pairPrompt !== SHELL_PAIR_PROMPT) {
      throw new Error(
        `sync-pair: the prompt reads "${facts.pairPrompt}", expected ` +
        `"${SHELL_PAIR_PROMPT}" — an empty one means pairPrompt was asked for a ` +
        "side/phase pair it does not hold, which is a typo in the host rather than copy",
      );
    }

    // NO FIELD, and no code. Both belong to the SHOW side, which needs an
    // account the browser mock cannot hold. The field's absence is also a
    // decision rather than a consequence: `pair_new_complete` discards its
    // `device_label`, so a name field on this side would be a control that
    // does nothing.
    if (state.fields.length > 0) {
      throw new Error(
        `sync-pair: the join side carries ${state.fields.length} field(s) ` +
        `(${state.fields.map((f) => f.label).join(", ")}) — the label field belongs to the ` +
        "SHOW side, because pair_new_complete throws this one's away",
      );
    }
    if (facts.pairWords !== null || facts.pairError !== null) {
      throw new Error(
        `sync-pair: the screen shows ${facts.pairWords ? "a pairing code" : "an error"} ` +
        `("${facts.pairWords ?? facts.pairError}") — nothing has been started on this side, ` +
        "so both belong to a state this capture is not in",
      );
    }
  },

  [STATES.SYNC_SCAN]: async (page) => {
    await goToShellSettings(page, "sync-scan");
    await tapScreenRow(page, "sync");
    await settle(page, 700);
    await tapScreenRow(page, SHELL_SYNC_DEVICE_ROWS[1][0]);
    await settle(page, 700);
    await tapScreenRow(page, SHELL_PAIR_ROW);
    await settle(page, 700);

    const state = await screenState(page);
    // Depth 4 — the deepest surface in this shell, and the only place the
    // stack goes past two. Everything about a pushed screen still holds at
    // the bottom of it: one back control a thumb can hit, and no reserved
    // bottom band.
    assertPushedScreen(state, "sync-scan", "scan", 4);

    // NO ROWS AT ALL. §2 asks for "full-screen camera with its own back",
    // and what makes it full-screen here is that the content band holds one
    // thing. A row appearing would be chrome nobody asked for over a
    // viewfinder.
    if (state.rows.length > 0) {
      throw new Error(
        `sync-scan: the scanner screen holds ${state.rows.length} rows ` +
        `(${state.rows.map((r) => r.label).join(", ")}) — the band is the preview's, and ` +
        "§2 gives this surface nothing but a back control",
      );
    }

    // THE CONSENT GATE, WHICH IS THE WHOLE SUBJECT of this capture. No
    // `getUserMedia` has been called yet: QrScanner deliberately holds the
    // OS prompt behind a control the reader presses, so they get a moment
    // to read why the camera is wanted. Mounted with its rationale showing
    // and no error is the app's answer to "the scanner opened".
    const facts = await syncScreenFacts(page);
    if (!facts.scannerMounted) {
      throw new Error(
        "sync-scan: QrScanner is not mounted — `cameraLive(status)` is the `{#if}` that " +
        "puts it there, so this screen came up already paused, already read, or already " +
        "failed, and the photograph would be of a note rather than of the gate",
      );
    }
    if (facts.scannerCta !== SHELL_SCAN_CTA) {
      throw new Error(
        `sync-scan: the consent control reads "${facts.scannerCta}", expected ` +
        `"${SHELL_SCAN_CTA}" — it is the one thing on this screen a reader can press, and ` +
        "the camera stays off until they do",
      );
    }
    if (facts.scanNote !== null || facts.scannerError !== null) {
      throw new Error(
        "sync-scan: a failure sentence is already on screen " +
        `("${facts.scanNote ?? facts.scannerError}") before the camera was ever asked for`,
      );
    }
  },

  [STATES.SYNC_SCAN_REFUSED]: async (page) => {
    await goToShellSettings(page, "sync-scan-refused");
    await tapScreenRow(page, "sync");
    await settle(page, 700);
    await tapScreenRow(page, SHELL_SYNC_DEVICE_ROWS[1][0]);
    await settle(page, 700);
    await tapScreenRow(page, SHELL_PAIR_ROW);
    await settle(page, 700);

    // The raw engine error, caught on its way to the console. `handleError`
    // logs it and never renders it — it is an exception in the face the
    // writer reads their own words in — so this listener is the only place a
    // run can say WHY the note below is the one it is. That matters because
    // WHICH of `scannerNote`'s three sentences appears is the engine's
    // answer: it is what `classifyCameraError` made of this string.
    // Registered before the tap, because a console listener added after the
    // event hears nothing.
    const cameraErrors = [];
    page.on("console", (msg) => {
      const text = msg.text();
      if (text.includes("the camera did not open")) cameraErrors.push(text);
    });

    const cta = page.locator(".rationale-cta");
    await cta.waitFor({ state: "visible" });
    await cta.tap();

    // Waited ON, not settled for: `getUserMedia` is an engine round trip
    // through a permission decision, and how long a refusal takes is not
    // this file's to guess. The note inside `.scan-band` is the shell's
    // own sentence (a `Note`, in the band the preview owns) and only
    // exists once `handleError` has moved the status.
    await page
      .locator('.shell-stack-entry[data-top="true"] .scan-band .shell-note')
      .waitFor({ state: "visible", timeout: 20000 });
    await settle(page, 400);

    const state = await screenState(page);
    assertPushedScreen(state, "sync-scan-refused", "scan", 4);

    const facts = await syncScreenFacts(page);

    // THE CAMERA IS RELEASED BY UNMOUNTING, which is the only lever this
    // shell has over a borrowed component's stream. A QrScanner still on
    // screen under the note would be a lens the writer cannot see and would
    // not attribute to a notebook app.
    if (facts.scannerMounted) {
      throw new Error(
        "sync-scan-refused: QrScanner is still mounted under the failure note — " +
        "SyncScanScreen's `{#if cameraLive(status)}` IS the camera switch, so a component " +
        "left mounted here is a stream nothing has stopped",
      );
    }

    // The sentence is one of `scannerNote`'s three. WHICH one is the
    // environment's answer rather than the app's — a machine with no camera
    // and a browser that refuses the permission fail differently — so the
    // set is asserted and the actual is logged, the way trail-sheet-keyboard
    // reports the numbers its verdict rests on.
    console.log(
      `[sync-scan-refused] scannerNote: ${facts.scanNote} · raw: ` +
      `${cameraErrors.join(" | ") || "(nothing reached the console)"}`,
    );
    if (!SHELL_SCAN_NOTES.includes(facts.scanNote)) {
      throw new Error(
        `sync-scan-refused: the note reads "${facts.scanNote}", which is none of ` +
        "scanner-lifecycle.js's three — `classifyCameraError` falls through to `failed` " +
        "for anything it does not recognise, so a fourth sentence means the note came " +
        "from somewhere else entirely",
      );
    }

    // AND THE DESKTOP'S SENTENCE IS NOWHERE ON THE DEVICE. This is the claim
    // the capture exists for: QrScanner's own error branch tells the reader
    // to switch to a "type words" tab that exists only in
    // src/components/SyncSettings.svelte, and on a phone that is an
    // instruction to do something impossible. Read across the whole document
    // rather than the top screen, because a sentence rendered one stack
    // entry down is still a sentence on the display.
    if (facts.scannerError !== null) {
      throw new Error(
        `sync-scan-refused: QrScanner's own error block rendered ("${facts.scannerError}") ` +
        "— the shell unmounts the component on onError precisely so its desktop wording " +
        "cannot be reached",
      );
    }
    if (facts.documentText.includes(SHELL_SCAN_DESKTOP_TEXT)) {
      throw new Error(
        `sync-scan-refused: the words "${SHELL_SCAN_DESKTOP_TEXT}" are on the display — ` +
        "that names a tab in the desktop's sync settings and nothing in this tree, so a " +
        "reader following it has nowhere to go",
      );
    }
  },

  // The pin panel over the page — its own layout, and the surface a pinned
  // image or a titleless pin row shows up on.

  [STATES.SYNC_SETUP_PHRASE]: async (page) => {
    await goToShellSetupPhrase(page, "sync-setup-phrase");

    const state = await screenState(page);
    const facts = await syncScreenFacts(page);
    assertSetupScreen(state, facts, "sync-setup-phrase");

    if (facts.activeSegment !== SHELL_SETUP_MODE_TYPED) {
      throw new Error(
        `sync-setup-phrase: the segment is on "${facts.activeSegment}", expected ` +
        `"${SHELL_SETUP_MODE_TYPED}" — the tap did not switch sides, so the field below is ` +
        "not the one this capture is of",
      );
    }
    // One field, and it holds every word. `value` is read from the
    // textarea, so a keystroke the field dropped shows here as a short
    // string rather than as a photograph of a full-looking box.
    if (state.fields.length !== 1 || state.fields[0].label !== SHELL_SETUP_PHRASE_FIELD) {
      throw new Error(
        `sync-setup-phrase: the fields are [${state.fields.map((f) => f.label).join(", ")}], ` +
        `expected [${SHELL_SETUP_PHRASE_FIELD}] — one multiline field is the whole typed side`,
      );
    }
    if (state.fields[0].value !== SHELL_SETUP_PHRASE) {
      throw new Error(
        `sync-setup-phrase: the field holds "${state.fields[0].value}", expected the 24 typed ` +
        "words — a phone keyboard that drops or rewrites a word here is what the model's " +
        "normalisation exists for, and this capture must show the words as typed",
      );
    }
    if (facts.setupWords !== null) {
      throw new Error(
        `sync-setup-phrase: a mono phrase block is on screen ("${facts.setupWords}") — that ` +
        "is the new-account side's display, and this capture is the typed side",
      );
    }
    if (facts.primaryAction !== "next") {
      throw new Error(
        `sync-setup-phrase: the filled button reads "${facts.primaryAction}", expected "next"`,
      );
    }
  },

  [STATES.SYNC_SETUP_RELAY]: async (page) => {
    await goToShellSetupPhrase(page, "sync-setup-relay");
    const next = page.locator('.shell-stack-entry[data-top="true"] [data-button-id="setup-next"]');
    await next.waitFor({ state: "visible" });
    await next.tap();
    await settle(page, 500);

    const state = await screenState(page);
    const facts = await syncScreenFacts(page);
    assertSetupScreen(state, facts, "sync-setup-relay");
    assertScreenRows(state, "sync-setup-relay", [[SHELL_SETUP_CHANGE_ROW, ""]]);

    if (facts.setupPrompts[0] !== SHELL_SETUP_RELAY_PROMPT) {
      throw new Error(
        `sync-setup-relay: the first sentence reads "${facts.setupPrompts[0]}", expected ` +
        `"${SHELL_SETUP_RELAY_PROMPT}" — the step did not advance, or the prompt table lost ` +
        "the desktop's line",
      );
    }
    if (facts.activeSegment !== SHELL_SETUP_HOSTED) {
      throw new Error(
        `sync-setup-relay: the relay segment is on "${facts.activeSegment}", expected ` +
        `"${SHELL_SETUP_HOSTED}" — hosted is the default while HOSTED_RELAY_URL names a relay`,
      );
    }
    // The destination, named. Its absence is the trust failure the
    // desktop's comment warns of; its presence with the scheme is a
    // string nobody would read as a place.
    if (facts.setupWords !== SHELL_SETUP_RELAY_NAME) {
      throw new Error(
        `sync-setup-relay: the destination reads "${facts.setupWords}", expected ` +
        `"${SHELL_SETUP_RELAY_NAME}" — the hosted choice names where the writing goes`,
      );
    }
    // One field: the device name. The url field belongs to self-host,
    // and the phrase field to the step before.
    if (state.fields.length !== 1 || state.fields[0].label !== SHELL_SETUP_LABEL_FIELD) {
      throw new Error(
        `sync-setup-relay: the fields are [${state.fields.map((f) => f.label).join(", ")}], ` +
        `expected [${SHELL_SETUP_LABEL_FIELD}] — hosted asks for a name and nothing else`,
      );
    }
    if (facts.primaryAction !== "connect") {
      throw new Error(
        `sync-setup-relay: the filled button reads "${facts.primaryAction}", expected "connect"`,
      );
    }
    if (state.rows[0]?.inert || state.rows[0]?.kind !== "action") {
      throw new Error(
        "sync-setup-relay: the way back to the words is not a pressable action row — the " +
        "nav bar's back leaves setup, so this row is the only step back that keeps the phrase",
      );
    }
  },
  [STATES.PIN_PANEL]: async (page) => {
    await page.getByRole("button", { name: /pin/i }).first().click();
    await settle(page);
  },

  // Reroute note (this pass): this state used to tap the block's body and
  // assert the title revealed via a `.block-active-touch` CSS class — but
  // c912aae's cleanup pass deleted the CSS that class drove (see prose.css
  // and global.css's notes on the removed touch-overlay rules) while the
  // JS kept stamping the now-inert class. Run against that code this state
  // timed out waiting for a title that CSS no longer had any way to show —
  // exactly the "passed here, would have failed forever on-device" gap
  // this task exists to close. The real, current path is the gutter
  // toolbar's own T button (this pass's title fix): tap the block to
  // reveal the toolbar, tap T, and T's own handler focuses the slot
  // synchronously — `.board-title-slot:focus` is the CSS rule that's
  // actually still wired up.
  [STATES.BLOCK_TITLE_TOUCH]: async (page) => {
    const wrapper = page.locator(".tiptap-wrapper").first();
    await wrapper.waitFor({ state: "visible" });
    const wrapBox = await wrapper.boundingBox();
    const block = page.locator(".tiptap-wrapper .ProseMirror > .block-shell").first();
    await block.waitFor({ state: "visible" });
    const box = await block.boundingBox();
    if (!box || box.y < wrapBox.y || box.y + box.height > wrapBox.y + wrapBox.height) {
      throw new Error("block-title-touch: block is not inside the editor viewport");
    }

    // Tap the block's body. That single tap IS the whole interaction now:
    // it is touch's equivalent of desktop hover, so it both reveals the
    // gutter toolbar and reveals this board's title slot, editable. There
    // is no T button any more — a dedicated control for something the block
    // already affords, occupying one of very few slots in a narrow gutter.
    await block.tap();
    await settle(page, 250);

    const handles = page.locator(".block-handles");
    await handles.waitFor({ state: "visible" });

    const titleSlot = block.locator(".board-title-slot").first();
    await titleSlot.waitFor({ state: "visible" });
    const titleBox = await titleSlot.boundingBox();
    if (!titleBox || titleBox.width === 0 || titleBox.height === 0) {
      throw new Error("block-title-touch: tapping the block did not reveal its title slot");
    }

    // The slot must be EDITABLE by tapping it — this is the half that a
    // "did it render" check misses. A mobile webview only raises the IME
    // for focus that traces to a user gesture, so the tap on the slot must
    // land focus on the input itself.
    await titleSlot.tap();
    await settle(page, 150);
    const isFocused = await titleSlot.evaluate((el) => el === document.activeElement);
    if (!isFocused) {
      throw new Error("block-title-touch: tapping the revealed title slot did not focus it — it cannot be edited");
    }

    // Deliberately no "nothing reflowed" assertion. The reveal is IN FLOW
    // by design (same as desktop's hover reveal); the overlay that used to
    // avoid reflow is what forced ~37px of reserved space above every
    // board. What matters instead is WHEN it reflows: TipTapEditor reveals
    // on pointerUP, after the caret has been placed from the tap, so the
    // text cannot move out from under the finger mid-tap. Asserting zero
    // reflow here would be asserting the design we deliberately dropped.
  },
  // The /chart builder, opened the real way: focus the empty page's lone
  // paragraph, type "/chart" so the slash-command Suggestion plugin opens
  // its menu, then click the "chart" row — same DOM path renderRow() wires
  // up for a real tap/click, see src/lib/slash-commands.js.
  [STATES.CHART_BUILDER]: async (page) => {
    const wrapper = page.locator(".tiptap-wrapper").first();
    await wrapper.waitFor({ state: "visible" });
    const block = page.locator(".tiptap-wrapper .ProseMirror > p").first();
    await block.waitFor({ state: "visible" });
    await block.click();
    await page.keyboard.type("/chart");
    await settle(page, 250);

    const menu = page.locator(".slash-command-menu");
    await menu.waitFor({ state: "visible" });
    const row = menu.locator(".slash-command-row", { hasText: "chart" }).first();
    await row.waitFor({ state: "visible" });
    await row.click();
    await settle(page, 300);

    const builder = page.locator(".builder");
    await builder.waitFor({ state: "visible" });
  },

  // Same open path, then the soft keyboard comes up — the reported bug
  // involved form fields with the IME open. Shrinking the viewport is the
  // same technique KEYBOARD above uses; focus the title input first so the
  // shrink happens with a field actually focused, like a real IME open would.
  [STATES.CHART_BUILDER_KEYBOARD]: async (page) => {
    await STATE_DRIVERS[STATES.CHART_BUILDER](page);
    const size = page.viewportSize();
    if (!size) throw new Error("chart-builder-keyboard: no viewport to shrink");
    await page.locator(".builder .title-input").click();
    await page.setViewportSize({ width: size.width, height: KEYBOARD_VIEWPORT_HEIGHT });
    await settle(page, 700);
  },

  // The shortcuts panel, opened the only way there is: click its own `?`.
  // Desktop project only (see the state's comment in scenes.js) — the
  // panel is display:none under (pointer: coarse), so this driver clicking
  // nothing is the correct failure on a phone, not a state to capture.
  [STATES.SHORTCUT_PANEL]: async (page) => {
    const toggle = page.getByRole("button", { name: "keyboard shortcuts" });
    await toggle.waitFor({ state: "visible" });
    await toggle.click();

    const panel = page.locator(".help-panel");
    await panel.waitFor({ state: "visible" });
    await settle(page, 350);

    // The container runs a Linux engine, so modifier-label.js must answer
    // "ctrl". Asserting ⌘ is ABSENT is the regression photograph: every
    // mod chord on this panel used to print ⌘ regardless of platform, and
    // no capture could see it because no capture ever opened the panel.
    const keys = await panel.locator(".key").allTextContents();
    if (!keys.includes("ctrl")) {
      throw new Error(
        `shortcut-panel: expected a "ctrl" chip on a Linux engine, got ${JSON.stringify(keys)}`,
      );
    }
    if (keys.includes("⌘")) {
      throw new Error("shortcut-panel: ⌘ printed on a Linux engine — modifier-label.js regressed");
    }

    // Every row's keys start at the same x. Measured rather than left to
    // the pixel diff: the column drifting a few px back to ragged is well
    // inside the 0.2% ratio gate, and the straight column is the entire
    // point of the subgrid that replaced justify-content: space-between.
    const lefts = await panel
      .locator(".help-keys")
      .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().left)));
    if (lefts.length === 0) throw new Error("shortcut-panel: no rows rendered");
    if (new Set(lefts).size !== 1) {
      throw new Error(
        `shortcut-panel: key column is ragged — left edges ${JSON.stringify([...new Set(lefts)].sort())}`,
      );
    }
  },

  // The DESKTOP tree's own bottom sheet, with the keyboard up. This state
  // exists to SCOPE Task 5's finding, not to photograph a new surface.
  //
  // Task 5 caught `.shell-sheet` sitting off the top of the display and
  // named the cause: index.html asks for
  // `interactive-widget=resizes-content`, so the soft keyboard shrinks the
  // LAYOUT viewport, a `position: fixed` surface anchored to the bottom is
  // ALREADY keyboard-clear, and lifting it by `--kb-inset` on top of that
  // subtracts the keyboard twice. `src/lib/ui/BottomSheet.svelte` — the
  // SHIPPING desktop/mobile-web sheet, which the shell's Sheet does not
  // share a line of code with — carries `bottom: var(--kb-inset, 0px)`.
  // That is geometrically the same lift, off the same variable, published
  // by the same owner (keyboard-state.js, started from App.svelte for the
  // desktop tree and ShellRoot for the shell). Whether it is a live bug
  // turns entirely on whether a BottomSheet is ever open while --kb-inset
  // is non-zero, and nothing in this suite had ever put one there: every
  // sheet state opens a sheet with no field in it, and every keyboard
  // state raises the keyboard with no sheet on screen.
  //
  // LineageSelector is the sheet that settles it, and it is not a
  // contrivance — on a phone viewport its trigger opens a BottomSheet
  // whose first child is a text input (`.lineage-search`, "search or
  // create..."), so "open the trail sheet and type a name" is the ordinary
  // way a trail gets made on a phone. Its own source says as much: the
  // comment at the top of the component describes the sheet's
  // "keyboard-lift" engaging when the field is focused.
  //
  // Real input only, throughout: a click on the trail chip, a click on the
  // field, then the viewport shrink that stands in for the IME — the same
  // technique KEYBOARD and CHART_BUILDER_KEYBOARD use, and a faithful one
  // here, because under resizes-content a layout-viewport shrink is
  // exactly what the real keyboard does.
  [STATES.TRAIL_SHEET_KEYBOARD]: async (page) => {
    const trigger = page.getByRole("button", { name: /trail/ }).first();
    await trigger.waitFor({ state: "visible" });
    await trigger.click();

    const sheet = page.locator(".sheet[role='dialog']");
    await sheet.waitFor({ state: "visible" });
    const field = sheet.locator("input.lineage-search");
    await field.waitFor({ state: "visible" });

    // The click that raises the keyboard on a device. LineageSelector
    // deliberately does NOT autofocus this field under a coarse pointer
    // (a webview only raises the IME for focus tracing to a gesture), so
    // the tap is the only way the field gets focus on the phone project —
    // which is also the only way --kb-inset can become non-zero.
    await field.click();

    const size = page.viewportSize();
    if (!size) throw new Error("trail-sheet-keyboard: no viewport to shrink");
    await page.setViewportSize({ width: size.width, height: KEYBOARD_VIEWPORT_HEIGHT });
    await settle(page, 700);

    const m = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const num = (name) => {
        const v = Number.parseFloat(cs.getPropertyValue(name));
        return Number.isFinite(v) ? Math.round(v) : null;
      };
      const el = document.querySelector(".sheet[role='dialog']");
      const r = el ? el.getBoundingClientRect() : null;
      const active = document.activeElement;
      return {
        present: !!el,
        kbInset: num("--kb-inset"),
        appHeight: num("--app-height"),
        innerHeight: window.innerHeight,
        vvHeight: window.visualViewport ? Math.round(window.visualViewport.height) : null,
        vvOffsetTop: window.visualViewport ? Math.round(window.visualViewport.offsetTop) : null,
        cssBottom: el ? getComputedStyle(el).bottom : null,
        top: r ? Math.round(r.top) : null,
        bottom: r ? Math.round(r.bottom) : null,
        height: r ? Math.round(r.height) : null,
        activeEl: active
          ? `${active.tagName.toLowerCase()}.${(active.className || "").toString().split(/\s+/)[0]}`
          : null,
        fieldFocused: !!(active && active.classList && active.classList.contains("lineage-search")),
      };
    });

    // One line carrying every number the verdict rests on, so a failure
    // reports its own diagnosis and a pass is still auditable in the run
    // output rather than only in the PNG.
    const facts =
      `sheet ${m.top}..${m.bottom} (h ${m.height}, css bottom ${m.cssBottom}) · ` +
      `--kb-inset ${m.kbInset}px · --app-height ${m.appHeight}px · ` +
      `innerHeight ${m.innerHeight} · visualViewport.height ${m.vvHeight} ` +
      `(offsetTop ${m.vvOffsetTop}) · focus ${m.activeEl}`;
    console.log(`[trail-sheet-keyboard] ${facts}`);

    if (!m.present) {
      throw new Error(
        "trail-sheet-keyboard: the BottomSheet left the DOM during the shrink — the " +
        `capture would prove nothing about where a sheet sits. ${facts}`,
      );
    }
    // The vacuous pass this state exists to avoid. --kb-inset is
    // `baseline − visualViewport.height` and computeKeyboardState gates it
    // on hasFocusedField, so a driver that shrank the viewport without a
    // focused field leaves it at 0 — and a sheet lifted by 0px is trivially
    // on screen. That result would read as "the desktop sheet is fine" while
    // having never once reached the condition under test.
    if (!m.fieldFocused) {
      throw new Error(
        "trail-sheet-keyboard: the sheet's search field does not have focus, so " +
        "--kb-inset cannot be non-zero and the lift under test is never applied. " +
        `This is a vacuous state, not a pass. ${facts}`,
      );
    }
    if (!m.kbInset) {
      throw new Error(
        `trail-sheet-keyboard: --kb-inset is ${m.kbInset}px with the viewport shrunk to ` +
        `${KEYBOARD_VIEWPORT_HEIGHT}px and a field focused — keyboard-state.js never ` +
        "published a keyboard, so BottomSheet's `bottom: var(--kb-inset, 0px)` resolved " +
        `to its 0px fallback and this state tested nothing. ${facts}`,
      );
    }

    // The question, measured. Same check assertSheetShape makes of the
    // shell's sheet, on the other tree's sheet: a bottom edge past the
    // viewport is the keyboard covering the field being typed into, and a
    // box wholly outside it is a sheet that is not on screen at all.
    if (m.top < 0 || m.bottom > m.innerHeight) {
      throw new Error(
        `trail-sheet-keyboard: the BottomSheet's box is ${m.top}..${m.bottom} in a ` +
        `${m.innerHeight}px viewport, with --kb-inset at ${m.kbInset}px — it is not where ` +
        "it can be seen. BottomSheet.svelte's `bottom: var(--kb-inset, 0px)` lifts a " +
        "fixed surface that `interactive-widget=resizes-content` has ALREADY put above " +
        "the keyboard, so the keyboard is subtracted twice. Task 5's shell finding is " +
        `NOT shell-only. ${facts}`,
      );
    }
  },
};

export function driverFor(state) {
  const fn = STATE_DRIVERS[state];
  if (!fn) throw new Error(`no VR driver for state: ${state}`);
  return fn;
}
