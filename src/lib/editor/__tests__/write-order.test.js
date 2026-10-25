// write-order.test.js — one save on the wire at a time.
//
// The module's header has the report: a pin on an Android page orphaned by
// the page's own save, because a pre-stamp save and the stamped save were
// both in flight and the database applied the stamped one first. These
// tests pin the property EditorCore now relies on, at the module boundary
// where it can be driven without an editor: the second send does not
// START until the first has settled, order is send order, and a failure
// in one holds up nothing behind it.
import { describe, it, expect } from "vitest";
import { serialWrites } from "../write-order.js";

/** A promise whose settling the test controls. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function drain() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe("serialWrites", () => {
  it("does not start the second send until the first has settled", async () => {
    // This is the whole bug: with both starts allowed at once, the
    // database could apply them in either order. `started` records the
    // moment each thunk is CALLED, which is the moment a request would
    // leave the device.
    const lane = serialWrites();
    const first = deferred();
    const started = [];
    lane.run(() => { started.push(1); return first.promise; });
    lane.run(() => { started.push(2); return Promise.resolve(); });
    await drain();
    expect(started).toEqual([1]);

    first.resolve();
    await drain();
    expect(started).toEqual([1, 2]);
  });

  it("keeps send order across three writes asked for in one turn", async () => {
    const lane = serialWrites();
    const order = [];
    const gates = [deferred(), deferred(), deferred()];
    for (let i = 0; i < 3; i += 1) {
      lane.run(() => { order.push(`start ${i}`); return gates[i].promise.then(() => order.push(`end ${i}`)); });
    }
    // Resolve out of order to prove the lane, not the gates, decides.
    gates[2].resolve();
    gates[0].resolve();
    await drain();
    gates[1].resolve();
    await drain();
    expect(order).toEqual(["start 0", "end 0", "start 1", "end 1", "start 2", "end 2"]);
  });

  it("hands the caller its own result and its own rejection", async () => {
    // flushSave has a try/catch around its save for a reason; the lane
    // must not swallow what that catch exists to log.
    const lane = serialWrites();
    await expect(lane.run(() => Promise.resolve("saved"))).resolves.toBe("saved");
    await expect(lane.run(() => Promise.reject(new Error("db is gone")))).rejects.toThrow("db is gone");
    await expect(lane.run(() => { throw new Error("sync throw"); })).rejects.toThrow("sync throw");
  });

  it("lets the next write through after a failed one", async () => {
    // A save that failed is a save to retry on the next edit. A lane that
    // stayed blocked behind it would turn one failed IPC into a page that
    // never saves again for the rest of the session.
    const lane = serialWrites();
    const started = [];
    const failing = lane.run(() => { started.push("a"); return Promise.reject(new Error("no")); });
    await expect(failing).rejects.toThrow("no");
    await lane.run(() => { started.push("b"); return Promise.resolve(); });
    expect(started).toEqual(["a", "b"]);
  });

  it("runs a write asked for on an idle lane without waiting on anything else", async () => {
    // Not a "nothing happens" assertion: the send must be called, and
    // called once. An idle lane that held a save for a tick it did not
    // need would be a latency the teardown flush cannot afford.
    const lane = serialWrites();
    let calls = 0;
    await lane.run(() => { calls += 1; });
    expect(calls).toBe(1);
  });
});
