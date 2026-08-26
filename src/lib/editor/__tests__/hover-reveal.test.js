import { describe, it, expect } from "vitest";
import {
  hoverIntent,
  hoverPlan,
  shouldRearmTimer,
  HOVER_SHOW_DELAY_MS,
  HOVER_SWITCH_DELAY_MS,
  HOVER_HIDE_DELAY_MS,
} from "../hover-reveal.js";

const A = { id: "a" };
const B = { id: "b" };

describe("hoverIntent", () => {
  it("waits the full show delay before revealing from nothing", () => {
    // The case the whole module exists for: the title slot used to be
    // assigned on every mousemove with no delay at all, so a cursor merely
    // crossing the page flickered chrome on and off behind it.
    expect(hoverIntent({ revealed: null, found: A })).toEqual({
      action: "reveal",
      delayMs: HOVER_SHOW_DELAY_MS,
    });
  });

  it("waits a shorter delay when moving between blocks", () => {
    // Chrome is already up and intent is already established, so only its
    // position is in question — but a sweep still crosses many blocks on
    // the way, which is why this is delayed at all rather than instant
    // (instant is exactly what made the column strobe down a page).
    expect(hoverIntent({ revealed: A, found: B })).toEqual({
      action: "reveal",
      delayMs: HOVER_SWITCH_DELAY_MS,
    });
    expect(HOVER_SWITCH_DELAY_MS).toBeLessThan(HOVER_SHOW_DELAY_MS);
  });

  it("waits a grace period before clearing", () => {
    // Long enough to cross from a block to its own handle column, which
    // sits in the gutter OUTSIDE the block's box — so the cursor is off
    // every block for the whole trip to the control it is aiming at.
    expect(hoverIntent({ revealed: A, found: null })).toEqual({
      action: "clear",
      delayMs: HOVER_HIDE_DELAY_MS,
    });
  });

  it("does nothing when the right block is already revealed", () => {
    // "none" means leave every timer ALONE, not cancel pending work —
    // see the re-arm rule below. Asserted rather than left implicit
    // because a cancel here would be indistinguishable in the type but
    // would make a drifting cursor never settle.
    expect(hoverIntent({ revealed: A, found: A })).toEqual({ action: "none", delayMs: 0 });
  });

  it("does nothing when there is nothing revealed and nothing under the cursor", () => {
    // The steady state of a cursor parked in the margin. Emitting a
    // "clear" here would be harmless but would churn a timer every pixel.
    expect(hoverIntent({ revealed: null, found: null })).toEqual({ action: "none", delayMs: 0 });
  });
});

describe("shouldRearmTimer", () => {
  it("arms when no timer is running", () => {
    expect(shouldRearmTimer(undefined, A)).toBe(true);
    expect(shouldRearmTimer(undefined, null)).toBe(true);
  });

  it("does NOT re-arm for the same pending target", () => {
    // mousemove fires per pixel of travel. Re-arming on every event would
    // restart the wait continuously, so the reveal would land only once
    // the mouse came to a dead stop — a different, worse promise than
    // "settle on a block for 450ms".
    expect(shouldRearmTimer(A, A)).toBe(false);
    expect(shouldRearmTimer(null, null)).toBe(false);
  });

  it("re-arms when the pending target changes", () => {
    expect(shouldRearmTimer(A, B)).toBe(true);
    expect(shouldRearmTimer(A, null)).toBe(true);
    expect(shouldRearmTimer(null, A)).toBe(true);
  });

  it("distinguishes 'no timer' from 'a timer pending a clear'", () => {
    // Both are falsy-ish, and conflating them is the bug that would make a
    // pending clear un-cancellable: `undefined` is no timer, `null` is a
    // live timer whose target is "nothing revealed".
    expect(shouldRearmTimer(undefined, null)).toBe(true);
    expect(shouldRearmTimer(null, null)).toBe(false);
  });
});

describe("hoverPlan", () => {
  it("arms a reveal when the cursor settles on a fresh block", () => {
    expect(hoverPlan({ revealed: null, found: A, pendingTarget: undefined }))
      .toEqual({ action: "arm", target: A, delayMs: HOVER_SHOW_DELAY_MS });
  });

  it("arms a clear when the cursor leaves every block", () => {
    expect(hoverPlan({ revealed: A, found: null, pendingTarget: undefined }))
      .toEqual({ action: "arm", target: null, delayMs: HOVER_HIDE_DELAY_MS });
  });

  it("cancels a pending clear when the cursor comes back to the same block", () => {
    // The case neither hoverIntent nor shouldRearmTimer catches alone.
    // The world is already right (A is revealed, A is under the cursor) so
    // hoverIntent says "none" — but the clear armed when the cursor dipped
    // off the block a moment ago is still counting down, and would hide
    // the chrome out from under a cursor sitting right on it.
    expect(hoverPlan({ revealed: A, found: A, pendingTarget: null }))
      .toEqual({ action: "cancel", target: undefined, delayMs: 0 });
  });

  it("cancels a pending reveal for a block the cursor has already left", () => {
    expect(hoverPlan({ revealed: null, found: null, pendingTarget: A }))
      .toEqual({ action: "cancel", target: undefined, delayMs: 0 });
  });

  it("does nothing in a true steady state with no timer running", () => {
    expect(hoverPlan({ revealed: A, found: A, pendingTarget: undefined }))
      .toEqual({ action: "none", target: undefined, delayMs: 0 });
    expect(hoverPlan({ revealed: null, found: null, pendingTarget: undefined }))
      .toEqual({ action: "none", target: undefined, delayMs: 0 });
  });

  it("does not restart a wait that is already counting down for the same target", () => {
    // mousemove fires per pixel; without this the delay would only elapse
    // once the mouse stopped dead.
    expect(hoverPlan({ revealed: null, found: A, pendingTarget: A }))
      .toEqual({ action: "none", target: undefined, delayMs: 0 });
    expect(hoverPlan({ revealed: A, found: null, pendingTarget: null }))
      .toEqual({ action: "none", target: undefined, delayMs: 0 });
  });

  it("re-aims a pending reveal at a different block, at switch speed once chrome is up", () => {
    expect(hoverPlan({ revealed: A, found: B, pendingTarget: A }))
      .toEqual({ action: "arm", target: B, delayMs: HOVER_SWITCH_DELAY_MS });
    expect(hoverPlan({ revealed: null, found: B, pendingTarget: A }))
      .toEqual({ action: "arm", target: B, delayMs: HOVER_SHOW_DELAY_MS });
  });
});
