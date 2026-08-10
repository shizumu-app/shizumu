// The dev/VR mock's create_lineage dropped `mode` and `parentId`, so a
// continuous trail was unreachable in VR and in browser dev: Page.svelte
// derives `currentTrailMode = lin?.mode || "discrete"`, and a lineage with
// no `mode` always fell back to discrete. Every continuous-trail surface
// was therefore untestable and unviewable outside the real Tauri backend.
//
// The mock's contract is the Rust command's contract (src-tauri/src/models.rs
// Lineage: id, name, created_at, mode, parent_id; create_lineage defaults
// mode to "discrete" when the caller omits it).
import { describe, it, expect } from "vitest";
import { createMockInvoke } from "../api.js";

describe("mock create_lineage", () => {
  it("preserves the requested mode", async () => {
    const invoke = createMockInvoke();
    const lin = await invoke("create_lineage", {
      name: "the book",
      mode: "continuous",
      parentId: null,
    });
    expect(lin.mode).toBe("continuous");
  });

  it("defaults mode to discrete when omitted, matching the Rust command", async () => {
    const invoke = createMockInvoke();
    const lin = await invoke("create_lineage", { name: "morning pages" });
    expect(lin.mode).toBe("discrete");
  });

  it("preserves parent_id, and uses null rather than undefined when absent", async () => {
    const invoke = createMockInvoke();
    const parent = await invoke("create_lineage", { name: "parent" });
    const child = await invoke("create_lineage", {
      name: "child",
      mode: "discrete",
      parentId: parent.id,
    });
    expect(child.parent_id).toBe(parent.id);

    const orphan = await invoke("create_lineage", { name: "orphan" });
    expect(orphan.parent_id).toBeNull();
  });

  it("returns the same shape the Rust Lineage struct serialises", async () => {
    const invoke = createMockInvoke();
    const lin = await invoke("create_lineage", { name: "x", mode: "continuous" });
    expect(Object.keys(lin).sort()).toEqual(
      ["created_at", "id", "mode", "name", "parent_id"].sort(),
    );
  });

  it("round-trips mode through get_lineages, which is what the UI reads", async () => {
    const invoke = createMockInvoke();
    await invoke("create_lineage", { name: "the book", mode: "continuous" });
    const all = await invoke("get_lineages", {});
    const found = all.find((l) => l.name === "the book");
    expect(found?.mode).toBe("continuous");
  });
});
