import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { shouldBootShell } from "../shell-boot.js";

describe("shouldBootShell", () => {
  it("boots when the setting is on and the viewport is phone-shaped", () => {
    expect(shouldBootShell({ setting: "true", mobileNav: true, coarsePointer: true })).toBe(true);
  });

  it("does not boot on a desktop viewport even with the setting on", () => {
    // The shell is a phone shell. A desktop window with the flag left on
    // must keep the desktop tree, or a tester who tried it on a phone
    // finds their laptop rearranged the next morning.
    //
    // `coarsePointer: true` is passed on purpose, so the ONLY term
    // refusing here is `mobileNav`. Leaving it at its false default would
    // make this row pass for either reason, and it would keep passing if
    // the viewport term were deleted outright — which is the thing it is
    // here to catch.
    expect(shouldBootShell({ setting: "true", mobileNav: false, coarsePointer: true })).toBe(false);
  });

  // ── the pointer term ────────────────────────────────────────────────
  //
  // `isMobileNav()` cannot tell a handset on its side from a laptop
  // window dragged short: PHONE_QUERY's second clause is `(orientation:
  // landscape) and (max-height: 480px)`, and a short desktop window
  // matches it. shizumu ships as a Linux desktop Flatpak, so before this
  // term the flipped default handed the phone shell to a mouse user who
  // resized their window — onto the one tree with no route back in.

  it("keeps the desktop tree on a landscape-phone-shaped window with a FINE pointer", () => {
    // THE REGRESSION TEST. A 863x360 window — the exact geometry of the VR
    // harness's `android-landscape` project, and the shape any desktop
    // window takes when dragged short — matches PHONE_QUERY, so
    // `mobileNav` is true and every other input is in its boot state. A
    // mouse is the only thing that says desktop, and it has to be enough.
    //
    // Remove `coarsePointer === true` from shell-boot.js and this line
    // goes red on its own; nothing else in this file does.
    expect(shouldBootShell({ setting: null, mobileNav: true, coarsePointer: false })).toBe(false);

    // The written-on flag refuses for the same reason. A tester who turned
    // the shell on from a phone does not get it pushed onto their laptop
    // the next time they drag the window short.
    expect(shouldBootShell({ setting: "true", mobileNav: true, coarsePointer: false })).toBe(false);
  });

  it("boots on a coarse pointer at a phone-shaped viewport, which is a real phone", () => {
    // The positive half of the pair, said separately so the row above
    // cannot be satisfied by a function that simply stopped booting. A
    // handset is coarse and phone-shaped in both orientations.
    expect(shouldBootShell({ setting: null, mobileNav: true, coarsePointer: true })).toBe(true);
  });

  it("refuses a coarse pointer that is not at a phone-shaped viewport", () => {
    // A desktop-sized touchscreen. Coarse, but there is no phone-shaped
    // viewport for the shell to render into, and the shell has no desktop
    // layout inside it. Both terms are required, not either.
    expect(shouldBootShell({ setting: null, mobileNav: false, coarsePointer: true })).toBe(false);
  });

  it("refuses when the pointer input is simply absent", () => {
    // NOT an assertion that nothing happens: this is the jsdom and
    // old-caller shape. `window.matchMedia` does not exist under jsdom, so
    // `safeMatchMedia` returns null and `isCoarsePointer()` answers false
    // — and a caller written before this term existed passes no
    // `coarsePointer` at all. Both must land on the desktop tree, for the
    // same reason `undefined` does below: a caller that has not said is
    // not a caller saying yes.
    expect(shouldBootShell({ setting: null, mobileNav: true })).toBe(false);
    expect(shouldBootShell({ setting: "true", mobileNav: true })).toBe(false);
  });

  it("boots on an unset setting, because the shell is the phone's default now", () => {
    // get_setting returns null for a key never written, and P5 inverted what
    // that means. This assertion used to read `false` with the note "ship the
    // redesign to every phone on the next release, which is the exact
    // opposite of the spec's opt-in beta" — shipping it to every phone is
    // the point of the switch-over, so the expectation is corrected rather
    // than the behaviour worked around. A phone that never opted out gets
    // the shell.
    expect(shouldBootShell({ setting: null, mobileNav: true, coarsePointer: true })).toBe(true);

    // Still viewport-gated. Flipping the default must not reach a laptop.
    expect(shouldBootShell({ setting: null, mobileNav: false, coarsePointer: true })).toBe(false);
  });

  it("keeps the desktop tree for a tester who opted out, on a phone", () => {
    // THE ESCAPE HATCH. This is the assertion that says `bootShell` is not
    // equivalent to `mobileNav`, and it is the reason App.svelte's
    // `mobileNav && !bootShell` conditions are still reachable and the
    // desktop tree's bottom bar is not dead chrome. Delete this behaviour
    // and a tester whose shell breaks has nowhere to go; delete the bar
    // while this behaviour exists and they land on a desktop tree with no
    // route to settings, and so no way to turn the shell back on.
    expect(shouldBootShell({ setting: "false", mobileNav: true, coarsePointer: true })).toBe(false);
  });

  it("reads anything other than an on-state as off", () => {
    // set_setting stores strings, and "false" is truthy in JS — a
    // `setting !== "false"` check would agree with the hatch above and
    // still send a corrupted row ON, trapping a user in the shell. The
    // on-states are enumerated instead, so an unrecognised value falls
    // through to the desktop tree, which is the recoverable direction:
    // that tree still has a route to settings at phone width.
    expect(shouldBootShell({ setting: "0", mobileNav: true, coarsePointer: true })).toBe(false);
    expect(shouldBootShell({ setting: "", mobileNav: true, coarsePointer: true })).toBe(false);
    expect(shouldBootShell({ setting: "TRUE", mobileNav: true, coarsePointer: true })).toBe(false);
  });

  it("ignores an argument it no longer has", () => {
    // The playground escape hatch was removed once Task 6 showed it had no
    // caller. Pinned rather than deleted outright: an extra key must not
    // resurrect the old behaviour by accident, and this is the shape a
    // stale caller would take if one survived somewhere unread.
    expect(shouldBootShell({ setting: null, mobileNav: false, coarsePointer: false, playground: true })).toBe(false);
  });

  it("keeps the desktop tree when the setting read fails or has not answered", () => {
    // get_setting throws on a cold or migrating database, and App.svelte's
    // `.catch(() => {})` leaves the value at its `$state(undefined)`
    // initial — as does simply not having resolved yet.
    //
    // THIS IS NO LONGER THE SAME ANSWER AS THE NEVER-WRITTEN KEY, and that
    // is the whole point of the assertion now. `null` above is get_setting
    // answering "no such key", which under the new default means ON.
    // `undefined` is the read not having answered at all, which must stay
    // OFF: a phone whose database is unhappy would otherwise boot the shell
    // over a "false" it could not read back, trapping the very tester the
    // escape hatch exists for. The hatch has to survive a failing read,
    // because a failing read is when it gets used.
    expect(shouldBootShell({ setting: undefined, mobileNav: true, coarsePointer: true })).toBe(false);

    // Said as a pair, because the two lines being different IS the
    // behaviour. Asserting only the undefined half would pass just as well
    // under a function that treated both absences alike.
    expect(shouldBootShell({ setting: null, mobileNav: true, coarsePointer: true })).toBe(true);
  });
});

