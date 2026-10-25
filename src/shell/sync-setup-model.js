// What the setup screen decides: which step comes next, whether a typed
// phrase may reach the backend at all, which relay a choice means, which
// command a path calls, and what each failure says.
//
// ── WHY SETUP IS ON THE PHONE AT ALL ──────────────────────────────────
//
// P4 Task 2 left it off, on the argument that a phone joins an account
// that already exists and pairing is that. The argument held for a phone
// that is someone's second device and failed on the first one that was
// their ONLY device: the devices screen offered `pair this device`, and
// there was nothing to pair with. sync-model.js's header records the
// reversal; this module is what the reversal costs — the wizard's
// decisions, out of the screen and under test, on the desktop's own
// step order (SyncSettings.svelte: `phrase` → `relay` → `done`).
//
// ── WHAT THE DESKTOP WIZARD ACTUALLY DOES, READ RATHER THAN ASSUMED ──
//
// Three things about it differ from the obvious reading, and each is a
// decision here:
//
//   The command is chosen by the RELAY, not by the writer. `connect`
//   probes `sync_relay_health` first, and it is the probe's `mode` that
//   picks the verb: a `multi_user` relay gets `sync_init` (a new phrase
//   creates an account) or `sync_recover` (a typed phrase finds one);
//   any other relay gets `sync_self_enroll`, which is one account per
//   relay and needs no init/recover distinction. So "hosted vs self-host"
//   is only where the url comes from — `setupVerb` takes the probe's
//   answer, and the host must probe before it enrolls. The probe is also
//   the reachability check, which is where "the relay did not answer"
//   comes from.
//
//   The phrase is validated by COUNT before it leaves the screen, and by
//   bip39 checksum only in Rust (`Mnemonic::parse_normalized`, which
//   rejects with "invalid bip39 phrase"). The desktop trims and counts on
//   `\s+`; this module also lowercases and collapses, because a phone
//   keyboard capitalises the first word and autocorrect doubles spaces,
//   and neither is what the writer meant.
//
//   The device label falls back to "this device", and `done` does not turn
//   sync on: enrolment leaves `enabled` false, the writer is asked, and
//   only `sync_set_enabled(true)` starts the worker. A recovered account
//   additionally force-pulls after enabling, because a recovered device
//   has history to fetch and a fresh one has none.

/** The relay we run. A COPY of the desktop's constant — `HOSTED_RELAY_URL`
 *  is a `const` inside SyncSettings.svelte's script, not an export, and
 *  that file is frozen to this tree. sync-setup-model.test.js reads the
 *  desktop's source and holds the two equal, so the day one changes the
 *  other goes red rather than the two trees enrolling on two relays.
 *  "" hides the hosted choice, exactly as it does there. */
export const HOSTED_RELAY_URL = "https://relay.shizumu.app";

/** The three steps, in order. `done` is a step rather than a pop so the
 *  writer sees the state row change and is asked about turning sync on,
 *  which is what the desktop's `done` exists for. */
export const SETUP_STEPS = Object.freeze(["phrase", "relay", "done"]);

/** @param {string} step @returns {string} the step after, or the same step at the end */
export function setupNext(step) {
  const at = SETUP_STEPS.indexOf(step);
  return at === -1 || at === SETUP_STEPS.length - 1 ? step : SETUP_STEPS[at + 1];
}

/** How many words a recovery phrase has. bip39's 24-word form, which is
 *  what `sync_generate_phrase` makes and what every enrol command parses. */
export const PHRASE_WORDS = 24;

/**
 * A typed phrase, made comparable: lowercase, trimmed, one space between
 * words. Applied before counting AND before the command is called, so
 * what the screen validated is byte-for-byte what the backend receives.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizePhrase(text) {
  return String(text ?? "").toLowerCase().trim().split(/\s+/).filter(Boolean).join(" ");
}

/** @param {string} text @returns {number} */
export function phraseWordCount(text) {
  const normal = normalizePhrase(text);
  return normal ? normal.split(" ").length : 0;
}

/** The desktop's own sentence for a phrase of the wrong length
 *  (SyncSettings.svelte, `continueToRelay`). */
export const PHRASE_LENGTH = "phrase must be 24 words";

/**
 * Why a typed phrase may not go on, or "" when it may. Count only: the
 * checksum is the backend's, and a wrong word in a 24-word phrase comes
 * back from the enrol command as "invalid bip39 phrase", which
 * `setupErrorText` has words for.
 *
 * @param {string} text
 * @returns {string}
 */
