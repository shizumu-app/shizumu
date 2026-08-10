import { describe, it, expect, afterEach } from "vitest";
import { render, cleanupAll } from "./test-helper.js";
import Row from "./Row.svelte";

// Minimal Svelte 5 snippet stand-in for text content in tests.
function snippetText(text) {
  return ($$anchor) => {
    const t = document.createTextNode(text);
    $$anchor.before(t);
    return () => t.remove();
  };
}

afterEach(cleanupAll);

describe("Row", () => {
  it("renders default slot content inside the label area", () => {
    const { target } = render(Row, {
      children: snippetText("my label"),
    });
    const row = target.querySelector(".settings-row");
    expect(row).not.toBeNull();
    expect(row.textContent).toContain("my label");
  });

  it("renders the trailing snippet inside .trailing", () => {
    const { target } = render(Row, {
      children: snippetText("label"),
      trailing: snippetText("right-side"),
    });
    const trailing = target.querySelector(".settings-row .trailing");
    expect(trailing).not.toBeNull();
    expect(trailing.textContent).toContain("right-side");
  });

  it("hidden=true suppresses render entirely", () => {
    const { target } = render(Row, {
      hidden: true,
      children: snippetText("label"),
    });
    expect(target.querySelector(".settings-row")).toBeNull();
  });
});
