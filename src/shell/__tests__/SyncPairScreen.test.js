import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";
import SyncPairScreen from "../SyncPairScreen.svelte";
import { CODES_MATCH, PAIR_ADDED, PAIR_DONE, SCAN_A_CODE, pairDone, pairPrompt } from "../sync-model.js";

afterEach(cleanupAll);

const rowFor = (target, label) =>
  [...target.querySelectorAll(".shell-row")].find(
    (r) => r.querySelector(".shell-row-label").textContent.trim() === label,
  );

function mount(props = {}) {
  return render(SyncPairScreen, { onBack: () => {}, ...props });
}

// The two sentences this screen can carry are both `Note`s, told apart by
// tone: the prompt in the note's own ink, the error warm. Selecting by
// tone rather than by position is what keeps "the prompt" from matching
// an error that happened to render first.
const PROMPT = '.shell-note[data-tone="ink"]';
const ERROR = '.shell-note[data-tone="warm"]';

describe("SyncPairScreen", () => {
  it("is pushed, so it draws a back", () => {
    const onBack = vi.fn();
    const { target } = mount({ onBack });
    expect(target.querySelector(".shell-navbar-title").textContent.trim()).toBe("pair");
    target.querySelector(".shell-navbar-back").click();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("carries the model's sentence for the side and phase it is in", () => {
    const { target } = mount({ side: "join", phase: "waiting" });
    expect(target.querySelector(PROMPT).textContent.trim()).toBe(
      pairPrompt("join", "waiting"),
    );
  });

  it("makes both rows actions: accent, no chevron", () => {
    // `scan a code` opens the lens and `the codes match` sends the
    // confirm; each does something and stays, and neither opens a screen
    // for a chevron to point at (row-kind.js). Without the kind a row
    // with an onSelect is a push by default, so this is the prop that
    // decides how every act in the sync stack reads.
    const joining = mount({ side: "join", phase: "waiting", onScan: () => {} });
    const scan = rowFor(joining.target, SCAN_A_CODE);
    expect(scan.dataset.kind).toBe("action");
    expect(scan.querySelector(".shell-row-chevron")).toBeNull();

    const verifying = mount({ side: "join", phase: "verify", sas: "4821", onConfirm: () => {} });
    const confirm = rowFor(verifying.target, CODES_MATCH);
    expect(confirm.dataset.kind).toBe("action");
    expect(confirm.querySelector(".shell-row-chevron")).toBeNull();
  });

  it("offers the scanner, and only on the joining side", () => {
    const onScan = vi.fn();
    const joining = mount({ side: "join", phase: "waiting", onScan });
    rowFor(joining.target, SCAN_A_CODE).click();
    expect(onScan).toHaveBeenCalledOnce();

    // A device already on the account has nothing to scan: it is the one
    // SHOWING the code. Offering a camera here would open a lens for a
    // read that cannot succeed.
    const showing = mount({ side: "show", phase: "waiting", words: "aa bb" });
    expect(rowFor(showing.target, SCAN_A_CODE)).toBeUndefined();
  });

  it("shows the words even when the code image is missing", () => {
    // The encoder is imported on demand and can fail. The words are the
    // contract and the picture is the convenience, so a failed render
    // must not take the code away — which is why they are not two
    // branches of one `{#if}`.
    const { target } = mount({ side: "show", phase: "waiting", words: "aa bb cc", qr: "" });
    expect(target.querySelector("img")).toBeNull();
    expect(target.querySelector(".pair-words").textContent.trim()).toBe("aa bb cc");
  });

  it("names the other device only on the side whose label is read", () => {
    // `pair_new_complete` discards its `device_label` on the joining side
    // (commands.rs:6477), so a field there would write nothing — Task 1's
    // reason for dropping a toggle nothing on this tree reads. On the
    // showing side the same field is the only thing that names the row
    // every other device's list will show.
    const onLabel = vi.fn();
    const showing = mount({ side: "show", phase: "waiting", words: "aa", onLabel });
    const field = showing.target.querySelector(".shell-field-input");
    expect(field).not.toBeNull();
    field.value = "the tablet";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onLabel).toHaveBeenCalledExactlyOnceWith("the tablet");

    const joining = mount({ side: "join", phase: "waiting" });
    expect(joining.target.querySelector(".shell-field-input")).toBeNull();
  });

  it("puts the digits and the confirm on both sides", () => {
    for (const side of ["show", "join"]) {
      const onConfirm = vi.fn();
      const { target } = mount({ side, phase: "verify", sas: "4821", onConfirm });
      expect(target.querySelector(".pair-sas").textContent.trim()).toBe("4821");
      rowFor(target, CODES_MATCH).click();
      expect(onConfirm, `${side} did not report the confirm`).toHaveBeenCalledOnce();
    }
  });

  it("offers nothing to press while an exchange is running", () => {
    // Not "nothing happens": `working` is the window between the reader
    // confirming and the relay answering, and a live confirm row there
    // would let a second tap start a second exchange against a code the
    // first one has already consumed — which comes back as
    // "pair_token_consumed" and reads as the pairing having failed.
    const { target } = mount({ side: "join", phase: "working", sas: "4821" });
    expect(rowFor(target, CODES_MATCH)).toBeUndefined();
    expect(target.querySelectorAll("button.shell-row").length).toBe(0);
  });

  it("shows a failure as a warm sentence beside whatever the phase is", () => {
    const { target } = mount({
      side: "join",
      phase: "waiting",
      error: "that code is unknown or expired.",
    });
    // WARM, and asserted by the tone rather than by the text alone: the
    // shell adds no red, so the note's warm tone is the only thing that
    // makes the error read as one and not as a second instruction. An
    // error rendered in the prompt's ink is two sentences in one voice.
    expect(target.querySelector(ERROR).textContent.trim()).toBe(
      "that code is unknown or expired.",
    );
    // The prompt stays: the reader still has to know what to do next, and
    // an error that replaced the instruction would leave them with a
    // complaint and no path.
    expect(target.querySelector(PROMPT)).not.toBeNull();
  });
});

describe("SyncPairScreen — the end of a pairing", () => {
  // The last screen of the pairing was a single grey "paired." and an empty
  // page. It now ends the way the verify step before it is drawn: a lead
  // sentence, an inset group naming what was added, and one act.
  const done = (extra = {}) => mount({
    side: "show", phase: "done", doneDevice: "laptop", doneEnabled: true, ...extra,
  });

  it("leads with the sentence the model writes for the real state", () => {
    const { target } = done();
    expect(target.querySelector(PROMPT).textContent.trim()).toBe(
      pairDone("show", { label: "laptop", enabled: true }).line,
    );
  });

  it("names the device that was added in its own group, with sync's state beside it", () => {
    const { target } = done();
    const eyebrows = [...target.querySelectorAll(".shell-rowgroup-eyebrow, .shell-eyebrow")]
      .map((e) => e.textContent.trim().toLowerCase());
    expect(eyebrows).toContain(PAIR_ADDED);
    const row = rowFor(target, "laptop");
    expect(row, "no row names the device").toBeTruthy();
    expect(row.querySelector(".shell-row-value").textContent.trim()).toBe("syncing");
  });

  it("says sync is off on a device where it is, rather than claiming otherwise", () => {
    const { target } = done({ doneEnabled: false });
    expect(target.querySelector(PROMPT).textContent.trim()).toBe("paired. turn sync on to start.");
    expect(rowFor(target, "laptop").querySelector(".shell-row-value").textContent.trim()).toBe("sync off");
  });

  it("offers one act, done, and it is an action rather than a push", () => {
    const onDone = vi.fn();
    const { target } = done({ onDone });
    const row = rowFor(target, PAIR_DONE);
    expect(row, "no done row").toBeTruthy();
    row.click();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("draws none of this before the pairing is done", () => {
    for (const phase of ["waiting", "verify", "working"]) {
      const { target } = mount({ side: "show", phase, doneDevice: "laptop", onDone: () => {} });
      expect(rowFor(target, PAIR_DONE), `a done row at ${phase}`).toBeFalsy();
      expect(rowFor(target, "laptop"), `the device row at ${phase}`).toBeFalsy();
      cleanupAll();
    }
  });
});