export function phraseProblem(text) {
  return phraseWordCount(text) === PHRASE_WORDS ? "" : PHRASE_LENGTH;
}

/** The two ways into the phrase step, and the segment that offers them. */
export const PHRASE_MODES = Object.freeze([
  { value: "generate", label: "new account" },
  { value: "existing", label: "have a phrase" },
]);

/** Where the writing goes. `hosted` is offered only while the desktop's
 *  constant names a relay — an empty one hides the choice and leaves the
 *  url field, which is what shipped before the relay was live. */
export const RELAY_CHOICES = Object.freeze([
  { value: "hosted", label: "hosted" },
  { value: "self", label: "self-host" },
]);

/** @returns {Array<{value: string, label: string}>} */
export function relayChoices() {
  return HOSTED_RELAY_URL ? RELAY_CHOICES : RELAY_CHOICES.filter((c) => c.value === "self");
}

/** @returns {"hosted"|"self"} */
export function defaultRelayChoice() {
  return HOSTED_RELAY_URL ? "hosted" : "self";
}

/**
 * The url a choice means. Hosted is the constant and nothing the writer
 * typed; self-host is what they typed, trimmed.
 *
 * @param {"hosted"|"self"} choice
 * @param {string} typed
 * @returns {string}
 */
export function relayUrlFor(choice, typed) {
  return choice === "hosted" && HOSTED_RELAY_URL ? HOSTED_RELAY_URL : String(typed ?? "").trim();
}

/** The hosted relay as the screen names it: the host without its
 *  scheme, the desktop's own presentation under "syncs to". */
