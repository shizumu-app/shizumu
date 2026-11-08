// The wipe clears the op log. An op not yet uploaded goes with it, so the
// danger row says so first and offers to send it (journey insight I49).
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";

const api = vi.hoisted(() => ({
  syncStatus: vi.fn(),
  opLogStats: vi.fn(),
  syncFlushNow: vi.fn(),
  deleteAllData: vi.fn(),
}));
vi.mock("../../lib/api.js", async (orig) => ({ ...(await orig()), ...api }));

import Settings from "../Settings.svelte";

const flush = async () => { for (let i = 0; i < 6; i++) { await Promise.resolve(); await tick(); } };
const on = { configured: true, enabled: true, revoked: false };

async function openConfirm(onDeleteAll = () => {}) {
  const { target } = render(Settings, { currentTone: "cream", onToneChange() {}, onDeleteAll, onClose() {}, initialTab: "danger" });
  await flush();
  const button = (name) => [...target.querySelectorAll("button")].find((b) => b.textContent.trim() === name);
  button("delete").click();
  await flush();
  const input = target.querySelector(".delete-input");
  input.value = "delete";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await flush();
  return { target, button };
}

afterEach(cleanupAll);
beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.syncFlushNow.mockResolvedValue(undefined);
  api.deleteAllData.mockResolvedValue(undefined);
  api.syncStatus.mockResolvedValue(on);
});

describe("delete all writing, with writing still waiting to upload", () => {
  it("everything sent: the plain confirm wipes, with no warning", async () => {
    api.opLogStats.mockResolvedValue({ local_only: 0, pending_upload: 0 });
    const onDeleteAll = vi.fn();
    const { target, button } = await openConfirm(onDeleteAll);
    expect(target.textContent).not.toMatch(/not everything has been sent/);
    button("confirm").click();
    await flush();
    expect(api.deleteAllData).toHaveBeenCalledOnce();
    expect(onDeleteAll).toHaveBeenCalledOnce();
  });

  it("something waiting: says so, and send it first clears the warning once it lands", async () => {
    api.opLogStats.mockResolvedValueOnce({ local_only: 3, pending_upload: 0 }).mockResolvedValue({ local_only: 0, pending_upload: 0 });
    const { target, button } = await openConfirm();
    expect(target.textContent).toMatch(/not reached your other devices/);
    expect(button("confirm")).toBeUndefined();
    button("send it first").click();
    await flush();
    expect(api.syncFlushNow).toHaveBeenCalledOnce();
    expect(target.textContent).not.toMatch(/not everything has been sent/);
    expect(button("confirm")).toBeTruthy();
    expect(api.deleteAllData).not.toHaveBeenCalled();
  });

  it("a send that fails says so, and delete anyway still wipes: an offline laptop is not stuck", async () => {
    api.opLogStats.mockResolvedValue({ local_only: 3, pending_upload: 0 });
    const { target, button } = await openConfirm();
    button("send it first").click();
    await flush();
    expect(target.textContent).toMatch(/could not be sent/);
    button("delete anyway").click();
    await flush();
    expect(api.deleteAllData).toHaveBeenCalledOnce();
  });

  it("writing that starts waiting after the row was drawn stops the plain confirm", async () => {
    api.opLogStats.mockResolvedValueOnce({ local_only: 0, pending_upload: 0 }).mockResolvedValue({ local_only: 1, pending_upload: 0 });
    const { target, button } = await openConfirm();
    button("confirm").click();
    await flush();
    expect(api.deleteAllData).not.toHaveBeenCalled();
    expect(target.textContent).toMatch(/not reached your other devices/);
    expect(button("delete anyway")).toBeTruthy();
  });
});
