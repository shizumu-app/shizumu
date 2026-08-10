import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Tauri API before importing
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("API layer", () => {
  let invoke;

  beforeEach(async () => {
    // Set up Tauri internals flag so api.js uses invoke
    window.__TAURI_INTERNALS__ = true;
    const core = await import("@tauri-apps/api/core");
    invoke = core.invoke;
    invoke.mockReset();
  });

  it("createLineage passes mode and parentId through to the command", async () => {
    invoke.mockResolvedValue({ id: "123", name: "test", created_at: "now", mode: "continuous", parent_id: null });

    const { createLineage } = await import("../api.js");
    await createLineage("test trail", "continuous", "parent-123");

    expect(invoke).toHaveBeenCalledWith("create_lineage", {
      name: "test trail",
      mode: "continuous",
      parentId: "parent-123",
    });
  });

  it("getTrailPages calls correct command", async () => {
    invoke.mockResolvedValue([]);

    const { getTrailPages } = await import("../api.js");
    await getTrailPages("lineage-123");

    expect(invoke).toHaveBeenCalledWith("get_trail_pages", {
      lineageId: "lineage-123",
    });
  });

  it("createLineage defaults mode to discrete and parentId to null", async () => {
    invoke.mockResolvedValue({ id: "456", name: "test", created_at: "now", mode: "discrete", parent_id: null });

    const { createLineage } = await import("../api.js");
    await createLineage("default trail");

    expect(invoke).toHaveBeenCalledWith("create_lineage", {
      name: "default trail",
      mode: "discrete",
      parentId: null,
    });
  });
});
