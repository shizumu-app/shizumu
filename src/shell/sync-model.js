// What the sync stack shows: the state of this device, the devices on the
// account, and which half of a pairing this device is performing.
//
// ── WHAT SYNC IS ON THE DESKTOP, AND WHAT OF IT IS HERE ───────────────
//
// `src/components/SyncSettings.svelte` is 2392 lines behind five tabs —
// account, devices, timing, mobile, storage. This is not a port of it.
// §2 asks for three screens ("Sync is a stack: devices → pair →
// scanner"), and what those three screens can honestly do is what is
// below. Everything else is left out for a named reason, on Task 1's
// precedent:
//
//   setup (the account wizard) — IS HERE NOW, and was not at first.
//     Task 2 left it off, arguing that a phone joins an account that
//     already exists and pairing is that. The argument was wrong for the
//     phone that is someone's ONLY device: it opened this stack, read
//     `pair this device`, and had nothing to pair with — so the one path
//     the stack refused was the only path that phone had. The refusal was
//     reversed (2026-09-17) and the wizard is `SyncSetupScreen`: generate
//     or type a 24-word phrase, pick a relay, connect, turn on — the
//     desktop's own steps, with the decisions in sync-setup-model.js and
//     the cost (24 words on a phone keyboard) paid in one multiline field
//     that lowercases and collapses what the keyboard did to them.
//     `setupRowShows` below is the one decision this module keeps: when
//     the devices screen offers the door.
//   on / off — IS HERE NOW, and was not at first. The same argument the
//     setup refusal died of, and it died the same way: this screen said
//     turning sync on belonged to the desktop, and a phone that reached
//     `off` by any route other than the wizard's last step had no route
//     back. Enrolment leaves `enabled` false and only the wizard's `turn
//     on` sets it, so a cancelled wizard, or the SHOWING side of a
//     pairing (neither half calls it), left a configured phone with sync
//     off, an inert row saying so, and nothing on the screen that could
//     change it. Found on a real A06 after a pairing: the joining laptop
//     came up `enabled:true` and the phone that owned the account stayed
//     `enabled:false`. `syncToggleShows` below is the decision, and the
//     row is a TOGGLE rather than an action because on and off are a
//     state the writer sets, not an act the device performs.
//   disconnect (`sync_reset`) — IS HERE NOW (Task 9g, 2026-10-17), and
//     was not at first, for want of a confirmation surface. 9e's trail
//     delete made the Sheet that surface, so the screen's last row,
//     `disconnect`, asks on a sheet and only the sheet's destructive row
//     resets. `disconnectRowShows` and `disconnectSheet` below are the
//     decision and the words. It is also the route back for a REVOKED
//     phone, which is the desktop's pair-again (`pairAgain` calls
//     `sync_reset` first): a revoked phone is still configured, so setup
//     is hidden, and before this nothing on the screen could clear it.
//   revoke (another device) — the desktop guards it with a confirmation
//     Modal. The Sheet could carry it now, as it carries disconnect; it
//     has not been asked for, and a row that removes ANOTHER device from
//     the account is its own task. `syncStateLabel` still reports this
//     phone's own revoked state rather than lying about it, because a
//     device that says "on" while the worker has stopped is the one
//     answer worse than no answer.
//   timing / mobile / storage — upload debounce, metered-network pause,
//     battery threshold, attachment quota and gc. The first three are
//     PERSISTED BUT UNHONOURED: the worker does not read them yet
//     (SyncSettings.svelte:138-143 records the TODO), so they are
//     controls that write a key nothing acts on — Task 1's own reason for
//     dropping `restore_last_page`. Storage is a quota readout plus a gc
//     button, which is an operator's pane, not a writer's.
//   web access, license keys, relay switching, op-log stats, replay —
//     account administration. Each needs a form, an error vocabulary of
//     its own, and none of it is `devices → pair → scanner`.
//   the raw error string — the desktop prints exceptions into an error
//     callout. They are English exception text, not copy, and half of
//     them name relay internals. The shell maps the ones that MEAN
//     something to a sentence (`pairErrorText`) and logs the rest.
//
// ── WHY THE PAIR SCREEN HAS NO DEVICE-NAME FIELD ON THE JOIN SIDE ─────
//
// Both halves of the desktop's pairing take a label, and only one of them
// is read. `pair_new_complete`'s `device_label` argument is discarded on
// the new-device side — `let _ = device_label;` with the reason beside it
// (commands.rs:6477: "the existing device sent the label to the relay's
// pair_finalize"). A field on the joining device would therefore be a
// control that does nothing, which is the exact thing Task 1 refused to
// ship. The label field belongs on the SHOWING side, where
// `pair_existing_confirm(new_device_label)` is what actually names the
// row every other device's list will read.

