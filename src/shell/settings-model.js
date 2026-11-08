// What settings the phone offers: which rows the root lists, how they are
// grouped, and what sits behind each one.
//
// ── WHY THIS IS A MODULE AND NOT MARKUP ───────────────────────────────
//
// Two decisions here are the kind CLAUDE.md keeps out of `.svelte` files.
// The first is which rows exist at all — every row shipped is a setting
// the SHELL honours, and three of the desktop's sections are honoured by
// desktop components the shell replaces (see the omissions below). A list
// written inline is a list nobody can hold to that rule. The second is
// data-shape conversion: a section's rows are `{kind, …}` descriptors and
// the screen renders one shape per kind, so "which control does this
// setting get" is answered here rather than by an `{#if}` chain grown one
// setting at a time.
//
// ── WHAT THE DESKTOP HAS, AND WHAT OF IT THE SHELL CAN HONESTLY SHOW ──
//
// `src/components/Settings.svelte` has eight sections: appearance,
// writing, data, encryption, sync, labs, danger, about. The ORDER is
// reused rather than reinvented (P4 Task 1 Step 1); the grouping is the
// shell's own since the visual pass — see ROOT_GROUPS below — because the
// desktop draws one rule before its last two and no headers, and a rule
// is not a thing an inset group with an eyebrow can draw. What is missing
// from the eight below is missing for a named reason, not for lack of
// room:
//
//   writing — `restore_last_page` is honoured by `Page.svelte:267`, the
//     desktop page component the shell REPLACES; the shell's own load is
//     an unconditional getOrCreateToday(). A toggle that writes a key
//     nothing on this tree reads is a control that does nothing, which is
//     worse than an absent one. `close_to_tray` is the same section's
//     other row and the desktop already hides it on mobile — no phone has
//     a system tray.
//   data — PRESENT since 0.8.2, with one action: export. The desktop's
//     export ends in a native folder picker and its backup in a save
//     dialog, and neither returns a path on a phone (Android's save dialog
//     answers with a `content://` URI). So the phone's export is the same
//     files packed into one zip by Rust and handed to the system share
//     sheet (`runExportZip`, src/lib/export/run.js), where the writer picks
//     Files, a drive or another app. Backup is still absent: it needs the
//     same path and a restore story the phone does not have. Where the
//     platform cannot share a zip (iOS today, a browser), the row stays and
//     a note says the export works from the laptop (`exportZip` in
//     platform.js says which).
//   encryption — "set up" mounts `SetupEncryption.svelte`, a desktop
//     component the shell's import rules do not allow, and the shell has
//     no password surface. §2 gives lock its own chromeless state, which
//     is P4 Task 3.
//   danger — "delete all writing" needs a typed confirmation surface and
//     a host that can re-run onboarding afterwards. The boot fork hands
//     the shell no such callback, so the shell would wipe the database
//     and then render over nothing.
//   sync — PRESENT since P4 Task 2, and the one root row that does not
//     push a section. §2 makes it a STACK of its own (devices → pair →
//     scanner), so there is no list of rows for `settingsSection` to
//     describe; the row carries `screen: "sync"`, and the host pushes
//     that stack's first screen rather than the section component.
//     `sync-model.js` holds what those screens show, and its header names
//     what of the desktop's five sync tabs is absent and why.
//
// What is left is what the shell itself acts on. Tone and font reach the
// document through the host's own appliers (`App.svelte`, one owner of
// `data-tone`); yjs is read by EditorCore, which is the shell's canvas;
// the version is a build-time define.
//
// ── OPTIONS ARE ROWS, NOT A SEGMENTED CONTROL ─────────────────────────
//
// §4's `Row` has six kinds — push, action, choice, destructive, toggle,
// value — and no segment. The desktop picks a tone with a four-way
// SegmentedControl, and the shell now has `Segment`, a wrapper that puts
// the desktop control on the 44px floor; it is still not reached for
// here, because four tone names in one segment on a 360px display is the
// case that already needed `white-space: nowrap` per segment elsewhere in
// the shell, and the font section's four would be the same squeeze.
//
// So an option set is a SECTION of `choice` rows, and the chosen one says
// so in its value column — the trail scope sheet's arrangement, and its
// argument applies unchanged: `Row` has no selected variant, adding one
// would put one screen's concept into the primitive every list uses, and
// a WORD reads the same to a screen reader as to an eye where a mark does
// not. A choice row draws no chevron (row-kind.js): it selects and pops,
// and the chevron is the promise that a tap opens a screen.
//
// This is also what keeps the SECTIONS two levels deep. Stack renders
// `entry.view()` with no arguments, so a pushed screen cannot be told
// which section it is — the host holds that in one variable, and one
// variable can only describe one pushed section. A second pushed section
// would need a snippet per section, declared in markup, for no gain the
// reader can see.
//
// That is a limit on ONE COMPONENT STANDING FOR MANY SCREENS, not a limit
// on depth, and P4 Task 2 is where the difference became load-bearing.
// Sync is three levels below this root and needs no such variable,
// because its three levels are three DIFFERENT screens: each is its own
// `kind` in the host's push list and its own snippet beside the others,
// which is the arrangement Stack was already built for. What cannot be
// done is telling one component which of four sections it is; what can be
// done is pushing four distinct screens. Settings is two deep because its
// sections are one component, and sync is four deep because its screens
// are three.

