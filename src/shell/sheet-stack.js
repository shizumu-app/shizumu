// One sheet at a time (§1): a sheet opened from a sheet replaces it. The
// obvious way to enforce that is to always dismiss whatever is current and
// then show whatever is opening — and that reads correctly right up until
// the sheet being opened is the one already showing. Applied there, it
// dismisses "a" and reshows "a", which to Sheet.svelte is indistinguishable
// from a fresh mount: its content is torn down and rebuilt. The trail
// picker and the pin note sheet both hold a field, so that "no-op" would
// silently discard whatever the user had typed. This function exists so
// that decision is made once, correctly, instead of by whichever host
// wires up a sheet next.

export function nextSheet({ current, opening }) {
  if (opening === current) {
    // Nothing is actually changing — report no dismissal so a host never
    // tears down content that was never going away.
    return { show: current, dismissed: null };
  }
  return { show: opening, dismissed: current };
}
