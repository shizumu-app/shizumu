import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { render, cleanupAll } from "../../../lib/ui/test-helper.js";
import Field from "../Field.svelte";

afterEach(cleanupAll);

describe("Field", () => {
  it("renders an input carrying its label", () => {
    const { target } = render(Field, { label: "trail name" });
    expect(target.querySelector("input").getAttribute("aria-label")).toBe("trail name");
  });

  it("reports what was typed", () => {
    const onInput = vi.fn();
    const { target } = render(Field, { label: "search", onInput });
    const input = target.querySelector("input");
    input.value = "book";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onInput).toHaveBeenCalledWith("book");
  });

  it("offers a clear control only when there is something to clear", () => {
    // The clear control is a ToolbarButton (see Field.svelte's header), so
    // it is found by its aria-label rather than a class that belongs to
    // ToolbarButton, not Field — the more honest assertion is what a user
    // or assistive tech would find, not an implementation-detail selector.
    expect(render(Field, { label: "search", value: "" }).target.querySelector('button[aria-label="clear"]')).toBeNull();
    expect(render(Field, { label: "search", value: "book" }).target.querySelector('button[aria-label="clear"]')).not.toBeNull();
  });

  it("clears to empty and reports it", () => {
    // ToolbarButton acts on pointerdown, not click (see ToolbarButton.svelte
    // and ToolbarButton.test.js) — that is the whole point of using it here,
    // so the clear control keeps the field's focus rather than stealing it.
    const onInput = vi.fn();
    const { target } = render(Field, { label: "search", value: "book", onInput });
    target.querySelector('button[aria-label="clear"]').dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
    expect(onInput).toHaveBeenCalledWith("");
  });

  it("renders its input with the class that carries the 16px floor", () => {
    // What this DOES prove: the input element exists and carries the
    // .shell-field-input class the component's <style> targets.
    //
    // What this does NOT prove: the actual font-size. jsdom does not
    // resolve Svelte's scoped <style>, so reading computed style here would
    // pass regardless of what font-size the CSS declares — this assertion
    // would have been equally green at the 14px this component used to
    // render. The real proof that the input hits the 16px floor is a
    // source-text guard: shell-rules.test.js asserts Field.svelte contains
    // var(--text-input) (max(var(--text-base), 16px), global.css).
    const { target } = render(Field, { label: "search" });
    expect(target.querySelector("input").classList.contains("shell-field-input")).toBe(true);
  });

  it("renders a textarea when the field holds more than a line", () => {
    const { target } = render(Field, { label: "pin text", multiline: true });
    expect(target.querySelector("input")).toBeNull();
    const area = target.querySelector("textarea");
    expect(area.getAttribute("aria-label")).toBe("pin text");
    expect(area.classList.contains("shell-field-input")).toBe(true);
  });

  it("keeps the newlines an input would strip", () => {
    // THE reason the variant exists. <input type="text"> runs the HTML
    // value sanitization algorithm, which removes every CR and LF from an
    // assigned value — so a three-line note pin put into one comes back
    // with its lines run together and a save writes that over the writing
    // the pin kept. jsdom implements the same rule, which is what makes
    // the loss visible here rather than only on a device: swap `multiline`
    // off below and the received value is "onetwo".
    const onInput = vi.fn();
    const { target } = render(Field, { label: "pin text", multiline: true, onInput });
    const area = target.querySelector("textarea");
    area.value = "one\ntwo";
    area.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onInput).toHaveBeenCalledWith("one\ntwo");

    // The contrast, asserted rather than described, so this test fails if
    // jsdom ever stops modelling the sanitization and the claim above
    // quietly becomes untestable.
    const single = render(Field, { label: "pin text", value: "one\ntwo" });
    expect(single.target.querySelector("input").value).toBe("onetwo");
  });

  it("offers no clear control on a multiline field", () => {
    // On a search box a one-tap clear is a convenience; on a note pin's
    // body it is a one-tap wipe of kept writing, under the thumb, with no
    // undo inside the sheet. The desktop's own note textarea has none.
    const { target } = render(Field, {
      label: "pin text",
      multiline: true,
      value: "what the trail is for",
    });
    expect(target.querySelector('button[aria-label="clear"]')).toBeNull();
  });

  it("sets what is typed in prose, and keeps the 16px floor beside it", () => {
    // The shell's type roles (Field.svelte's header): what goes into a
    // field is the writer's — a search, a trail's name, a pin's body — so
    // the input is --font-prose, not the interface face every control
    // label takes. READ FROM SOURCE: jsdom applies no scoped stylesheet
    // (the test above says why). Both declarations are read from the one
    // `.shell-field-input` rule, so a face change that dropped the floor
    // on the way — the defect the rules test exists for — goes red here
    // too, one rule away from the face it came in with.
    const src = readFileSync("src/shell/ui/Field.svelte", "utf8");
    const match = /\.shell-field-input\s*\{([^}]*)\}/.exec(src);
    expect(match, "no .shell-field-input rule in Field.svelte").toBeTruthy();
    expect(match[1]).toMatch(/font-family:\s*var\(--font-prose\)/);
    expect(match[1]).toMatch(/font-size:\s*var\(--text-input\)/);
  });
  it("submits what it holds on Enter, only when asked to", () => {
    // The insert sheet's finder: type, Enter, the first row runs. A field
    // with no onSubmit leaves Enter alone — on the trail sheet it must
    // not be swallowed, and on a textarea it is a line.
    const onSubmit = vi.fn();
    const { target } = render(Field, { label: "find a block", value: "tab", onSubmit });
    const input = target.querySelector("input");
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    input.dispatchEvent(enter);
    expect(onSubmit).toHaveBeenCalledWith("tab");
    expect(enter.defaultPrevented).toBe(true);

    const plain = render(Field, { label: "trail name", value: "x" });
    const untouched = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    plain.target.querySelector("input").dispatchEvent(untouched);
    expect(untouched.defaultPrevented).toBe(false);
  });
});
