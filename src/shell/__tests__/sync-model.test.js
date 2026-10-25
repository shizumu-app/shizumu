import { describe, it, expect } from "vitest";
import {
  CODES_MATCH,
  DISCONNECT,
  DISCONNECT_CONFIRM,
  DISCONNECT_STAY,
  disconnectRowShows,
  disconnectSheet,
  PAIR_FAILED,
  SCAN_A_CODE,
  SET_UP_SYNC,
  THIS_DEVICE,
  UNNAMED_NEW_DEVICE,
  UNTITLED_DEVICE,
  deviceRows,
  everySyncString,
  pairErrorText,
  pairPrompt,
  pairRowLabel,
  pairSide,
  setupRowShows,
  syncStateLabel,
  syncToggleShows,
  syncStateNote,
  pairDone,
  PAIR_DONE,
  PAIR_ADDED,
} from "../sync-model.js";
import { STALE_AFTER_MS } from "../../lib/device-staleness.js";

const DAY = 86_400_000;

describe("syncStateLabel", () => {
  it("tells an unread status from an unconfigured install", () => {
    // Two different facts. Answering "not set up" for a status that has
    // not come back yet would tell a synced writer their account is gone
    // for the length of a round trip, on the settings root, which is the
    // one screen someone worried about their writing goes to first.
    expect(syncStateLabel(null)).toBe("");
    expect(syncStateLabel({ configured: false })).toBe("not set up");
  });

  it("reports a revoked device as revoked, not as on", () => {
    // The worker has already stopped by the time this flag is set — the
    // backend sets it on the `device_revoked` the relay answered with —
    // and `enabled` can still be true underneath it. "on" over a stopped
    // worker is the one answer worse than no answer.
    expect(syncStateLabel({ configured: true, enabled: true, revoked: true })).toBe("revoked");
  });

  it("otherwise says whether the engine is running", () => {
    expect(syncStateLabel({ configured: true, enabled: true })).toBe("on");
    expect(syncStateLabel({ configured: true, enabled: false })).toBe("off");
  });
});

describe("syncStateNote", () => {
  it("explains the two states one word does not", () => {
    expect(syncStateNote({ configured: false })).toContain("pair it");
    expect(syncStateNote({ configured: true, revoked: true })).toContain("removed");
  });

  it("names both doors off-account, now that there are two", () => {
    // The sentence said "pair it" alone while pairing was the only path,
    // and a phone with no other device read it as an instruction it
    // could not follow. It names setup too now.
    expect(syncStateNote({ configured: false })).toContain("set up sync");
  });

  it("adds nothing to on, off, or a status not read yet", () => {
    // Not an omission. "on" and "off" are the whole fact and a sentence
    // repeating them is noise; the empty state is where nothing is known,
    // and a sentence there would be a guess printed as a statement.
    expect(syncStateNote({ configured: true, enabled: true })).toBe("");
    expect(syncStateNote({ configured: true, enabled: false })).toBe("");
    expect(syncStateNote(null)).toBe("");
  });
});

