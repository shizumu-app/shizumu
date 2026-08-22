// SyncSettings is large (1300+ lines, a setup + pairing wizard). This
// covers the load-bearing seams: the not-configured surface offers setup,
// the configured surface shows the relay/device, and starting setup
// generates a phrase and advances to the phrase step. All api fns are
// mocked (the factory replaces the whole module).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";

// Built inside vi.hoisted so the (hoisted) vi.mock factory can reference it.
const api = vi.hoisted(() => {
  const m = {
    syncStatus: vi.fn(() => Promise.resolve({ configured: false })),
    syncGeneratePhrase: vi.fn(() => Promise.resolve("word ".repeat(24).trim())),
    getSetting: vi.fn(() => Promise.resolve(null)),
    // Collection/shape-returning fns the configured surface loads in the
    // background — give safe shapes so .filter/.length/.used don't throw.
    listDevices: vi.fn(() => Promise.resolve([])),
    attachmentList: vi.fn(() => Promise.resolve([])),
    attachmentLocalBytes: vi.fn(() => Promise.resolve(0)),
    syncQuota: vi.fn(() => Promise.resolve({ used: 0, limit: 0, blob_count: 0 })),
    opLogStats: vi.fn(() => Promise.resolve({})),
    syncRelayHealth: vi.fn(() => Promise.resolve({})),
    syncAccountEmailStatus: vi.fn(() => Promise.resolve({})),
    syncRedeemLicense: vi.fn(() => Promise.resolve(null)),
    syncSetAccountEmail: vi.fn(() => Promise.resolve(null)),
    syncInit: vi.fn(() => Promise.resolve({ user_id: "u", device_id: "d" })),
    syncRecover: vi.fn(() => Promise.resolve({ user_id: "u", device_id: "d" })),
  };
  // Every remaining imported name defaults to a resolved no-op so the
  // module evaluates and onMount runs without an undefined-call throw.
  for (const name of [
    "syncSelfEnroll", "syncSetEnabled", "syncForcePull", "syncReset",
    "syncSwitchRelay", "revokeDevice", "syncReplayFailed",
    "pairExistingStart", "pairExistingFetchSas", "pairExistingConfirm",
    "pairNewJoin", "pairNewComplete", "setSetting", "attachmentGc",
  ]) {
    m[name] = vi.fn(() => Promise.resolve(null));
  }
  return m;
});
vi.mock("../../lib/api.js", () => api);

// QRCode.toDataURL is called by startPairExisting; stub it so the pairing
// flow advances without a real canvas in jsdom.
vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn(() => Promise.resolve("data:image/png;base64,AAAA")) },
}));

import {
  syncStatus,
  syncGeneratePhrase,
  pairExistingStart,
  pairExistingFetchSas,
  pairExistingConfirm,
  pairNewJoin,
  pairNewComplete,
  listDevices,
  revokeDevice,
  attachmentList,
  attachmentLocalBytes,
  syncQuota,
  syncReset,
  syncRelayHealth,
  syncInit,
  syncRecover,
} from "../../lib/api.js";
import { ATTACHMENT_LOCALITY_NOTE, PIN_RETENTION_NOTE } from "../../lib/attachment-locality.js";
import SyncSettings from "../SyncSettings.svelte";

afterEach(cleanupAll);
beforeEach(() => vi.clearAllMocks());

async function settle() {
  await new Promise((r) => setTimeout(r, 0));
  await tick();
}

// The pairing flow chains several awaited promises (start → fetch_sas →
// state transition); pump the microtask/macrotask queue a few times.
async function settleMany(n = 6) {
  for (let i = 0; i < n; i++) await settle();
}

const byText = (target, sel, text) =>
  [...target.querySelectorAll(sel)].find((el) => el.textContent.trim() === text);