import { syncStateLabel } from "./sync-model.js";

/** The canvas tones, and their ids as `canvas_tone` stores them. */
export const TONES = Object.freeze([
  Object.freeze({ id: "cream", label: "cream" }),
  Object.freeze({ id: "white", label: "white" }),
  Object.freeze({ id: "dark", label: "dark" }),
  Object.freeze({ id: "system", label: "system" }),
]);

/** The body typefaces, ids as `canvas_font_family` stores them. The last
 *  two ids differ from their labels on purpose — they are the desktop's
 *  own stored values, and renaming them here would orphan every install
 *  that has already picked one. */
export const FONTS = Object.freeze([
  Object.freeze({ id: "lora", label: "lora" }),
  Object.freeze({ id: "inter", label: "inter" }),
  Object.freeze({ id: "dm-mono", label: "mono" }),
  Object.freeze({ id: "system-serif", label: "system" }),
]);

/** What the chosen row of an option set says in its value column. A word
 *  rather than a tick, for the trail scope sheet's reason. Exported so a test
 *  asserts against the string the screen renders rather than a second
 *  copy of it that can drift. */
export const CHOSEN = "in use";

/** What the labs section says once the layout switch is off. Exported for
 *  CHOSEN's reason — the screen renders this string and the tests assert
 *  it, and a second copy is a second thing to keep true.
 *
 *  It answers the question the switch leaves hanging, which is not "did
 *  that work" but "why does the app look the same". So it says WHEN, in
 *  the same breath as what: the flag is read once at boot, so the next
 *  open is when the layout changes. */
/** The export row's second line: what the zip holds. */
export const EXPORT_DETAIL = "every page as markdown files, in one zip";

/** Where this phone cannot share a zip (exportZip false in platform.js). */
export const EXPORT_LAPTOP_NOTE = "export works from the laptop for now.";

/**
 * The sentence under the export row once it has been pressed, or null.
 * @param {{state: "working"|"done"|"failed", pageCount?: number}|null} status
 * @returns {string|null}
 */
export function exportStatusText(status) {
  if (!status) return null;
  if (status.state === "working") return "packing every page…";
  if (status.state === "done") {
    const n = status.pageCount ?? 0;
    return `${n} ${n === 1 ? "page" : "pages"} packed into one zip.`;
  }
  if (status.state === "failed") return "the export stopped before the zip was ready. try again.";
  return null;
}

export const SHELL_OFF_NOTE =
  "off when you reopen shizumu — the previous layout comes back.";

/** The root's rows, in three named groups, ids only. Each group renders
 *  as an inset `RowGroup` under an eyebrow that says what the rows in it
 *  are about, so the name is the first thing a reader sees and it has to
 *  be the right word:
 *
 *    page — tone and font. Both are the page's look — the canvas colour
 *      under the writing and the face the writing is set in — and `page`
 *      is what the shell calls that surface everywhere else (the first
 *      tab, the writing canvas). Not `appearance`, the desktop's word: it
 *      names the section, where `page` names the thing the section is a
 *      setting OF.
 *    sync — the one row that is a stack of its own, under its own name.
 *    app — labs and about: the build, and the experiments this build
 *      carries. The honest word for the two rows that are about shizumu
 *      itself rather than about the page.
 *
 *  `sync` sits between `font` and `labs` because that is where the
 *  desktop puts it: appearance, writing, data, encryption, sync, labs,
 *  danger, about. Of those eight the shell honours four and a stack, and
 *  they stay in the desktop's order rather than being re-sorted into the
 *  phone's idea of importance — one set of settings, one organisation.
 *  The groups follow that order too; only the names are new. */
const ROOT_GROUPS = Object.freeze([
  Object.freeze({ eyebrow: "page", ids: Object.freeze(["tone", "font"]) }),
  // data sits after page and before sync: the desktop's order (appearance,
  // writing, data, encryption, sync, …). One row, one section behind it.
  Object.freeze({ eyebrow: "data", ids: Object.freeze(["data"]) }),
  // lock sits between data and sync: the desktop's encryption row, in its
  // place (… data, encryption, sync …). The account's one lock
  // (src-tauri/src/account_lock.rs), set, changed or turned off here.
  Object.freeze({ eyebrow: "lock", ids: Object.freeze(["lock"]) }),
  Object.freeze({ eyebrow: "sync", ids: Object.freeze(["sync"]) }),
  Object.freeze({ eyebrow: "app", ids: Object.freeze(["labs", "about"]) }),
]);