describe("deviceRows", () => {
  const status = { configured: true, device_id: "self" };

  it("draws no rows off an account, whatever list it is handed", () => {
    // Not "nothing happens": the 9g review's race. A device list fetched
    // before a disconnect can land after the re-read that says `not set
    // up`, and the screen must not then list the account's devices under
    // a state row saying there is no account. The status is the newer
    // fact.
    const devices = [
      { id: "self", label: "phone" },
      { id: "other", label: "laptop" },
    ];
    expect(deviceRows({ devices, status: { configured: false, device_id: "self" } })).toEqual([]);
    expect(deviceRows({ devices, status: null })).toEqual([]);
  });

  it("names the device you are holding rather than dating it", () => {
    // "seen today" is true of this device and says nothing — of course it
    // was seen today, it is the one asking. The word is what tells the
    // reader which row is theirs before they revoke the wrong one
    // somewhere else.
    const rows = deviceRows({ devices: [{ id: "self", label: "phone" }], status, nowMs: 0 });
    expect(rows).toEqual([{ id: "self", label: "phone", value: THIS_DEVICE }]);
  });

  it("dates every other device from the shared staleness module", () => {
    const now = 10 * DAY;
    const rows = deviceRows({
      devices: [{ id: "other", label: "laptop", last_seen_ms: now - 2 * DAY }],
      status,
      nowMs: now,
    });
    expect(rows[0].value).toBe("seen 2 days ago");
  });

  it("carries the staleness label and not the staleness flag", () => {
    // The desktop dims a stale row. `Row` has no dim variant, adding one
    // would put this screen's concept into the primitive every list in
    // the shell uses, and the words already say it — which is also the
    // reading a screen reader gets, where the dimming says nothing.
    const now = STALE_AFTER_MS * 2;
    const [row] = deviceRows({
      devices: [{ id: "other", last_seen_ms: now - STALE_AFTER_MS - DAY }],
      status,
      nowMs: now,
    });
    expect(row.value).toMatch(/seen \d+ days ago/);
    expect(row).not.toHaveProperty("stale");
  });

  it("gives an unlabelled device the desktop's own word", () => {
    const [row] = deviceRows({ devices: [{ id: "other", label: "" }], status, nowMs: 0 });
    expect(row.label).toBe(UNTITLED_DEVICE);
  });

  it("drops revoked devices", () => {
    // The relay never forgets a device, so a list that kept them would
    // grow a permanent tail — and this screen offers no revoke, so there
    // is nothing on a revoked row to act on either.
    const rows = deviceRows({
      devices: [
        { id: "self", label: "phone" },
        { id: "gone", label: "old laptop", revoked_at: 1 },
      ],
      status,
      nowMs: 0,
    });
    expect(rows.map((row) => row.id)).toEqual(["self"]);
  });
});

describe("syncToggleShows", () => {
  it("offers the switch on an account", () => {
    expect(syncToggleShows({ configured: true, enabled: true })).toBe(true);
    // The state the defect was found in: configured, off, and before this
    // existed nothing on the screen could turn it back on.
    expect(syncToggleShows({ configured: true, enabled: false })).toBe(true);
  });

  it("withholds it where it could only fail or lie", () => {
    // Not a bug written down as correct: an unconfigured device has no
    // account for `sync_set_enabled` to act on, and a revoked one can
    // still read `enabled: true` under the revocation (syncStateLabel's
    // own reason), so a switch there would show `on`, flip, and stop
    // nothing. Both have a real route back, and the screen offers it.
    expect(syncToggleShows(null)).toBe(false);
    expect(syncToggleShows({ configured: false })).toBe(false);
    expect(syncToggleShows({ configured: true, enabled: true, revoked: true })).toBe(false);
  });
});

describe("disconnect (task 9g)", () => {
  it("offers disconnect wherever there is an account on this phone", () => {
    expect(disconnectRowShows({ configured: true, enabled: true })).toBe(true);
    expect(disconnectRowShows({ configured: true, enabled: false })).toBe(true);
    // Revoked is included, unlike the toggle: the account's keys are still
    // on the phone and setup stays hidden while they are, so this is the
    // one way to clear them — the desktop's pair-again resets first.
    expect(disconnectRowShows({ configured: true, enabled: true, revoked: true })).toBe(true);
  });

  it("withholds it where there is nothing to leave", () => {
    // Not a bug written down as correct: an unconfigured phone has no
    // account, so `sync_reset` there resets nothing, and an unread (null)
    // status is pairSide's "not on an account" until it is read.
    expect(disconnectRowShows(null)).toBe(false);
    expect(disconnectRowShows(undefined)).toBe(false);
    expect(disconnectRowShows({ configured: false })).toBe(false);
  });

  it("spells the row in the desktop's word, and the confirm by what it disconnects", () => {
    expect(DISCONNECT).toBe("disconnect");
    expect(DISCONNECT_CONFIRM).toBe("disconnect this phone");
    expect(DISCONNECT_STAY).toBe("keep things as they are");
  });

  it("says what sync_reset does: the writing stays, sync stops, setup again sends it all", () => {
    const { note, stay, confirm } = disconnectSheet({ configured: true, enabled: true });
    expect(note).toContain("your writing stays on this phone");
    expect(note).toContain("sync stops");
    // Forgets, not leaves: sync_reset never tells the relay, so the other
    // devices keep listing this one.
    expect(note).toContain("sync stops, and this phone forgets its account.");
    expect(note).not.toContain("leaves");
    expect(note).toContain("set up sync again and everything here is sent again");
    expect(stay).toBe(DISCONNECT_STAY);
    expect(confirm).toBe(DISCONNECT_CONFIRM);
  });

  it("does not tell a revoked phone it is leaving an account it was already removed from", () => {
    const { note } = disconnectSheet({ configured: true, revoked: true });
    expect(note).toContain("your writing stays on this phone");
    expect(note).not.toContain("forgets its account");
    expect(note).toContain("removed from");
  });
});

