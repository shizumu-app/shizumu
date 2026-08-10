import { describe, it, expect, afterEach, vi } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "./test-helper.js";
import SidebarShell from "./SidebarShell.svelte";

// Minimal Svelte 5 snippet stand-in for text content in tests.
function snippetText(text) {
  return ($$anchor) => {
    const t = document.createTextNode(text);
    $$anchor.before(t);
    return () => t.remove();
  };
}

afterEach(cleanupAll);

describe("SidebarShell", () => {
  it("renders sidebar slot and default slot", () => {
    const { target } = render(SidebarShell, {
      sidebarMode: "permanent",
      sidebar: snippetText("sidebar-content"),
      children: snippetText("main-content"),
    });
    expect(target.textContent).toContain("sidebar-content");
    expect(target.textContent).toContain("main-content");
  });

  it("renders toolbar slot above content body when provided", () => {
    const { target } = render(SidebarShell, {
      toolbar: snippetText("toolbar-content"),
      children: snippetText("main"),
    });
    const toolbar = target.querySelector(".shell-toolbar");
    expect(toolbar?.textContent).toContain("toolbar-content");
  });

  it("sets --sidebar-density CSS var to 1 in standard density", () => {
    const { target } = render(SidebarShell, { density: "standard" });
    const shell = target.querySelector(".sidebar-shell");
    expect(shell.style.getPropertyValue("--sidebar-density")).toBe("1");
  });

  it("sets --sidebar-density CSS var to 0.75 in compact density", () => {
    const { target } = render(SidebarShell, { density: "compact" });
    const shell = target.querySelector(".sidebar-shell");
    expect(shell.style.getPropertyValue("--sidebar-density")).toBe("0.75");
  });

  it("applies sidebarWidth prop as inline style", () => {
    const { target } = render(SidebarShell, {
      sidebarWidth: "10rem",
      sidebar: snippetText("s"),
    });
    const aside = target.querySelector(".shell-sidebar");
    expect(aside.style.width).toBe("10rem");
  });

  it("Escape closes the drawer when open", async () => {
    const onDrawerChange = vi.fn();
    const { target } = render(SidebarShell, {
      sidebarMode: "drawer",
      drawerOpen: true,
      onDrawerChange,
      sidebar: snippetText("s"),
      children: snippetText("m"),
    });
    await tick();
    expect(target.querySelector(".sidebar-shell.drawer-open")).not.toBeNull();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await tick();
    expect(onDrawerChange).toHaveBeenCalledWith(false);
    expect(target.querySelector(".sidebar-shell.drawer-open")).toBeNull();
  });

  it("hamburger click toggles the drawer", async () => {
    const onDrawerChange = vi.fn();
    const { target } = render(SidebarShell, {
      sidebarMode: "drawer",
      onDrawerChange,
      sidebar: snippetText("s"),
      toolbar: snippetText("t"),
      children: snippetText("m"),
    });
    await tick();
    const hamburger = target.querySelector(".shell-hamburger");
    expect(hamburger).not.toBeNull();
    expect(target.querySelector(".sidebar-shell.drawer-open")).toBeNull();

    hamburger.click();
    await tick();
    expect(onDrawerChange).toHaveBeenLastCalledWith(true);
    expect(target.querySelector(".sidebar-shell.drawer-open")).not.toBeNull();

    hamburger.click();
    await tick();
    expect(onDrawerChange).toHaveBeenLastCalledWith(false);
    expect(target.querySelector(".sidebar-shell.drawer-open")).toBeNull();
  });

  it("sidebarMode='drawer' applies .is-mobile, 'permanent' does not", async () => {
    const drawer = render(SidebarShell, {
      sidebarMode: "drawer",
      sidebar: snippetText("s"),
    });
    await tick();
    expect(drawer.target.querySelector(".sidebar-shell.is-mobile")).not.toBeNull();

    const permanent = render(SidebarShell, {
      sidebarMode: "permanent",
      sidebar: snippetText("s"),
    });
    await tick();
    expect(permanent.target.querySelector(".sidebar-shell.is-mobile")).toBeNull();
    expect(permanent.target.querySelector(".sidebar-shell")).not.toBeNull();
  });
});
