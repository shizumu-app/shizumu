// The shortcuts panel is the only place several bindings are ever named,
// so a wrong row is a wrong feature as far as the user is concerned. Four
// rows shipped wrong for months: `@` described a command that no longer
// exists, the alt row drew ← and → that are bound nowhere, `⌘k` claimed
// the palette unconditionally, and shift+↵ was labelled list-only. These
// assertions are about the TEXT, deliberately — the text is the product.
import { describe, it, expect, afterEach, vi } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";
import ShortcutHelp from "../ShortcutHelp.svelte";

afterEach(() => {
  cleanupAll();
  vi.unstubAllGlobals();
});

const LINUX = { platform: "Linux x86_64", userAgent: "Mozilla/5.0 (X11; Linux x86_64)" };
const MAC = { platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" };

/** Mount, click the `?` toggle, return the open panel. */
async function openPanel(nav = LINUX) {
  vi.stubGlobal("navigator", nav);
  const { target } = render(ShortcutHelp);
  target.querySelector(".help-toggle").click();
  await tick();
  await tick();
  const panel = target.querySelector(".help-panel");
  expect(panel, "clicking ? must open the panel").not.toBeNull();
  return panel;
}

function keyTexts(panel) {
  return [...panel.querySelectorAll(".key")].map((k) => k.textContent);
}

function rowFor(panel, labelText) {
  return [...panel.querySelectorAll(".help-row")].find(
    (r) => r.querySelector(".help-label")?.textContent === labelText,
  );
}

describe("ShortcutHelp — the modifier key", () => {
  it("prints ctrl on Linux", async () => {
    const panel = await openPanel(LINUX);
    const keys = keyTexts(panel);
    expect(keys).toContain("ctrl");
    expect(keys).not.toContain("⌘");
  });

  it("prints ctrl on Windows", async () => {
    const panel = await openPanel({
      platform: "Win32",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    });
    expect(keyTexts(panel)).toContain("ctrl");
    expect(keyTexts(panel)).not.toContain("⌘");
  });

  it("prints ⌘ on macOS", async () => {
    const panel = await openPanel(MAC);
    const keys = keyTexts(panel);
    expect(keys).toContain("⌘");
    expect(keys).not.toContain("ctrl");
  });

  it("labels every mod chord with the same glyph", async () => {
    const panel = await openPanel(LINUX);
    // Nine rows carry the modifier (⌘shift+c, ← →, ↑, ↓, k, comma, p, f, h).
    // A count, not a spot-check: the previous panel hardcoded ⌘ on six of
    // them and left the rest unlabelled, which is how the split survived.
    expect(keyTexts(panel).filter((k) => k === "ctrl").length).toBe(9);
  });
});

describe("ShortcutHelp — the rows that were wrong", () => {
  it("does not describe @ as inserting a subtrail", async () => {
    const panel = await openPanel();
    // mention-command.js offers four item kinds in three sections; the old
    // label named one of them, and named it after a file that is gone.
    expect(panel.textContent).not.toContain("insert subtrail");
    const row = rowFor(panel, "link or start a trail");
    expect(row).toBeTruthy();
    expect(row.querySelector(".help-sub").textContent).toBe(
      "page · pin · subtrail · new trail",
    );
  });

  it("promises only up and down on the alt row", async () => {
    const panel = await openPanel();
    const row = rowFor(panel, "move block, item, or row");
    const keys = [...row.querySelectorAll(".key")].map((k) => k.textContent);
    // block-movement.js binds Alt-ArrowUp/Down only. Alt-ArrowLeft and
    // Alt-ArrowRight are bound NOWHERE in the codebase; the old row drew
    // "↑↓←→" and promised movement that never existed.
    expect(keys).toEqual(["alt", "↑ / ↓"]);
    expect(row.textContent).not.toContain("←");
    expect(row.textContent).not.toContain("→");
  });

  it("names the trail index ahead of the palette on mod+k", async () => {
    const panel = await openPanel();
    // Page.svelte's handleKeydown tries openTrailIndex() first and only
    // falls through to the palette when the doc has no day markers.
    expect(rowFor(panel, "trail index, or command palette")).toBeTruthy();
    expect(panel.textContent).not.toContain("command palette\n");
  });

  it("does not tie shift+enter to list items", async () => {
    const panel = await openPanel();
    // @tiptap/extension-hard-break (bundled by StarterKit, not disabled in
    // shared-extensions.js) binds Shift-Enter everywhere. unified-list.js's
    // own binding is the list case only, and "in same item" read as if the
    // chord did nothing outside a list.
    expect(panel.textContent).not.toContain("new line in same item");
    expect(rowFor(panel, "line break, no new block")).toBeTruthy();
  });

  it("mentions table cells on the tab row", async () => {
    const panel = await openPanel();
    // block-tab-noop.js lets Tab through inside tableCell/tableHeader so
    // the table extension's goToNextCell runs; "indent / outdent list
    // item" was actively wrong inside a table.
    expect(rowFor(panel, "indent a list item, or next cell")).toBeTruthy();
  });

  it("calls settings a toggle", async () => {
    const panel = await openPanel();
    expect(rowFor(panel, "open or close settings")).toBeTruthy();
  });
});

describe("ShortcutHelp — the added rows", () => {
  it("lists the halves that had no partner", async () => {
    const panel = await openPanel();
    for (const label of [
      "copy the block as markdown", // Mod-Shift-c, block-copy-keymap.js
      "find and replace",           // Mod-h, the twin of the listed Mod-f
      "back to the page",           // Mod-ArrowDown, the twin of Mod-ArrowUp
      "in memory: pages · trail map · pins", // Memory.svelte 1/2/3
    ]) {
      expect(rowFor(panel, label), `missing row: ${label}`).toBeTruthy();
    }
  });

  it("gives board titles their own section", async () => {
    const panel = await openPanel();
    const titles = [...panel.querySelectorAll(".help-section-title")].map(
      (t) => t.textContent,
    );
    expect(titles).toEqual(["writing", "blocks", "board titles", "navigation", "pins & find"]);
    expect(rowFor(panel, "from the line above, into the title")).toBeTruthy();
    expect(rowFor(panel, "keep the title, into the body")).toBeTruthy();
  });

  it("stays trimmed", async () => {
    const panel = await openPanel();
    // The panel earns its keep by being scannable. If a row lands here it
    // has to displace one, not extend the list.
    expect(panel.querySelectorAll(".help-row").length).toBe(18);
  });

  it("gives a second line to the two gateway keys only", async () => {
    const panel = await openPanel();
    // Not "nothing happens": every other row is one key doing one thing,
    // and a sub-line on those would flatten the contrast that makes `/`
    // and `@` read as menus.
    const subs = [...panel.querySelectorAll(".help-row")].filter((r) =>
      r.querySelector(".help-sub"),
    );
    expect(subs.length).toBe(2);
    expect(subs.map((r) => r.querySelector(".help-label").textContent)).toEqual([
      "create a block",
      "link or start a trail",
    ]);
  });
});

describe("ShortcutHelp — the toggle", () => {
  it("closes on Escape", async () => {
    const { target } = render(ShortcutHelp);
    target.querySelector(".help-toggle").click();
    await tick();
    expect(target.querySelector(".help-panel")).not.toBeNull();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await tick();
    expect(target.querySelector(".help-panel")).toBeNull();
  });
});