describe("which half of a pairing this device performs", () => {
  it("shows a code when it is on the account and joins when it is not", () => {
    // The one branch in the whole sync stack. It decides which command
    // the pair screen starts with and whether the scanner is reachable at
    // all, so it is derived from one field in one place rather than asked
    // again per screen.
    expect(pairSide({ configured: true })).toBe("show");
    expect(pairSide({ configured: false })).toBe("join");
    expect(pairSide(null)).toBe("join");
  });

  it("names the act rather than the screen on the row that opens it", () => {
    expect(pairRowLabel("show")).toBe("add a device");
    expect(pairRowLabel("join")).toBe("pair this device");
  });
});

describe("setupRowShows", () => {
  it("offers setup only off-account", () => {
    // THE ROW THAT WAS MISSING. A device already on an account has one,
    // and setup over it would re-key the device under a second; a device
    // with none — or with no status read yet, which the pair row already
    // treats as none — is the phone this row exists for.
    expect(setupRowShows({ status: { configured: true, enabled: true } })).toBe(false);
    expect(setupRowShows({ status: { configured: false } })).toBe(true);
    expect(setupRowShows({ status: null })).toBe(true);
    expect(setupRowShows()).toBe(true);
  });

  it("hides setup while a pairing is mid-exchange or just finished", () => {
    // `working` and `done` are the phases between "this device sent its
    // key" and "the status has been re-read as configured". A second
    // door onto an account during them is a door onto two accounts.
    expect(setupRowShows({ status: null, pairPhase: "working" })).toBe(false);
    expect(setupRowShows({ status: null, pairPhase: "done" })).toBe(false);
    expect(setupRowShows({ status: null, pairPhase: "waiting" })).toBe(true);
    expect(setupRowShows({ status: null, pairPhase: "verify" })).toBe(true);
  });

  it("spells the row once", () => {
    expect(SET_UP_SYNC).toBe("set up sync");
  });
});

describe("pairPrompt", () => {
  it("tells the reader what to do at every phase each side can be in", () => {
    for (const phase of ["starting", "waiting", "verify", "working", "done"]) {
      expect(pairPrompt("show", phase), `show:${phase} says nothing`).toBeTruthy();
    }
    for (const phase of ["waiting", "verify", "working", "done"]) {
      expect(pairPrompt("join", phase), `join:${phase} says nothing`).toBeTruthy();
    }
  });

  it("makes the digits a comparison and names the refusal", () => {
    // The whole security story: a malicious relay can substitute its own
    // ephemeral key, and a person comparing these digits on two screens
    // is the only thing that catches it. A prompt that just said "confirm
    // to continue" would turn the one check into a step to get past.
    for (const side of ["show", "join"]) {
      expect(pairPrompt(side, "verify")).toContain("match");
      expect(pairPrompt(side, "verify")).toContain("go back");
    }
  });

  it("says nothing for a pair the table does not hold", () => {
    // `join:starting` has no producer — the joining side opens on a row
    // to press, not on a command in flight — so an unknown pair means a
    // typo in the host. Inventing a sentence would hide that behind copy
    // that reads fine.
    expect(pairPrompt("join", "starting")).toBe("");
    expect(pairPrompt("show", "elsewhere")).toBe("");
  });
});

