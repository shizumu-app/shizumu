// May the camera be open right now, and what the screen says when it is
// not.
//
// ── WHY THIS IS A MODULE ──────────────────────────────────────────────
//
// The scanner is the first surface in this shell that owns a HARDWARE
// resource. Every other screen leaks nothing worse than a listener when
// it gets its lifecycle wrong; this one leaves a lens open, and a camera
// left running is a battery drain the writer cannot see and will not
// attribute to a notebook app. "Is the camera allowed to be live" is
// therefore exactly the kind of decision CLAUDE.md keeps out of a
// `.svelte` file — inline in a component nothing could reach it, and the
// three states that matter (backgrounded, refused, done) are all states a
// unit test can drive and a screenshot cannot.
//
// ── THE STATUS IS A STRING, AND A NO-OP RETURNS THE SAME ONE ──────────
//
// `cameraLive` gates an `{#if}` around a BORROWED component
// (`src/components/QrScanner.svelte`, on the shell's import allowlist and
// named by spec §4). Mounting is the only lever the shell has over that
// component's stream: QrScanner opens it in its own `start()` and stops
// it in its own `onDestroy` (QrScanner.svelte:49-55), and the shell may
// not edit a desktop component to add a second door. So flipping this
// status IS the camera switch, and an event that means nothing must
// return the IDENTICAL string — a fresh object for a duplicate
// `visibilitychange` would re-run the `{#if}`, tear down a live stream
// mid-frame, and put the consent gate back under the writer's thumb for
// no reason at all.
//
// ── WHY THE SHELL CLASSIFIES THE FAILURE ITSELF ───────────────────────
//
// QrScanner renders its own error text, and that text is the DESKTOP's:
// it tells the reader to "switch to the 'type words' tab", a tab that
// exists in `SyncSettings.svelte` and nowhere in this tree. So the shell
// unmounts the component on the first error rather than letting it
// explain itself, and says the phone's own sentence instead. The
// substrings matched below are QrScanner's own (QrScanner.svelte:70-75),
// deliberately and not by coincidence: two surfaces disagreeing about
// what counts as a refusal is how one of them ends up offering a recovery
// the other one's state cannot reach.

/** Every status this module produces. Exported for the copy test, which
 *  holds each one's sentence to the brand canon rather than trusting a
 *  list retyped beside it. */
export const SCANNER_STATUSES = Object.freeze([
  "scanning",
  "paused",
  "refused",
  "absent",
  "failed",
  "read",
]);

// QrScanner's own two branches, matched as it matches them (plain
// substring, same casing). `Permission` catches the SecurityError shape
// some engines report instead of NotAllowedError.
const REFUSED_MARKS = ["NotAllowedError", "Permission"];
const ABSENT_MARKS = ["NotFoundError", "DevicesNotFound"];

/**
 * Which kind of failure a stream-open error is.
 *
 * @param {unknown} message  whatever QrScanner handed to onError
 * @returns {"refused"|"absent"|"failed"}
 */
export function classifyCameraError(message) {
  const text = String(message ?? "");
  if (REFUSED_MARKS.some((mark) => text.includes(mark))) return "refused";
  if (ABSENT_MARKS.some((mark) => text.includes(mark))) return "absent";
  return "failed";
}

/**
 * The next status, given what just happened.
 *
 * @param {string} status
 * @param {{type: "hidden"|"shown"|"error"|"read", message?: unknown}} event
 * @returns {string}
 */
export function nextScanner(status, event) {
  switch (event?.type) {
    case "hidden":
      // Backgrounded: the camera closes, whatever it was doing —
      // including from a failure state, because the most likely reason a
      // reader leaves this screen after a refusal is to go and grant the
      // permission in system settings, and they must come back to a
      // scanner that can try again rather than to a frozen apology.
      //
      // A read is the exception and the only one. It is terminal: the
      // host is already popping this screen, and re-arming the camera on
      // the way out is the one thing a finished scan must not do.
      return status === "read" ? status : "paused";
    case "shown":
      // ONLY out of `paused`. From "scanning" this is the ordinary
      // duplicate visibilitychange, and returning anything but the same
      // string would remount QrScanner over a live stream (see the header
      // — the string identity IS the switch). From a failure status it
      // would silently promote a refusal to a viewfinder that cannot
      // open, on an event the reader did not cause.
      return status === "paused" ? "scanning" : status;
    case "error":
      return classifyCameraError(event.message);
    case "read":
      return "read";
    default:
      // An event this module does not know is not a reason to change what
      // the camera is doing. There is no producer for one today; the
      // branch exists so that adding a listener to the screen cannot
      // close a stream by accident.
      return status;
  }
}

/**
 * May QrScanner be mounted — which is to say, may a stream be open.
 *
 * @param {string} status
 * @returns {boolean}
 */
export function cameraLive(status) {
  return status === "scanning";
}

// The three failures, and nothing else. `refused` names the fix rather
// than the fault, because on Android the refusal is currently the
// EXPECTED first answer: nothing in this tree grants the WebView its
// camera permission (only the Linux webview does, via the
// on_permission_request hook in src-tauri/src/lib.rs:74-93), so a reader
// meeting this sentence is meeting the common case, not an edge one.
const NOTES = Object.freeze({
  refused: "shizumu has no camera permission. grant it in system settings, then start the camera again.",
  absent: "no camera on this device.",
  failed: "the camera did not open. go back and try again.",
});

/**
 * The sentence the screen shows, or "" for the statuses that say nothing.
 *
 * Three of the six are deliberately silent, and each for its own reason
 * rather than because nothing was written for them:
 *
 *   scanning — the viewfinder is the message. A caption over a live
 *     preview is chrome that reads as an instruction and gets in the way
 *     of the one thing the reader is doing, which is aiming.
 *   paused — nothing reads a note on a screen the OS has hidden, and by
 *     the time anyone can read it the status is "scanning" again (see
 *     `nextScanner`'s "shown"). A sentence here would be copy no eye can
 *     ever reach.
 *   read — the host pops this screen on the read, so a note would flash
 *     for one frame on the way out.
 *
 * @param {string} status
 * @returns {string}
 */
export function scannerNote(status) {
  return NOTES[status] ?? "";
}
