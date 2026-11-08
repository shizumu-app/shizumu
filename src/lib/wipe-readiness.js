// May "delete all writing" go straight through, or would it take writing the
// other devices never received? The wipe clears the op log, so an op still
// waiting to upload is gone for good, while the person believes the phone has
// everything. Only an account makes that promise: a device that never set sync
// up holds local_only rows all the time and has nothing to lose by them.

const CAN_SEND = "some writing on this device has not reached your other devices yet. delete now and it is gone for good.";
const SEND_FAILED = "that writing could not be sent. check your connection and try again, or delete it anyway.";
const SYNC_OFF = "sync is off on this device, so some of its writing has not reached your other devices. turn sync on to send it, or delete it anyway.";
const REVOKED = "this device is off the account, so some of its writing never reached your other devices. export it to keep it, or delete it anyway.";
const UNCHECKED = "could not check whether everything has reached your other devices. delete it anyway only if you are sure.";

/**
 * @param {{configured?:boolean, enabled?:boolean, revoked?:boolean}|null} status  sync_status
 * @param {{local_only?:number, pending_upload?:number}|null} stats  op_log_stats
 * @param {{failed?:boolean, triedSend?:boolean}} [opts]
 *   failed: reading either one threw. triedSend: "send it first" already ran.
 * @returns {{clear:boolean, line:string, canSend:boolean, confirmLabel:string}}
 */
export function wipeReadiness(status, stats, { failed = false, triedSend = false } = {}) {
  const warn = (line, canSend = false) => ({ clear: false, line, canSend, confirmLabel: "delete anyway" });
  if (failed) return warn(UNCHECKED);
  if (!status?.configured) return { clear: true, line: "", canSend: false, confirmLabel: "confirm" };
  if (!stats) return warn(UNCHECKED);
  const waiting = (stats.local_only ?? 0) + (stats.pending_upload ?? 0);
  if (waiting === 0) return { clear: true, line: "", canSend: false, confirmLabel: "confirm" };
  if (status.revoked) return warn(REVOKED);
  if (!status.enabled) return warn(SYNC_OFF);
  return warn(triedSend ? SEND_FAILED : CAN_SEND, true);
}

/**
 * The second read, at the press of confirm. Writing can start waiting after
 * the row was drawn; a warning the person has not seen must not be passed
 * through by a "confirm" they pressed when there was nothing to warn about.
 */
export function mayWipeNow(shown, fresh) {
  return fresh.clear || (shown != null && !shown.clear);
}