describe("pairErrorText", () => {
  it("says what to do about each relay code that means something", () => {
    expect(pairErrorText("pair_token_consumed")).toContain("already been used");
    expect(pairErrorText("Error: pair_token_unknown")).toContain("unknown or expired");
    expect(pairErrorText("device_limit_reached")).toContain("two devices");
    expect(pairErrorText("no wrapped bundle deposited")).toContain("did not finish");
    expect(pairErrorText("timed out")).toContain("timed out");
  });

  it("never puts the exception itself on screen", () => {
    // The raw string is relay internals in the face the writer reads
    // their own words in. It goes to the console; this is what the screen
    // gets.
    expect(pairErrorText("thread 'main' panicked at src/sync/pair.rs:41")).toBe(PAIR_FAILED);
    expect(pairErrorText(undefined)).toBe(PAIR_FAILED);
  });
});

describe("the words on screen", () => {
  it("spells the confirm and the scan row once each", () => {
    // Both sides of the pair screen render the same confirm. Two spellings
    // of one act would read as two features.
    expect(CODES_MATCH).toBe("the codes match");
    expect(SCAN_A_CODE).toBe("scan a code");
    expect(UNNAMED_NEW_DEVICE).toBe("another device");
  });

  it("keeps every string on the brand canon", () => {
    // CLAUDE.md's retirement, plus the voice rules. Sync is the surface
    // most likely to want to explain the default in passing, and the one
    // most likely to reach for an exclamation on a success.
    for (const text of everySyncString()) {
      expect(text, `"${text}" carries the retired word`).not.toMatch(
        /\b(sinks?|sinking|sunk)\b/i,
      );
      expect(text, `"${text}" is not lowercase`).toBe(text.toLowerCase());
      expect(text, `"${text}" carries an exclamation mark`).not.toMatch(/!/);
    }
  });

  it("never lists the absence of a cloud as a feature", () => {
    // CLAUDE.md is explicit: cloud sync via a self-deploy relay is
    // planned, so "no cloud" is not a refusal this product makes and must
    // not be written as one — least of all on the sync screens.
    for (const text of everySyncString()) {
      expect(text.toLowerCase(), `"${text}" refuses the cloud`).not.toMatch(/no cloud|cloudless/);
    }
  });
});

describe("pairDone", () => {
  // THE END OF A PAIRING HAS TO SAY WHAT HAPPENED, AND ONLY WHAT HAPPENED.
  // It used to be one grey word, "paired.", on an otherwise empty screen —
  // reported from a real A16 as looking broken, which it did: no device
  // named, no state, nothing to press but a back chevron.
  //
  // And it must not claim sync is on when it is not. The device that SHOWS
  // the code does not turn sync on by being paired with (only the joining
  // side comes up enabled — docs/device-findings-sync.md), so a line that
  // always said "it syncs from now on" would be false on exactly the phone
  // that most often shows it.

  it("names the device that was added, by the name the writer gave it", () => {
    const d = pairDone("show", { label: "laptop", enabled: true });
    expect(d.device).toBe("laptop");
    expect(d.line).toBe("paired. it syncs from now on.");
    expect(d.value).toBe("syncing");
  });

  it("does not claim sync is running on a device where it is off", () => {
    const d = pairDone("show", { label: "laptop", enabled: false });
    expect(d.line).not.toMatch(/syncs from now on/);
    expect(d.line).toBe("paired. turn sync on to start.");
    expect(d.value).toBe("sync off");
  });

  it("falls back to the name the field offered when the writer left it blank", () => {
    expect(pairDone("show", { label: "   ", enabled: true }).device).toBe(UNNAMED_NEW_DEVICE);
  });

  it("names this phone on the joining side, which never learns the other's name", () => {
    expect(pairDone("join", { label: "ignored", enabled: true }).device).toBe("this phone");
  });

  it("builds on the table's own word, so 'paired' is spelled in one place", () => {
    for (const side of ["show", "join"]) {
      for (const enabled of [true, false]) {
        expect(pairDone(side, { enabled }).line.startsWith(pairPrompt(side, "done"))).toBe(true);
      }
    }
  });

  it("spells the group and the action once", () => {
    expect(PAIR_ADDED).toBe("added");
    expect(PAIR_DONE).toBe("done");
  });
});
