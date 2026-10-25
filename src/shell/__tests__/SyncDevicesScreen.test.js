import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";
import SyncDevicesScreen from "../SyncDevicesScreen.svelte";
import { DISCONNECT, SET_UP_SYNC, THIS_DEVICE, pairRowLabel } from "../sync-model.js";

afterEach(cleanupAll);

const rowLabels = (target) =>
  [...target.querySelectorAll(".shell-row-label")].map((n) => n.textContent.trim());

const rowFor = (target, label) =>
  [...target.querySelectorAll(".shell-row")].find(
    (r) => r.querySelector(".shell-row-label").textContent.trim() === label,
  );

const valueOf = (target, label) =>
  rowFor(target, label)?.querySelector(".shell-row-value")?.textContent.trim() ?? "";

const ON = { configured: true, enabled: true, device_id: "self" };
const REVOKED = { configured: true, enabled: true, revoked: true, device_id: "self" };

function mount(props = {}) {
  return render(SyncDevicesScreen, { onBack: () => {}, nowMs: 0, ...props });
}

describe("SyncDevicesScreen", () => {
  it("is pushed, so it draws a back", () => {
    const onBack = vi.fn();
    const { target } = mount({ onBack });
    expect(target.querySelector(".shell-navbar-title").textContent.trim()).toBe("sync");
    target.querySelector(".shell-navbar-back").click();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("says what sync is doing in the value column, where there is no switch", () => {
    expect(valueOf(mount({ status: { configured: false } }).target, "sync")).toBe("not set up");
    expect(valueOf(mount({ status: REVOKED }).target, "sync")).toBe("revoked");
  });

  it("turns sync on and off on an account", () => {
    // THE DEFECT THIS IS WRITTEN FOR, found on a paired A06: enrolment
    // leaves `enabled` false and only the setup wizard's last step ever
    // set it, so a phone that reached `off` any other way — a cancelled
    // wizard, or being the showing side of a pairing — read `sync off`
    // on an inert row with no control on the screen that could change it.
    const onEnabled = vi.fn();
    const { target } = mount({ status: { ...ON, enabled: false }, onEnabled });
    const box = rowFor(target, "sync").querySelector('input[type="checkbox"]');
    expect(box).not.toBeNull();
    expect(box.checked).toBe(false);
    box.click();
    expect(onEnabled).toHaveBeenCalledWith(true);
  });

  it("draws the switch in the position the backend reports", () => {
    // Derived from the status rather than held beside it, which is what
    // makes a failed write spring the row back instead of leaving a
    // switch in a position nothing took.
    const on = mount({ status: ON }).target;
    expect(on.querySelector('.shell-row input[type="checkbox"]').checked).toBe(true);
  });

  it("leaves the state row inert off-account, and where a switch would lie", () => {
    // about's build row, and its reason: an unconfigured device has no
    // account to sync with, so a switch there could only fail. A revoked
    // one is worse than useless — `enabled` can still be true under the
    // revocation, so the switch would read `on`, flip to `off`, and stop
    // nothing that had not already stopped.
    for (const status of [{ configured: false }, REVOKED]) {
      const { target } = mount({ status });
      expect(rowFor(target, "sync").tagName).not.toBe("BUTTON");
      expect(rowFor(target, "sync").querySelector('input[type="checkbox"]')).toBeNull();
    }
  });

  it("explains the two states one word does not, and adds nothing to the others", () => {
    const { target } = mount({ status: { configured: false } });
    const note = target.querySelector(".shell-note");
    expect(note).not.toBeNull();
    // Under the status group, not inside its body: a caption on the
    // surface, so the group's rule never falls between the word and the
    // sentence explaining it.
    expect(note.closest(".shell-row-group-body")).toBeNull();
    // Not a missing element: "on" is the whole fact, and a sentence
    // repeating it is a band of prose between the reader and the list.
    expect(mount({ status: ON }).target.querySelector(".shell-note")).toBeNull();
  });

  it("lists the devices, marking the one in hand", () => {
    const { target } = mount({
      status: ON,
      nowMs: 3 * 86_400_000,
      devices: [
        { id: "self", label: "phone" },
        { id: "other", label: "laptop", last_seen_ms: 86_400_000 },
      ],
    });
    expect(rowLabels(target)).toEqual(["sync", "phone", "laptop", pairRowLabel("show"), DISCONNECT]);
    expect(valueOf(target, "phone")).toBe(THIS_DEVICE);
    expect(valueOf(target, "laptop")).toBe("seen 2 days ago");
  });

  it("names the status group and the devices group, and leaves the acts unnamed", () => {
    // `status` over the state row, `devices` over the list, the pair row
    // in a flush group with no eyebrow — it is one act, not a list of
    // anything, and a name over it would be a heading for a single button
    // — and, on an account, disconnect in a flush group of its own, last.
    const { target } = mount({ status: ON, devices: [{ id: "other", label: "laptop" }] });
    const groups = [...target.querySelectorAll(".shell-row-group")];
    expect(groups.map((g) => g.querySelector(".shell-eyebrow")?.textContent.trim() ?? "")).toEqual(
      ["status", "devices", "", ""],
    );
    expect(groups[2].classList.contains("flush")).toBe(true);
    expect(groups[3].classList.contains("flush")).toBe(true);
    expect(target.querySelectorAll('[role="separator"]').length).toBe(0);
  });

  it("draws no devices group when there is no list to head", () => {
    // Not "nothing happens": an eyebrow over an empty surface names a
    // list that is not there, and on a device with no account that is
    // the state every reader meets the screen in.
    const { target } = mount({ status: { configured: false } });
    const eyebrows = [...target.querySelectorAll(".shell-eyebrow")].map((e) => e.textContent.trim());
    expect(eyebrows).toEqual(["status"]);
  });

  it("makes the pair row an action: accent, no chevron", () => {
    // Starting a pairing is something this device DOES, not a screen it
    // opens for a chevron to point at (row-kind.js). Without the kind
    // the row has an onSelect and is a push by default, so this is the
    // one prop that decides how the only door in the sync stack reads.
    const { target } = mount({ status: ON, onPair: () => {} });
    const row = rowFor(target, "add a device");
    expect(row.dataset.kind).toBe("action");
    expect(row.querySelector(".shell-row-chevron")).toBeNull();
  });

  it("leaves every device row inert, because this screen offers no revoke", () => {
    // The desktop's row carries one behind a confirmation Modal, and the
    // shell's only overlay is Sheet. A destructive account write with no
    // confirmation is worse than one the phone does not offer — so the
    // rows must not be in the tab order promising an action either.
    const { target } = mount({ status: ON, devices: [{ id: "other", label: "laptop" }] });
    expect(rowFor(target, "laptop").tagName).not.toBe("BUTTON");
  });

  it("tells a list not read yet from an account with no devices", () => {
    // PinsScreen's rule. Showing "no devices" while the round trip is in
    // flight tells someone with three of them that they have none.
    const { target } = mount({ status: ON, loading: true });
    expect(target.textContent).toContain("reading the devices");
  });

  it("names the pair row for the side this device is on", () => {
    // Two acts, not one: adding a device to an account you hold, and
    // putting this device onto one you hold elsewhere.
    const onPair = vi.fn();
    const showing = mount({ status: ON, onPair });
    expect(rowFor(showing.target, "add a device")).toBeTruthy();
    rowFor(showing.target, "add a device").click();
    expect(onPair).toHaveBeenCalledOnce();

    const joining = mount({ status: { configured: false }, onPair });
    expect(rowFor(joining.target, "pair this device")).toBeTruthy();
  });

  it("offers set up sync only off-account", () => {
    // THE REGRESSION THIS SCREEN SHIPPED WITHOUT. On an account the
    // second act must not exist — setup over an account re-keys the
    // device under a second one — and off it, it is the only way onto
    // one for a phone with nothing to pair with.
    const onSetup = vi.fn();
    const off = mount({ status: { configured: false }, onSetup });
    expect(rowLabels(off.target)).toEqual(["sync", "pair this device", SET_UP_SYNC]);
    const row = rowFor(off.target, SET_UP_SYNC);
    expect(row.dataset.kind).toBe("action");
    expect(row.querySelector(".shell-row-chevron")).toBeNull();
    row.click();
    expect(onSetup).toHaveBeenCalledOnce();

    const on = mount({ status: ON, onSetup });
    expect(rowFor(on.target, SET_UP_SYNC)).toBeUndefined();
  });

  it("withholds set up sync while a pairing is in flight", () => {
    // The status that would hide it has not been re-read yet; the model
    // says so (`setupRowShows`), and the screen passes the phase through
    // rather than deciding.
    const { target } = mount({ status: { configured: false }, pairPhase: "working" });
    expect(rowFor(target, SET_UP_SYNC)).toBeUndefined();
  });

  it("offers disconnect last, destructive, and only on an account", () => {
    // Task 9g. The row asks the host; the host's sheet resets. Last and in
    // its own group, so the row that takes the account away is not the
    // one a thumb lands on reaching for `add a device`.
    const onDisconnect = vi.fn();
    const { target } = mount({ status: ON, onDisconnect });
    expect(rowLabels(target).at(-1)).toBe(DISCONNECT);
    const row = rowFor(target, DISCONNECT);
    expect(row.dataset.destructive).toBe("true");
    row.click();
    expect(onDisconnect).toHaveBeenCalledOnce();

    // A revoked phone still holds the account's keys, and this is the way
    // to clear them (disconnectRowShows).
    expect(rowFor(mount({ status: REVOKED }).target, DISCONNECT)).toBeTruthy();
  });

  it("draws no devices group off an account, even when handed a list", () => {
    // The 9g review's race, at the screen: a stale list landing after the
    // disconnect's re-read must not draw a devices group under `not set up`.
    const { target } = mount({
      status: { configured: false },
      devices: [
        { id: "self", label: "phone" },
        { id: "other", label: "laptop" },
      ],
    });
    const eyebrows = [...target.querySelectorAll(".shell-eyebrow")].map((e) => e.textContent.trim());
    expect(eyebrows).toEqual(["status"]);
    expect(rowFor(target, "laptop")).toBeUndefined();
  });

  it("offers no disconnect off an account, nor before the status is read", () => {
    // Not "nothing happens": there is no account to leave, so the row
    // would be a control that resets nothing.
    expect(rowFor(mount({ status: { configured: false } }).target, DISCONNECT)).toBeUndefined();
    expect(rowFor(mount({ status: null }).target, DISCONNECT)).toBeUndefined();
  });

  it("offers the pair row with no host as inert markup", () => {
    // `Row` renders a control only when it has an action, and the gallery
    // mounts screens with no host — this is where that shape is reached.
    const { target } = mount({ status: ON, onPair: null, onBack: null });
    expect(target.querySelectorAll("button").length).toBe(0);
  });
});
