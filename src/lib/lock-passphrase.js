// What the settings lock form accepts, and what it says when it does not.
//
// The same minimum as the setup screen (SetupEncryption.svelte) and the
// backend (MIN_PASSPHRASE_CHARS in commands.rs), which refuses a shorter one
// on its own: this is the reader's early warning, not the guard.
export const MIN_PASSPHRASE_CHARS = 8;

/**
 * @param {{ mode: "change"|"off", current: string, next?: string, confirm?: string }} form
 * @returns {{ valid: boolean, hint: string|null }}
 */
export function lockFormState({ mode, current, next = "", confirm = "" }) {
  if (mode === "off") return { valid: current.length > 0, hint: null };

  // A hint names something the reader got wrong; an empty field is only
  // unfinished, so it gets none.
  if (next.length > 0 && next.length < MIN_PASSPHRASE_CHARS) {
    return { valid: false, hint: `at least ${MIN_PASSPHRASE_CHARS} characters` };
  }
  if (confirm.length > 0 && next !== confirm) {
    return { valid: false, hint: "passphrases do not match" };
  }
  if (current.length > 0 && next.length > 0 && next === current) {
    return { valid: false, hint: "that is already the passphrase" };
  }
  const valid = current.length > 0 && next.length >= MIN_PASSPHRASE_CHARS && next === confirm;
  return { valid, hint: null };
}
