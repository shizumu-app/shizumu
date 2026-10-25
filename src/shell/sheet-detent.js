// Where a dragged sheet lands when the finger lifts.
//
// Two detents and the exit (§1): full, half, dismissed. The naive rule —
// snap to whichever detent is nearest — feels stuck, because a fast short
// flick reads as "barely moved" and springs back to where it started. So
// velocity is checked first; only a slow release is decided by position.
//
// Velocity has two tiers, and the second exists because of a device report:
// "sometimes we could not dismiss an opened drawer", photographed on a
// one-field sheet at the full detent. With one tier, a flick moved exactly
// one step, so a full sheet took TWO flicks to leave — and a slow drag from
// full had to travel past the midpoint between half and nothing (~560px of
// finger on a ~750px sheet) before release landed on dismissed. A gentle
// flick still moves one step: a sheet that vanishes past the detent the
// user was aiming for is the same bug as a gesture that fires too eagerly,
// and this one loses their input. A HARD flick — `dismissVelocity` and
// above — is not an aim at a detent; it is the sheet being thrown away, and
// it goes straight to dismissed from either detent.
//
// The units are px/ms, because that is what pointer-gesture.js reports:
// endpointVelocity divides pixels by event timestamps in ms, measured over
// the last 100ms of the stroke (VELOCITY_WINDOW_MS). At 2px/ms the finger
// covered at least 200px in that window — half of the half detent on a
// phone, in a tenth of a second. It is four times the step tier, above the
// 1.4px/ms sheet-detent.test.js calls a "fast flick" that must still land on
// half, and below the 3px/ms Sheet.test.js's flick helper produces, so the
// component test throws a sheet with the same helper it always used.
//
// A slow release is still nearest-detent, and that includes a drag from
// full released just past the half line: it snaps back UP to half rather
// than continuing down to dismissed. Considered and kept. Direction-wins
// would read a 20px overshoot of the half detent as a request to close,
// and closing is the one outcome that costs the user something — the
// sheets that open at full are the ones holding a typed field. Springing
// back 20px costs a glance; dismissing costs the rename. The slow path is
// therefore the forgiving one on purpose, and the two fast paths (a hard
// flick, or a tap on the scrim in Sheet.svelte) are how a full sheet is
// closed in one gesture.

const ORDER = ["dismissed", "half", "full"];

/**
 * @param {object} drag
 * @param {"half"|"full"} drag.from        detent the drag started from
 * @param {number} drag.offsetY            px dragged; positive is downward
 * @param {number} drag.velocityY          px/ms at release; positive is downward
 * @param {number} drag.halfPx             half detent height, px
 * @param {number} drag.fullPx             full detent height, px
 * @param {number} [drag.velocityThreshold] px/ms above which velocity moves one step
 * @param {number} [drag.dismissVelocity]   px/ms above which a downward flick dismisses outright
 * @returns {"full"|"half"|"dismissed"}
 */
export function sheetDetent({
  from,
  offsetY,
  velocityY,
  halfPx,
  fullPx,
  velocityThreshold = 0.5,
  dismissVelocity = 2,
}) {
  const at = ORDER.indexOf(from === "full" ? "full" : "half");

  // Strict `>` on both tiers: exactly at a threshold the lower rule decides,
  // so exactly dismissVelocity is a one-step flick and exactly
  // velocityThreshold is a slow release. Both boundaries are pinned in
  // sheet-detent.test.js.
  if (velocityY > dismissVelocity) return "dismissed";
  if (velocityY > velocityThreshold) return ORDER[Math.max(0, at - 1)];
  if (velocityY < -velocityThreshold) return ORDER[Math.min(ORDER.length - 1, at + 1)];

  // Slow release: the sheet lands at whichever height it is now closest to.
  const startHeight = from === "full" ? fullPx : halfPx;
  const height = startHeight - offsetY;
  const candidates = [
    { detent: "dismissed", height: 0 },
    { detent: "half", height: halfPx },
    { detent: "full", height: fullPx },
  ];
  let best = candidates[0];
  for (const c of candidates) {
    if (Math.abs(c.height - height) < Math.abs(best.height - height)) best = c;
  }
  return best.detent;
}
