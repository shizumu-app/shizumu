import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { flushSync } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";

const markOnboardingComplete = vi.fn(async () => null);
const unlock = vi.fn(async () => null);

// The gate is the shell's only surface that writes onboarding state or
// hands a passphrase to the backend, so both are stubbed rather than left
// to api.js's browser mock — `unlock` in particular has to be able to
// answer `false`, which the mock never does.
vi.mock("../../lib/api.js", () => ({
  markOnboardingComplete: (...a) => markOnboardingComplete(...a),
  unlock: (...a) => unlock(...a),
}));

const ShellGate = (await import("../ShellGate.svelte")).default;
const { WRONG_PASSPHRASE } = await import("../../lib/lock-copy.js");
const { ONBOARDING_SLIDES } = await import("../gate-model.js");

beforeEach(() => {
  markOnboardingComplete.mockClear();
  unlock.mockClear();
  unlock.mockImplementation(async () => null);
});
afterEach(cleanupAll);

/** The one control in the bottom slot, whatever it currently says. */
function action(target) {
  return target.querySelector(".shell-primary-action button");
}

/** A WHOLE TAP, both halves, because the two gates listen to different ones.
 *
 *  Lock acts on pointerdown — its field is focused, and preventDefault is
 *  what stops the soft keyboard dropping over the passphrase just typed.
 *  Onboarding acts on the click, because a press that dismisses the gate
 *  hands the lift to the tab bar mounting into the same band, which landed
 *  a brand-new writer on memory instead of the page. PrimaryAction's header
 *  carries the device measurement and why the two differ.
 *
 *  Sending only pointerdown, as this helper used to, baked one of those
 *  choices into the harness: the onboarding tests went red when the
 *  component was FIXED, which is a test holding a defect in place. A finger
 *  sends both, so this sends both, and neither gate's choice is the
 *  helper's business. */
function press(el) {
  el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  flushSync();
}

describe("ShellGate — the bands", () => {
  it("renders no nav bar on either kind", () => {
    // "nav bar hidden" (§2). A Screen would bring one; the gate renders no
    // Screen at all, so there is no band to be empty. Asserted by the class
    // Screen's nav band carries, which is the only thing that could put a
    // bar here.
    for (const kind of ["onboarding", "lock"]) {
      const { target } = render(ShellGate, { kind });
      expect(target.querySelector(".shell-screen-nav"), kind).toBeNull();
      expect(target.querySelector(".shell-tab-bar"), kind).toBeNull();
    }
  });

  it("reserves the bottom slot for the primary action", () => {
    const { target } = render(ShellGate, { kind: "lock" });
    expect(target.querySelector(".shell-root.has-slot")).not.toBeNull();
    expect(action(target)).not.toBeNull();
  });

  // THE INSET RULE IS NOT ASSERTED HERE, and the omission is deliberate.
  // shell-rules.test.js already scans every file under src/shell/ for the
  // raw inset function and for the tokens the root owns, so ShellGate is
  // covered by it the moment the file exists. A second copy of that scan
  // aimed at this one file would be two mechanisms guarding one rule —
  // and the redundant one is the kind that keeps a probe green while the
  // real guard is the thing that got deleted.
});