/** The root rows that push something other than a settings section, and
 *  what they push. Every other row pushes `SettingsSectionScreen` with
 *  the rows `settingsSection` describes.
 *
 *  It is a table with one entry rather than a name matched at the host,
 *  so that "which screen does this row open" is answered in the file that
 *  decides which rows exist at all — the host reads it and pushes, and
 *  cannot grow a second opinion about a row it did not list. */
const SCREEN_ROWS = Object.freeze({ sync: "sync", lock: "lock" });

/**
 * Which screen a root row opens: a stack of its own by name, or the
 * shared section screen.
 *
 * @param {string} id
 * @returns {string}  "sync" today, otherwise "section"
 */
export function settingsRowScreen(id) {
  return SCREEN_ROWS[id] ?? "section";
}

/** Every section, by id. `blurb` rides NavBar's subtitle rather than
 *  needing a description slot on `Row`: the bar already has a two-line
 *  shape and drops the second line when it collapses, which is exactly
 *  what a blurb should do under a scroll. */
const SECTIONS = Object.freeze({
  tone: Object.freeze({
    label: "tone",
    blurb: "canvas color underneath everything you write.",
  }),
  font: Object.freeze({
    label: "font",
    blurb: "typeface for body text.",
  }),
  data: Object.freeze({
    label: "data",
    blurb: "your writing, as files you keep.",
  }),
  labs: Object.freeze({
    label: "labs",
    blurb: "opt-in experiments. may move or vanish.",
  }),
  about: Object.freeze({
    label: "about",
    blurb: "build info.",
  }),
});

/** What each root row is called. Sections answer with their own label, so
 *  the root and the screen it opens cannot say two different words for
 *  one thing; `sync` opens no section, so its word lives here. */
const ROOT_LABELS = Object.freeze(
  Object.fromEntries(
    ROOT_GROUPS.flatMap((group) => group.ids).map((id) => [id, SECTIONS[id]?.label ?? id]),
  ),
);

/** The label an option set shows for the value it currently holds.
 *
 *  Falls back to the stored id rather than to the first option: a
 *  `canvas_tone` this build does not know about is a real state (an older
 *  install, a hand-edited row), and answering "cream" for it would tell
 *  the reader their tone is something it is not. */
function optionLabel(options, value) {
  return options.find((o) => o.id === value)?.label ?? value ?? "";
}

/**
 * The settings root: three named groups of navigation rows, each row
 * pushing a section (or the sync stack).
 *
 * @param {object} [state]
 * @param {string} [state.tone]  the current `canvas_tone`
 * @param {string} [state.font]  the current `canvas_font_family`
 * @param {object|null} [state.sync]  the `sync_status` snapshot, or null
 *   before one has been read
 * @returns {Array<{eyebrow: string, rows: Array<{id: string, label: string, value: string, screen: string}>}>}
 */
export function settingsGroups({ tone = "", font = "", sync = null, lock = false } = {}) {
  // The value column carries what the setting is SET TO, so the root
  // answers the common question without a push. Three rows have one:
  // the two option sets, and sync, whose one-word state is the question
  // anyone opening settings for it is actually asking. `labs` holds
  // toggles, whose state belongs beside each switch and cannot be summed
  // into one word, and `about` would otherwise print the build twice on
  // two screens.
  const values = {
    tone: optionLabel(TONES, tone),
    font: optionLabel(FONTS, font),
    sync: syncStateLabel(sync),
    // Whether this device's file is locked, the question the row answers.
    lock: lock ? "on" : "off",
  };
  return ROOT_GROUPS.map((group) => ({
    eyebrow: group.eyebrow,
    rows: group.ids.map((id) => ({
      id,
      label: ROOT_LABELS[id],
      value: values[id] ?? "",
      screen: settingsRowScreen(id),
    })),
  }));
}

/**
 * One pushed section: its bar, and the rows in it.
 *
 * Returns null for an id the root does not offer. The host pushes only
 * ids `settingsGroups` produced, so that is the model declining to invent
 * a screen rather than a state the app can reach — and the test that
 * matters is the other one, that every root row HAS a section.
 *
 * @param {string|null} id
 * @param {object} [state]
 * @param {string} [state.tone]
 * @param {string} [state.font]
 * @param {boolean} [state.yjsEnabled]
 * @param {boolean} [state.shellEnabled]  where the layout switch sits —
 *   `shellSwitchChecked` of the stored `try_new_shell`
 * @param {boolean} [state.offerShellSwitch]  false where the switch would
 *   strand the reader (the browser demo): the `shell` row and its note go
 * @param {string} [state.version]  the build string, from the host's defines
 * @returns {{id: string, title: string, blurb: string, rows: Array<object>}|null}
 */
