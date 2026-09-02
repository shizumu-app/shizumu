// Which commands a browser demo cannot honestly run, and what to say.
//
// The split that matters is between commands the app calls AT the visitor and
// commands the visitor reaches FOR. Sync alone fires seven of the first kind
// on boot, so treating the whole subsystem as "unavailable" would greet every
// arrival with a popup about a feature nobody asked about.
import { DEMO_COPY } from "./copy.js";

// Read-only status calls. The truthful answer is "nothing is set up", and the
// existing settings UI renders that state on its own.
const QUIET = {
  sync_status: { enabled: false, configured: false },
  sync_quota: { used: 0, cap: null, tier: "free" },
  sync_relay_health: { ok: false },
  sync_account_email_status: { email: null, verified: false },
  check_encryption_status: false,
  sync_list_devices: [],
  sync_error_history: [],
};

// Reachable only by a deliberate act. Each resolves to a typed result rather
// than a rejected promise: a rejection surfaces as a red error, and there is
// nothing wrong here to apologise for. sync_relay_health is called in the
// pairing wizard (a deliberate act), not on boot; keeping it quiet is harmless.
const NOTICED = new Map([
  ["sync_setup", DEMO_COPY.sync],
  ["sync_init", DEMO_COPY.sync],
  ["sync_enroll", DEMO_COPY.sync],
  ["sync_self_enroll", DEMO_COPY.sync],
  ["sync_generate_phrase", DEMO_COPY.sync],
  ["sync_reveal_phrase", DEMO_COPY.sync],
  ["sync_recover", DEMO_COPY.sync],
  ["sync_redeem_license", DEMO_COPY.sync],
  ["sync_set_relay_url", DEMO_COPY.sync],
  ["sync_switch_relay", DEMO_COPY.sync],
  ["sync_revoke_device", DEMO_COPY.sync],
  ["setup_encryption", DEMO_COPY.sync],
  ["pair_new_join", DEMO_COPY.sync],
  ["pair_new_complete", DEMO_COPY.sync],
  ["pair_existing_start", DEMO_COPY.sync],
  ["pair_existing_fetch_sas", DEMO_COPY.sync],
  ["pair_existing_confirm", DEMO_COPY.sync],
  ["backup_database_gui", DEMO_COPY.exportBackup],
  ["export_pages_gui", DEMO_COPY.exportBackup],
  ["attachment_add", DEMO_COPY.files],
  ["attachment_add_bytes", DEMO_COPY.files],
  ["attachment_open", DEMO_COPY.files],
]);

/** @returns {"quiet"|"noticed"|"normal"} */
export function classifyCommand(cmd) {
  if (Object.prototype.hasOwnProperty.call(QUIET, cmd)) return "quiet";
  if (NOTICED.has(cmd)) return "noticed";
  return "normal";
}

export function quietAnswer(cmd) {
  const a = QUIET[cmd];
  // Pass primitives through untouched (e.g., check_encryption_status returns
  // a boolean). Copy objects and arrays to prevent callers from mutating the
  // stored answer.
  if (typeof a === 'object') {
    return Array.isArray(a) ? [...a] : { ...a };
  }
  return a;
}

/** @returns {{text: string}|null} */
export function noticeFor(cmd) {
  const text = NOTICED.get(cmd);
  return text ? { text } : null;
}