describe("ShellGate — onboarding", () => {
  it("shows the first slide's words", () => {
    const { target } = render(ShellGate, { kind: "onboarding" });
    expect(target.textContent).toContain(ONBOARDING_SLIDES[0].body);
  });

  it("walks the deck one press at a time and only then completes", () => {
    const onComplete = vi.fn();
    const { target } = render(ShellGate, { kind: "onboarding", onComplete });

    for (let i = 0; i < ONBOARDING_SLIDES.length - 1; i++) {
      expect(action(target).textContent.trim(), `slide ${i}`).toBe("next");
      expect(onComplete, `slide ${i}`).not.toHaveBeenCalled();
      press(action(target));
    }
    expect(target.textContent).toContain(ONBOARDING_SLIDES.at(-1).body);
    expect(action(target).textContent.trim()).toBe("begin");
  });

  it("marks onboarding complete when `begin` is pressed", async () => {
    const onComplete = vi.fn();
    const { target } = render(ShellGate, { kind: "onboarding", onComplete });
    for (let i = 0; i < ONBOARDING_SLIDES.length - 1; i++) press(action(target));
    press(action(target));
    await Promise.resolve();
    await Promise.resolve();
    expect(markOnboardingComplete).toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalled();
  });

  it("leaves the gate even if the write never answers", async () => {
    // THE DEVICE REPORT: a phone sat on the last onboarding slide with a
    // button that did nothing, and relaunching showed the same slide again.
    //
    // The old `finish` awaited markOnboardingComplete inside a try/catch,
    // and its comment said exactly what that was for — a failed write must
    // not strand a new user. It guarded against the write THROWING. A write
    // that never RESOLVES, which a locked database or a migration still
    // running produces, is an await that never returns: a dead button on
    // the one screen with no other control, and no way out by restarting,
    // because the flag was never written either.
    //
    // A promise that never settles is the whole fixture. If this test hangs
    // or fails, the button is dead again.
    markOnboardingComplete.mockImplementationOnce(() => new Promise(() => {}));
    const onComplete = vi.fn();
    const { target } = render(ShellGate, { kind: "onboarding", onComplete });
    for (let i = 0; i < ONBOARDING_SLIDES.length - 1; i++) press(action(target));
    press(action(target));
    await Promise.resolve();
    expect(onComplete).toHaveBeenCalled();
  });

  it("still leaves the gate when the write fails", async () => {
    // A failed write must not strand a new user on the last slide with a
    // button that has stopped working; the cost of swallowing it is seeing
    // onboarding once more on the next launch.
    markOnboardingComplete.mockImplementationOnce(async () => {
      throw new Error("no db");
    });
    const onComplete = vi.fn();
    const { target } = render(ShellGate, { kind: "onboarding", onComplete });
    for (let i = 0; i < ONBOARDING_SLIDES.length - 1; i++) press(action(target));
    press(action(target));
    await Promise.resolve();
    await Promise.resolve();
    expect(onComplete).toHaveBeenCalled();
  });
});

describe("ShellGate — which half of the tap acts", () => {
  // THE WIRING, not the primitive. ToolbarButton's own tests prove
  // `activateOn` works; these prove ShellGate asks for the right one on
  // each kind, which is where the shipped defect actually lived.
  //
  // Both send HALF a tap deliberately — a press with no lift — because
  // that is the only way to tell the two paths apart.

  it("does not advance onboarding on the press alone", () => {
    // The first-run defect, as a unit test. On an SM-A065F the press
    // dismissed the gate, the tab bar mounted into the band the button had
    // occupied, and the lift landed on a tab — so tapping `begin` put a
    // brand-new writer on an empty memory list instead of the page. Acting
    // on the lift is what keeps the whole gesture on this button.
    const { target } = render(ShellGate, { kind: "onboarding", onComplete: () => {} });
    expect(action(target).textContent.trim()).toBe("next");

    action(target).dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
    flushSync();

    expect(action(target).textContent.trim()).toBe("next");
    expect(target.querySelector(".shell-gate-title").textContent.trim()).toBe(
      ONBOARDING_SLIDES[0].title,
    );
  });

  it("unlocks on the press, before focus can leave the passphrase", () => {
    // The other kind keeps pointerdown, and for a reason that is not
    // symmetry: lock's field is focused when the writer reaches for this
    // button, and a blur would drop the soft keyboard over what they just
    // typed. Lock has the same mount-underneath shape as onboarding and is
    // left alone on purpose — PrimaryAction's header says why, and says
    // that it is unverified rather than proven harmless.
    const { target } = render(ShellGate, { kind: "lock", onUnlock: () => {} });
    const input = target.querySelector("input");
    input.value = "a passphrase";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();

    action(target).dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
    flushSync();

    expect(unlock).toHaveBeenCalledOnce();
  });
});

