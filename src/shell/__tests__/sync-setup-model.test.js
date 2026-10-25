import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  CHANGE_THE_PHRASE,
  DEFAULT_DEVICE_LABEL,
  HOSTED_RELAY_URL,
  LATER,
  PHRASE_FAILED,
  PHRASE_LENGTH,
  PHRASE_MODES,
  PHRASE_WORDS,
  RELAY_URL_SHAPE,
  SETUP_FAILED,
  SETUP_STEPS,
  defaultRelayChoice,
  deviceLabelFor,
  everySetupString,
  hostedRelayName,
  normalizePhrase,
  phraseProblem,
  phraseWordCount,
  relayChoices,
  relayProblem,
  relayUrlFor,
  setupErrorText,
  setupNext,
  setupPrompt,
  setupVerb,
} from "../sync-setup-model.js";

const WORDS = Array.from({ length: 24 }, (_, i) => `w${i + 1}`);
const PHRASE = WORDS.join(" ");

describe("the steps", () => {
  it("runs phrase → relay → done and stops there", () => {
    // The desktop wizard's own order. `done` is the end rather than a
    // loop back to `phrase`: after enrolment the words are gone, and a
    // step that showed the phrase display again would show nothing.
    expect(SETUP_STEPS).toEqual(["phrase", "relay", "done"]);
    expect(setupNext("phrase")).toBe("relay");
    expect(setupNext("relay")).toBe("done");
    expect(setupNext("done")).toBe("done");
  });

  it("holds an unknown step where it is", () => {
    // Not an invented step: a step the list does not hold is a typo in
    // the host, and advancing it would hide that behind a screen that
    // renders nothing for a step it does not know.
    expect(setupNext("elsewhere")).toBe("elsewhere");
  });
});

describe("the typed phrase", () => {
  it("lowercases, trims and collapses what a phone keyboard did to it", () => {
    // A keyboard capitalises the first word and autocorrect doubles a
    // space; neither is what the writer meant, and bip39 wants
    // lowercase words one space apart.
    expect(normalizePhrase("  Abandon  ability\nable\tabout ")).toBe(
      "abandon ability able about",
    );
    expect(normalizePhrase("")).toBe("");
    expect(normalizePhrase(null)).toBe("");
  });

  it("counts words after normalising, so a stray newline is not a word", () => {
    expect(phraseWordCount(PHRASE)).toBe(PHRASE_WORDS);
    expect(phraseWordCount(`${PHRASE}\n`)).toBe(PHRASE_WORDS);
    expect(phraseWordCount("")).toBe(0);
  });

  it("stops a 23-word phrase before the api, with the desktop's sentence", () => {
    // THE GUARD THE HOST LEANS ON: `setupNextStep` advances only on "".
    // Twenty-three words is the commonest slip — one skipped while
    // copying from paper — and the backend's answer to it is a bip39
    // parse error naming the checksum, which is not a sentence about
    // counting.
    expect(phraseProblem(WORDS.slice(0, 23).join(" "))).toBe(PHRASE_LENGTH);
    expect(phraseProblem(`${PHRASE} extra`)).toBe(PHRASE_LENGTH);
    expect(phraseProblem("")).toBe(PHRASE_LENGTH);
    expect(phraseProblem(PHRASE)).toBe("");
    expect(PHRASE_LENGTH).toBe("phrase must be 24 words");
  });

  it("offers the two ways in, new account first", () => {
    // New account is the default because it is the path a first device
    // takes, and the one where the app does the work; a kept phrase is
    // the writer's to choose.
    expect(PHRASE_MODES.map((m) => m.value)).toEqual(["generate", "existing"]);
  });
});

