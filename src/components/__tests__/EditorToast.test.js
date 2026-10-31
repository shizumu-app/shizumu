import { describe, it, expect, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import EditorToast from "../EditorToast.svelte";

let app, target;
afterEach(() => { if (app) unmount(app); target?.remove(); app = null; });

describe("EditorToast — read aloud, not only shown", () => {
  // Vercel's interface guidelines, 2026-10-31: an async notice needs
  // aria-live. And it has to be the shell Toast's lesson too: a live region
  // inserted already holding its message is announced unreliably, so the
  // region stays mounted and only the band inside it comes and goes.
  it("keeps a polite status region mounted while there is no message", () => {
    target = document.body.appendChild(document.createElement("div"));
    app = mount(EditorToast, { target, props: { message: null } });
    const region = target.querySelector('[role="status"]');
    expect(region).not.toBeNull();
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent.trim()).toBe("");
  });

  it("puts the message inside that region", () => {
    target = document.body.appendChild(document.createElement("div"));
    app = mount(EditorToast, { target, props: { message: "that edit did not save" } });
    flushSync();
    expect(target.querySelector('[role="status"]').textContent).toContain("that edit did not save");
  });
});
