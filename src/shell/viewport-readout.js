// viewport-readout.js — the numbers that settle an iOS keyboard report,
// as lines a phone can be photographed holding.
//
// THE REPORT: on a real iPhone, with the keyboard up, the writing ends up
// behind the keyboard. Everything this tree can check already passes —
// keyboard-state.js has the resizes-visual arithmetic and the VR suite
// drives it with iOS-SHAPED numbers — so what is in doubt is not the
// arithmetic but the INPUT: what a real WKWebView reports, which nothing
// here has ever seen. A screenshot of these lines is that observation,
// and it costs one build rather than a guess per round trip.
//
// ── WHAT EACH LINE DECIDES ────────────────────────────────────────────
//
// `frame` is the answer to the question the report could not answer from
// the outside — "does the app frame move, or only the content inside it?"
// It is the readout's OWN box, read with getBoundingClientRect, and the
// readout sits at the top of the frame: so `frame.top` is where the top of
// the app is in layout coordinates. Zero means the frame is where a fixed
// box sits by default; anything else is the frame having been moved, by
// us (--vv-offset-top) or by the engine.
//
// `pan` — the visible band's own offset inside the layout viewport, the
// number the viewport owner publishes as `offsetTop` — is the one with
// two readings,
// and they point at opposite fixes:
//
//   pan > 0 while the caret is hidden — WebKit panned the visible band
//     down to reveal the caret, and the frame followed it down by the
//     same amount (ShellRoot's `top`), which puts the caret back under
//     the keyboard. The compensation added for an Android photograph
//     would then be wrong on this platform, and what is wrong with it is
//     that nothing re-checks the caret after the frame moves.
//
//   pan === 0 with scroll > 0 — WebKit scrolled the LAYOUT viewport
//     instead, which a fixed frame does not follow, and the caret
//     correction in keyboard-state.js (`win.scrollTo(0, 0)`) is skipped
//     while a text field has focus. That guard was written for Android's
//     IME animation and would be the thing to narrow.
//
// Both were candidates in the report; neither can be chosen without the
// number. The remaining lines are what this app decided from it, so a
// disagreement between `vv` and `app`, or between `pan` and `top`, is
// visible in the same photograph rather than inferred from it.

/**
 * @param {object} snapshot  keyboard-state.js's `viewportSnapshot`
 * @param {{top: number, height: number}|null} [frame]  the readout's own box
 * @param {{activeBlock: {type: string, pos: number}|null, canUndo: boolean,
 *   seen: boolean}|null} [editor]  editor-readout.js's `editorReadout`
 * @param {{why: string, top: number|null}|null} [handle]  its `handleReadout`
 * @returns {string[]} one short line each, in the order a thumb reads them
 */
export function viewportReadoutLines(snapshot, frame = null, editor = null, handle = null) {
  const n = (value) => (Number.isFinite(value) ? Math.round(value) : 0);
  const s = snapshot || {};
  return [
    `inner ${n(s.innerHeight)}  vv ${n(s.vvHeight)}  pan ${n(s.offsetTop)}  scroll ${n(s.scrollY)}`,
    `app ${n(s.appHeight)}  inset ${n(s.kbInset)}  overlay ${n(s.kbOverlay)}  top ${n(s.vvOffsetTop)}`,
    `frame ${frame ? `${n(frame.top)}..${n(frame.top) + n(frame.height)}` : "—"}  ` +
      `kb ${s.isOpen ? "up" : "down"}  field ${s.focused ? "yes" : "no"}  ${s.event || ""}`.trimEnd(),
    // One build's question, not a permanent line: which number tells the
    // truth when the viewport API goes stale. See the snapshot's own note
    // in keyboard-state.js.
    `client ${n(s.clientHeight)}  html ${n(s.htmlBox)}  avail ${n(s.availHeight)}  zoom ${(Number.isFinite(s.scale) ? s.scale : 1).toFixed(2)}`,
    // THE LINE TO READ FIRST, once the activity publishes IME visibility
    // (scripts/patch-android-keyboard.py). A dash means Android never
    // spoke, and then every number above is an inference again — which is
    // the state four fixes were written against. `up`/`down` here and a
    // disagreeing `kb` on line 3 would mean the branch in
    // computeKeyboardState is not being reached.
    `nat ${s.native ? `${s.native.visible ? "up" : "down"} ${n(s.native.heightPx)}` : "—"}` +
      // THE TWO NUMBERS THAT SETTLE THE REMAINING QUESTION, and they are here
      // rather than in a log because the only way to ask it is on a phone:
      // `raw` is getInsets(ime()).bottom and `nav` is the navigation bar's.
      // If `nav` reads 0 while the IME is up, the subtraction that produces
      // `heightPx` is dead and that height carries the bar's own strip on top
      // of the keyboard's — which decides whether the band is 48px short or
      // exactly right. Absent on every platform but Android, where `nat`
      // itself is a dash.
      (s.native && (s.native.imeRawPx != null || s.native.navPx != null)
        ? `  raw ${n(s.native.imeRawPx)}  nav ${n(s.native.navPx)}`
        : ""),
    // THE BLOCK LINE, and it separates two failures that look identical on
    // a phone. The gutter handle, the `turn into` chip and `pin` all read
    // `activeBlock`; when the handle is missing, the question is whether
    // there is no block or no snapshot at all, and those are opposite
    // hunts. `snap —` means the editor has never reported to the shell
    // (editor-readout.js's `seen`), which is a broken subscription rather
    // than an empty editor.
    editorLine(editor),
    // WHICH BRANCH ANSWERED for the gutter handle. `ok` with a top means it
    // is in the DOM and the question is why it is not visible; anything
    // else names the step that declined. PageScreen's gutterHandle has five
    // ways to answer null and they look identical on a phone.
    `hdl ${handle?.why ?? "—"}${handle?.top == null ? "" : ` top ${n(handle.top)}`}`,
  ];
}