describe("the relay", () => {
  it("copies the desktop's hosted relay exactly", () => {
    // `HOSTED_RELAY_URL` is a `const` inside SyncSettings.svelte's
    // script, not an export, and that file is frozen to this tree — so
    // the shell carries a copy, and this is what keeps the copy honest:
    // the desktop's own line, read from its source. Two trees enrolling
    // on two relays is the failure this exists for.
    const desktop = readFileSync("src/components/SyncSettings.svelte", "utf8");
    const declared = /const HOSTED_RELAY_URL = "([^"]*)"/.exec(desktop);
    expect(declared, "the desktop no longer declares HOSTED_RELAY_URL as a string const").not.toBeNull();
    expect(HOSTED_RELAY_URL).toBe(declared[1]);
  });

  it("offers hosted first while a hosted relay exists", () => {
    // Guarded on the constant's truthiness the way the desktop guards
    // its `{#if HOSTED_RELAY_URL}`: emptying it hides the choice and
    // leaves the url field, which is what shipped before the relay was
    // live. Both arms are asserted against the constant as it IS, so
    // the test says which arm it ran.
    if (HOSTED_RELAY_URL) {
      expect(relayChoices().map((c) => c.value)).toEqual(["hosted", "self"]);
      expect(defaultRelayChoice()).toBe("hosted");
    } else {
      expect(relayChoices().map((c) => c.value)).toEqual(["self"]);
      expect(defaultRelayChoice()).toBe("self");
    }
  });

  it("resolves hosted to the constant and self-host to what was typed", () => {
    expect(relayUrlFor("hosted", "https://typed.example")).toBe(
      HOSTED_RELAY_URL || "https://typed.example",
    );
    expect(relayUrlFor("self", "  https://relay.example.com ")).toBe("https://relay.example.com");
    expect(relayUrlFor("self", "")).toBe("");
  });

  it("names the hosted relay without its scheme, the desktop's way", () => {
    expect(hostedRelayName()).toBe(HOSTED_RELAY_URL.replace(/^https?:\/\//, ""));
    expect(hostedRelayName()).not.toMatch(/^https?:/);
  });

  it("refuses a url that is not one, with the desktop's sentence", () => {
    expect(relayProblem("relay.example.com")).toBe(RELAY_URL_SHAPE);
    expect(relayProblem("")).toBe(RELAY_URL_SHAPE);
    expect(relayProblem("http://localhost:8080")).toBe("");
    expect(relayProblem("https://relay.example.com")).toBe("");
  });

  it("names an unnamed device the way the pair path does", () => {
    // One account, one vocabulary: the same literal the host already
    // sends to `pair_new_complete`, and the desktop's default.
    expect(deviceLabelFor("")).toBe(DEFAULT_DEVICE_LABEL);
    expect(deviceLabelFor("   ")).toBe(DEFAULT_DEVICE_LABEL);
    expect(deviceLabelFor(" phone ")).toBe("phone");
    expect(DEFAULT_DEVICE_LABEL).toBe("this device");
  });
});

describe("which command connects", () => {
  it("recovers a kept phrase and inits a new one, on a multi_user relay", () => {
    // THE TWO PATHS MUST NEVER CROSS. `init` with a kept phrase asks the
    // relay to create an account that already exists; `recover` with a
    // fresh phrase asks it to find one that never did. The desktop
    // branches on `phraseMode` here, and so does this.
    expect(setupVerb({ mode: "existing", relayMode: "multi_user" })).toBe("recover");
    expect(setupVerb({ mode: "generate", relayMode: "multi_user" })).toBe("init");
  });

  it("self-enrols on any relay that is not multi_user, whatever the phrase", () => {
    // A single-account relay has no init/recover distinction: the
    // phrase either matches its one account or claims it. The desktop
    // sends every non-multi_user relay to `sync_self_enroll`, including
    // one whose health answered no mode at all.
    expect(setupVerb({ mode: "existing", relayMode: "single" })).toBe("self-enroll");
    expect(setupVerb({ mode: "generate", relayMode: null })).toBe("self-enroll");
    expect(setupVerb({ mode: "generate" })).toBe("self-enroll");
  });
});

