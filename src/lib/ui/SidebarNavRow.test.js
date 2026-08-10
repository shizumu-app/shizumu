import { describe, it, expect, afterEach, vi } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "./test-helper.js";
import SidebarNavRow from "./SidebarNavRow.svelte";

// Minimal Svelte 5 snippet stand-in for text content in tests.
function snippetText(text) {
  return ($$anchor) => {
    const t = document.createTextNode(text);
    $$anchor.before(t);
    return () => t.remove();
  };
}

afterEach(cleanupAll);

describe("SidebarNavRow", () => {
  it("renders default slot content inside the row", () => {
    const { target } = render(SidebarNavRow, {
      children: snippetText("row-label"),
    });
    const row = target.querySelector(".sidebar-nav-row");
    expect(row).not.toBeNull();
    expect(row.textContent).toContain("row-label");
  });

  it("active=true adds .active class to .sidebar-nav-row", () => {
    const { target } = render(SidebarNavRow, {
      active: true,
      children: snippetText("x"),
    });
    const row = target.querySelector(".sidebar-nav-row");
    expect(row.classList.contains("active")).toBe(true);
  });

  it("count prop renders a trailing '· N' element", () => {
    const { target } = render(SidebarNavRow, {
      count: 7,
      children: snippetText("trail"),
    });
    const count = target.querySelector(".sidebar-nav-row .count");
    expect(count).not.toBeNull();
    expect(count.textContent).toContain("·");
    expect(count.textContent).toContain("7");
  });

  it("indent=1.5 applies padding-left: 1.5rem inline", () => {
    const { target } = render(SidebarNavRow, {
      indent: 1.5,
      children: snippetText("x"),
    });
    const row = target.querySelector(".sidebar-nav-row");
    expect(row.style.paddingLeft).toBe("1.5rem");
  });

  it("onClick callback fires when the row is clicked", async () => {
    const onClick = vi.fn();
    const { target } = render(SidebarNavRow, {
      onClick,
      children: snippetText("x"),
    });
    const row = target.querySelector(".sidebar-nav-row");
    row.click();
    await tick();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("accent=true with active=true applies both .accent and .active classes", () => {
    const { target } = render(SidebarNavRow, {
      active: true,
      accent: true,
      children: snippetText("x"),
    });
    const row = target.querySelector(".sidebar-nav-row");
    expect(row.classList.contains("active")).toBe(true);
    expect(row.classList.contains("accent")).toBe(true);
  });
});
