import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SHELL_SWITCH_KEY, shellSwitchChecked, shellSwitchValue } from "../shell-switch.js";
// The other half of the pair. Every assertion below is written against the
// REAL boot fork rather than against a second copy of its truth table —
// that is the whole point of the module under test, and a test that
// re-typed the table would go green on exactly the drift it exists to
// catch.
import { shouldBootShell } from "../shell-boot.js";

describe("the labs switch writes what the boot fork reads", () => {
  it("writes a value that opts the phone OUT — this is what makes the hatch openable", () => {
    // THE TEST THIS FILE EXISTS FOR. P5 Task 2 kept `"false"` as the escape
    // hatch and then found nothing in the app wrote the key: every write in
    // the tree was harness code (demo bootstrap, VR seed, VR scenes), so
    // the only way out of the shell was editing SQLite. This asserts the
    // round trip the control now closes — the string the switch stores is
    // a string the boot fork reads as off, on the viewport where it
    // matters.
    expect(shouldBootShell({ setting: shellSwitchValue(false), mobileNav: true, coarsePointer: true })).toBe(false);
  });

  it("writes a value that opts back IN, so a mis-tap is undoable before the next launch", () => {
    // Not symmetry for its own sake. Turning the switch off does not leave
    // the shell — the flag is read once at boot — so the reader stays on
    // this screen with the switch under their thumb, and flicking it back
    // has to actually cancel the exit. It only does if the value written
    // is one `shouldBootShell` enumerates as ON, and "true" is the only
    // string that qualifies.
    expect(shouldBootShell({ setting: shellSwitchValue(true), mobileNav: true, coarsePointer: true })).toBe(true);
  });

  it("stores strings, because the column does", () => {
    // `set_setting` takes a Rust String (commands.rs:1236-1242). A boolean
    // would arrive as something else entirely, and `shouldBootShell` reads
    // anything it does not recognise as off — so a boolean `false` would
    // LOOK correct (the reader lands on the desktop tree) while a boolean
    // `true` would silently fail to bring them back.
    expect(typeof shellSwitchValue(true)).toBe("string");
    expect(typeof shellSwitchValue(false)).toBe("string");
    expect(shellSwitchValue(false)).toBe("false");
    expect(shellSwitchValue(true)).toBe("true");
  });

  it("writes the key App.svelte reads, asserted against App.svelte itself", () => {
    // Two literals with nothing holding them together is how a control
    // quietly stops reaching the thing it controls: the write is in the
    // shell, the read is in the host, and neither file can see the other.
    // Read from the repo root the way shell-boot.test.js and
    // shell-rules.test.js do — import.meta.url is an http URL under
    // vitest's transform, so a URL-relative read throws before any
    // assertion runs.
    const app = readFileSync("src/App.svelte", "utf8");
    expect(app).toContain(`getSetting("${SHELL_SWITCH_KEY}")`);
  });
});

describe("the switch's position is the boot fork's answer, not a second opinion", () => {
  it("agrees with the boot fork on every stored value", () => {
    // The row says which tree the next launch gives you. If it decided for
    // itself it could disagree, and a row that shows ON above a boot fork
    // that reads OFF is a control lying about the only thing it does.
    //
    // THE REFERENCE CALL MUST PASS THE SAME PAIR, and that is not
    // bookkeeping. `shouldBootShell` defaults `coarsePointer` to false, so
    // dropping it from this side would make the right-hand answer false
    // for every value in the list — and if `shellSwitchChecked` had lost
    // the same argument, the left side would be false too and this loop
    // would go green on a switch that could never read ON. Both sides say
    // it, and the `null`/`"true"` cases below fail loudly if either does
    // not.
    for (const setting of [null, "true", "false", "0", "", "TRUE", "yes"]) {
      expect(shellSwitchChecked(setting), `disagreed on ${JSON.stringify(setting)}`).toBe(
        shouldBootShell({ setting, mobileNav: true, coarsePointer: true }),
      );
    }
  });

  it("shows on for a never-written key, which is the phone's default", () => {
    expect(shellSwitchChecked(null)).toBe(true);
    expect(shellSwitchChecked("true")).toBe(true);
  });

  it("shows off for the hatch and for anything nobody wrote on purpose", () => {
    expect(shellSwitchChecked("false")).toBe(false);
    expect(shellSwitchChecked("0")).toBe(false);
  });

  it("shows off for undefined, which the host never actually hands it", () => {
    // NOT an assertion that nothing happens. `undefined` is a read that has
    // not answered, and ShellApp's own read cannot produce it — a throw is
    // caught and leaves the state at its initial `true`, and get_setting
    // answers `null`, not undefined, for a missing key. It is asserted
    // because shell-boot.js draws a real distinction between the two
    // absences, and `shellSwitchChecked` delegating means the row inherits
    // it: if a later refactor ever did route an unresolved read here, off
    // is the answer that matches what the next boot would do.
    expect(shellSwitchChecked(undefined)).toBe(false);
  });

  it("answers on a phone's terms, because that is the only place it is asked", () => {
    // `mobileNav: true` and `coarsePointer: true` are baked in rather than
    // taken as arguments. The caller is the shell's settings screen, and
    // the shell mounts only under `bootShell`, which already required a
    // phone-shaped viewport AND a touch pointer. Said here so the
    // constants read as facts about the call site rather than assumptions
    // nobody checked.
    expect(shellSwitchChecked("true")).toBe(shouldBootShell({ setting: "true", mobileNav: true, coarsePointer: true }));
    expect(shouldBootShell({ setting: "true", mobileNav: false })).toBe(false);
    // The other half the row leans on. A fine pointer refuses too, so a
    // reader on a short desktop window would not be shown a row promising
    // a tree the next launch will not give them.
    expect(shouldBootShell({ setting: "true", mobileNav: true, coarsePointer: false })).toBe(false);
  });
});