describe("SyncSettings", () => {
  it("offers setup when sync is not configured", async () => {
    syncStatus.mockResolvedValue({ configured: false });
    const { target } = render(SyncSettings, {});
    await settle();
    expect(target.textContent).toContain("new account");
  });

  it("shows the relay when sync is configured", async () => {
    syncStatus.mockResolvedValue({
      configured: true,
      enabled: false,
      relay_url: "https://relay.example",
      device_id: "device-1234567890",
    });
    const { target } = render(SyncSettings, {});
    await settle();
    expect(target.textContent).toContain("relay.example");
  });

  // ===== revoked device =====
  // Task 4 (mobile-stability): the backend flips `revoked: true` in the
  // sync_status DTO once the worker sees a 401 device_revoked and stops
  // ticking. The UI must show the note instead of the normal paired
  // surface, and "pair again" must clear credentials (sync_reset) and
  // land the user in the pairing wizard's join step — never try to
  // resurrect the worker, which has already exited by this point.
  it("shows the revoked note instead of the paired surface, and pair-again clears credentials into the pairing wizard", async () => {
    syncStatus
      .mockResolvedValueOnce({
        configured: true,
        enabled: false,
        revoked: true,
        relay_url: "https://relay.example",
        device_id: "device-1234567890",
      })
      .mockResolvedValueOnce({ configured: false });

    const { target } = render(SyncSettings, {});
    await settle();

    expect(target.textContent).toContain(
      "this device was revoked from the account. its local pages are untouched — syncing has stopped.",
    );
    // The normal paired surface (relay row) must not render underneath.
    expect(target.textContent).not.toContain("relay.example");

    byText(target, "button", "pair again").click();
    await settleMany();

    expect(syncReset).toHaveBeenCalledTimes(1);
    expect(syncStatus).toHaveBeenCalledTimes(2);
    // Lands in the pairing wizard's join-a-new-device entry step.
    expect(target.textContent).toContain(
      'on the existing device, hit "add device" and read the pairing info.',
    );
  });

  // The tab bar stays clickable while the revoked note is showing (it
  // overrides the pane content, not the tabs), so pair-again must not
  // assume the user is still on "account" — it has to reset syncTab
  // itself, or the join wizard renders under a tab whose own
  // status?.configured gate (now false post-reset) shows its
  // "configured under account first" dead-end instead.
  it("pair-again resets the active tab so the join wizard renders even when triggered from a non-account tab", async () => {
    syncStatus
      .mockResolvedValueOnce({
        configured: true,
        enabled: false,
        revoked: true,
        relay_url: "https://relay.example",
        device_id: "device-1234567890",
      })
      .mockResolvedValueOnce({ configured: false });

    const { target } = render(SyncSettings, {});
    await settle();

    byText(target, "button", "devices").click();
    await settle();

    byText(target, "button", "pair again").click();
    await settleMany();

    expect(target.textContent).toContain(
      'on the existing device, hit "add device" and read the pairing info.',
    );
    expect(target.textContent).not.toContain("configured under account first");
  });

  it("generates a phrase and advances to the phrase step on setup", async () => {
    syncStatus.mockResolvedValue({ configured: false });
    const { target } = render(SyncSettings, {});
    await settle();
    byText(target, "button", "generate").click();
    await settle();
    expect(syncGeneratePhrase).toHaveBeenCalledTimes(1);
    expect(target.textContent).toContain("generate new"); // phrase-step UI
  });

  // init creates a fresh account; a phrase the user already has must find
  // the account it belongs to instead — otherwise the relay answers 409
  // and the client has nowhere to route it.
  it("an existing phrase on a multi-user relay recovers instead of creating", async () => {
    syncStatus.mockResolvedValue({ configured: false });
    syncRelayHealth.mockResolvedValueOnce({ mode: "multi_user" });
    const { target } = render(SyncSettings, {});
    await settle();

    // "restore" jumps straight to the phrase step with "i have a phrase"
    // pre-selected (see startRestore).
    byText(target, "button", "restore").click();
    await settle();

    const textarea = target.querySelector("textarea.phrase-input");
    textarea.value = Array(24).fill("abandon").join(" ");
    textarea.dispatchEvent(new Event("input"));
    await settle();

    byText(target, "button", "next").click();
    await settle();

    byText(target, "button", "connect").click();
    await settleMany();

    expect(syncRecover).toHaveBeenCalledTimes(1);
    expect(syncInit).not.toHaveBeenCalled();
  });

  // ===== pairing SAS verification gate =====
  // Security regression: the existing device must NOT wrap/upload the
  // keyring (pairExistingConfirm) until the human confirms the SAS digits
  // match the new device. A malicious relay that substitutes its own
  // ephemeral key is only caught by this human comparison.
  describe("pairing SAS gate", () => {
    const configured = {
      configured: true,
      enabled: true,
      relay_url: "https://relay.example",
      user_id: "user-abc",
      device_id: "device-1234567890",
    };

    async function openExistingPairing(target) {
      byText(target, "button", "devices").click();
      await settle();
      byText(target, "button", "start").click();
      await settleMany();
    }

    it("existing device shows the SAS and does not confirm until the user approves", async () => {
      syncStatus.mockResolvedValue(configured);
      pairExistingStart.mockResolvedValue({
        pair_token: "ember-tide-warm-pine",
        qr_payload: '{"relay":"https://relay.example","uid":"user-abc","tok":"ember-tide-warm-pine"}',
      });
      pairExistingFetchSas.mockResolvedValue({
        sas: "428913",
        ephemeral_pub_b64: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      });

      const { target } = render(SyncSettings, {});
      await settle();
      await openExistingPairing(target);

      // startPairExisting switches to the account tab while the SAS
      // renders in the devices tab — navigate back to verify it.
      byText(target, "button", "devices").click();
      await settle();

      // SAS fetched and displayed, but the keyring is NOT wrapped yet.
      expect(pairExistingFetchSas).toHaveBeenCalled();
      expect(target.textContent).toContain("428913");
      expect(pairExistingConfirm).not.toHaveBeenCalled();

      // User confirms the digits match -> now the bundle is wrapped/uploaded.
      byText(target, "button", "codes match").click();
      await settleMany();
      expect(pairExistingConfirm).toHaveBeenCalledTimes(1);
    });

    it("new device shows the SAS and does not complete until the user approves", async () => {
      syncStatus.mockResolvedValue({ configured: false });
      pairNewJoin.mockResolvedValue({
        sas: "428913",
        user_id: "user-abc",
        relay_url: "https://relay.example",
      });

      const { target } = render(SyncSettings, {});
      await settle();
      // Enter the join flow, fill typed values, join.
      byText(target, "span", "pair")?.click();
      // The "pair" entry is a Chip (span); fall back to clicking by text.
      const pairChip = [...target.querySelectorAll("span, button")].find(
        (el) => el.textContent.trim() === "pair",
      );
      pairChip?.click();
      await settle();

      const inputs = target.querySelectorAll("input.text-input");
      // relay, uid, phrase, label
      if (inputs[0]) { inputs[0].value = "https://relay.example"; inputs[0].dispatchEvent(new Event("input")); }
      if (inputs[1]) { inputs[1].value = "user-abc"; inputs[1].dispatchEvent(new Event("input")); }
      if (inputs[2]) { inputs[2].value = "ember tide warm pine"; inputs[2].dispatchEvent(new Event("input")); }
      await settle();
      byText(target, "button", "join").click();
      await settleMany();

      expect(pairNewJoin).toHaveBeenCalled();
      expect(target.textContent).toContain("428913");
      expect(pairNewComplete).not.toHaveBeenCalled();

      byText(target, "button", "codes match").click();
      await settleMany();
      expect(pairNewComplete).toHaveBeenCalledTimes(1);
    });
  });

  // ===== in-app confirm dialog (revoke) =====
  // Native confirm()/prompt() were replaced with the shared Modal (see
  // findings 3.1). Cover the revoke path: opening the modal must not act,
  // cancel must not call revokeDevice, and confirming both calls
  // revokeDevice and bumps devicesKey so the list re-fetches.
  describe("revoke confirm modal", () => {
    const configured = {
      configured: true,
      enabled: true,
      relay_url: "https://relay.example",
      user_id: "user-abc",
      device_id: "this-device",
    };

    const devices = [
      { id: "this-device", label: "this laptop" },
      { id: "other-device", label: "phone" },
    ];

    async function openDevicesTab(target) {
      byText(target, "button", "devices").click();
      await settle();
    }

    it("opens a modal on revoke without calling revokeDevice yet", async () => {
      syncStatus.mockResolvedValue(configured);
      listDevices.mockResolvedValue(devices);
      const { target } = render(SyncSettings, {});
      await settle();
      await openDevicesTab(target);

      byText(target, "button", "revoke").click();
      await settle();

      const dialog = target.querySelector('[role="dialog"]');
      expect(dialog).toBeTruthy();
      expect(dialog.textContent).toContain('revoke "phone"');
      expect(revokeDevice).not.toHaveBeenCalled();
    });

    it("cancel closes the modal without calling revokeDevice", async () => {
      syncStatus.mockResolvedValue(configured);
      listDevices.mockResolvedValue(devices);
      const { target } = render(SyncSettings, {});
      await settle();
      await openDevicesTab(target);

      byText(target, "button", "revoke").click();
      await settle();

      const dialog = target.querySelector('[role="dialog"]');
      byText(dialog, "button", "cancel").click();
      await settle();

      expect(revokeDevice).not.toHaveBeenCalled();
      expect(target.querySelector('[role="dialog"]')).toBeFalsy();
    });

    it("confirm calls revokeDevice and bumps the devices list key", async () => {
      syncStatus.mockResolvedValue(configured);
      listDevices.mockResolvedValue(devices);
      const { target } = render(SyncSettings, {});
      await settle();
      await openDevicesTab(target);

      const callsBeforeRevoke = listDevices.mock.calls.length;

      byText(target, "button", "revoke").click();
      await settle();

      // Both the row's own "revoke" trigger and the modal's confirm button
      // are labeled "revoke" while the modal is open — scope to the dialog.
      const dialog = target.querySelector('[role="dialog"]');
      byText(dialog, "button", "revoke").click();
      await settleMany();

      expect(revokeDevice).toHaveBeenCalledTimes(1);
      expect(revokeDevice).toHaveBeenCalledWith("other-device");
      // devicesKey bump re-runs fetchDevices(devicesKey) -> listDevices()
      // fires again beyond the initial tab-open fetch.
      expect(listDevices.mock.calls.length).toBeGreaterThan(callsBeforeRevoke);
    });
  });

  describe("storage tab", () => {
    it("labels synced bytes as synced (not used) and shows a separate local total", async () => {
      syncStatus.mockResolvedValue({
        configured: true, enabled: true, relay_url: "https://relay.example", device_id: "device-1",
      });
      syncQuota.mockResolvedValue({ used: 0, cap: 1_000_000_000, tier: "free" });
      attachmentList.mockResolvedValue([
        { blob_hash: "a", filename: "f", size_bytes: 1, sync: false, has_local: true, created_at: "2026-01-01" },
      ]);
      attachmentLocalBytes.mockResolvedValue(50_000_000);

      const { target } = render(SyncSettings, {});
      await settle();
      const storageTabBtn = [...target.querySelectorAll(".sync-tab")]
        .find((b) => b.textContent.trim() === "storage");
      storageTabBtn.click();
      await settleMany();

      expect(byText(target, ".label", "synced")).toBeTruthy();
      expect(byText(target, ".label", "local storage")).toBeTruthy();
      expect(byText(target, ".label", "used")).toBeFalsy();
      // The two numbers measure different things and must not be conflated:
      // 50 MB held locally, 0 B of it authorized to sync. (formatBytes is
      // binary, so 50_000_000 reads as 47.7 MB.)
      expect(target.textContent).toContain("47.7 MB");
      expect(target.textContent).toContain("0 B / 953.7 MB");
    });

    it("names the floor under the sweep and how the bytes are released", async () => {
      syncStatus.mockResolvedValue({
        configured: true, enabled: true, relay_url: "https://relay.example", device_id: "device-1",
      });
      syncQuota.mockResolvedValue({ used: 0, cap: 1_000_000_000, tier: "free" });
      attachmentList.mockResolvedValue([
        { blob_hash: "a", filename: "f", size_bytes: 1, sync: false, has_local: true, created_at: "2026-01-01" },
      ]);
      attachmentLocalBytes.mockResolvedValue(1000);

      const { target } = render(SyncSettings, {});
      await settle();
      [...target.querySelectorAll(".sync-tab")]
        .find((b) => b.textContent.trim() === "storage").click();
      await settleMany();

      // A pinned attachment is a permanent reference on this device (pin
      // caches are frozen), so "gc now" can never reclaim it. Without this
      // line the user meets an unexplained floor and reads it as a bug.
      expect(target.textContent).toContain(
        "a pin keeps its file here — unpinning is what releases the bytes.",
      );
    });

    it("counts the attachments whose bytes are not here", async () => {
      syncStatus.mockResolvedValue({
        configured: true, enabled: true, relay_url: "https://relay.example", device_id: "device-1",
      });
      syncQuota.mockResolvedValue({ used: 0, cap: 1_000_000_000, tier: "free" });
      attachmentList.mockResolvedValue([
        { blob_hash: "a", filename: "f", size_bytes: 1, sync: false, has_local: true, created_at: "2026-01-01" },
        { blob_hash: "b", filename: "g", size_bytes: 2, sync: true, has_local: false, created_at: "2026-01-01" },
        { blob_hash: "c", filename: "h", size_bytes: 3, sync: true, has_local: false, created_at: "2026-01-01" },
      ]);
      attachmentLocalBytes.mockResolvedValue(1);

      const { target } = render(SyncSettings, {});
      await settle();
      [...target.querySelectorAll(".sync-tab")]
        .find((b) => b.textContent.trim() === "storage").click();
      await settleMany();

      expect(target.textContent).toContain("3 files");
      expect(target.textContent).toContain("2 not on this device");
    });

    it("says nothing about locality when every attachment is here", async () => {
      syncStatus.mockResolvedValue({
        configured: true, enabled: true, relay_url: "https://relay.example", device_id: "device-1",
      });
      syncQuota.mockResolvedValue({ used: 0, cap: 1_000_000_000, tier: "free" });
      attachmentList.mockResolvedValue([
        { blob_hash: "a", filename: "f", size_bytes: 1, sync: false, has_local: true, created_at: "2026-01-01" },
      ]);
      attachmentLocalBytes.mockResolvedValue(1);

      const { target } = render(SyncSettings, {});
      await settle();
      [...target.querySelectorAll(".sync-tab")]
        .find((b) => b.textContent.trim() === "storage").click();
      await settleMany();

      // Silence is the correct render here, not a missing feature: "0 not on
      // this device" would be chrome that reports a non-event on every
      // healthy install, which is exactly the noise the panel avoids.
      expect(target.textContent).not.toContain("not on this device");
    });

    it("shows the local-only explainers and gc control even when sync was never configured", async () => {
      // Attachments default to sync = 0, so an unconfigured, single-device
      // install is the population these two lines matter to most: it has
      // no relay copy to fall back on if an unsynced file's blob is swept
      // before it is pinned. They were previously stuck behind the
      // status?.configured gate, so the exact population that needed them
      // could never read them.
      syncStatus.mockResolvedValue({ configured: false });
      attachmentList.mockResolvedValue([
        { blob_hash: "a", filename: "f", size_bytes: 1, sync: false, has_local: true, created_at: "2026-01-01" },
      ]);
      attachmentLocalBytes.mockResolvedValue(1000);

      const { target } = render(SyncSettings, {});
      await settle();
      [...target.querySelectorAll(".sync-tab")]
        .find((b) => b.textContent.trim() === "storage").click();
      await settleMany();

      expect(target.textContent).toContain(ATTACHMENT_LOCALITY_NOTE);
      expect(target.textContent).toContain(PIN_RETENTION_NOTE);
      expect(byText(target, "button", "gc now")).toBeTruthy();
      expect(byText(target, ".label", "local storage")).toBeTruthy();

      // Relay-only figures must stay gated — showing quota/tier/op-log
      // numbers with no relay configured would be worse than the old
      // "configured under account first" placeholder it replaces.
      expect(byText(target, ".label", "synced")).toBeFalsy();
      expect(byText(target, ".label", "tier")).toBeFalsy();
      expect(target.textContent).not.toContain("op log details");
    });
  });
});
