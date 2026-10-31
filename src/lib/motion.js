// Motion that keeps still when the writer's system asks it to.
//
// The CSS motion tokens (--motion-*, global.css) collapse to 0ms under
// prefers-reduced-motion, and a global rule there stills fixed-duration
// CSS. Svelte's transitions are neither: they take a number in a script,
// so the laptop's nineteen fades played in full for a writer who had asked
// for none (Vercel's interface guidelines, 2026-10-31). Every component
// imports `fade` from here instead of from svelte/transition.

import { fade as svelteFade } from "svelte/transition";

/** True when the system asks for less motion. */
export function prefersReducedMotion() {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** svelte/transition's fade, with no duration under reduced motion.
 *  @param {Element} node  @param {import("svelte/transition").FadeParams} [params] */
export function fade(node, params = {}) {
  return svelteFade(node, prefersReducedMotion() ? { ...params, duration: 0 } : params);
}
