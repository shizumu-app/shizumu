import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke, listen, convertFileSrc, getVersion, open, save, message, addPluginListener } from "./tauri-stub.js";

beforeEach(() => {
  globalThis.window = globalThis.window || {};
});
afterEach(() => {
  delete globalThis.window.__DEMO_INVOKE__;
});

describe("invoke", () => {
  it("routes through the demo invoke so interception still applies", async () => {
    const seen = [];
    globalThis.window.__DEMO_INVOKE__ = async (cmd, args) => { seen.push([cmd, args]); return "ok"; };
    expect(await invoke("get_lineages", { a: 1 })).toBe("ok");
    expect(seen).toEqual([["get_lineages", { a: 1 }]]);
  });

  it("resolves null rather than throwing when no demo invoke is installed", async () => {
    // Not a silent swallow: this module only ever loads in a demo build, where
    // the bootstrap installs __DEMO_INVOKE__ before the app mounts. Resolving
    // null keeps a stray early call from turning into an uncaught rejection in
    // front of a visitor.
    expect(await invoke("anything")).toBeNull();
  });
});

describe("listen", () => {
  it("returns an unsubscribe function and never throws", async () => {
    const un = await listen("some-event", () => {});
    expect(typeof un).toBe("function");
    expect(() => un()).not.toThrow();
  });
});

describe("convertFileSrc and getVersion", () => {
  it("hands back the path it was given", () => {
    expect(convertFileSrc("/blob/abc")).toBe("/blob/abc");
  });

  it("reports a version string", async () => {
    expect(typeof await getVersion()).toBe("string");
  });
});

describe("open", () => {
  it("raises the demo notice and picks nothing", async () => {
    const notices = [];
    globalThis.window.__DEMO_NOTICE__ = (t) => notices.push(t);
    // null is what the real dialog returns when a visitor cancels, so every
    // caller already handles it. That is why the notice carries the meaning
    // and the return value stays boring.
    expect(await open()).toBeNull();
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/installed app/);
    delete globalThis.window.__DEMO_NOTICE__;
  });
});

describe("save", () => {
  it("raises the demo notice and picks nothing", async () => {
    const notices = [];
    globalThis.window.__DEMO_NOTICE__ = (t) => notices.push(t);
    // Same shape as open()'s test: null is what the real save dialog
    // returns on cancel, so the notice is what carries the meaning here.
    expect(await save()).toBeNull();
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/installed app/);
    delete globalThis.window.__DEMO_NOTICE__;
  });
});

describe("message", () => {
  it("resolves null and never throws", async () => {
    await expect(message("anything")).resolves.toBeNull();
  });
});

describe("addPluginListener", () => {
  it("resolves an object with an unregister function, so a real plugin's own teardown call never throws", async () => {
    // Never called from app code directly (see the comment on the export) -
    // this exists only so esbuild's dependency pre-bundler can resolve a
    // real Tauri plugin's static import of it. Getting the returned shape
    // wrong would surface as a confusing dev-only failure rather than a
    // clear one, which is exactly why the shape itself is worth pinning.
    const listener = await addPluginListener();
    expect(typeof listener.unregister).toBe("function");
    await expect(listener.unregister()).resolves.toBeUndefined();
  });
});
