import { describe, it, expect, afterEach, vi } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "./test-helper.js";
import Modal from "./Modal.svelte";

afterEach(cleanupAll);

describe("Modal", () => {
  it("renders nothing when open=false", () => {
    const { target } = render(Modal, { open: false });
    expect(target.querySelector(".modal")).toBeNull();
    expect(target.querySelector(".scrim")).toBeNull();
  });

  it("renders modal + scrim with proper ARIA when open=true", async () => {
    const { target } = render(Modal, { open: true, title: "confirm" });
    await tick();
    const modal = target.querySelector(".modal");
    expect(modal).not.toBeNull();
    expect(modal.getAttribute("role")).toBe("dialog");
    expect(modal.getAttribute("aria-modal")).toBe("true");
    expect(modal.getAttribute("aria-labelledby")).toBeTruthy();
    expect(target.querySelector(".scrim")).not.toBeNull();
  });

  it("Escape fires onClose when dismissable", async () => {
    const onClose = vi.fn();
    render(Modal, { open: true, dismissable: true, onClose });
    await tick();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("Escape is ignored when dismissable=false", async () => {
    const onClose = vi.fn();
    render(Modal, { open: true, dismissable: false, onClose });
    await tick();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
