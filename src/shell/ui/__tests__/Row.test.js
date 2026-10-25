import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { render, cleanupAll } from "../../../lib/ui/test-helper.js";
import Row from "../Row.svelte";

afterEach(cleanupAll);

describe("Row", () => {
  it("renders its label", () => {
    const { target } = render(Row, { label: "sync" });
    expect(target.querySelector(".shell-row-label").textContent.trim()).toBe("sync");
  });

  it("is a button when it navigates and plain markup when it does not", () => {
    // A row that only displays a value is not interactive, and making it a
    // button would put it in the tab order promising something it cannot do.
    expect(render(Row, { label: "version", value: "0.7.4" }).target.querySelector("button")).toBeNull();
    expect(render(Row, { label: "devices", onSelect: () => {} }).target.querySelector("button")).not.toBeNull();
  });

  it("reports a selection", () => {
    const onSelect = vi.fn();
    const { target } = render(Row, { label: "devices", onSelect });
    target.querySelector("button").click();
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("shows a chevron only for navigation rows", () => {
    expect(render(Row, { label: "devices", onSelect: () => {} }).target.querySelector(".shell-row-chevron")).not.toBeNull();
    expect(render(Row, { label: "version", value: "0.7.4" }).target.querySelector(".shell-row-chevron")).toBeNull();
  });

  it("shows no chevron on a row that acts or chooses, even though it is a button", () => {
    // The defect this prop exists for: `save` on the pin editor had an
    // onSelect, so it rendered `save ›` — the chevron promising a screen
    // a tap never opened. A row that acts (save, insert, continue) or
    // chooses (a tone, a date) is still a real button, still in the tab
    // order, and points nowhere.
    const action = render(Row, { label: "save", onSelect: () => {}, kind: "action" }).target;
    expect(action.querySelector("button")).not.toBeNull();
    expect(action.querySelector(".shell-row-chevron")).toBeNull();
    const choice = render(Row, { label: "cream", value: "in use", onSelect: () => {}, kind: "choice" }).target;
    expect(choice.querySelector("button")).not.toBeNull();
    expect(choice.querySelector(".shell-row-chevron")).toBeNull();
  });

  it("says which kind it is, derived when the caller gave none", () => {
    // data-kind is how a screen's test — and the plan's gate scan — can
    // tell a push from an action without reading the chevron back. The
    // derived cases are the back-compat default: an existing caller with
    // onSelect alone is still a push.
    const kindOf = (props) => render(Row, props).target.querySelector(".shell-row").dataset.kind;
    expect(kindOf({ label: "devices", onSelect: () => {} })).toBe("push");
    expect(kindOf({ label: "version", value: "0.7.4" })).toBe("value");
    expect(kindOf({ label: "yjs", toggle: true })).toBe("toggle");
    expect(kindOf({ label: "delete trail", onSelect: () => {}, destructive: true })).toBe("destructive");
    expect(kindOf({ label: "save", onSelect: () => {}, kind: "action" })).toBe("action");
    expect(kindOf({ label: "cream", onSelect: () => {}, kind: "choice" })).toBe("choice");
  });

  it("carries its tone as data, so an action reads as an offer and a destructive row as a warning", () => {
    const toneOf = (props) => render(Row, props).target.querySelector(".shell-row").dataset.tone;
    expect(toneOf({ label: "save", onSelect: () => {}, kind: "action" })).toBe("accent");
    expect(toneOf({ label: "delete trail", onSelect: () => {}, destructive: true })).toBe("warm");
    expect(toneOf({ label: "devices", onSelect: () => {} })).toBe("ink");
  });

  it("sets the label in prose, keeps the value mono, and draws no line of its own", () => {
    // READ FROM SOURCE, for the reason the value-cap test below gives:
    // jsdom applies no scoped stylesheet, so a Lora label and a mono one
    // render identically here. Three facts held, each an amendment to
    // spec §4's Row line:
    //   - the label is --font-prose: it is the writer's word for the
    //     thing, and the value beside it in --font-ui is the interface's;
    //   - the value stays --font-ui, so the two faces are two voices;
    //   - `.shell-row {…}` has NO border-bottom. The line between rows is
    //     RowGroup's, which knows where its rows begin and end; a row that
    //     underlines itself puts a line under a list of one and rules a
    //     sheet the same as a screen.
    const src = readFileSync("src/shell/ui/Row.svelte", "utf8");
    const label = /\.shell-row-label\s*\{([^}]*)\}/.exec(src);
    expect(label, "no .shell-row-label rule in Row.svelte").toBeTruthy();
    expect(label[1]).toMatch(/font-family:\s*var\(--font-prose\)/);
    const value = /\.shell-row-value\s*\{([^}]*)\}/.exec(src);
    expect(value[1]).toMatch(/font-family:\s*var\(--font-ui\)/);
    const row = /\.shell-row\s*\{([^}]*)\}/.exec(src);
    expect(row, "no .shell-row rule in Row.svelte").toBeTruthy();
    expect(row[1]).not.toMatch(/border-bottom/);
  });

  it("draws an action in the accent and floors the switch at the tap size", () => {
    // Source-read, same wall. The action rule is what makes `save` and
    // `continue` read as offers rather than list items; the switch rule is
    // the 44px floor reaching a control the shell borrows and may not
    // edit — Toggle.svelte's label is 2.75rem square, 38.5px on a phone.
    const src = readFileSync("src/shell/ui/Row.svelte", "utf8");
    const action = /\.shell-row\[data-kind="action"\]\s*\{([^}]*)\}/.exec(src);
    expect(action, 'no .shell-row[data-kind="action"] rule in Row.svelte').toBeTruthy();
    expect(action[1]).toMatch(/color:\s*var\(--warm-accent\)/);
    const toggle = /\.shell-row\s+:global\(\.toggle\)\s*\{([^}]*)\}/.exec(src);
    expect(toggle, "no .shell-row :global(.toggle) rule in Row.svelte").toBeTruthy();
    expect(toggle[1]).toMatch(/min-height:\s*var\(--tap\)/);
    expect(toggle[1]).toMatch(/min-width:\s*var\(--tap\)/);
  });

  it("marks a destructive row for assistive tech as well as colour", () => {
    // Colour alone is not an affordance; the row must say what it is.
    const { target } = render(Row, { label: "delete trail", onSelect: () => {}, destructive: true });
    const button = target.querySelector("button");
    expect(button.classList.contains("destructive")).toBe(true);
    expect(button.dataset.destructive).toBe("true");
  });

  it("caps the value column, so a long value cannot wrap the label", () => {
    // P2f-2's finding, paid in P4 Task 1. A flex item's min-width is
    // `auto` — its MIN-CONTENT width — and a value with no spaces in it
    // has a min-content width of the whole string. So the value refused to
    // shrink and the label, which does carry min-width: 0, absorbed the
    // overflow and wrapped to two lines. Reachable today from
    // TrailIndexScreen and MemoryScreen, whose value column is a
    // user-typed trail name.
    //
    // READ FROM SOURCE, and that limit is the point rather than a
    // shortcut: jsdom applies no scoped Svelte stylesheet and computes no
    // layout, so no rendered assertion can tell a capped column from an
    // uncapped one — the same wall PageScreen.test.js hits holding the
    // page's three left edges, and shell-rules.test.js answers the same
    // way. What this holds is that the four declarations are present;
    // that they LOOK right is the VR gate's to say.
    const src = readFileSync("src/shell/ui/Row.svelte", "utf8");
    const match = /\.shell-row-value\s*\{([^}]*)\}/.exec(src);
    expect(match, "no .shell-row-value rule in Row.svelte").toBeTruthy();
    const decls = match[1];
    // Lets it shrink at all.
    expect(decls).toMatch(/min-width:\s*0/);
    // Stops it shrinking the label first — without it both items shrink in
    // proportion to their base sizes and a long enough value still eats
    // the label's line.
    expect(decls).toMatch(/max-width:\s*50%/);
    // Makes the shrink legible rather than a mid-word cut.
    expect(decls).toMatch(/white-space:\s*nowrap/);
    expect(decls).toMatch(/text-overflow:\s*ellipsis/);
  });
  it("keeps the editor's focus when asked, and still acts on click", () => {
    // The insert sheet's rows: a tap that moved focus blurred the editor
    // and dropped the keyboard (the third device pass). Cancelling
    // pointerdown keeps focus where it is; the click still runs the row.
    const onSelect = vi.fn();
    const { target } = render(Row, { label: "q&a", onSelect, keepFocus: true });
    const row = target.querySelector(".shell-row");
    const down = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
    row.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    row.click();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("leaves pointerdown alone by default", () => {
    // A row in settings has no editor to keep, and a cancelled pointerdown
    // on it would only cost the button its focus ring.
    const { target } = render(Row, { label: "tone", onSelect: vi.fn() });
    const down = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
    target.querySelector(".shell-row").dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
  });
});