describe("the boot fork's place in App.svelte's chain", () => {
  // This decision takes no `locked` input, because it is never asked while
  // the app is locked: the {#if} chain reaches LockScreen first. That is
  // invisible from shell-boot.js and invisible from the branch itself, and
  // an earlier draft of the plan put the fork ABOVE the lock branch — where
  // flipping one setting would have rendered the shell over a locked
  // database. So the ordering is asserted here, as text, rather than
  // written down as a comment nothing checks.
  // Read from the repo root, the way shell-rules.test.js reads the files it
  // scans: import.meta.url is an http URL under vitest's transform, so a
  // URL-relative read throws before any assertion runs.
  const APP = readFileSync("src/App.svelte", "utf8");

  const positions = {
    onboarding: APP.indexOf("{:else if !onboardingComplete}"),
    // The shell's own chromeless gates (P4 Task 3). Each renders INSIDE the
    // branch that already decided the gate applies, never beside it — a
    // third top-level branch for them would be the same edit the fork below
    // was corrected for, wearing a different name.
    onboardingGate: APP.indexOf('<G kind="onboarding"'),
    lock: APP.indexOf("{:else if isLocked}"),
    lockGate: APP.indexOf('<G kind="lock"'),
    shell: APP.indexOf("{:else if bootShell}"),
    page: APP.indexOf('{:else if space === "page"}'),
  };

  it("finds all six branches — a scan that matches nothing proves nothing", () => {
    // Every ordering assertion below compares indexOf results, and -1 sorts
    // before everything. Without this guard, renaming a branch would turn
    // the ordering tests green instead of red.
    for (const [name, at] of Object.entries(positions)) {
      expect(at, `branch not found in App.svelte: ${name}`).toBeGreaterThan(-1);
    }
  });

  it("renders the shell below the lock branch, never above it", () => {
    expect(positions.shell).toBeGreaterThan(positions.lock);
  });

  it("renders the shell below onboarding, so a new user still onboards", () => {
    expect(positions.shell).toBeGreaterThan(positions.onboarding);
  });

  it("renders the shell above the page space, replacing it rather than racing it", () => {
    // Both branches are live at once for a phone tester with the flag on;
    // whichever comes first wins, and the shell has to be the one that
    // does or the fork does nothing at all.
    expect(positions.shell).toBeLessThan(positions.page);
  });

  it("renders the shell's onboarding inside the onboarding branch", () => {
    // Between the branch that decides a new user onboards and the branch
    // that decides the app is locked — which is what "inside" reduces to in
    // a text scan. Above `lock` it would be a top-level branch of its own,
    // and a shell surface that outranks the lock branch is the bypass this
    // whole describe exists to keep out.
    expect(positions.onboardingGate).toBeGreaterThan(positions.onboarding);
    expect(positions.onboardingGate).toBeLessThan(positions.lock);
  });

  it("renders the shell's lock inside the lock branch, not above it", () => {
    // The shell decides what a locked phone LOOKS like. It does not decide
    // whether the phone is locked, and this is the assertion that says so.
    expect(positions.lockGate).toBeGreaterThan(positions.lock);
    expect(positions.lockGate).toBeLessThan(positions.shell);
  });

  it("feeds the pointer term, and WATCHES it rather than reading it once", () => {
    // The gate grew a `coarsePointer` input that defaults to false, which
    // means a host that forgets to pass it does not crash and does not
    // fail a unit test — it quietly stops booting the shell on every
    // phone. Nothing in shell-boot.js can see whether its caller supplies
    // the argument, so it is asserted here as text, the way the branch
    // ordering above is.
    expect(APP).toContain("coarsePointer");
    expect(APP).toContain("shouldBootShell({ setting: shellFlag, mobileNav, coarsePointer })");

    // And the watcher, which is the half a one-shot read would miss.
    // `watchMobileNav` already consults `(pointer: coarse)`, but it only
    // fires when the COMBINED answer flips — on a phone-shaped viewport
    // `isPhoneViewport()` is already true, so a pointer going coarse→fine
    // leaves `mobileNav` true and fires nothing. A tablet or convertible
    // that changes input modality mid-session would keep the tree it
    // booted with. Reusing responsive.js's own watcher is also what keeps
    // one spelling of the query in the codebase.
    expect(APP).toContain("watchCoarsePointer");
  });

  it("starts the flag at undefined, never at null", () => {
    // The one line that makes null-means-on safe. Since P5, `null` (the key
    // was never written) boots the shell and `undefined` (the read has not
    // answered) does not — so initialising this state to `null` would boot
    // the shell on every phone for the tick before get_setting replies,
    // including phones holding a "false" it is about to read back. That is
    // a flash of the wrong tree for exactly the tester who opted out.
    //
    // Asserted as text for the same reason the ordering above is: the
    // distinction lives in shell-boot.js, the initialiser lives here, and
    // nothing at either site can show the other.
    expect(APP).toContain("let shellFlag = $state(undefined);");
  });
});
