/**
 * Parses a pasted blob of pair-device info (relay url / user id / phrase) on
 * the new-device side of the pairing wizard.
 *
 * navigator.clipboard.readText() is unreliable under wry/webkit2gtk, so the
 * paste box is the primary mechanism (not a clipboard-read fallback) — the
 * user pastes whatever they copied on the existing device into a textarea
 * and this module parses it on input. It needs to handle:
 *
 *   - the labeled block "copy pairing info" produces:
 *       relay: <url>
 *       user id: <token>
 *       phrase: <words>
 *   - those three lines in any order
 *   - extra/irregular whitespace, blank lines, missing labels
 *   - a plain unlabeled jumble, using shape as the signal:
 *       relay   = the first http(s):// URL
 *       user id = a uuid (8-4-4-4-12 hex, per the relay spec and the
 *                 uuid::Uuid::parse_str validation on the Rust side —
 *                 src-tauri/src/commands.rs), falling back to any other
 *                 long whitespace-free base64/hex-ish token (16+ chars)
 *                 if no uuid-shaped candidate is present
 *       phrase  = a run of 6+ lowercase words (space- or hyphen-joined)
 *                 OR a bare 64-char hex string — the deployed pair_token
 *                 is 64 hex chars, dash-joined into word-like groups for
 *                 display (pairToken.replace(/-/g, " ")), so either shape
 *                 can show up depending on how the user copies it
 *   - partial input — returns whatever it could find, "" for the rest
 *
 * Shape priority when several candidates are present unlabeled: a uuid is
 * never mistaken for the phrase (it's excluded from the hex-64/word scan),
 * and a bare 64-hex string is treated as the phrase before it's ever
 * considered as a fallback user-id token — user ids are uuid-shaped, not
 * bare hex, so hex-64 should never win user id over phrase.
 */

const LABELED_LINE = /^\s*(relay|user\s*id|uid)\s*[:=]\s*(.+?)\s*$/i;
const PHRASE_LABELED_LINE = /^\s*phrase\s*[:=]\s*(.+?)\s*$/i;
const URL_RE = /https?:\/\/\S+/i;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const HEX64_RE = /\b[0-9a-f]{64}\b/i;
const WORDS_RE = /\b[a-z]{2,}(?:[ \t-]+[a-z]{2,}){5,}\b/;
const TOKEN_RE = /\b[a-zA-Z0-9_-]{16,}\b/;

/**
 * @param {string} text
 * @returns {{ relay: string, userId: string, phrase: string }}
 */
export function parsePairingInfo(text) {
  const result = { relay: "", userId: "", phrase: "" };
  if (!text) return result;

  // Pass 1: labeled lines, tolerant of reordering and missing labels.
  // Matched lines are stripped from the remainder so the shape-based
  // fallback below doesn't re-derive the same value from labeled text.
  let remainder = text;
  for (const line of text.split(/\r?\n/)) {
    const phraseMatch = line.match(PHRASE_LABELED_LINE);
    if (phraseMatch) {
      if (!result.phrase && phraseMatch[1]) result.phrase = phraseMatch[1].trim();
      remainder = remainder.replace(line, "");
      continue;
    }
    const m = line.match(LABELED_LINE);
    if (!m) continue;
    const label = m[1].toLowerCase().replace(/\s+/g, "");
    const value = m[2].trim();
    if (value && (label === "relay") && !result.relay) result.relay = value;
    else if (value && (label === "userid" || label === "uid") && !result.userId) {
      result.userId = value;
    }
    remainder = remainder.replace(line, "");
  }

  // Pass 2: shape-based fallback over whatever wasn't consumed by a label.
  if (!result.relay) {
    const m = remainder.match(URL_RE);
    if (m) result.relay = m[0];
  }
  let scan = remainder;
  if (result.relay) scan = scan.replace(result.relay, "");

  // User id: a uuid is unambiguous and takes priority — it's the only
  // shape real user ids have. Claim it (and remove it from the pool)
  // before the phrase scan runs, so a uuid is never swept up as part of
  // a word-run phrase match.
  let uuidMatch = null;
  if (!result.userId) {
    const m = scan.match(UUID_RE);
    if (m) {
      uuidMatch = m[0];
      result.userId = m[0];
    }
  } else {
    uuidMatch = result.userId;
  }
  if (uuidMatch) scan = scan.replace(uuidMatch, "");

  // Phrase: either a word-run or a bare 64-hex pair_token. Try both and
  // take whichever occurs first, so order in the pasted text doesn't
  // matter. Checked before the generic token fallback below so a lone
  // unlabeled hex-64 (e.g. the tap-to-copy phrase, copied by itself)
  // lands in phrase, not user id.
  if (!result.phrase) {
    const wordsMatch = scan.match(WORDS_RE);
    const hexMatch = scan.match(HEX64_RE);
    if (wordsMatch && hexMatch) {
      result.phrase = (wordsMatch.index <= hexMatch.index ? wordsMatch : hexMatch)[0]
        .trim()
        .replace(/\s+/g, " ");
    } else if (wordsMatch) {
      result.phrase = wordsMatch[0].trim().replace(/\s+/g, " ");
    } else if (hexMatch) {
      result.phrase = hexMatch[0];
    }
  }
  if (result.phrase) scan = scan.replace(result.phrase, "");

  // User id fallback: no uuid was found above, so accept any other long
  // whitespace-free token (legacy/forward-compat shape) — but only after
  // the phrase scan has already claimed a bare hex-64, so hex-64 never
  // ends up here instead.
  if (!result.userId) {
    const m = scan.match(TOKEN_RE);
    if (m) result.userId = m[0];
  }

  return result;
}