import { deviceStaleness } from "../lib/device-staleness.js";

/** What a device row with no label of its own is called. The desktop's
 *  own word, so one account does not read two ways across two trees. */
export const UNTITLED_DEVICE = "untitled";

/** The value column of the row for the device you are holding. A word
 *  rather than a mark, for the trail scope sheet's reason: it reads the same
 *  to a screen reader as to an eye. */
export const THIS_DEVICE = "this device";

/** What `pair_existing_confirm` names a device the user did not name.
 *  The desktop's default, for the reason above — one account, one
 *  vocabulary. */
export const UNNAMED_NEW_DEVICE = "another device";

/**
 * What the settings root's `sync` row says in its value column, and what
 * the devices screen's first row says.
 *
 * `null` answers "" rather than "not set up": a status that has not been
 * read yet and an install that has never synced are different facts, and
 * printing the second for the first would tell a synced user their
 * account is gone for as long as the round trip takes.
 *
 * @param {{configured?: boolean, enabled?: boolean, revoked?: boolean}|null} [status]
 * @returns {string}
 */
export function syncStateLabel(status) {
  if (!status) return "";
  if (!status.configured) return "not set up";
  // Ahead of `enabled`, because the worker has already stopped: the
  // backend sets this on the `device_revoked` the relay answered with,
  // and `enabled` can still be true underneath it (commands.rs:4910-4914).
  if (status.revoked) return "revoked";
  return status.enabled ? "on" : "off";
}

/** The sentence under the state row, for the two states a single word
 *  does not explain. "on" and "off" need none — they are the whole fact —
 *  and "" is the state where nothing is known yet, where a sentence would
 *  be a guess. */
const STATE_NOTES = Object.freeze({
  "not set up":
    "this device is not on an account. pair it with a device that already syncs, or set up sync here.",
  revoked: "this device was removed from the account, and sync has stopped.",
});

/**
 * @param {{configured?: boolean, enabled?: boolean, revoked?: boolean}|null} [status]
 * @returns {string}
 */
export function syncStateNote(status) {
  return STATE_NOTES[syncStateLabel(status)] ?? "";
}

/**
 * The device list, as rows.
 *
 * Revoked devices are dropped, which is the desktop's own filter
 * (`devices.filter((d) => !d.revoked_at)`) rather than a second policy:
 * the relay never forgets a device, so a list that showed them would grow
 * a permanent tail of rows nothing can act on — and this screen offers no
 * revoke, so there is nothing to un-revoke either.
 *
 * The staleness LABEL is carried and the staleness FLAG is not. The
 * desktop dims a stale row; `Row` has no dim variant, adding one would
 * put this screen's concept into the primitive every list uses, and
 * "seen 20 days ago" already says everything the dimming was for.
 *
 * NO ACCOUNT, NO LIST. An unconfigured (or unread) status draws no rows
 * whatever `devices` holds. The host's `listDevices` is not sequenced
 * against its status read, so a list fetched before a disconnect can land
 * after the re-read that says `not set up` (9g review) — and a screen
 * reading `not set up` over a list of the account's devices is two
 * answers to one question. The status is the newer fact; it wins.
 *
 * @param {object} [args]
 * @param {Array<object>} [args.devices]  rows from `sync_list_devices`
 * @param {{configured?: boolean, device_id?: string|null}|null} [args.status]
 * @param {number} [args.nowMs]
 * @returns {Array<{id: string, label: string, value: string}>}
 */
export function deviceRows({ devices = [], status = null, nowMs = 0 } = {}) {
  if (!status?.configured) return [];
  const selfId = status?.device_id ?? null;
  return devices
    .filter((device) => !device.revoked_at)
    .map((device) => ({
      id: device.id,
      label: device.label || UNTITLED_DEVICE,
      value:
        device.id === selfId
          ? THIS_DEVICE
          : deviceStaleness({
              last_seen_ms: device.last_seen_ms,
              created_at_ms: device.created_at,
              now_ms: nowMs,
            }).label,
    }));
}

