import { describe, it, expect } from "vitest";
import { parsePairingInfo } from "./pair-info.js";

describe("parsePairingInfo", () => {
  it("returns all-empty for empty/nullish input", () => {
    expect(parsePairingInfo("")).toEqual({ relay: "", userId: "", phrase: "" });
    expect(parsePairingInfo(undefined)).toEqual({ relay: "", userId: "", phrase: "" });
    expect(parsePairingInfo(null)).toEqual({ relay: "", userId: "", phrase: "" });
  });

  it("parses the exact labeled block produced by 'copy pairing info'", () => {
    const block = [
      "relay: https://relay.example.com",
      "user id: 9f3a8b2c7d1e4f5a6b7c8d9e0f1a2b3c",
      "phrase: ember tide warm pine glow moss",
    ].join("\n");
    expect(parsePairingInfo(block)).toEqual({
      relay: "https://relay.example.com",
      userId: "9f3a8b2c7d1e4f5a6b7c8d9e0f1a2b3c",
      phrase: "ember tide warm pine glow moss",
    });
  });

  it("tolerates reordered labeled lines", () => {
    const block = [
      "phrase: ember tide warm pine glow moss",
      "user id: 9f3a8b2c7d1e4f5a6b7c8d9e0f1a2b3c",
      "relay: https://relay.example.com",
    ].join("\n");
    expect(parsePairingInfo(block)).toEqual({
      relay: "https://relay.example.com",
      userId: "9f3a8b2c7d1e4f5a6b7c8d9e0f1a2b3c",
      phrase: "ember tide warm pine glow moss",
    });
  });

  it("tolerates extra whitespace, blank lines, and label case/spacing variants", () => {
    const block = [
      "",
      "  RELAY :   https://relay.example.com   ",
      "",
      "User Id:9f3a8b2c7d1e4f5a6b7c8d9e0f1a2b3c",
      "  phrase   =  ember tide warm pine glow moss  ",
      "",
    ].join("\n");
    expect(parsePairingInfo(block)).toEqual({
      relay: "https://relay.example.com",
      userId: "9f3a8b2c7d1e4f5a6b7c8d9e0f1a2b3c",
      phrase: "ember tide warm pine glow moss",
    });
  });

  it("accepts 'uid' as an alias for user id", () => {
    const block = "relay: https://relay.example.com\nuid: 9f3a8b2c7d1e4f5a6b7c8d9e0f1a2b3c";
    const r = parsePairingInfo(block);
    expect(r.userId).toBe("9f3a8b2c7d1e4f5a6b7c8d9e0f1a2b3c");
  });

  it("parses an unlabeled jumble via shape detection", () => {
    const jumble =
      "url: https://relay.example.com\n" +
      "9f3a8b2c7d1e4f5a6b7c8d9e0f1a2b3c\n" +
      "words: ember tide warm pine glow moss";
    expect(parsePairingInfo(jumble)).toEqual({
      relay: "https://relay.example.com",
      userId: "9f3a8b2c7d1e4f5a6b7c8d9e0f1a2b3c",
      phrase: "ember tide warm pine glow moss",
    });
  });

  it("picks out relay/token/phrase shapes even inside surrounding prose", () => {
    // Shape detection is greedy about lowercase word runs, so it may sweep
    // up adjacent filler words along with the real phrase — that's an
    // accepted tradeoff of a label-free heuristic. It must still find the
    // relay and the token correctly.
    const jumble =
      "here's the info: https://relay.example.com and 9f3a8b2c7d1e4f5a6b7c8d9e0f1a2b3c " +
      "and the phrase is ember tide warm pine glow moss, thanks";
    const r = parsePairingInfo(jumble);
    expect(r.relay).toBe("https://relay.example.com");
    expect(r.userId).toBe("9f3a8b2c7d1e4f5a6b7c8d9e0f1a2b3c");
    expect(r.phrase).toContain("ember tide warm pine glow moss");
  });

  it("parses a hyphen-joined phrase in an unlabeled jumble", () => {
    const jumble = "https://relay.example.com 9f3a8b2c7d1e4f5a6b7c8d9e0f1a2b3c ember-tide-warm-pine-glow-moss";
    const r = parsePairingInfo(jumble);
    expect(r.phrase).toBe("ember-tide-warm-pine-glow-moss");
  });

  it("returns partial info when only the relay is present", () => {
    expect(parsePairingInfo("relay: https://relay.example.com")).toEqual({
      relay: "https://relay.example.com",
      userId: "",
      phrase: "",
    });
  });

  it("returns partial info when only a bare url is pasted", () => {
    expect(parsePairingInfo("https://relay.example.com")).toEqual({
      relay: "https://relay.example.com",
      userId: "",
      phrase: "",
    });
  });

  it("returns partial info when only the phrase is present", () => {
    const r = parsePairingInfo("phrase: ember tide warm pine glow moss");
    expect(r).toEqual({ relay: "", userId: "", phrase: "ember tide warm pine glow moss" });
  });

  it("does not mistake a short (<6) word run for a phrase", () => {
    const r = parsePairingInfo("just four little words");
    expect(r.phrase).toBe("");
  });

  it("does not treat labeled text as also matching the fallback scan", () => {
    // The relay's hostname alone isn't 16+ contiguous token chars, but make
    // sure the labeled user-id line isn't double-counted as a fallback token
    // once already assigned via the label.
    const block = "relay: https://relay.example.com\nuser id: 9f3a8b2c7d1e4f5a6b7c8d9e0f1a2b3c";
    const r = parsePairingInfo(block);
    expect(r.userId).toBe("9f3a8b2c7d1e4f5a6b7c8d9e0f1a2b3c");
    expect(r.relay).toBe("https://relay.example.com");
  });

  it("ignores garbage input with no recognizable shapes", () => {
    expect(parsePairingInfo("hello there, nothing useful here.")).toEqual({
      relay: "",
      userId: "",
      phrase: "",
    });
  });

  // ── real token shapes ──────────────────────────────────────────────
  // Ground truth from the Rust side: user_id is validated with
  // uuid::Uuid::parse_str (src-tauri/src/commands.rs, pair_existing_fetch_sas
  // and friends) so it is always canonical 8-4-4-4-12 hex, never bare hex.
  // pair_token is a 64-char hex string (relay spec,
  // docs/superpowers/specs/2026-05-08-shizumu-relay-spec.md:184) that the UI
  // displays dash-joined into word-like groups
  // (pairToken.replace(/-/g, " ")) — so an unlabeled paste of the phrase can
  // show up as either a bare 64-hex blob or as dash/space-joined "words".
  const UUID = "82069793-5b3b-417d-abb8-7303b81e3dc9";
  const HEX64 =
    "9f3a8b2c7d1e4f5a6b7c8d9e0f1a2b3c9f3a8b2c7d1e4f5a6b7c8d9e0f1a2b3c";

  it("parses a lone unlabeled dash-word phrase", () => {
    const r = parsePairingInfo("ember-tide-warm-pine-glow-moss");
    expect(r).toEqual({ relay: "", userId: "", phrase: "ember-tide-warm-pine-glow-moss" });
  });

  it("parses a lone unlabeled bare 64-hex phrase (the tap-to-copy path) as phrase, not user id", () => {
    const r = parsePairingInfo(HEX64);
    expect(r).toEqual({ relay: "", userId: "", phrase: HEX64 });
  });

  it("routes a uuid + bare 64-hex jumble to userId and phrase respectively", () => {
    // Reproduces the reported bug: previously the uuid-shaped token won
    // the generic 16+-char fallback for userId, and the hex-64 token was
    // silently dropped (phrase stayed empty) because nothing else claimed
    // it and it was never tried as a phrase candidate.
    const jumble = `${UUID}\n${HEX64}`;
    const r = parsePairingInfo(jumble);
    expect(r.userId).toBe(UUID);
    expect(r.phrase).toBe(HEX64);
  });

  it("routes a uuid + word-phrase jumble to userId and phrase respectively", () => {
    const jumble = `${UUID}\nember tide warm pine glow moss`;
    const r = parsePairingInfo(jumble);
    expect(r.userId).toBe(UUID);
    expect(r.phrase).toBe("ember tide warm pine glow moss");
  });

  it("prefers a uuid-shaped candidate for userId over the generic token fallback", () => {
    // A generic 16+ char token and a uuid both appear; the uuid must win,
    // and the generic token must not leak into any field.
    const jumble = `relay: https://relay.example.com\n${UUID}\nsomeRandomToken1234567890`;
    const r = parsePairingInfo(jumble);
    expect(r.userId).toBe(UUID);
  });

  it("parses a labeled 64-hex phrase (label always wins regardless of shape)", () => {
    const block = `relay: https://relay.example.com\nuser id: ${UUID}\nphrase: ${HEX64}`;
    expect(parsePairingInfo(block)).toEqual({
      relay: "https://relay.example.com",
      userId: UUID,
      phrase: HEX64,
    });
  });
});
