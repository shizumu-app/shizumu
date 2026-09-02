import { describe, it, expect } from "vitest";
import { resolveInvokeSource } from "./invoke-source.js";

const vr = () => "vr";
const demo = () => "demo";

describe("resolveInvokeSource", () => {
  it("prefers the VR invoke over everything else", () => {
    const r = resolveInvokeSource({ vrInvoke: vr, demoInvoke: demo, isTauri: true });
    expect(r).toEqual({ kind: "vr", invoke: vr });
  });

  it("prefers the demo invoke over a real Tauri runtime", () => {
    // Unreachable in normal operation: the demo bundle is served from the
    // website and never loaded inside the app. Defined anyway, and defined
    // this way round, because the alternative failure is the worse one — a
    // demo bundle writing into somebody's real database.
    const r = resolveInvokeSource({ vrInvoke: null, demoInvoke: demo, isTauri: true });
    expect(r).toEqual({ kind: "demo", invoke: demo });
  });

  it("uses Tauri when no harness invoke is installed", () => {
    const r = resolveInvokeSource({ vrInvoke: null, demoInvoke: null, isTauri: true });
    expect(r).toEqual({ kind: "tauri", invoke: null });
  });

  it("falls back to the in-memory mock outside Tauri", () => {
    const r = resolveInvokeSource({ vrInvoke: null, demoInvoke: null, isTauri: false });
    expect(r).toEqual({ kind: "mock", invoke: null });
  });
});