/**
 * May this screen turn sync on and off.
 *
 * Only where the switch has a meaning to carry. An unconfigured device
 * has no account to sync WITH, so a switch there would be a control that
 * can only fail; a revoked one has been removed from the account, and
 * `enabled` can still be true underneath that (see `syncStateLabel`), so
 * a toggle would read as on, flip to off, and change nothing that
 * stopped the worker. Both of those are a route back through pairing or
 * setup, which this screen already offers.
 *
 * @param {{configured?: boolean, revoked?: boolean}|null} [status]
 * @returns {boolean}
 */
export function syncToggleShows(status) {
  return !!status?.configured && !status?.revoked;
}

/** The sync screen's last row, in the desktop's word for the same act
 *  (SyncSettings.svelte's `disconnect`), so one account does not read two
 *  ways across two trees. */
export const DISCONNECT = "disconnect";

/**
 * May the sync screen offer `disconnect`.
 *
 * Wherever there is an account on this phone to leave — `configured`,
 * revoked or not. Unconfigured (or unread, null) has nothing to
 * disconnect, and a row that resets nothing would be a control that does
 * nothing. Revoked is INCLUDED, unlike the toggle: the relay has already
 * removed the phone, but the account's keys and state are still on it, so
 * `setupRowShows` stays false and this row is the one way to clear them
 * and start again — the desktop's pair-again, which resets first.
 *
 * @param {{configured?: boolean}|null} [status]
 * @returns {boolean}
 */
export function disconnectRowShows(status) {
  return !!status?.configured;
}

/**
 * What the confirmation sheet says, and its two rows. The facts are
 * `sync_reset`'s (commands.rs, `sync_reset`): it clears the sync state and
 * keys and stops the worker, and pages, trails, pins and settings stay;
 * every op it had sent is marked local-only again, so setting up again
 * sends the whole history from this phone.
 *
 * `stay` comes FIRST and `confirm` last, pin-artifact-view's rule: the row
 * that removes something is not the row a thumb lands on by accident.
 * Dismissing the sheet is a cancel too; the `stay` row is the cancel said
 * as a row, for the reader who looks for one.
 *
 * The note says this phone FORGETS its account, not that it leaves it:
 * `sync_reset` is local and never tells the relay, so the other devices
 * keep listing this one (9g review). The revoked note differs because the
 * relay has already removed the phone, so there is nothing to forget but
 * the dead account itself. The cancel is one neutral row for both arms —
 * a revoked phone is not connected, so "stay connected" would not be true
 * of it.
 *
 * @param {{revoked?: boolean}|null} [status]
 * @returns {{ note: string, stay: string, confirm: string }}
 */
export function disconnectSheet(status) {
  return {
    note: status?.revoked ? DISCONNECT_NOTES.revoked : DISCONNECT_NOTES.account,
    stay: DISCONNECT_STAY,
    confirm: DISCONNECT_CONFIRM,
  };
}

const DISCONNECT_NOTES = Object.freeze({
  account:
    "your writing stays on this phone. sync stops, and this phone forgets its account. set up sync again and everything here is sent again.",
  revoked:
    "your writing stays on this phone. this clears the account it was removed from. set up sync again and everything here is sent again.",
});

/** The sheet's cancel, said as what it keeps. Neutral, so it is true of
 *  a live account and a revoked one alike. */
export const DISCONNECT_STAY = "keep things as they are";

/** The sheet's one destructive row. Names the act and the device, the
 *  trail delete's safeguard: a row that says what it disconnects cannot be
 *  pressed believing it disconnects something else. */
export const DISCONNECT_CONFIRM = "disconnect this phone";

/**
 * Which half of a pairing this device performs.
 *
 * A device already on the account SHOWS a code; a device that is not
 * JOINS by reading one. This is the only branch in the sync stack, and it
 * decides everything downstream — which command the pair screen starts
 * with, whether the scanner is reachable at all, and which of the two
 * labels the devices screen's last row carries.
 *
 * @param {{configured?: boolean}|null} [status]
 * @returns {"show"|"join"}
 */
