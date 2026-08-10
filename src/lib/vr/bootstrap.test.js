import { describe, it, expect, afterEach, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  delete window.__VR__;
  delete window.__VR_INVOKE__;
  document.documentElement.removeAttribute("data-tone");
  document.documentElement.removeAttribute("data-vr-state");
  document.documentElement.removeAttribute("data-vr-inset");
});

function setUrl(search) {
  Object.defineProperty(window, "location", {
    value: new URL(`http://localhost/${search}`),
    writable: true,
  });
}

describe("bootstrapVR", () => {
  it("is a no-op without ?vr", async () => {
    setUrl("");
    const { bootstrapVR } = await import("./bootstrap.js");
    await bootstrapVR();
    expect(window.__VR__).toBeUndefined();
    expect(window.__VR_INVOKE__).toBeUndefined();
  });

  it("seeds invoke and config from scene + theme params", async () => {
    setUrl("?vr=1&scene=page-content&theme=dark");
    const { bootstrapVR } = await import("./bootstrap.js");
    await bootstrapVR();
    expect(typeof window.__VR_INVOKE__).toBe("function");
    expect(window.__VR__).toMatchObject({ scene: "page-content", theme: "dark", space: "page" });
    expect(document.documentElement.getAttribute("data-tone")).toBe("dark");
    const today = await window.__VR_INVOKE__("get_or_create_today", {});
    expect(today.page.content_json).toBeTruthy();
  });

  it("leaves state and inset unset when the params are absent", async () => {
    setUrl("?vr=1&scene=page-content");
    const { bootstrapVR } = await import("./bootstrap.js");
    await bootstrapVR();
    expect(window.__VR__).toMatchObject({ state: null, inset: null });
    expect(document.documentElement.hasAttribute("data-vr-state")).toBe(false);
    expect(document.documentElement.hasAttribute("data-vr-inset")).toBe(false);
  });

  it("accepts a state the scene declares", async () => {
    setUrl("?vr=1&scene=page-content&state=keyboard");
    const { bootstrapVR } = await import("./bootstrap.js");
    await bootstrapVR();
    expect(window.__VR__.state).toBe("keyboard");
    expect(document.documentElement.getAttribute("data-vr-state")).toBe("keyboard");
  });

  it("ignores a state the scene does not declare", async () => {
    // page-blank has no interaction states — a typo'd or stale URL must not
    // silently produce a capture named for a state that was never entered.
    // (block-handles is also the state page-content currently withholds; see
    // PENDING_STATES in scenes.js.)
    setUrl("?vr=1&scene=page-blank&state=keyboard");
    const { bootstrapVR } = await import("./bootstrap.js");
    await bootstrapVR();
    expect(window.__VR__.state).toBe(null);
  });

  it("simulates a notch on request, and only on request", async () => {
    setUrl("?vr=1&scene=page-content&inset=notch");
    const { bootstrapVR } = await import("./bootstrap.js");
    await bootstrapVR();
    expect(window.__VR__.inset).toBe("notch");
    expect(document.documentElement.getAttribute("data-vr-inset")).toBe("notch");
  });

  it("ignores an unknown inset value", async () => {
    setUrl("?vr=1&scene=page-content&inset=enormous");
    const { bootstrapVR } = await import("./bootstrap.js");
    await bootstrapVR();
    expect(window.__VR__.inset).toBe(null);
  });
});