export function hostedRelayName() {
  return HOSTED_RELAY_URL.replace(/^https?:\/\//, "");
}

/** The desktop's own sentence for a url that is not one (`connect`). */
export const RELAY_URL_SHAPE = "relay url must start with http:// or https://";

/**
 * @param {string} url  already resolved through `relayUrlFor`
 * @returns {string}  "" when it may be probed
 */
export function relayProblem(url) {
  return /^https?:\/\//.test(url) ? "" : RELAY_URL_SHAPE;
}

/** What `sync_init` / `sync_recover` / `sync_self_enroll` name this device
 *  when the writer typed nothing. The desktop's default, and the same
 *  string the pair path already sends to `pair_new_complete`. */
export const DEFAULT_DEVICE_LABEL = "this device";

/** @param {string} typed @returns {string} */
export function deviceLabelFor(typed) {
  return String(typed ?? "").trim() || DEFAULT_DEVICE_LABEL;
}

/**
 * Which command enrols this device. The relay's mode decides between one
 * account per relay (`self-enroll`) and many (`init` / `recover`), and
 * only on a many-account relay does it matter whether the phrase is new
 * or kept — see the header.
 *
 * @param {{mode: "generate"|"existing", relayMode?: string|null}} args
 * @returns {"init"|"recover"|"self-enroll"}
 */
export function setupVerb({ mode, relayMode = null }) {
  if (relayMode !== "multi_user") return "self-enroll";
  return mode === "existing" ? "recover" : "init";
}

/** The relay step's way back to the words, and the done step's way out
 *  without turning sync on. Rows, not backs: the nav bar's back leaves
 *  setup on every step, through every door the shell has (its button,
 *  the edge drag, the system button), and a back that meant "previous
 *  step" through one door and "leave" through another is the one
 *  inconsistency a step machine on a stack must not grow. */
export const CHANGE_THE_PHRASE = "change the phrase";
export const COPY_THE_PHRASE = "copy the phrase";
export const LATER = "later";

/** What the toast says after `copy the phrase`. The desktop's own. */
export const PHRASE_COPIED = "phrase copied";

// What the screen says, by step and mode. One table, for pairPrompt's
// reason: the copy test reads every sentence without driving the screen
// into each state.
//
// The phrase sentences say what the words ARE and what to do with them,
// and nothing about what not to do — "write it down" rather than "never
// share it". The relay sentence is the desktop's, verbatim. The hosted
// note is the canon's privacy claim: what the relay holds, said as what
// it cannot read, never as invisibility.
const PROMPTS = Object.freeze({
  "phrase:generate":
    "your recovery phrase. write these words down and keep them: they are the way back to your writing from another device.",
  "phrase:existing": "type or paste the 24-word phrase you kept.",
  "phrase:working": "making a phrase.",
  relay: "choose where your encrypted writing syncs.",
  "relay:hosted":
    "we run the relay. free for this device and one more, end-to-end encrypted. the relay holds what it cannot read, and neither can we.",
  "relay:self": "run your own relay. free, unlimited. your server, your rules.",
  "relay:working": "connecting.",
  done: "connected. turn sync on.",
  "done:working": "turning on.",
});

/**
 * @param {string} key  `step`, or `step:mode`
 * @returns {string}  "" for a key the table does not hold — a typo in the
 *   host, not a state to invent a sentence for (pairPrompt's rule)
 */
export function setupPrompt(key) {
  return PROMPTS[key] ?? "";
}

/** The phrase display's label, and the two fields' labels. Spelled once
 *  so the screen, its test and the VR reader all name one thing. */
export const PHRASE_FIELD = "recovery phrase";
export const RELAY_FIELD = "relay url";
export const LABEL_FIELD = "a name for this device";
export const RELAY_PLACEHOLDER = "https://relay.example.com";
export const PHRASE_PLACEHOLDER = "word word word ...";

/** `syncs to`, over the hosted relay's name. The desktop names the
 *  destination even when it is not editable: "where does this go" is the
 *  first question worth answering. */
export const SYNCS_TO = "syncs to";

// The failures that mean something, and the sentence for each. The first
// two are the desktop's verbatim (SyncSettings.svelte, `connect`); the
// rest are the strings the Rust side and the relay actually produce,
// read off commands.rs (`sync_relay_health`, `bootstrap_hosted_account`)
// and sync/wire/enroll.rs, not guessed from the names.
//
//   invalid bip39 phrase — 24 words, and one of them is wrong (or the
//     checksum is): the count passed here and the parse failed there.
//   user_not_found — a kept phrase no account on this relay matches.
//   pubkey_mismatch — a self-enrol relay another phrase already owns.
//   user_sign_pub_already_registered — `init` with a phrase the relay
//     already holds an account for: the writer chose new account with
//     kept words, or ran setup twice.
//   relay_already_claimed — a single-account relay that already has one.
//   device_limit_reached — the account is full; the pair path's own
//     sentence, borrowed rather than reworded.
//   can't reach / relay returned / decode healthz / timed out — the probe
//     failed before anything was written: the url is wrong or the phone
//     is offline. This is the one that must leave every field alone.
const SETUP_ERRORS = Object.freeze([
  [["invalid bip39 phrase"], "one of those words is not in the phrase list. check each one."],
  [
    ["user_not_found"],
    "no account matches this phrase. check the words, or set up a new account instead.",
  ],
  [["pubkey_mismatch"], "a different account owns this relay. check the phrase or relay url."],
  [
    ["user_sign_pub_already_registered"],
    "an account already holds this phrase. choose have a phrase to join it.",
  ],
  [["relay_already_claimed"], "this relay already has an account. use its phrase, or another relay."],
  [["device_limit_reached"], "this account already holds its two devices."],
  [
    ["can't reach", "relay returned", "decode healthz", "timed out", "timeout", "error sending request"],
    "the relay did not answer. check the url, and that this phone is online.",
  ],
]);

/** The catch-all, pairErrorText's shape: a sentence for the screen, the
 *  exception for the console. */
export const SETUP_FAILED = "setup did not finish. try again.";

/** When `sync_generate_phrase` itself fails, which on a device means the
 *  secret store is unreadable and in a browser means there is no backend. */
export const PHRASE_FAILED = "could not make a phrase. try again.";

/**
 * @param {unknown} raw  whatever the command rejected with
 * @returns {string}
 */
export function setupErrorText(raw) {
  const message = String(raw ?? "");
  for (const [marks, text] of SETUP_ERRORS) {
    if (marks.some((mark) => message.includes(mark))) return text;
  }
  return SETUP_FAILED;
}

/** Every sentence this module can put on a screen, for the copy test —
 *  built from the tables, everySyncString's way, so nothing added to one
 *  can escape the canon by being added nowhere else. */
export function everySetupString() {
  return [
    CHANGE_THE_PHRASE,
    COPY_THE_PHRASE,
    LATER,
    PHRASE_COPIED,
    PHRASE_LENGTH,
    RELAY_URL_SHAPE,
    DEFAULT_DEVICE_LABEL,
    SETUP_FAILED,
    PHRASE_FAILED,
    PHRASE_FIELD,
    RELAY_FIELD,
    LABEL_FIELD,
    RELAY_PLACEHOLDER,
    PHRASE_PLACEHOLDER,
    SYNCS_TO,
    ...PHRASE_MODES.map((m) => m.label),
    ...RELAY_CHOICES.map((c) => c.label),
    ...Object.values(PROMPTS),
    ...SETUP_ERRORS.map(([, text]) => text),
  ];
}
