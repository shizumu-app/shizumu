import { describe, it, expect, afterEach } from "vitest";
import { render, cleanupAll } from "./test-helper.js";
import Empty from "./Empty.svelte";

function snippetText(text) {
  return ($$anchor) => {
    const t = document.createTextNode(text);
    $$anchor.before(t);
    return () => t.remove();
  };
}

afterEach(cleanupAll);

describe("Empty", () => {
  it("renders with role=status and aria-live=polite", () => {
    const { el } = render(Empty, {});
    expect(el.getAttribute("role")).toBe("status");
    expect(el.getAttribute("aria-live")).toBe("polite");
  });

  it("renders title and body snippets", () => {
    const { el } = render(Empty, {
      title: snippetText("nothing here"),
      body: snippetText("clear filters to see more."),
    });
    expect(el.querySelector(".empty-title")?.textContent).toContain("nothing here");
    expect(el.querySelector(".empty-body")?.textContent).toContain("clear filters");
  });

  it("hides actions when hasActiveFilters is false", () => {
    const { el } = render(Empty, {
      hasActiveFilters: false,
      actions: snippetText("clear all"),
    });
    expect(el.querySelector(".empty-actions")).toBeNull();
  });

  it("shows actions when hasActiveFilters is true", () => {
    const { el } = render(Empty, {
      hasActiveFilters: true,
      actions: snippetText("clear all"),
    });
    expect(el.querySelector(".empty-actions")?.textContent).toContain("clear all");
  });
});
