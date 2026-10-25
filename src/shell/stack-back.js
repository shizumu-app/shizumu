// Whether an interactive back gesture commits or springs back.
//
// Position alone is not enough in either direction. A short fast flick is a
// committed back even though the finger travelled 20px, and a long drag
// thrown back toward the origin is a cancel even though it passed the
// distance line. Velocity is therefore checked first, in both directions,
// and distance decides only the slow release.
//
// The zero-width guard is deliberate rather than defensive noise: width
// arrives from a measurement, and a 0 there means the measurement failed.
// Committing a navigation on a number we do not trust is how a screen
// disappears out from under the finger.

/**
 * @param {object} drag
 * @param {number} drag.dx                 px travelled rightward from the edge
 * @param {number} drag.width              screen width the drag is measured against
 * @param {number} drag.velocityX          px/ms at release; positive is rightward
 * @param {number} [drag.commitFraction]   fraction of width that commits a slow drag
 * @param {number} [drag.velocityThreshold] px/ms above which velocity decides
 * @returns {"commit"|"cancel"}
 */
export function stackBackOutcome({
  dx,
  width,
  velocityX,
  commitFraction = 0.4,
  velocityThreshold = 0.5,
}) {
  if (!(width > 0)) return "cancel";
  if (velocityX > velocityThreshold) return "commit";
  if (velocityX < -velocityThreshold) return "cancel";
  return dx >= width * commitFraction ? "commit" : "cancel";
}
