import { describe, it, expect, afterEach, vi } from "vitest";

describe("api VR seam", () => {
  afterEach(() => {
    delete window.__VR_INVOKE__;
    delete window.__TAURI_INTERNALS__;
    vi.resetModules();
  });

  it("routes call() through window.__VR_INVOKE__ when present", async () => {
    const spy = vi.fn(async (cmd) => ({ cmd }));
    window.__VR_INVOKE__ = spy;
    const api = await import("../api.js");
    const result = await api.getSetting("canvas_tone");
    expect(spy).toHaveBeenCalled();
    expect(result).toEqual({ cmd: "get_setting" });
  });

  it("exports createMockInvoke", async () => {
    const api = await import("../api.js");
    expect(typeof api.createMockInvoke).toBe("function");
    const invoke = api.createMockInvoke();
    const res = await invoke("get_or_create_today", {});
    expect(res.page).toBeTruthy();
  });
});