describe("setupErrorText", () => {
  it("has a sentence for a wrong phrase, an unreachable relay, and an account already there", () => {
    // The three the brief for this screen named, plus what the relay
    // actually says for each — read off commands.rs and enroll.rs, not
    // guessed from the command names.
    expect(setupErrorText("invalid bip39 phrase: checksum")).toContain("check each one");
    expect(setupErrorText("relay error user_not_found")).toContain("no account matches");
    expect(setupErrorText("can't reach https://x: dns")).toContain("did not answer");
    expect(setupErrorText("relay returned 502")).toContain("did not answer");
    expect(setupErrorText("timed out")).toContain("did not answer");
    expect(setupErrorText("user_sign_pub_already_registered")).toContain("already holds this phrase");
    expect(setupErrorText("relay_already_claimed")).toContain("already has an account");
    expect(setupErrorText("pubkey_mismatch")).toContain("different account");
    expect(setupErrorText("device_limit_reached")).toContain("two devices");
  });

  it("never puts the exception itself on screen", () => {
    // pairErrorText's rule. The raw string is Rust and relay internals;
    // it goes to the console and this is what the screen gets.
    expect(setupErrorText("thread 'main' panicked at src/sync/keys.rs:12")).toBe(SETUP_FAILED);
    expect(setupErrorText(undefined)).toBe(SETUP_FAILED);
    expect(setupErrorText(new Error("blocking task panicked: x"))).toBe(SETUP_FAILED);
  });
});

describe("the words on screen", () => {
  it("has a sentence for every step and mode the screen can be in", () => {
    for (const key of [
      "phrase:generate",
      "phrase:existing",
      "phrase:working",
      "relay",
      "relay:hosted",
      "relay:self",
      "relay:working",
      "done",
      "done:working",
    ]) {
      expect(setupPrompt(key), `${key} says nothing`).toBeTruthy();
    }
  });

  it("says nothing for a key the table does not hold", () => {
    // pairPrompt's rule: an unknown key is a typo in the host, and a
    // sentence invented for it would hide that behind copy that reads
    // fine.
    expect(setupPrompt("relay:elsewhere")).toBe("");
  });

  it("tells the writer what the phrase is for, not what to avoid", () => {
    // The canon: say what happens, never what is forbidden. The generate
    // sentence names what the words are and what to do with them.
    const generate = setupPrompt("phrase:generate");
    expect(generate).toContain("write");
    expect(generate).not.toMatch(/never|don't|do not/);
  });

  it("makes the privacy claim about reading, never about invisibility", () => {
    // CLAUDE.md's precision constraint: the relay sees sizes and timing
    // (docs/threat-model), so "nobody can see your data" is a claim the
    // next page contradicts. "cannot read" is the honest one.
    const hosted = setupPrompt("relay:hosted");
    expect(hosted).toContain("cannot read");
    expect(hosted).toContain("end-to-end encrypted");
    expect(hosted).not.toMatch(/nobody can see|no one can see/);
  });

  it("reuses the desktop's sentences where the desktop has them", () => {
    expect(setupPrompt("relay")).toBe("choose where your encrypted writing syncs.");
    expect(setupPrompt("done")).toBe("connected. turn sync on.");
    expect(setupPrompt("relay:self")).toBe("run your own relay. free, unlimited. your server, your rules.");
  });

  it("spells the rows once each", () => {
    expect(CHANGE_THE_PHRASE).toBe("change the phrase");
    expect(LATER).toBe("later");
    expect(PHRASE_FAILED).toContain("could not make a phrase");
  });

  it("keeps every string on the brand canon", () => {
    // sync-model.test.js's check, over this module's table. Setup is the
    // surface most tempted to warn ("never share this") and to promise
    // ("you'll be able to"), and neither is the register.
    for (const text of everySetupString()) {
      expect(text, `"${text}" carries the retired word`).not.toMatch(
        /\b(sinks?|sinking|sunk)\b/i,
      );
      expect(text, `"${text}" is not lowercase`).toBe(text.toLowerCase());
      expect(text, `"${text}" carries an exclamation mark`).not.toMatch(/!/);
      expect(text, `"${text}" promises the future`).not.toMatch(/you'll|you will|soon/);
      expect(text, `"${text}" lists the absence of a cloud`).not.toMatch(/no cloud|cloudless/);
    }
  });
});