describe("ShellGate — lock", () => {
  it("renders a masked passphrase field", () => {
    const { target } = render(ShellGate, { kind: "lock" });
    const input = target.querySelector("input");
    expect(input.getAttribute("type")).toBe("password");
    expect(input.getAttribute("aria-label")).toBe("passphrase");
  });

  it("keeps its one action dead until there is a passphrase to try", () => {
    // Not defensive tidiness: an unlock that submits an empty passphrase
    // can only fail, and on a screen with one control a failure the user
    // could not have avoided reads as the app refusing them.
    const { target } = render(ShellGate, { kind: "lock" });
    expect(action(target).disabled).toBe(true);
    const input = target.querySelector("input");
    input.value = "open sesame";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(action(target).disabled).toBe(false);
  });

  it("unlocks on a passphrase the backend accepts", async () => {
    unlock.mockImplementation(async () => true);
    const onUnlock = vi.fn();
    const { target } = render(ShellGate, { kind: "lock", onUnlock });
    const input = target.querySelector("input");
    input.value = "right";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    press(action(target));
    await Promise.resolve();
    await Promise.resolve();
    expect(unlock).toHaveBeenCalledWith("right");
    expect(onUnlock).toHaveBeenCalled();
  });

  it("stays locked when the backend answers false", async () => {
    // `unlock` returns Ok(false) for a wrong passphrase rather than
    // throwing (commands.rs:4030-4050), so a gate that only awaits it lets
    // a wrong passphrase in — which src/components/LockScreen.svelte did
    // until main's 133b66d6, and this gate never did. Both screens now
    // read the answer; this is the assertion that the shell's keeps
    // reading it (LockScreen.test.js holds the desktop's).
    unlock.mockImplementation(async () => false);
    const onUnlock = vi.fn();
    const { target } = render(ShellGate, { kind: "lock", onUnlock });
    const input = target.querySelector("input");
    input.value = "wrong";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    press(action(target));
    await Promise.resolve();
    await Promise.resolve();
    flushSync();
    expect(onUnlock).not.toHaveBeenCalled();
    // A `Note` in its warm tone — the shell's one colour for "this one"
    // beside a field the writer just used. Asserted by the tone and not
    // by the words alone: rendered in the note's plain ink, "wrong
    // passphrase" under an empty field reads as a label for it.
    const note = target.querySelector('.shell-note[data-tone="warm"]');
    // The account's one lock (account_lock.rs): a phone closed while the
    // passphrase changed elsewhere opens with the one before it until it
    // syncs, and the refusal says so.
    expect(note?.textContent.trim()).toBe(WRONG_PASSPHRASE);
    expect(WRONG_PASSPHRASE).toMatch(/^wrong passphrase\. .*the one before it/);
    expect(target.querySelector("input").value).toBe("");
  });

  it("lets web dev through, because the mock answers null and null is not false", async () => {
    // api.js's browser mock returns null for "unlock" — the check is
    // strictly `=== false`, so non-Tauri development keeps the behaviour it
    // has always had rather than becoming un-unlockable.
    unlock.mockImplementation(async () => null);
    const onUnlock = vi.fn();
    const { target } = render(ShellGate, { kind: "lock", onUnlock });
    const input = target.querySelector("input");
    input.value = "anything";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    press(action(target));
    await Promise.resolve();
    await Promise.resolve();
    expect(onUnlock).toHaveBeenCalled();
  });

  it("keeps its one action with the keyboard up", () => {
    // The gate row's position in toolbarFor, seen from the component that
    // depends on it: focusing the passphrase field raises the soft keyboard
    // and App.svelte passes that straight through. Without the row above
    // `keyboardOpen` this band holds the editor's block strip instead —
    // five controls over a password box, and no unlock among them.
    const { target } = render(ShellGate, { kind: "lock", keyboardOpen: true });
    expect(target.querySelector(".shell-primary-action")).not.toBeNull();
    expect(target.querySelector(".shell-toolbar-strip")).toBeNull();
    expect(action(target).getAttribute("data-button-id")).toBe("unlock");
  });
});