export function pairSide(status) {
  // `user_id: null` with keys present is a pairing that saved the keys and
  // was never enrolled (0.8.0 did that when the relay refused the finalize).
  // It holds no account, so it joins. Tested against null, not falsiness:
  // sync_status always sends the key, and a status read without it is not
  // this state.
  if (status?.configured && status.user_id === null) return "join";
  return status?.configured ? "show" : "join";
}

/** The devices screen's last row: the one way into the pair screen. Two
 *  labels because they are two acts — adding a device to an account you
 *  hold, and putting this device onto one you hold elsewhere. */
export function pairRowLabel(side) {
  return side === "show" ? "add a device" : "pair this device";
}

// What the pair screen says, by side and phase. One table rather than a
// sentence per branch of the markup, so the copy test can read every
// string the screen can ever show without driving the screen into each of
// its states.
//
// The phases: `starting` (a command is in flight and there is nothing to
// show yet), `waiting` (the code is up, or the scan row is offered),
// `verify` (both devices hold digits that must match), `working` (the
// confirmed exchange is running), `done`.
const PROMPTS = Object.freeze({
  "show:starting": "making a code.",
  "show:waiting": "scan this on the other device, or type the words under it.",
  "show:verify": "these digits must match the ones on the other device. if they do not, go back.",
  "show:working": "adding it.",
  "show:done": "paired.",
  "join:waiting": "on the device that already has your writing, open settings, sync, add a device. then scan the code it shows.",
  "join:verify": "these digits must match the ones on the other device. if they do not, go back.",
  "join:working": "joining. press codes match on the other device too.",
  "join:done": "paired.",
});

/** The group a finished pairing draws, and its one act. */
export const PAIR_ADDED = "added";
export const PAIR_DONE = "done";

/**
 * What the end of a pairing says: the lead sentence, the device the group
 * names, and the state beside it.
 *
 * It was one grey word, "paired.", on an otherwise empty screen, which on a
 * real A16 read as a page that had not finished loading. The screen before
 * it, the digits, is drawn with an inset group and an act; the end now is
 * too.
 *
 * NOT A CLAIM IT CANNOT KEEP. The device that SHOWS the code is not switched
 * on by being paired with — only the joining side comes up enabled
 * (docs/device-findings-sync.md) — so the sentence reads the real state:
 * "it syncs from now on" where sync is on, and the way to start it where it
 * is off. The status row on the sync screen is the switch; this says where
 * it is rather than duplicating it.
 *
 * `side` is the side the pairing was CONFIRMED on, not the live one: a
 * joining device becomes configured at exactly this moment, and `pairSide`
 * would then call it the showing side.
 *
 * @param {"show"|"join"} side
 * @param {{ label?: string, enabled?: boolean }} [state]
 * @returns {{ line: string, device: string, value: string }}
 */
export function pairDone(side, { label = "", enabled = false } = {}) {
  const paired = pairPrompt(side, "done");
  return {
    line: enabled ? `${paired} it syncs from now on.` : `${paired} turn sync on to start.`,
    device: side === "show" ? (String(label).trim() || UNNAMED_NEW_DEVICE) : "this phone",
    value: enabled ? "syncing" : "sync off",
  };
}

/**
 * @param {"show"|"join"} side
 * @param {string} phase
 * @returns {string}
 */
export function pairPrompt(side, phase) {
  // "" for a pair the table does not hold. Not "nothing happens": the
  // host produces only the pairs above (`join:starting` has no producer —
  // the join side starts with a row to press, not a command in flight) —
  // so an unknown pair is a typo in the host, and inventing a sentence
  // for it would hide that behind copy that reads fine.
  return PROMPTS[`${side}:${phase}`] ?? "";
}

/** The row that confirms the digits match, on both sides. Spelled once so
 *  the two screens cannot drift into two words for one act. */
export const CODES_MATCH = "the codes match";

/** The join side's one row, which is what pushes the scanner. */
export const SCAN_A_CODE = "scan a code";

/** The devices screen's second act, and the one a phone with no other
 *  device has: the door to SyncSetupScreen. */
export const SET_UP_SYNC = "set up sync";

