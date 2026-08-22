// Is this device one the user has forgotten about?
//
// Every reinstall mints a new device and the relay never forgets the old
// one, so after a week of testing an account carries a trail of ghosts that
// count against the two-device tier. The relay keeps no last-seen; the app
// derives it from the op log. The threshold is generous on purpose: a phone
// in a drawer for a fortnight is the honest case, and "stale" only softens
// the revoke button, it never presses it.
export const STALE_AFTER_MS = 14 * 86_400_000;
const NEVER_SEEN_GRACE_MS = 86_400_000;

export function deviceStaleness({ last_seen_ms, created_at_ms, now_ms }) {
  if (last_seen_ms == null) {
    return { label: "never seen", stale: now_ms - (created_at_ms ?? now_ms) > NEVER_SEEN_GRACE_MS };
  }
  const age = now_ms - last_seen_ms;
  const days = Math.floor(age / 86_400_000);
  const label = days <= 0 ? "seen today" : days === 1 ? "seen yesterday" : `seen ${days} days ago`;
  return { label, stale: age > STALE_AFTER_MS };
}
