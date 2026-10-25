import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";
import SyncSetupScreen from "../SyncSetupScreen.svelte";
import {
  CHANGE_THE_PHRASE,
  COPY_THE_PHRASE,
  HOSTED_RELAY_URL,
  LABEL_FIELD,
  LATER,
  PHRASE_FIELD,
  RELAY_FIELD,
  hostedRelayName,
  setupPrompt,
} from "../sync-setup-model.js";

afterEach(cleanupAll);

const rowFor = (target, label) =>
  [...target.querySelectorAll(".shell-row")].find(
    (r) => r.querySelector(".shell-row-label").textContent.trim() === label,
  );

const fieldFor = (target, label) => target.querySelector(`[aria-label="${label}"]`);

const buttonFor = (target, label) =>
  target.querySelector(`.shell-primary-action [aria-label="${label}"]`);

const segmentFor = (target, label) =>
  [...target.querySelectorAll(".seg-btn")].find((b) => b.textContent.trim() === label);

const PROMPT = '.shell-note[data-tone="ink"]';
const ERROR = '.shell-note[data-tone="warm"]';

function mount(props = {}) {
  return render(SyncSetupScreen, { onBack: () => {}, ...props });
}

describe("SyncSetupScreen — the phrase step", () => {
  it("is pushed, so it draws a back", () => {
    const onBack = vi.fn();
    const { target } = mount({ onBack });
    expect(target.querySelector(".shell-navbar-title").textContent.trim()).toBe("set up");
    target.querySelector(".shell-navbar-back").click();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("shows the generated words and a copy row, and no field, on the new-account side", () => {
    const onCopy = vi.fn();
    const { target } = mount({ step: "phrase", mode: "generate", phrase: "aa bb cc", onCopy });
    expect(target.querySelector(".setup-words").textContent.trim()).toBe("aa bb cc");
    expect(target.querySelector(PROMPT).textContent.trim()).toBe(setupPrompt("phrase:generate"));
    expect(fieldFor(target, PHRASE_FIELD)).toBeNull();
    rowFor(target, COPY_THE_PHRASE).click();
    expect(onCopy).toHaveBeenCalledOnce();
  });

  it("shows no words and no copy row before the phrase exists", () => {
    // Not "nothing happens": an empty mono block is something a writer
    // might copy down as their phrase, and a copy row under it would
    // copy "". The failure sentence is the host's, through `error`.
    const { target } = mount({ step: "phrase", mode: "generate", phrase: "" });
    expect(target.querySelector(".setup-words")).toBeNull();
    expect(rowFor(target, COPY_THE_PHRASE)).toBeUndefined();
  });

  it("says the phrase is being made while it is", () => {
    const { target } = mount({ step: "phrase", mode: "generate", phrase: "", working: true });
    expect(target.querySelector(PROMPT).textContent.trim()).toBe(setupPrompt("phrase:working"));
  });

  it("offers one multiline field on the have-a-phrase side, holding what was typed", () => {
    // One textarea, not an input per word: Field's multiline keeps
    // newlines, and the model collapses them at the count. Twenty-four
    // fields on a phone would be twenty-four keyboard raises.
    const onTyped = vi.fn();
    const { target } = mount({ step: "phrase", mode: "existing", typed: "aa bb", onTyped });
    const field = fieldFor(target, PHRASE_FIELD);
    expect(field.tagName).toBe("TEXTAREA");
    expect(field.value).toBe("aa bb");
    expect(target.querySelector(".setup-words")).toBeNull();
    field.value = "aa bb cc";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onTyped).toHaveBeenCalledWith("aa bb cc");
  });

  it("hands the segment's choice to the host rather than switching itself", () => {
    const onMode = vi.fn();
    const { target } = mount({ step: "phrase", mode: "generate", onMode });
    segmentFor(target, "have a phrase").click();
    expect(onMode).toHaveBeenCalledWith("existing");
  });

  it("puts the error under the words, warm, and sends next to the host", () => {
    const onNext = vi.fn();
    const { target } = mount({
      step: "phrase",
      mode: "existing",
      error: "phrase must be 24 words",
      onNext,
    });
    expect(target.querySelector(ERROR).textContent.trim()).toBe("phrase must be 24 words");
    buttonFor(target, "next").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(onNext).toHaveBeenCalledOnce();
  });
});

describe("SyncSetupScreen — the relay step", () => {
  it("names the destination and asks only for a device name on the hosted choice", () => {
    // Guarded on the constant as the desktop guards its markup: with a
    // hosted relay the url is not the writer's to type, and the screen
    // says where the writing goes instead of hiding it behind the easy
    // path.
    if (!HOSTED_RELAY_URL) return;
    const { target } = mount({ step: "relay", relayChoice: "hosted" });
    expect(target.querySelector(".setup-words").textContent.trim()).toBe(hostedRelayName());
    expect(fieldFor(target, RELAY_FIELD)).toBeNull();
    expect(fieldFor(target, LABEL_FIELD)).not.toBeNull();
    const notes = [...target.querySelectorAll(PROMPT)].map((n) => n.textContent.trim());
    expect(notes).toEqual([setupPrompt("relay"), setupPrompt("relay:hosted")]);
  });

  it("asks for the url on the self-host choice", () => {
    const onRelayUrl = vi.fn();
    const { target } = mount({ step: "relay", relayChoice: "self", relayUrl: "", onRelayUrl });
    const url = fieldFor(target, RELAY_FIELD);
    expect(url).not.toBeNull();
    expect(target.querySelector(".setup-words")).toBeNull();
    url.value = "https://relay.example.com";
    url.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onRelayUrl).toHaveBeenCalledWith("https://relay.example.com");
  });

  it("offers the way back to the words as a row, not as the back", () => {
    // The nav bar's back leaves setup through every door the shell has;
    // a back that meant "previous step" through one door would be the
    // inconsistency the header refuses. So the step back is an action
    // row: accent, no chevron.
    const onChangePhrase = vi.fn();
    const onBack = vi.fn();
    const { target } = mount({ step: "relay", onChangePhrase, onBack });
    const row = rowFor(target, CHANGE_THE_PHRASE);
    expect(row.dataset.kind).toBe("action");
    expect(row.querySelector(".shell-row-chevron")).toBeNull();
    row.click();
    expect(onChangePhrase).toHaveBeenCalledOnce();
    expect(onBack).not.toHaveBeenCalled();
  });

  it("disables connect while working and says so", () => {
    const { target } = mount({ step: "relay", working: true });
    expect(buttonFor(target, "connect").disabled).toBe(true);
    const notes = [...target.querySelectorAll(PROMPT)].map((n) => n.textContent.trim());
    expect(notes).toContain(setupPrompt("relay:working"));
  });

  it("sends connect to the host", () => {
    const onConnect = vi.fn();
    const { target } = mount({ step: "relay", onConnect });
    buttonFor(target, "connect").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(onConnect).toHaveBeenCalledOnce();
  });
});

