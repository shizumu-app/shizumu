// How far to scroll so the caret sits between the nav bar and the bottom slot.
//
// The band is what is actually visible while typing: below the nav bar, above
// the slot. MEASURE it; do not derive it from tokens. `.shell-content` and
// `.shell-slot` are flex siblings of a root sized to `--app-height`
// (ShellRoot.svelte:234,238,253), and `--app-height` is the visible viewport
// with the keyboard already excluded — so the content band's own
// getBoundingClientRect() already stops above BOTH the slot and the keyboard.
// Subtract either token from that measurement and you lift the floor off a
// floor that was already right, yanking the page up under a caret that was
// perfectly visible.
//
// This paragraph used to say a normal-flow band's bottom edge "reads only
// `--slot-h`, never `--kb-inset` on top of it". The warning about
// `--kb-inset` was right and is the ShellRoot bug this module must not
// repeat; the conclusion was wrong for a MEASURED band, where neither token
// belongs. Task 4 of P2b — this module's first caller — measures, and
// subtracting `--slot-h` there would have been the very jump the next
// paragraph names. The
// recurring phone bug is not that the caret goes off-screen — it is that
// the correction fires when it should not, so the page jumps under a caret
// that was perfectly visible. Hence the explicit zero: inside the band,
// nothing moves.
//
// When the "caret" is taller than the band it is a selected block, not a text
// cursor. Both edges cannot be satisfied, and the top wins: aligning the
// bottom would scroll the beginning of the user's own selection out of view.
//
// "Too tall" has to be measured against the band AFTER margins, not the raw
// band: the usable space once both margins are reserved is
// `bandBottom - bandTop - 2 * margin`, not `bandBottom - bandTop`. Comparing
// against the raw band let a selection through that fits the band but not
// the band-minus-margins, which then fell into the bottom-alignment branch
// and pushed the selection's TOP a few pixels behind the nav bar — the
// off-screen-caret bug this module exists to prevent, arriving from the
// branch meant to prevent it.
//
// ── WHEN TO ASK, which is a different question from how far to scroll ──
//
// The arithmetic above answers "where should the page be". It cannot answer
// "is now a moment to move the page", and the second question is where the
// jump this module's header names actually comes from. A correction that is
// arithmetically perfect is still a bug if it runs at a moment the writer
// did not ask for: the caret sitting at the end of a document the writer has
// deliberately scrolled away from is not a caret that needs rescuing, it is
// the page they left behind them.
//
// So a re-check answers ONLY to something that moved under the writer. There
// are two such things and neither is a scroll:
//
//   the selection moved — it arrives as tiptap's own selectionUpdate, is
//     never in doubt, and never comes through here. Every keystroke and
//     every caret move re-corrects on that path.
//
//   the keyboard flipped — the ONLY thing that can hide a caret nobody
//     touched. Nothing announces it: `--app-height` shrinks, the frame
//     reflows, and the band's box is simply shorter the next time it is
//     measured. Hence caretRecheckWarranted below, and hence the trigger is
//     a flip rather than a level.
//
// And one thing that looks like a third and is not: the nav bar folding and
// unfolding. It changes the band's box on every fold — but it moves the
// band's TOP edge, and the content moves down with it, so the caret's
// position INSIDE the band is unchanged and a caret that was visible stays
// visible. The keyboard is the opposite shape: it raises the band's FLOOR
// without moving the content, which is why it, alone, needs an answer here.
//
// This is not theory. Measured on android-webview 2026-09-02: writing a page
// and then scrolling back up to re-read it, the band reached scrollTop 0, the
// bar unfolded, and a correction immediately pulled the page back to 222 —
// then 22, then 0, then 222, for as long as it was given wheels. The route in
// was a dependency nobody had written down. PageScreen's `handleScroll` reads
// its `collapsed` derived; Screen calls that handler synchronously from its
// own mount `$effect`, so Screen's effect SUBSCRIBED to `collapsed`; every
// fold and every unfold therefore re-ran it, and it re-handed its scroller
// object to PageScreen; and `let scroller = $state(null)` proxies what it is
// assigned, so an identical object handed back a second time is a brand-new
// proxy and the assignment invalidates anyway. The caret `$effect` read that
// through `scroller?.bounds()` and corrected. Four links, none of them about
// carets, and the effect's own comment named one dependency out of the three
// it had.
//
// The guard is here rather than in the component because the rule — which
// changes are a reason to move the page — is a decision, and this file is
// where this feature's decisions live. What the component keeps is the one
// thing a pure function cannot: the memory of what it last answered to.