/**
 * Whether the devices screen offers `set up sync`.
 *
 * Off-account only: a device already on an account has one, and setup
 * over it would re-key the device under a second. Hidden while a pairing
 * is mid-exchange or just finished, because the status that would hide
 * it has not been re-read yet — `working` and `done` are the two phases
 * between "this device sent its key" and "the account knows it", and a
 * second door onto an account during them is a door onto two accounts.
 *
 * Null status shows it, for `pairSide`'s reason: a status not read yet is
 * the same "not on an account" the pair row already assumes, and it is
 * the only status the browser mock can answer, which is what makes the
 * setup screen photographable at all.
 *
 * @param {{status?: {configured?: boolean}|null, pairPhase?: string}} [args]
 * @returns {boolean}
 */
export function setupRowShows({ status = null, pairPhase = "waiting" } = {}) {
  if (status?.configured) return false;
  return pairPhase !== "working" && pairPhase !== "done";
}

// The relay's error codes that mean something a reader can act on, and
// the sentence for each. Taken from the desktop's own mapping
// (SyncSettings.svelte:809-817, 837-848) so one failure does not get two
// explanations across two trees — minus its upgrade pitch on
// `device_limit_reached`, which opens a pricing page through a plugin the
// shell does not import.
const PAIR_ERRORS = Object.freeze([
  [
    ["pair_token_consumed", "ephemeral_pub already deposited"],
    "that code has already been used. get a fresh one on the other device.",
  ],
  [
    ["pair_token_unknown", "expired"],
    "that code is unknown or expired. get a fresh one on the other device.",
  ],
  [["device_limit_reached"], "this account already holds its two devices."],
  // pair_new_complete's own give-up after its fetch budget: the other device
  // never sent the keys, which almost always means its codes match was never
  // pressed. A 0.8.0 tester waited three minutes on "joining." and then read
  // the catch-all, because this string matched nothing here.
  [
    ["never deposited"],
    "the other device did not confirm. press codes match on it, then try a fresh code.",
  ],
  // The keys arrived, and the relay never said this device was added: the
  // other device's finalize was refused, most often because the account
  // is at its device limit. Only the other device is told the reason (a
  // 0.8.0 tester read the catch-all three times), so say where to look.
  // Before the rate-limit row: the 429 inside this message is not the reason.
  [
    ["never ready"],
    "the other device could not add this one. its screen says why, often the account's device limit.",
  ],
  [
    ["rate_limited", "429"],
    "the relay asked for a pause. wait a minute, then try a fresh code.",
  ],
  [
    ["no wrapped bundle deposited", "pair_token_state_invalid"],
    "the other device did not finish. start over with a fresh code.",
  ],
  [
    ["timed out", "timeout"],
    "timed out. keep the pair screen open on the other device, then try a fresh code.",
  ],
]);

/** The catch-all. A sentence rather than the exception, because the
 *  exception is relay internals in a font the writer is reading their own
 *  words in. The raw string goes to the console instead. */
export const PAIR_FAILED = "pairing did not finish. try again.";

/**
 * @param {unknown} raw  whatever the command rejected with
 * @returns {string}
 */
export function pairErrorText(raw) {
  const message = String(raw ?? "");
  for (const [marks, text] of PAIR_ERRORS) {
    if (marks.some((mark) => message.includes(mark))) return text;
  }
  return PAIR_FAILED;
}

/** Every sentence this module can put on a screen, for the copy test.
 *  Built from the tables themselves rather than retyped, so a string
 *  added to one of them cannot escape the canon by being added nowhere
 *  else. */
export function everySyncString() {
  return [
    UNTITLED_DEVICE,
    THIS_DEVICE,
    UNNAMED_NEW_DEVICE,
    CODES_MATCH,
    SCAN_A_CODE,
    SET_UP_SYNC,
    DISCONNECT,
    DISCONNECT_STAY,
    DISCONNECT_CONFIRM,
    ...Object.values(DISCONNECT_NOTES),
    PAIR_FAILED,
    pairRowLabel("show"),
    pairRowLabel("join"),
    ...["not set up", "revoked", "on", "off"],
    ...Object.values(STATE_NOTES),
    ...Object.values(PROMPTS),
    ...PAIR_ERRORS.map(([, text]) => text),
  ];
}
