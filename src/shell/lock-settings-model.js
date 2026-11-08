// The phone's lock settings: what the screen offers in each state.
//
// The lock is the account's (docs/superpowers/specs/2026-11-07-account-lock-design.md,
// src-tauri/src/account_lock.rs): set up, changed or turned off on the phone,
// every paired device follows. So the phone gets the laptop's choices
// (Settings.svelte's lock row and LockPassphraseForm.svelte), with the same
// minimum length the backend enforces (commands.rs MIN_PASSPHRASE_CHARS).

export const MIN_PASSPHRASE = 8;

/** The laptop's inactivity choices (Settings.svelte lockTimeoutOptions). */
export const LOCK_TIMEOUTS = Object.freeze([
  Object.freeze({ minutes: 0, label: "never" }),
  Object.freeze({ minutes: 5, label: "5 minutes" }),
  Object.freeze({ minutes: 15, label: "15 minutes" }),
  Object.freeze({ minutes: 30, label: "30 minutes" }),
]);

const NOTE_OFF = "set a passphrase here and every device on this account asks for it.";
const NOTE_ON = "every device on this account asks for this passphrase. change it or turn it off here, and they follow.";

const FIELDS = Object.freeze({
  current: Object.freeze({ id: "current", label: "current passphrase" }),
  next: Object.freeze({ id: "next", label: "new passphrase" }),
  confirm: Object.freeze({ id: "confirm", label: "the new one again" }),
});

const FORMS = Object.freeze({
  setup: Object.freeze({ when: false, fields: ["next", "confirm"], submit: "turn the lock on", title: "set up the lock" }),
  change: Object.freeze({ when: true, fields: ["current", "next", "confirm"], submit: "change passphrase", title: "change passphrase" }),
  off: Object.freeze({ when: true, fields: ["current"], submit: "turn the lock off", title: "turn the lock off" }),
});

/** Why a form cannot be sent yet, or "" when it can. */
function formHint(form, v) {
  const spec = FORMS[form];
  if (spec.fields.includes("current") && !String(v.current || "")) return "";
  if (spec.fields.includes("next")) {
    const next = String(v.next || "");
    if (next.length === 0) return "";
    if ([...next].length < MIN_PASSPHRASE) return `at least ${MIN_PASSPHRASE} characters`;
    if (String(v.confirm || "") !== next) return "the two do not match";
  }
  return "";
}

function formReady(form, v) {
  const spec = FORMS[form];
  if (spec.fields.includes("current") && !String(v.current || "")) return false;
  if (spec.fields.includes("next")) {
    const next = String(v.next || "");
    return [...next].length >= MIN_PASSPHRASE && String(v.confirm || "") === next;
  }
  return true;
}

/**
 * @param {object} state
 * @param {boolean} state.on  is this device's file locked
 * @param {number} [state.timeout]  the stored lock_timeout_minutes
 * @param {null|"setup"|"change"|"off"} [state.form]  the form open, if any
 * @param {object} [state.values]  what is typed in the form's fields
 * @param {boolean} [state.busy]  a submit is running
 * @param {string|null} [state.error]  the backend's refusal, in its words
 */
export function lockScreen({ on, timeout = 0, form = null, values = {}, busy = false, error = null }) {
  const rows = on
    ? [
        { id: "change", kind: "action", label: "change passphrase" },
        { id: "off", kind: "action", label: "turn off" },
        ...LOCK_TIMEOUTS.map((t) => ({
          id: `timeout-${t.minutes}`,
          kind: "choice",
          label: t.label,
          chosen: t.minutes === (Number(timeout) || 0),
          minutes: t.minutes,
        })),
      ]
    : [{ id: "setup", kind: "action", label: "set up" }];
  const spec = form ? FORMS[form] : null;
  const fits = !!spec && spec.when === on;
  return {
    rows,
    note: on ? NOTE_ON : NOTE_OFF,
    form: fits
      ? {
          id: form,
          title: spec.title,
          fields: spec.fields.map((id) => FIELDS[id]),
          submit: spec.submit,
          ready: !busy && formReady(form, values),
          hint: error || formHint(form, values),
        }
      : null,
  };
}