/**
 * Whether the caret correction should run again, given what it last ran
 * against.
 *
 * A CHANGE, not a level: `keyboardOpen === true` is not a reason to
 * correct, `false -> true` is. Anything else that re-runs the caller's
 * effect — a re-handed scroller, a re-render, a read nobody has noticed
 * yet — reaches here as an unchanged trigger and is refused.
 *
 * ── THE SECOND INPUT, AND THE PLATFORM THAT NEEDS IT ─────────────────
 *
 * `pan` is how far the visible band sits inside the layout viewport
 * (keyboard-state.js publishes it as `--vv-offset-top`; the shell's frame
 * takes it as its `top`). On a platform that shrinks the layout viewport
 * for the keyboard it is 0 forever and this parameter changes nothing.
 *
 * Where it is not 0, the engine moved the band to reveal the caret and
 * the frame FOLLOWED it — so the app's content moved down by the same
 * amount the reveal moved the view up, and the caret can end up back
 * under the keyboard. The keyboard never flipped during that, so the
 * correction this module gates was never asked to run again.
 *
 * This is written from the code rather than from a device: an iPhone
 * reported the writing ending up behind the keyboard, and what settles
 * WHICH mechanism did it is a screenshot of viewport-readout.js's lines.
 * The gap is real either way — nothing re-checked the caret after the
 * frame moved — so it is closed here, and the report stays open.
 *
 * `stripRow` is the third input, and the band's floor is why.
 *
 * The bottom band holds up to two rows — an editor strip above, the nav
 * row below — and the strip row comes and goes on inputs this function
 * otherwise never hears about: find opening, a sheet opening, a root
 * switch. Each moves `bandBottom` by a --tap's worth with `keyboardOpen`
 * unchanged, which is the same gap `pan` closes one paragraph up: the
 * floor moved and nothing asked again. It was not a gap before the band
 * had two rows, because the band's height never changed.
 *
 * @param {{keyboardOpen: boolean, pan?: number, stripRow?: boolean} | null} last
 *   the trigger at the previous correction, or null before the first ask
 * @param {{keyboardOpen: boolean, pan?: number, stripRow?: boolean}} now
 * @returns {boolean}
 */
export function caretRecheckWarranted(last, now) {
  if (!last) return true;
  if (last.keyboardOpen !== now.keyboardOpen) return true;
  if (!!last.stripRow !== !!now.stripRow) return true;
  return (last.pan ?? 0) !== (now.pan ?? 0);
}

/**
 * @param {object} geom
 * @param {number} geom.caretTop     caret/selection top, viewport px
 * @param {number} geom.caretBottom  caret/selection bottom, viewport px
 * @param {number} geom.bandTop      first visible px below the nav bar
 * @param {number} geom.bandBottom   last visible px above the slot
 * @param {number} [geom.margin]     breathing room to keep on either side
 * @returns {number} px to scroll; positive moves content up, 0 means do nothing
 */
export function caretScrollDelta({ caretTop, caretBottom, bandTop, bandBottom, margin = 8 }) {
  const tooTall = caretBottom - caretTop > bandBottom - bandTop - 2 * margin;
  if (tooTall) return Math.round(caretTop - margin - bandTop);
  if (caretBottom + margin > bandBottom) return Math.round(caretBottom + margin - bandBottom);
  if (caretTop - margin < bandTop) return Math.round(caretTop - margin - bandTop);
  return 0;
}

/**
 * Is the writer typing somewhere other than the editor? The keyboard that a
 * text field raises (the focus line, a search) is not the editor's, and the
 * editor's remembered caret is not what is being typed at. Chasing it put a
 * long living document's last line on screen and the focused title above
 * the top, so nothing typed reached it (sync journey J5.3, 2026-10-24).
 *
 * @param {Element|null} active  document.activeElement
 * @returns {boolean} true when a text field outside the editor has focus.
 */
export function typingElsewhere(active) {
  if (!active || typeof active.tagName !== "string") return false;
  const tag = active.tagName.toUpperCase();
  if (tag !== "INPUT" && tag !== "TEXTAREA") return false;
  return !active.closest?.(".ProseMirror");
}