describe("SyncSetupScreen — the done step", () => {
  it("reads the new state, offers turn on, and offers later as a row", () => {
    const onEnable = vi.fn();
    const onLater = vi.fn();
    const { target } = mount({
      step: "done",
      status: { configured: true, enabled: false },
      onEnable,
      onLater,
    });
    const state = rowFor(target, "sync");
    expect(state.querySelector(".shell-row-value").textContent.trim()).toBe("off");
    expect(state.tagName).not.toBe("BUTTON");
    expect(target.querySelector(PROMPT).textContent.trim()).toBe(setupPrompt("done"));
    buttonFor(target, "turn on").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(onEnable).toHaveBeenCalledOnce();
    rowFor(target, LATER).click();
    expect(onLater).toHaveBeenCalledOnce();
  });

  it("shows nothing of the phrase once enrolled", () => {
    // The words are cleared on enrolment and this step has no display
    // for them: a phrase step's markup leaking into done would show an
    // empty block where a phrase used to be.
    const { target } = mount({ step: "done", phrase: "aa bb", typed: "cc dd" });
    expect(target.querySelector(".setup-words")).toBeNull();
    expect(fieldFor(target, PHRASE_FIELD)).toBeNull();
  });
});

describe("SyncSetupScreen — with no host", () => {
  it("renders every row as inert markup", () => {
    // Gallery's shape: `Row` renders a control only when it has an
    // action, and a screen mounted without callbacks must not promise
    // taps that go nowhere.
    for (const step of ["phrase", "relay", "done"]) {
      const { target } = mount({ step, phrase: "aa", onBack: null });
      expect(
        [...target.querySelectorAll(".shell-row")].every((r) => r.tagName !== "BUTTON"),
        `${step}: a row is a button with no host`,
      ).toBe(true);
    }
  });
});
