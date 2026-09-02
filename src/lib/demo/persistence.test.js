import { describe, it, expect } from "vitest";
import {
  DEMO_STORAGE_KEY, serialize, parse, shouldRestore, readStored, writeStored,
} from "./persistence.js";

function fakeStorage(initial = {}, { throwOnWrite = null, throwOnRead = null } = {}) {
  const map = { ...initial };
  return {
    getItem(k) { if (throwOnRead) throw throwOnRead; return k in map ? map[k] : null; },
    setItem(k, v) { if (throwOnWrite) throw throwOnWrite; map[k] = v; },
    removeItem(k) { delete map[k]; },
    _map: map,
  };
}

describe("serialize and parse", () => {
  it("round-trips a payload", () => {
    const raw = serialize(3, { pages: [] });
    expect(parse(raw)).toEqual({ seedVersion: 3, data: { pages: [] } });
  });

  it("returns null for unparseable text rather than throwing", () => {
    // Parse errors mean corrupt storage; the caller reseeds and the demo runs fresh.
    expect(parse("{not json")).toBeNull();
  });
});

describe("shouldRestore", () => {
  it("restores a payload from the same seed version", () => {
    expect(shouldRestore({ seedVersion: 3, data: {} }, 3)).toBe(true);
  });

  it("refuses a payload from an older seed version", () => {
    // Shape change means the old store cannot be trusted to load against the new fixture, so the caller reseeds.
    expect(shouldRestore({ seedVersion: 2, data: {} }, 3)).toBe(false);
  });

  it("refuses a payload with no data", () => {
    // Payload is invalid; the caller reseeds.
    expect(shouldRestore({ seedVersion: 3 }, 3)).toBe(false);
  });
});

describe("readStored", () => {
  it("returns the stored data when the version matches", () => {
    const s = fakeStorage({ [DEMO_STORAGE_KEY]: serialize(3, { pins: [1] }) });
    expect(readStored(s, 3)).toEqual({ pins: [1] });
  });

  it("returns null when the stored demo predates a seed bump", () => {
    // Not a failure: a shape change means the old store cannot be trusted to
    // load against the new fixture, so the caller reseeds.
    const s = fakeStorage({ [DEMO_STORAGE_KEY]: serialize(2, { pins: [1] }) });
    expect(readStored(s, 3)).toBeNull();
  });

  it("returns null when the stored value is corrupt", () => {
    // Corrupt data cannot be trusted to load against the fixture, so the caller reseeds.
    const s = fakeStorage({ [DEMO_STORAGE_KEY]: "<<garbage>>" });
    expect(readStored(s, 3)).toBeNull();
  });

  it("returns null when storage itself throws", () => {
    // Private windows and blocked-site-data settings throw on access rather
    // than returning empty. The demo still has to run.
    const s = fakeStorage({}, { throwOnRead: new Error("SecurityError") });
    expect(readStored(s, 3)).toBeNull();
  });

  it("returns null when there is no storage at all", () => {
    // No storage means the caller falls back to memory-only for the session.
    expect(readStored(null, 3)).toBeNull();
  });
});

describe("writeStored", () => {
  it("writes and reports success", () => {
    const s = fakeStorage();
    expect(writeStored(s, 3, { pins: [] })).toBe(true);
    expect(parse(s._map[DEMO_STORAGE_KEY])).toEqual({ seedVersion: 3, data: { pins: [] } });
  });

  it("reports failure instead of throwing when the quota is exceeded", () => {
    // The caller drops to memory-only for the session. A throw here would
    // surface out of a save in the editor, which is the one place the demo
    // must never be seen to break.
    const err = new Error("QuotaExceededError");
    err.name = "QuotaExceededError";
    const s = fakeStorage({}, { throwOnWrite: err });
    expect(writeStored(s, 3, { pins: [] })).toBe(false);
  });
});