export function settingsSection(
  id,
  {
    tone = "", font = "", yjsEnabled = false, shellEnabled = true, offerShellSwitch = true, version = "",
    exportZip = false, exportStatus = null,
  } = {},
) {
  const section = SECTIONS[id];
  if (!section) return null;
  return {
    id,
    title: section.label,
    blurb: section.blurb,
    rows: sectionRows(id, { tone, font, yjsEnabled, shellEnabled, offerShellSwitch, version, exportZip, exportStatus }),
  };
}

/**
 * The data section: one export row. An action where the platform can share
 * a zip, a plain row with a note where it cannot, so the reader sees the
 * export exists and where to do it rather than finding nothing.
 */
function dataRows({ exportZip, exportStatus }) {
  if (!exportZip) {
    return [
      { id: "export", kind: "value", label: "export", detail: EXPORT_DETAIL, value: "" },
      { id: "export-note", kind: "note", text: EXPORT_LAPTOP_NOTE },
    ];
  }
  const status = exportStatusText(exportStatus);
  return [
    {
      id: "export",
      kind: "action",
      label: "export",
      detail: EXPORT_DETAIL,
      // A second press while the zip is packing would pack it twice.
      busy: exportStatus?.state === "working",
    },
    ...(status ? [{ id: "export-status", kind: "note", text: status }] : []),
  ];
}

function sectionRows(id, { tone, font, yjsEnabled, shellEnabled, offerShellSwitch, version, exportZip, exportStatus }) {
  if (id === "tone") return choiceRows(TONES, tone);
  if (id === "font") return choiceRows(FONTS, font);
  if (id === "data") return dataRows({ exportZip, exportStatus });
  if (id === "labs") {
    return [
      {
        id: "yjs",
        kind: "toggle",
        // The desktop's own wording. "crdt" is dropped: it explains the
        // mechanism to someone who already knows it and nothing to anyone
        // else, and the row sits under a blurb that already says these
        // may vanish.
        label: "yjs for continuous trails",
        checked: yjsEnabled,
      },
      ...(!offerShellSwitch ? [] : [{
        id: "shell",
        kind: "toggle",
        // WHAT IT DOES, not what it is called anywhere else. The key is
        // `try_new_shell`, the spec calls it the mobile shell and the
        // plans call it P5 — three names a reader has never seen, and a
        // labs row is the last place to spend someone's attention on
        // vocabulary. What the switch actually decides is which layout
        // the phone opens in, so that is what it says.
        label: "new phone layout",
        checked: shellEnabled,
      }]),
      // THE NOTE IS THE FEEDBACK, and it exists because this switch is the
      // only one on the phone that does not take effect where it is
      // thrown. `try_new_shell` is read once, at App.svelte's boot, into a
      // `$state` nothing re-reads — so turning the switch off changes
      // SQLite and changes nothing on screen, and a control that appears
      // to do nothing reads as broken by the tester who most needs it to
      // work.
      //
      // Absent while the switch is ON for a reason, not by omission: the
      // next launch then gives the reader the tree they are already
      // looking at, and there is nothing to say about it. A note that
      // stood there permanently would be chrome, and the one time it
      // matters would look like the other times.
      //
      // It is a row rather than a toast because the toast band belongs to
      // the page root (`PageScreen`'s `toast` prop) — a message fired from
      // a pushed settings section renders behind the section and is gone
      // before anyone pops back to it.
      ...(shellEnabled || !offerShellSwitch ? [] : [{ id: "shell-note", kind: "note", text: SHELL_OFF_NOTE }]),
    ];
  }
  // about. A value row, so `Row` renders inert markup rather than a
  // button — there is nothing behind it to open.
  return [{ id: "version", kind: "value", label: "version", value: version }];
}

function choiceRows(options, value) {
  return options.map((option) => ({
    id: option.id,
    kind: "choice",
    label: option.label,
    chosen: option.id === value,
  }));
}

/** Every SECTION id the root offers, flattened — for the host's push
 *  table and for the test that holds the two in step.
 *
 *  Rows that open a stack of their own are filtered out rather than
 *  listed and excused: this list's whole job is "every id here must have
 *  a section behind it", and `sync` has screens behind it instead.
 *  `settingsRootIds` is the list that still covers every row. */
export function settingsSectionIds() {
  return settingsRootIds().filter((id) => settingsRowScreen(id) === "section");
}

/** Every root row id, section or not — the list the completeness test
 *  walks, so that a row added with no screen behind it fails somewhere
 *  rather than pushing a blank. */
export function settingsRootIds() {
  return ROOT_GROUPS.flatMap((group) => [...group.ids]);
}