/** THE ONE LINE, for a readout that is not being read right now.
 *
 * Eight lines at 9px is still a strip of the page, and the writer said so:
 * "taking so much space … the bottom buttons are intersected with android
 * buttons". A diagnostic that changes the layout it is diagnosing is a
 * second bug wearing the first one's clothes — these lines are IN the flow
 * (deliberately, so the frame's top can be measured), which means every
 * line is a line of writing surface spent.
 *
 * So it opens collapsed to the four numbers a device question actually
 * starts from, and the rest arrives on a tap (ViewportReadout.svelte):
 *
 *   app   the band the app laid out in — the number that was wrong
 *   kb    what it believes, and from where: `nat` means the activity said so
 *   safe  the bottom inset, which read 0 while the nav row sat in Android's
 *         own button strip
 *   hdl   which branch answered for the gutter handle
 *
 * @param {object} snapshot  keyboard-state.js's `viewportSnapshot`
 * @param {{why: string, top: number|null}|null} [handle]  `handleReadout`
 * @param {string} [safeBottom]  the computed `--safe-bottom`, or ""
 * @returns {string}
 */
export function viewportReadoutSummary(snapshot, handle = null, safeBottom = "") {
  const s = snapshot || {};
  const app = Number.isFinite(s.appHeight) ? Math.round(s.appHeight) : 0;
  // `nat` rather than `up` when the activity is the one answering, because
  // the difference between a measured keyboard and an inferred one is the
  // first thing worth knowing and the two used to be indistinguishable on
  // screen.
  const kb = s.native
    ? `nat ${s.native.visible ? Math.round(s.native.heightPx || 0) : "down"}`
    : (s.isOpen ? `inf ${Math.round(s.kbInset || 0)}` : "down");
  const safe = (safeBottom || "").trim() || "—";
  const hdl = handle?.why ?? "—";
  return `app ${app}  kb ${kb}  safe ${safe}  hdl ${hdl}`;
}

/** The editor half of the readout, as one line.
 *
 *  `undo` rides along because it is the cheapest second opinion there is:
 *  it comes from the same snapshot and is computed from the editor's
 *  history rather than its selection, so `blk —` with `undo y` is a real
 *  editor reporting no block, and `blk —` with `undo n` is the empty
 *  snapshot wearing the same face.
 *
 *  @param {{activeBlock: {type: string, pos: number}|null, canUndo: boolean,
 *    seen: boolean}|null} editor
 *  @returns {string}
 */
function editorLine(editor) {
  if (!editor || !editor.seen) return "blk —  snap —";
  const block = editor.activeBlock;
  const where = block ? `${block.type}@${Math.round(block.pos)}` : "—";
  return `blk ${where}  snap live  undo ${editor.canUndo ? "y" : "n"}`;
}

/**
 * Whether this build wants the readout.
 *
 * A BUILD FLAG, not a setting: the question is one device pass long, and
 * a row in settings would be a permanent surface for it. `?viewport=1`
 * is the same switch for a dev server, where there is no build to
 * re-make. Both are read once, at mount.
 *
 * @param {{search?: string}} [location]
 * @param {Record<string, any>} [env]
 * @returns {boolean}
 */
export function readoutWanted(
  location = typeof window !== "undefined" ? window.location : null,
  env = typeof import.meta !== "undefined" ? import.meta.env : null,
) {
  if (env && (env.VITE_VIEWPORT_READOUT === "1" || env.VITE_VIEWPORT_READOUT === true)) return true;
  const search = typeof location?.search === "string" ? location.search : "";
  return /[?&]viewport=1(?:&|$)/.test(search);
}
