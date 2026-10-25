import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { mayReplaceWithPulled, isEchoOfPull, pullReload } from "../pull-reload.js";

const A = JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] });
const B = JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a, and more" }] }] });

describe("mayReplaceWithPulled", () => {
  it("shows a change the other device made, when nothing here is waiting to save", () => {
    // What the sync-pulled listener exists for: without it the editor keeps
    // its stale copy and the writer's next save wipes the remote update.
    expect(mayReplaceWithPulled({ pendingSave: false, current: A, incoming: B })).toBe(true);
  });

  it("never replaces typing that has not been saved yet", () => {
    // MEASURED ON A DESKTOP: a sentence typed a moment before a pull was gone
    // from the editor and never reached the database — the pull replaced the
    // editor with the stored copy, which did not have it yet because the
    // save waits one second. The pending save IS the newer edit, the same
    // last-write-wins a page edited on two devices already resolves by, and
    // it lands within the second; replacing the editor first destroys it.
    expect(mayReplaceWithPulled({ pendingSave: true, current: B, incoming: A })).toBe(false);
  });

  it("does nothing when the stored copy is what is already on screen", () => {
    // Not "nothing happens" by accident: setContent on an identical doc still
    // moves the caret and drops focus, which is a cost with no change behind it.
    expect(mayReplaceWithPulled({ pendingSave: false, current: A, incoming: A })).toBe(false);
  });

  it("does nothing with nothing to load", () => {
    // A pull for a page whose row came back empty has nothing to show; an
    // empty doc in its place would erase the screen rather than update it.
    expect(mayReplaceWithPulled({ pendingSave: false, current: A, incoming: "" })).toBe(false);
    expect(mayReplaceWithPulled({ pendingSave: false, current: A, incoming: null })).toBe(false);
  });
});

describe("isEchoOfPull", () => {
  it("skips a save of exactly what the pull left", () => {
    expect(isEchoOfPull({ json: "A", pulled: "A" })).toBe(true);
  });
  it("saves once anything was typed", () => {
    expect(isEchoOfPull({ json: "AB", pulled: "A" })).toBe(false);
  });
  it("saves as always when no pull has landed", () => {
    // null: the editor holds what the writer opened, not a pull.
    expect(isEchoOfPull({ json: "A", pulled: null })).toBe(false);
  });
});

// THE WIRING, read from the editor core (TipTapEditor forwards to it since
// the split): the guard above only protects a page
// if every save path the editor takes asks it, and every way a document
// arrives in the editor records the copy it compares against. On 2026-10-19
// the page-switch flush skipped both: the laptop opened a page whose body had
// not arrived, left it, and saved the empty copy with a newer clock, which
// emptied the phone's writing on both devices (docs/desktop-findings.md).
describe("EditorCore asks isEchoOfPull on every save of a copy it loaded", () => {
  const src = readFileSync(`${process.cwd()}/src/components/editor/EditorCore.svelte`, "utf8");

  it("the page-switch flush skips an untouched page", () => {
    const at = src.indexOf("Flush save for old page BEFORE loading new content");
    expect(at).toBeGreaterThan(-1);
    const flush = src.slice(at, src.indexOf("editor.commands.setContent(content);", at));
    expect(flush).toMatch(/isEchoOfPull\(\{ json, pulled: pulledJson \}\)/);
  });

  it("a page load records the loaded copy instead of clearing it", () => {
    const at = src.indexOf("editor.commands.setContent(content);");
    const after = src.slice(at, at + 400);
    expect(after).toMatch(/pulledJson = JSON\.stringify\(editor\.getJSON\(\)\)/);
    expect(after).not.toMatch(/pulledJson = null;/);
  });

  it("the first mount and every successful save record their copy too", () => {
    expect(src).toMatch(/onDocChange\(editor\.state\.doc\.toJSON\(\)\);\s*\/\/[^\n]*\n(\s*\/\/[^\n]*\n)*\s*pulledJson = JSON\.stringify\(editor\.getJSON\(\)\);/);
    expect(src).toMatch(/await sendSave\(pageId, json, yjsBytes\);\s*pulledJson = json;\s*saveSucceeded\(\);/);
  });
});

// A pull put off for a pending save was meant to show "on the next pull",
// and when the other device had stopped writing there was no next pull: the
// laptop's open page never showed the phone's line (J10.6, J5.3, 25 october).
// So the answer says "deferred", and the host saves and reads again.
describe("pullReload", () => {
  it("applies a different stored copy when nothing is pending", () => {
    expect(pullReload({ pendingSave: false, current: "a", incoming: "b" })).toBe("apply");
  });
  it("is deferred, not dropped, while a save is pending", () => {
    expect(pullReload({ pendingSave: true, current: "a", incoming: "b" })).toBe("deferred");
  });
  it("does nothing for an identical or missing copy", () => {
    // nothing to show: the editor already holds it, or there is no copy
    expect(pullReload({ pendingSave: true, current: "a", incoming: "a" })).toBe("same");
    expect(pullReload({ pendingSave: false, current: "a", incoming: null })).toBe("same");
  });
});

describe("both hosts follow a deferred pull with a save and a second read", () => {
  const read = (f) => readFileSync(`${process.cwd()}/${f}`, "utf8");
  it("EditorCore returns the decision", () => {
    expect(read("src/components/editor/EditorCore.svelte")).toMatch(/const decision = pullReload\(\{ pendingSave: !!saveTimer, current, incoming \}\);\s*if \(decision !== "apply"\) return decision;/);
  });
  it("the desktop page and the phone shell save and read again on deferred", () => {
    expect(read("src/components/Page.svelte")).toMatch(/=== "deferred"[\s\S]{0,200}flushPendingSave/);
    expect(read("src/shell/ShellApp.svelte")).toMatch(/=== "deferred"[\s\S]{0,200}flushPendingSave/);
  });
});
