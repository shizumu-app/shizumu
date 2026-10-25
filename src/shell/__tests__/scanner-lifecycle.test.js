import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  SCANNER_STATUSES,
  cameraLive,
  classifyCameraError,
  nextScanner,
  scannerNote,
} from "../scanner-lifecycle.js";

describe("the camera closes", () => {
  it("closes when the app goes to the background", () => {
    // The battery bug the writer cannot see. Nothing unmounts when a
    // WebView backgrounds, so without this the stream stays open behind
    // whatever app the writer switched to, and the drain is attributed to
    // the phone rather than to a notebook.
    expect(nextScanner("scanning", { type: "hidden" })).toBe("paused");
    expect(cameraLive("paused")).toBe(false);
  });

  it("closes on the way out of any failure too, so a granted permission can be retried", () => {
    // The most likely reason a reader leaves this screen after a refusal
    // is to go and grant the permission. They must come back to a scanner
    // that can try again, which means the failure has to clear on the way
    // out — not persist as a frozen apology over a camera that would now
    // work.
    for (const status of ["refused", "absent", "failed"]) {
      expect(nextScanner(status, { type: "hidden" })).toBe("paused");
    }
    expect(nextScanner("paused", { type: "shown" })).toBe("scanning");
  });

  it("closes on a read, before the host has done anything with the code", () => {
    expect(nextScanner("scanning", { type: "read" })).toBe("read");
    expect(cameraLive("read")).toBe(false);
  });

  it("closes on any failure", () => {
    expect(cameraLive(nextScanner("scanning", { type: "error", message: "boom" }))).toBe(false);
  });

  it("is open in exactly one status", () => {
    // The gate is what mounts QrScanner, which is what opens a stream. A
    // second status answering true is a second way to have a lens on with
    // no screen saying so.
    expect(SCANNER_STATUSES.filter(cameraLive)).toEqual(["scanning"]);
  });
});

describe("the camera does not reopen by itself", () => {
  it("returns the SAME status for a duplicate visibility event", () => {
    // Not "nothing happens" for its own sake. Mounting is the only lever
    // this shell has over a borrowed component's stream, so the value
    // returned here IS the switch: a different value for the ordinary
    // duplicate visibilitychange would re-run the screen's `{#if}`, tear
    // down a live stream mid-frame, and put QrScanner's consent gate back
    // under the writer's thumb for no reason they caused.
    expect(nextScanner("scanning", { type: "shown" })).toBe("scanning");
  });

  it("does not promote a failure to a viewfinder on a visibility event", () => {
    // `shown` arrives without the reader doing anything — an OS overlay
    // dismissing, a notification shade closing. Re-arming a refused
    // camera on it would replace a sentence that says what to do with a
    // preview that cannot open.
    for (const status of ["refused", "absent", "failed"]) {
      expect(nextScanner(status, { type: "shown" })).toBe(status);
    }
  });

  it("does not re-arm after a read, even across a background and back", () => {
    // A read is terminal: the host is already popping this screen. The
    // one path that could re-arm it is background-then-return, and this
    // is what closes it — otherwise switching away and back during the
    // pairing exchange would reopen the lens on a screen that is leaving.
    const afterRead = nextScanner("scanning", { type: "read" });
    const backgrounded = nextScanner(afterRead, { type: "hidden" });
    expect(backgrounded).toBe("read");
    expect(cameraLive(nextScanner(backgrounded, { type: "shown" }))).toBe(false);
  });

  it("changes nothing on an event it does not know", () => {
    // There is no producer for one: the screen sends exactly four. The
    // branch exists so that adding a fifth listener to that screen cannot
    // close a stream by accident before anyone has decided what the fifth
    // event means.
    expect(nextScanner("scanning", { type: "resize" })).toBe("scanning");
    expect(nextScanner("scanning", undefined)).toBe("scanning");
  });
});

describe("classifying what went wrong", () => {
  it("reads the same substrings QrScanner's own branches read", () => {
    // Held against the borrowed component's source rather than against a
    // copy of its strings typed here, which would agree with it on the
    // day it was written and never again. Two surfaces disagreeing about
    // what counts as a refusal is how one of them offers a recovery the
    // other one's state cannot reach.
    const qrScanner = readFileSync("src/components/QrScanner.svelte", "utf8");
    for (const mark of ["NotAllowedError", "Permission"]) {
      expect(qrScanner, `QrScanner no longer mentions ${mark}`).toContain(mark);
      expect(classifyCameraError(`Error: ${mark}: denied`)).toBe("refused");
    }
    for (const mark of ["NotFoundError", "DevicesNotFound"]) {
      expect(qrScanner, `QrScanner no longer mentions ${mark}`).toContain(mark);
      expect(classifyCameraError(`Error: ${mark}`)).toBe("absent");
    }
  });

  it("calls anything else a plain failure", () => {
    // jsdom's real answer when a tap opens no stream, which is what the
    // screen test drives: `navigator.mediaDevices` is undefined there.
    expect(
      classifyCameraError("TypeError: Cannot read properties of undefined (reading 'getUserMedia')"),
    ).toBe("failed");
    expect(classifyCameraError(null)).toBe("failed");
  });
});

describe("what the screen says", () => {
  it("says something for each of the three failures", () => {
    for (const status of ["refused", "absent", "failed"]) {
      expect(scannerNote(status), `"${status}" has no sentence`).toBeTruthy();
    }
  });

  it("names the fix rather than the fault when permission is refused", () => {
    // On Android the refusal is currently the EXPECTED first answer:
    // nothing in this repo grants the WebView its camera permission, so
    // this sentence is the common case and has to be actionable.
    expect(scannerNote("refused")).toContain("system settings");
  });

  it("says nothing in the three statuses nobody can read a sentence in", () => {
    // Each silence is a decision, not a gap. `scanning` is a live
    // viewfinder, where a caption is an instruction in the way of aiming.
    // `paused` is a screen the OS has hidden — by the time an eye is on
    // it the status is `scanning` again (see the re-arm test above), so a
    // sentence there is copy nothing can ever reach. `read` is a screen
    // the host is popping, where a sentence would flash for one frame on
    // the way out.
    expect(scannerNote("scanning")).toBe("");
    expect(scannerNote("paused")).toBe("");
    expect(scannerNote("read")).toBe("");
  });

  it("keeps every sentence on the brand canon", () => {
    for (const status of SCANNER_STATUSES) {
      const text = scannerNote(status);
      if (!text) continue;
      expect(text, `"${text}" is not lowercase`).toBe(text.toLowerCase());
      expect(text, `"${text}" carries the retired word`).not.toMatch(
        /\b(sinks?|sinking|sunk)\b/i,
      );
      expect(text).not.toMatch(/!/);
    }
  });
});
