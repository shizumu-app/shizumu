import { describe, it, expect, afterEach } from "vitest";
import { render, cleanupAll } from "./test-helper.js";
import SectionHeader from "./SectionHeader.svelte";

afterEach(cleanupAll);

describe("SectionHeader", () => {
  it("renders label text inside an h3 with aria-level=3", () => {
    const { el } = render(SectionHeader, { label: "today" });
    expect(el.tagName).toBe("H3");
    expect(el.getAttribute("aria-level")).toBe("3");
    expect(el.textContent).toContain("today");
  });

  it("count renders ` · <n>` in the count span", () => {
    const { el } = render(SectionHeader, { label: "today", count: 5 });
    const count = el.querySelector(".count");
    expect(count?.textContent?.replace(/\s+/g, " ").trim()).toBe("· 5");
  });

  it("omits count span when count is undefined", () => {
    const { el } = render(SectionHeader, { label: "today" });
    expect(el.querySelector(".count")).toBeNull();
  });
});
