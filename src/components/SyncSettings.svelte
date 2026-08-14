<script>
  import { onMount } from "svelte";
  import QRCode from "qrcode";
  import {
    syncGeneratePhrase,
    syncRevealPhrase,
    syncSelfEnroll,
    syncSetEnabled,
    syncStatus,
    syncForcePull,
    syncReset,
    syncSwitchRelay,
    listDevices,
    revokeDevice,
    opLogStats,
    syncReplayFailed,
    pairExistingStart,
    pairExistingFetchSas,
    pairExistingConfirm,
    pairNewJoin,
    pairNewComplete,
    getSetting,
    setSetting,
    syncQuota,
    syncRelayHealth,
    syncInit,
    attachmentList,
    attachmentGc,
    attachmentLocalBytes,
    syncSetAccountEmail,
    syncAccountEmailStatus,
    syncRedeemLicense,
  } from "../lib/api.js";
  import Row from "../lib/ui/Row.svelte";
  import Button from "../lib/ui/Button.svelte";
  import Chip from "../lib/ui/Chip.svelte";
  import Toggle from "../lib/ui/Toggle.svelte";
  import SegmentedControl from "../lib/ui/SegmentedControl.svelte";
  import Modal from "../lib/ui/Modal.svelte";
  import Input from "../lib/ui/Input.svelte";
  import QrScanner from "./QrScanner.svelte";
  import { parsePairingInfo } from "../lib/pair-info.js";
  import {
    awayCount,
    AWAY_LABEL,
    ATTACHMENT_LOCALITY_NOTE,
    PIN_RETENTION_NOTE,
  } from "../lib/attachment-locality.js";

  // Tap-to-copy helper for phrase / SAS / meta-value displays. The phone
  // user can't easily select text from a long mono block; a single tap
  // beats a long-press + select handle dance every time.
  let copyToast = $state("");
  async function copyToClipboard(text, label = "copied") {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      copyToast = label;
      setTimeout(() => {
        copyToast = "";
      }, 1500);
    } catch (err) {
      console.warn("clipboard failed", err);
    }
  }

  // status snapshot from the rust side; null while loading.
  let status = $state(/** @type {null | object} */ (null));
  let loading = $state(true);

  // active settings tab inside the sync surface. defaults to account so the
  // setup/pair flow lands the user on the right pane on first open.
  let syncTab = $state(/** @type {"account"|"devices"|"timing"|"mobile"|"storage"} */ ("account"));

  // setup wizard step machine.
  // 'idle' = show top-level "set up" or status block;
  // 'phrase' = generate or enter recovery phrase;
  // 'relay'  = relay URL + device label + connect;
  // 'done'   = post-enroll confirmation + enable prompt.
  let step = $state("idle");

  let phrase = $state("");
  let relayUrl = $state("");
  let deviceLabel = $state("");
  let working = $state(false);
  // The hosted relay we run for users — makes "we host it for you" the easy
  // default at setup, with self-host as the power path. Set to "" to hide the
  // hosted option (falls back to manual relay url) until the hosted relay is live.
  // The hosted relay. Setting this makes "hosted" the default choice and
  // pre-fills the url, so turning sync on is one tap; "self-host" swaps to an
  // empty field for anyone running their own. Set to "" to hide the hosted
  // option entirely and require a url — which is what shipped before the
  // relay was live.
  const HOSTED_RELAY_URL = "https://relay.shizumu.app";
  let relayChoice = $state("hosted"); // 'hosted' | 'self'
  let errorMsg = $state("");
  // Set when pairing a new device hits the free-tier device limit, so the
  // pairing error can offer an upgrade (move #1 — the device-N paywall moment).
  let deviceLimitHit = $state(false);

  // "generate" or "existing" phrase mode within the phrase step.
  let phraseMode = $state(/** @type {"generate" | "existing"} */ ("generate"));
  let existingPhrase = $state("");
  // Re-revealed recovery phrase (configured devices), so a user who lost their
  // written copy can save it again. phraseHasNone = a paired device with no phrase.
  let revealedPhrase = $state(/** @type {string | null} */ (null));
  let phraseHasNone = $state(false);

  // pairing wizard state — separate from the self-enroll setup wizard.
  // pairStep walks through the QR / SAS verification sequence.
  // none = inactive; the other values follow the two device paths.
  let pairStep = $state(
    /** @type {"none" | "existing_qr" | "existing_sas" | "new_input" | "new_sas" | "new_done"} */ (
      "none"
    ),
  );
  let pairToken = $state("");
  let pairQr = $state(""); // JSON payload string
  let pairSas = $state("");
  let pairEphemeralPub = $state("");
  let pairNewLabel = $state("");
  // "type" or "scan" within the new-device join path.
  let newDeviceInputMode = $state(/** @type {"type" | "scan"} */ ("type"));
  let typedRelay = $state("");
  let typedUid = $state("");
  let typedPhrase = $state("");
  // Paste box for the pairing-info block copied from the existing device.
  // navigator.clipboard.readText() is unreliable under wry/webkit2gtk, so
  // this paste-and-parse box is the primary path, not a fallback behind a
  // clipboard-read button.
  let pastedPairingInfo = $state("");
  let qrSvgDataUrl = $state("");
  // Bundle reused across pair_new_join and the background pair_new_complete poll.
  let pairBundleForJoin = $state("");

  // Mobile-awareness settings. These are surfaced now so the toggle
  // lives in one place even though the worker doesn't yet honour them.
  // See worker.rs TODO and docs/v0.4-sync-mobile.md — gating wires in
  // 0.4.1 (NetworkManager / UPower D-Bus on Linux mobile, dedicated
  // plugins on iOS/Android). Persisting the user's preference now means
  // 0.4.1 doesn't require a second pass through onboarding.
  let pauseOnMetered = $state(false);
  let batteryThreshold = $state(15);
  let saveDebounceMs = $state(2000);

  async function loadMobileSettings() {
    try {
      const m = await getSetting("sync_pause_on_metered");
      pauseOnMetered = m === "true";
      const bt = await getSetting("sync_battery_threshold");
      if (bt != null && bt !== "") {
        const n = parseInt(bt, 10);
        if (!Number.isNaN(n)) batteryThreshold = n;
      }
      const sd = await getSetting("sync_save_debounce_ms");
      if (sd != null && sd !== "") {
        const n = parseInt(sd, 10);
        if (!Number.isNaN(n)) saveDebounceMs = n;
      }
    } catch {
      // Settings table read failure is non-fatal — defaults stand.
    }
  }

  async function updatePauseOnMetered(v) {
    pauseOnMetered = !!v;
    try {
      await setSetting("sync_pause_on_metered", pauseOnMetered ? "true" : "false");
    } catch (e) {
      console.warn("save pause-on-metered failed", e);
    }
  }

  async function updateBatteryThreshold(v) {
    const n = Math.max(0, Math.min(100, parseInt(v, 10) || 0));
    batteryThreshold = n;
    try {
      await setSetting("sync_battery_threshold", String(n));
    } catch (e) {
      console.warn("save battery-threshold failed", e);
    }
  }

  async function updateSaveDebounce(v) {
    // Clamp 0..10000ms — below ~500ms slash-commands race, above 10s
    // feels broken. 0 = upload immediately (old behavior).
    const n = Math.max(0, Math.min(10000, parseInt(v, 10) || 0));
    saveDebounceMs = n;
    try {
      await setSetting("sync_save_debounce_ms", String(n));
    } catch (e) {
      console.warn("save sync-debounce failed", e);
    }
  }

  // web access — email linking form state.
  let webEmail = $state("");
  let webPassword = $state("");
  let webWorking = $state(false);
  let webError = $state("");
  let webSuccess = $state("");
  // bump to force the email-status {#await} block to re-fetch after a
  // successful set_email call — same key-bump trick as statsKey below.
  let emailStatusKey = $state(0);
  function emailStatusFetch(_key) {
    return syncAccountEmailStatus();
  }

  async function handleSetEmail() {
    webError = "";
    webSuccess = "";
    const emailVal = webEmail.trim();
    const passwordVal = webPassword;
    if (!emailVal || !passwordVal) {
      webError = "enter an email and password.";
      return;
    }
    webWorking = true;
    try {
      await syncSetAccountEmail(emailVal, passwordVal);
      webEmail = "";
      webPassword = "";
      emailStatusKey += 1;
      webSuccess = "verification sent. check your inbox.";
    } catch (e) {
      const code = String(e).trim();
      if (code === "email_unavailable") {
        webError = "email unavailable.";
      } else if (code === "bad_password") {
        webError = "password too short (8 minimum).";
      } else if (code === "bad_email") {
        webError = "not an email address.";
      } else if (code === "mail_failed") {
        webError = "could not send the email. try again.";
      } else {
        webError = "something failed. try again.";
      }
    } finally {
      webWorking = false;
    }
  }

  // license key redemption form state.
  let redeemKey = $state("");
  let redeemWorking = $state(false);
  let redeemError = $state("");
  let redeemSuccess = $state("");

  async function handleRedeem() {
    redeemError = "";
    redeemSuccess = "";
    const key = redeemKey.trim();
    if (!key) {
      redeemError = "enter a license key.";
      return;
    }
    redeemWorking = true;
    try {
      await syncRedeemLicense(key);
      redeemKey = "";
      redeemSuccess = "license active.";
      // re-fetch the quota display to reflect the new tier.
      attachmentsKey += 1;
    } catch (e) {
      const code = String(e).trim();
      if (code === "unknown_key") {
        redeemError = "key not found.";
      } else if (code === "already_bound") {
        redeemError = "key already in use.";
      } else if (code === "inactive") {
        redeemError = "subscription not active.";
      } else {
        redeemError = `failed: ${code}`;
      }
    } finally {
      redeemWorking = false;
    }
  }

  async function openPricing() {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl("https://shizumu.app/pricing");
    } catch {
      // fallback for browser-dev or if the plugin is unavailable.
      window.open("https://shizumu.app/pricing", "_blank", "noopener");
    }
  }

  // bump to force the op-log-stats {#await} block to re-fetch after
  // a replay-failed run. svelte re-evaluates the promise expression
  // whenever a reactive read inside it changes.
  let statsKey = $state(0);
  function fetchStats(_key) {
    return opLogStats();
  }

  // bump to force the devices-list {#await} block to re-fetch after a
  // revoke — same key-bump trick as statsKey above. without it the list
  // keeps showing the just-revoked device until the whole pane remounts.
  let devicesKey = $state(0);
  function fetchDevices(_key) {
    return listDevices();
  }

  async function handleReplayFailed() {
    errorMsg = "";
    working = true;
    try {
      await syncReplayFailed();
      statsKey += 1;
    } catch (e) {
      errorMsg = String(e);
    } finally {
      working = false;
    }
  }

  // Human-readable byte formatter for the storage panel. `null` (no
  // cap) is handled by the caller; here we only format known sizes.
  function formatBytes(n) {
    if (n == null) return "—";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  // Bump to force the storage panel's {#await} blocks to re-fetch
  // after a gc run — same trick as statsKey for the op-log details.
  let attachmentsKey = $state(0);
  function quotaFetch(_key) {
    return syncQuota();
  }
  function attachmentsFetch(_key) {
    return attachmentList();
  }
  // What this device is holding — a different measurement from the relay's
  // synced total, so it gets its own row rather than sharing one label.
  function localBytesFetch(_key) {
    return attachmentLocalBytes();
  }

  async function handleGc() {
    errorMsg = "";
    working = true;
    try {
      await attachmentGc();
      attachmentsKey += 1;
    } catch (e) {
      errorMsg = String(e);
    } finally {
      working = false;
    }
  }

  onMount(async () => {
    await refresh();
    await loadMobileSettings();
  });

  async function refresh() {
    loading = true;
    try {
      status = await syncStatus();
    } catch (e) {
      errorMsg = String(e);
    } finally {
      loading = false;
    }
  }

  async function startSetup() {
    errorMsg = "";
    phraseMode = "generate";
    working = true;
    try {
      phrase = await syncGeneratePhrase();
      step = "phrase";
    } catch (e) {
      errorMsg = String(e);
    } finally {
      working = false;
    }
  }

  // Restore an existing account on this device straight from the saved
  // recovery phrase — no other device, no co-location needed (the path for
  // "my phone is nowhere near my main device"). Jumps to the phrase step with
  // the "i have a phrase" mode pre-selected, then relay url, then pull.
  function startRestore() {
    errorMsg = "";
    cancelWizard();
    phraseMode = "existing";
    existingPhrase = "";
    step = "phrase";
  }

  // Re-reveal this device's recovery phrase so the user can save it again.
  async function revealPhrase() {
    errorMsg = "";
    try {
      const words = await syncRevealPhrase();
      revealedPhrase = words || null;
      phraseHasNone = !words;
    } catch (e) {
      errorMsg = String(e);
    }
  }
  function hidePhrase() {
    revealedPhrase = null;
    phraseHasNone = false;
  }

  function continueToRelay() {
    errorMsg = "";
    if (phraseMode === "existing") {
      const trimmed = existingPhrase.trim();
      if (trimmed.split(/\s+/).length !== 24) {
        errorMsg = "phrase must be 24 words";
        return;
      }
      phrase = trimmed;
    }
    step = "relay";
    // Default to hosted (the easy path) when we offer it; else manual url.
    relayChoice = HOSTED_RELAY_URL ? "hosted" : "self";
    relayUrl = relayChoice === "hosted" ? HOSTED_RELAY_URL : "";
  }

  async function connect() {
    errorMsg = "";
    const url = relayUrl.trim();
    if (!url.startsWith("http")) {
      errorMsg = "relay url must start with http:// or https://";
      return;
    }
    working = true;
    try {
      // Preflight: confirm the relay is reachable before persisting keys.
      // Goes through the Tauri command (reqwest) to bypass CORS — the
      // webview's tauri://localhost origin would otherwise be rejected
      // by relays that don't set Access-Control-Allow-Origin.
      let relayInfo;
      try {
        relayInfo = await syncRelayHealth(url);
      } catch (e) {
        errorMsg = String(e);
        working = false;
        return;
      }
      console.log("connecting to relay", relayInfo);
      const mode = relayInfo?.mode;
      if (mode === "multi_user") {
        await syncInit(phrase, url, deviceLabel.trim() || "this device");
      } else {
        await syncSelfEnroll(phrase, url, deviceLabel.trim() || "this device");
      }
      phrase = "";
      existingPhrase = "";
      step = "done";
      await refresh();
    } catch (e) {
      const msg = String(e);
      if (msg.includes("pubkey_mismatch")) {
        errorMsg = "a different account owns this relay. check the phrase or relay url.";
      } else {
        errorMsg = msg;
      }
    } finally {
      working = false;
    }
  }

  async function enable() {
    errorMsg = "";
    working = true;
    try {
      await syncSetEnabled(true);
      const wasExisting = phraseMode === "existing";
      await refresh();
      step = "idle";
      if (wasExisting) {
        syncForcePull()
          .then(() => refresh())
          .catch((err) => console.warn("force-pull after recovery failed:", err));
      }
    } catch (e) {
      errorMsg = String(e);
    } finally {
      working = false;
    }
  }

  async function disable() {
    errorMsg = "";
    working = true;
    try {
      await syncSetEnabled(false);
      await refresh();
    } catch (e) {
      errorMsg = String(e);
    } finally {
      working = false;
    }
  }

  // In-app confirm dialog state — replaces native confirm()/prompt() for the
  // three destructive/parameterized sync actions below (disconnect, revoke,
  // switch relay). `confirmKind` picks which body the shared Modal renders;
  // switch-relay is the only one that needs a text field, so it gets its
  // own two-step kind (collect the url, then confirm) mirroring the old
  // prompt()-then-confirm() sequence.
  let confirmOpen = $state(false);
  let confirmKind = $state(
    /** @type {"reset" | "revoke" | "switch-relay-input" | "switch-relay-confirm" | null} */ (null),
  );
  let confirmRevokeTarget = $state(/** @type {{ id: string, label: string } | null} */ (null));
  let switchRelayUrl = $state("");
  let switchRelayError = $state("");

  function closeConfirm() {
    confirmOpen = false;
    confirmKind = null;
    confirmRevokeTarget = null;
    switchRelayError = "";
  }

  function handleReset() {
    confirmKind = "reset";
    confirmOpen = true;
  }

  async function doReset() {
    closeConfirm();
    errorMsg = "";
    working = true;
    try {
      await syncReset();
      await refresh();
    } catch (e) {
      errorMsg = String(e);
    } finally {
      working = false;
    }
  }

  /// Revoked-device recovery: clear credentials + the revoked flag
  /// (sync_reset — content is never touched) then land the user in
  /// the pairing wizard's join-a-new-device entry step. The worker
  /// has already exited by the time this runs (backend stops it on
  /// the 401 that set the revoked flag); pair_new_join /
  /// pair_new_complete replace the worker slot themselves, so no
  /// worker-restart call belongs here.
  async function pairAgain() {
    errorMsg = "";
    working = true;
    try {
      await syncReset();
      await refresh();
      cancelWizard();
      // The revoked note can be triggered from any tab (it overrides
      // the whole sync-pane). The join wizard only renders under the
      // "account" tab's step==="idle" branch — without this reset, a
      // pair-again clicked from "devices"/"timing"/etc. leaves that
      // tab selected and its own `status?.configured` gate (now false
      // post-reset) shows its "configured under account first"
      // dead-end instead of the wizard the user just asked for.
      syncTab = "account";
      pairStep = "new_input";
    } catch (e) {
      errorMsg = String(e);
    } finally {
      working = false;
    }
  }

  function handleRevoke(deviceId, label) {
    confirmRevokeTarget = { id: deviceId, label: label || "this device" };
    confirmKind = "revoke";
    confirmOpen = true;
  }

  async function doRevoke() {
    const target = confirmRevokeTarget;
    closeConfirm();
    if (!target) return;
    errorMsg = "";
    working = true;
    try {
      await revokeDevice(target.id);
      await refresh();
      devicesKey += 1;
    } catch (e) {
      errorMsg = String(e);
    } finally {
      working = false;
    }
  }

  function handleSwitchRelay() {
    switchRelayUrl = status?.relay_url || "https://";
    switchRelayError = "";
    confirmKind = "switch-relay-input";
    confirmOpen = true;
  }

  function continueSwitchRelay() {
    const trimmed = switchRelayUrl.trim();
    if (!trimmed.startsWith("http")) {
      switchRelayError = "relay url must start with http:// or https://";
      return;
    }
    switchRelayUrl = trimmed;
    switchRelayError = "";
    confirmKind = "switch-relay-confirm";
  }

  async function doSwitchRelay() {
    const trimmed = switchRelayUrl;
    closeConfirm();
    errorMsg = "";
    working = true;
    try {
      await syncSwitchRelay(trimmed);
      await refresh();
    } catch (e) {
      errorMsg = String(e);
    } finally {
      working = false;
    }
  }

  function cancelWizard() {
    step = "idle";
    phrase = "";
    existingPhrase = "";
    relayUrl = "";
    deviceLabel = "";
    phraseMode = "generate";
    errorMsg = "";
  }

  // ===== pairing flow =====
  // Existing device: kick off pairing, mint a token, build the QR.
  async function startPairExisting() {
    errorMsg = "";
    working = true;
    try {
      // 15-minute TTL — the user types 4 words on the new device by hand,
      // then both sides compare the SAS before the keyring is wrapped.
      // 5 minutes was too tight in practice (test sessions, multi-device
      // juggling).
      const r = await pairExistingStart(900);
      pairToken = r.pair_token;
      pairQr = r.qr_payload;
      qrSvgDataUrl = await QRCode.toDataURL(pairQr, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 280,
      });
      pairStep = "existing_qr";
      // Poll for the new device's join, then surface the SAS for the
      // user to compare. The keyring is NOT wrapped until they confirm.
      void waitForPairJoin();
    } catch (e) {
      errorMsg = String(e);
    } finally {
      working = false;
    }
  }

  // Existing device: one labeled block with everything the new device
  // needs to type by hand, so there's a single copy action instead of
  // three separate ones for relay / user id / phrase.
  function copyPairingInfo() {
    const block = [
      `relay: ${status?.relay_url || ""}`,
      `user id: ${status?.user_id || ""}`,
      `phrase: ${pairToken.replace(/-/g, " ")}`,
    ].join("\n");
    copyToClipboard(block, "pairing info copied");
  }

  // Existing device: long-poll until the new device deposits its
  // ephemeral key, then surface the SAS for human comparison. We do NOT
  // wrap the keyring here — a malicious relay can substitute its own
  // ephemeral key, and the only thing that catches that is the user
  // comparing the SAS digits on both screens. Wrapping happens in
  // confirmPairExisting() once the user approves.
  let pairAutoCancelled = false;
  async function waitForPairJoin() {
    pairAutoCancelled = false;
    errorMsg = "";
    // Loop attempts with short batches so cancel can interrupt promptly.
    for (let attempt = 0; attempt < 120; attempt++) {
      if (pairAutoCancelled) return;
      try {
        const r = await pairExistingFetchSas(pairToken, 5);
        pairSas = r.sas;
        pairEphemeralPub = r.ephemeral_pub_b64;
        // Got the ephemeral pub — show the SAS and wait for the user.
        if (!pairAutoCancelled) pairStep = "existing_sas";
        return;
      } catch {
        // Not yet — keep polling silently. The relay 404s until the
        // new device has deposited its ephemeral key.
      }
    }
    if (!pairAutoCancelled) {
      errorMsg = "timed out waiting for the other device. start over with a fresh code.";
    }
  }

  // Existing device: the user has confirmed the SAS matches the new
  // device. Only now do we wrap the keyring to the new device's
  // ephemeral key and finalize. If the digits did NOT match, the user
  // hits cancel instead and nothing sensitive ever leaves this device.
  async function confirmPairExisting() {
    errorMsg = "";
    working = true;
    try {
      await pairExistingConfirm({
        pairToken,
        ephemeralPubB64: pairEphemeralPub,
        newDeviceLabel: pairNewLabel.trim() || "another device",
      });
      cancelPair();
      await refresh();
    } catch (e) {
      errorMsg = String(e);
    } finally {
      working = false;
    }
  }

  function cancelPair() {
    pairAutoCancelled = true;
    pairStep = "none";
    pairToken = "";
    pairQr = "";
    pairSas = "";
    pairEphemeralPub = "";
    pairNewLabel = "";
    typedRelay = "";
    typedUid = "";
    typedPhrase = "";
    pastedPairingInfo = "";
    qrSvgDataUrl = "";
    pairBundleForJoin = "";
    newDeviceInputMode = "type";
    errorMsg = "";
  }

  // Assemble the QR bundle from manual typed values. The phrase is
  // normalized to hyphen-joined lowercase to match the relay's token
  // shape.
  function buildBundleFromTyped() {
    const phrase = typedPhrase
      .toLowerCase()
      .trim()
      .split(/[\s-]+/)
      .filter(Boolean)
      .join("-");
    return JSON.stringify({
      relay: typedRelay.trim(),
      uid: typedUid.trim(),
      tok: phrase,
    });
  }

  // New device: parse whatever the user pasted from the existing device's
  // "copy pairing info" block into the three typed fields, live as they
  // paste/edit. Tolerant of reordering, missing labels, and partial info —
  // fills in only the fields it can find, leaves the rest for hand-typing.
  function handlePastePairingInfo(text) {
    pastedPairingInfo = text;
    const parsed = parsePairingInfo(text);
    if (parsed.relay) typedRelay = parsed.relay;
    if (parsed.userId) typedUid = parsed.userId;
    if (parsed.phrase) typedPhrase = parsed.phrase;
  }

  async function joinPairNew() {
    errorMsg = "";
    working = true;
    try {
      const bundle =
        newDeviceInputMode === "type" ? buildBundleFromTyped() : pairBundleForJoin;
      pairBundleForJoin = bundle;
      const r = await pairNewJoin(bundle);
      pairSas = r.sas;
      // Show the SAS so the user can compare it against the existing
      // device before anything is exchanged. completePairNew only runs
      // once they confirm the digits match.
      pairStep = "new_sas";
    } catch (e) {
      const msg = String(e);
      if (msg.includes("pair_token_consumed") || msg.includes("ephemeral_pub already deposited")) {
        errorMsg = "this pair code was already used. on the existing device, hit \"add device\" again to get a fresh code.";
      } else if (msg.includes("pair_token_unknown") || msg.includes("expired")) {
        errorMsg = "this pair code is unknown or expired. on the existing device, hit \"add device\" to get a fresh code.";
      } else {
        errorMsg = msg;
      }
    } finally {
      working = false;
    }
  }

  // New device: the user confirmed the SAS matches. Move to the waiting
  // screen and fetch + decrypt the wrapped bundle the existing device
  // deposits after its own confirmation.
  async function completePairNew() {
    pairStep = "new_waiting";
    deviceLimitHit = false;
    try {
      await pairNewComplete(
        pairBundleForJoin,
        pairNewLabel.trim() || "this device",
        120,
      );
      pairStep = "new_done";
      await refresh();
    } catch (e) {
      const msg = String(e);
      if (msg.includes("device_limit_reached")) {
        errorMsg = "this account is at its free device limit. upgrade for unlimited devices.";
        deviceLimitHit = true;
      } else if (msg.includes("no wrapped bundle deposited") || msg.includes("pair_token_state_invalid")) {
        errorMsg = "the other device did not finish. start over with a fresh code.";
      } else if (msg.includes("timed out") || msg.includes("timeout")) {
        errorMsg = "timed out. make sure the other device still has the pair screen open, then try a fresh code.";
      } else {
        errorMsg = msg;
      }
      pairStep = "new_input";
    }
  }

  // When the in-page scanner fails (permission denied, no camera, etc.)
  // flip the user back to the typed-words tab so they have a working
  // path forward without a second click. The QrScanner shows its own
  // friendly hint; we still surface the raw error in the global error
  // strip for diagnostics.
  function onScannerError(msg) {
    errorMsg = `scanner: ${msg}`;
    newDeviceInputMode = "type";
  }

  function shortId(s) {
    if (!s) return "—";
    return s.length > 12 ? s.slice(0, 8) + "…" + s.slice(-4) : s;
  }

  function relativeTime(ms) {
    if (!ms) return "never";
    const diff = Date.now() - ms;
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  }
</script>

<div class="sync-settings">
  {#if loading}
    <Row>
      sync
      {#snippet trailing()}
        <span class="status-text label">loading…</span>
      {/snippet}
    </Row>
  {:else}
    <div class="sync-tabs">
      <button type="button" class="sync-tab" class:active={syncTab === "account"} onclick={() => (syncTab = "account")}>account</button>
      <button type="button" class="sync-tab" class:active={syncTab === "devices"} onclick={() => (syncTab = "devices")}>devices</button>
      <button type="button" class="sync-tab" class:active={syncTab === "timing"}  onclick={() => (syncTab = "timing")}>timing</button>
      <button type="button" class="sync-tab" class:active={syncTab === "mobile"}  onclick={() => (syncTab = "mobile")}>mobile</button>
      <button type="button" class="sync-tab" class:active={syncTab === "storage"} onclick={() => (syncTab = "storage")}>storage</button>
    </div>

    <div class="sync-pane">
      {#if status?.revoked}
        <div class="revoked-note">
          <p>this device was revoked from the account. its local pages are untouched — syncing has stopped.</p>
          <Button variant="accent" onClick={pairAgain} disabled={working}>pair again</Button>
        </div>
      {:else if syncTab === "account"}
        {#if step === "idle"}
          {#if !status?.configured}
            <Row description="you're the first device. we generate a recovery phrase — write it down to add your other devices later.">
              new account
              {#snippet trailing()}
                <Button variant="accent" onClick={startSetup} disabled={working}>generate</Button>
              {/snippet}
            </Row>
            <Row description="pair with a device you already use, via qr or phrase.">
              pair device
              {#snippet trailing()}
                <Button variant="ghost" onClick={() => { cancelWizard(); pairStep = 'new_input'; }} disabled={working}>pair</Button>
              {/snippet}
            </Row>
            <Row description="restore this account from the 24-word recovery phrase you saved. no other device needed.">
              recovery phrase
              {#snippet trailing()}
                <Button variant="ghost" onClick={startRestore} disabled={working}>restore</Button>
              {/snippet}
            </Row>
          {:else}
      <Row description="overall sync state. pause to stop the worker without disconnecting; resume to start uploading again.">
        sync
        {#snippet trailing()}
          {#if status.enabled}
            <Chip variant="neutral">on</Chip>
            <Button variant="ghost" onClick={disable} disabled={working}>pause</Button>
          {:else}
            <Chip variant="neutral">paused</Chip>
            <Button variant="ghost" onClick={enable} disabled={working}>resume</Button>
          {/if}
        {/snippet}
      </Row>
      <Row description="server this device talks to. all your devices on the same account must point at the same relay.">
        relay
        {#snippet trailing()}
          <span class="status-text relay-url">{status.relay_url || "—"}</span>
        {/snippet}
      </Row>
      <Row description="this device's stable identifier on the relay. shown as the short prefix.">
        device
        {#snippet trailing()}
          <span class="status-text mono">{shortId(status.device_id)}</span>
        {/snippet}
      </Row>
      {#if status.enabled}
        <Row description="when this device last successfully exchanged data with the relay.">
          last sync
          {#snippet trailing()}
            <span class="status-text label">{relativeTime(status.last_sync_at_ms)}</span>
          {/snippet}
        </Row>
      {/if}

      <Row description="the only key to your account. we cannot recover it for you. reveal it to save another copy.">
        recovery phrase
        {#snippet trailing()}
          {#if revealedPhrase || phraseHasNone}
            <Button variant="ghost" onClick={hidePhrase}>hide</Button>
          {:else}
            <Button variant="ghost" onClick={revealPhrase}>reveal</Button>
          {/if}
        {/snippet}
      </Row>
      {#if revealedPhrase}
        <div class="phrase-reveal">
          <p class="phrase-warn">
            this is the only key to your writing. we never see it and cannot
            reset it. save it somewhere safe now: a password manager, or on
            paper kept somewhere private. if you lose it and lose your devices,
            your synced writing is gone for good.
          </p>
          <div
            class="phrase-display mono"
            role="button"
            tabindex="0"
            title="tap to copy"
            onclick={() => copyToClipboard(revealedPhrase, "phrase copied")}
            onkeydown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                copyToClipboard(revealedPhrase, "phrase copied");
              }
            }}
          >{revealedPhrase}</div>
        </div>
      {:else if phraseHasNone}
        <div class="phrase-reveal">
          <p class="phrase-warn">
            this device was paired from another, so it does not hold the phrase.
            reveal it from your original device, the one you first set up.
          </p>
        </div>
      {/if}

          <div class="web-access-group">
            <div class="group-label label">web access</div>
            {#await emailStatusFetch(emailStatusKey)}
              <Row>
                email
                {#snippet trailing()}
                  <span class="status-text label">loading…</span>
                {/snippet}
              </Row>
            {:then es}
              {#if es.email}
                <Row>
                  email
                  {#snippet trailing()}
                    <span class="status-text mono email-value">{es.email}</span>
                    <Chip variant="neutral">{es.verified ? "verified" : "awaiting verification"}</Chip>
                  {/snippet}
                </Row>
              {:else}
                <p class="web-access-desc">add an email to sign in at shizumu.app and see your account on the web. your writing stays encrypted. the password is for the dashboard only.</p>
              {/if}
              <div class="web-access-form">
                <input
                  type="email"
                  class="text-input"
                  bind:value={webEmail}
                  placeholder="email"
                  spellcheck="false"
                  autocomplete="email"
                  disabled={webWorking}
                />
                <input
                  type="password"
                  class="text-input"
                  bind:value={webPassword}
                  placeholder="password"
                  autocomplete="new-password"
                  disabled={webWorking}
                />
                <div class="web-access-actions">
                  <Button variant="accent" onClick={handleSetEmail} disabled={webWorking}>
                    {webWorking ? "saving…" : (es.email ? "change email" : "add email")}
                  </Button>
                </div>
              </div>
            {:catch _err}
              <Row>
                email
                {#snippet trailing()}
                  <span class="status-text label">unavailable</span>
                {/snippet}
              </Row>
            {/await}
            {#if webError}
              <div class="error-callout">
                <div class="error-callout-text">{webError}</div>
              </div>
            {/if}
            {#if webSuccess}
              <div class="web-success">{webSuccess}</div>
            {/if}
          </div>

          <div class="redeem-group">
            <div class="group-label label">redeem</div>
            <div class="redeem-form">
              <input
                type="text"
                class="text-input redeem-input"
                bind:value={redeemKey}
                placeholder="license key"
                aria-label="license key"
                spellcheck="false"
                autocomplete="off"
                disabled={redeemWorking}
              />
              <Button variant="subtle" onClick={handleRedeem} disabled={redeemWorking}>
                {redeemWorking ? "redeeming…" : "redeem"}
              </Button>
            </div>
            {#if redeemSuccess}
              <div class="redeem-success">{redeemSuccess}</div>
            {/if}
            {#if redeemError}
              <div class="redeem-error">{redeemError}</div>
            {/if}
          </div>

          {#if status.last_error}
            <div class="error-callout">
              <div class="error-callout-label">last error</div>
              <div class="error-callout-text">{status.last_error}</div>
            </div>
          {/if}
          {/if}
        {:else if step === "phrase"}
    <div class="wizard">
      <SegmentedControl
        options={[
          { value: "generate", label: "generate new" },
          { value: "existing", label: "i have a phrase" },
        ]}
        value={phraseMode}
        onChange={(v) => { phraseMode = v; }}
        ariaLabel="recovery phrase mode"
      />

      {#if phraseMode === "generate"}
        <p class="wizard-prompt">
          your recovery phrase. write it down before continuing.
        </p>
        <div
          class="phrase-display mono"
          role="button"
          tabindex="0"
          title="tap to copy"
          onclick={() => copyToClipboard(phrase, "phrase copied")}
          onkeydown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              copyToClipboard(phrase, "phrase copied");
            }
          }}
        >{phrase}</div>
      {:else}
        <p class="wizard-prompt">paste the 24-word phrase you saved.</p>
        <textarea
          class="phrase-input"
          bind:value={existingPhrase}
          placeholder="word word word ..."
          rows="3"
          spellcheck="false"
          autocomplete="off"
        ></textarea>
      {/if}

      <div class="wizard-actions">
        <Button variant="ghost" onClick={cancelWizard}>cancel</Button>
        <Button variant="ghost" onClick={continueToRelay}>next</Button>
      </div>
    </div>
  {:else if step === "relay"}
    <div class="wizard">
      <p class="wizard-prompt">choose where your encrypted writing syncs.</p>
      {#if HOSTED_RELAY_URL}
        <div class="relay-choice">
          <button
            type="button"
            class="relay-opt"
            class:active={relayChoice === "hosted"}
            onclick={() => { relayChoice = "hosted"; relayUrl = HOSTED_RELAY_URL; errorMsg = ""; }}
          >
            <span class="relay-opt-name">hosted</span>
            <span class="relay-opt-desc">we run the relay for you. free, end-to-end encrypted. upgrade later for more attachment room.</span>
          </button>
          <button
            type="button"
            class="relay-opt"
            class:active={relayChoice === "self"}
            onclick={() => { relayChoice = "self"; relayUrl = ""; errorMsg = ""; }}
          >
            <span class="relay-opt-name">self-host</span>
            <span class="relay-opt-desc">run your own relay. free, unlimited. your server, your rules.</span>
          </button>
        </div>
      {/if}
      {#if relayChoice === "hosted" && HOSTED_RELAY_URL}
        <!-- Name the destination even when it is not editable. The relay
             holds ciphertext it cannot read, but "where does this go" is
             still the first question worth answering, and hiding the answer
             behind the easy path is how a sync toggle stops feeling
             trustworthy. -->
        <p class="wizard-prompt">syncs to</p>
        <p class="relay-destination">{HOSTED_RELAY_URL.replace(/^https:\/\//, "")}</p>
      {/if}
      {#if relayChoice === "self" || !HOSTED_RELAY_URL}
        <p class="wizard-prompt">relay url</p>
        <input
          type="url"
          class="text-input"
          bind:value={relayUrl}
          placeholder="https://relay.example.com"
          spellcheck="false"
          autocomplete="off"
        />
      {/if}
      <p class="wizard-prompt">device label</p>
      <input
        type="text"
        class="text-input"
        bind:value={deviceLabel}
        placeholder="laptop, phone, ..."
        spellcheck="false"
        autocomplete="off"
      />
      <div class="wizard-actions">
        <Button variant="ghost" onClick={() => { step = "phrase"; }}>back</Button>
        <Button variant="accent" onClick={connect} disabled={working}>
          {working ? "connecting…" : "connect"}
        </Button>
      </div>
    </div>
        {:else if step === "done"}
          <div class="wizard">
            <p class="wizard-prompt">connected. turn sync on.</p>
            <div class="wizard-actions">
              <Button variant="ghost" onClick={cancelWizard}>later</Button>
              <Button variant="accent" onClick={enable} disabled={working}>
                {working ? "enabling…" : "turn on"}
              </Button>
            </div>
          </div>
        {/if}

        {#if pairStep === "new_input"}
    <div class="wizard">
      <p class="wizard-prompt">on the existing device, hit "add device" and read the pairing info.</p>
      <SegmentedControl
        options={[
          { value: "type", label: "type words" },
          { value: "scan", label: "scan qr" },
        ]}
        value={newDeviceInputMode}
        onChange={(v) => { newDeviceInputMode = v; }}
        ariaLabel="pairing input mode"
      />
      {#if newDeviceInputMode === "type"}
        <p class="wizard-prompt-small">paste the pairing info from the other device's "add device" screen — it fills in the fields below. or type them by hand, or scan its qr to skip typing.</p>
        <span class="field-label label">paste pairing info</span>
        <textarea
          class="phrase-input mono"
          value={pastedPairingInfo}
          oninput={(e) => handlePastePairingInfo(e.target.value)}
          placeholder={"relay: ...\nuser id: ...\nphrase: ..."}
          rows="3"
          spellcheck="false"
          autocomplete="off"
          aria-label="paste pairing info"
        ></textarea>
        <span class="field-label label">relay url</span>
        <input
          type="text"
          class="text-input mono"
          bind:value={typedRelay}
          placeholder="http://192.168.1.5:8787"
          spellcheck="false"
          autocomplete="off"
        />
        <span class="field-label label">user id (shown on the other device)</span>
        <input
          type="text"
          class="text-input mono"
          bind:value={typedUid}
          placeholder="paste the user id"
          spellcheck="false"
          autocomplete="off"
        />
        <span class="field-label label">pairing words</span>
        <input
          type="text"
          class="text-input mono"
          bind:value={typedPhrase}
          placeholder="ember tide warm pine"
          spellcheck="false"
          autocomplete="off"
          autocapitalize="off"
        />
      {:else}
        <p class="wizard-prompt-small">point your camera at the qr shown on the existing device.</p>
        <QrScanner
          onResult={(text) => { pairBundleForJoin = text; joinPairNew(); }}
          onError={onScannerError}
        />
      {/if}
      <input
        type="text"
        class="text-input"
        bind:value={pairNewLabel}
        placeholder="label for this device"
        spellcheck="false"
        autocomplete="off"
      />
      <div class="wizard-actions">
        <Button variant="ghost" onClick={cancelPair}>cancel</Button>
        <Button variant="accent" onClick={joinPairNew} disabled={working}>
          {working ? "joining…" : "join"}
        </Button>
      </div>
    </div>
  {:else if pairStep === "new_sas"}
    <div class="wizard">
      <p class="wizard-prompt">
        check this code matches the one on the existing device. if it does
        not match, cancel — do not continue.
      </p>
      <div class="sas-display mono">{pairSas}</div>
      <div class="wizard-actions">
        <Button variant="ghost" onClick={cancelPair}>cancel</Button>
        <Button variant="accent" onClick={completePairNew} disabled={working}>
          codes match
        </Button>
      </div>
    </div>
  {:else if pairStep === "new_waiting"}
    <div class="wizard">
      <p class="wizard-prompt">waiting for the other device to add you…</p>
      <div class="wizard-actions">
        <Button variant="ghost" onClick={cancelPair}>cancel</Button>
      </div>
    </div>
        {:else if pairStep === "new_done"}
          <div class="wizard">
            <p class="wizard-prompt">paired. this device now syncs with the others.</p>
            <div class="wizard-actions">
              <Button variant="ghost" onClick={cancelPair}>close</Button>
            </div>
          </div>
        {/if}

        {#if errorMsg}
          <div class="error-callout">
            <div class="error-callout-label">{deviceLimitHit ? "device limit" : "pairing error"}</div>
            <div class="error-callout-text">{errorMsg}</div>
            {#if deviceLimitHit}
              <Button variant="accent" onClick={openPricing}>upgrade — unlimited devices</Button>
            {/if}
          </div>
        {/if}
      {:else if syncTab === "devices"}
        {#if status?.configured}
          <Row description="generate a one-time pairing code so another device can join this account.">
            add device
            {#snippet trailing()}
              <Button variant="ghost" onClick={startPairExisting} disabled={working || pairStep !== "none"}>start</Button>
            {/snippet}
          </Row>
          {#if pairStep === "existing_qr"}
            <div class="wizard">
              <ol class="pair-steps">
                <li>install shizumu on the new device</li>
                <li>open settings → sync → pair</li>
                <li>scan this qr or type the phrase</li>
              </ol>
              <div class="pair-primaries">
                {#if qrSvgDataUrl}
                  <img src={qrSvgDataUrl} alt="pairing qr code" class="qr-img" />
                {/if}
                <div
                  class="pair-phrase mono"
                  role="button"
                  tabindex="0"
                  title="tap to copy"
                  onclick={() => copyToClipboard(pairToken.replace(/-/g, " "), "phrase copied")}
                  onkeydown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      copyToClipboard(pairToken.replace(/-/g, " "), "phrase copied");
                    }
                  }}
                >{pairToken.replace(/-/g, " ")}</div>
              </div>
              <Button variant="subtle" onClick={copyPairingInfo}>copy pairing info</Button>
              <details class="pair-details">
                <summary class="label">relay + user id, to type by hand</summary>
                <div class="pair-meta">
                  <span class="meta-label label">relay</span>
                  <span class="meta-value mono">{status?.relay_url || "—"}</span>
                  <Button variant="subtle" onClick={() => copyToClipboard(status?.relay_url || "", "relay copied")}>copy</Button>
                </div>
                <div class="pair-meta">
                  <span class="meta-label label">user id</span>
                  <span class="meta-value mono">{status?.user_id || "—"}</span>
                  <Button variant="subtle" onClick={() => copyToClipboard(status?.user_id || "", "user id copied")}>copy</Button>
                </div>
              </details>
              <div class="pair-wait-group">
                <input
                  type="text"
                  class="text-input"
                  bind:value={pairNewLabel}
                  placeholder="label for the new device (optional)"
                  spellcheck="false"
                  autocomplete="off"
                />
                <p class="wizard-prompt">waiting for the other device to join…</p>
              </div>
              <div class="wizard-actions">
                <Button variant="ghost" onClick={cancelPair}>cancel</Button>
              </div>
            </div>
          {:else if pairStep === "existing_sas"}
            <div class="wizard">
              <p class="wizard-prompt">
                check this code matches the one on the new device. if it does not
                match, cancel — do not add the device.
              </p>
              <div class="sas-display mono">{pairSas}</div>
              <div class="wizard-actions">
                <Button variant="ghost" onClick={cancelPair}>cancel</Button>
                <Button variant="accent" onClick={confirmPairExisting} disabled={working}>
                  {working ? "adding…" : "codes match"}
                </Button>
              </div>
            </div>
          {/if}
          {#if errorMsg}
            <div class="error-callout">
              <div class="error-callout-label">pairing error</div>
              <div class="error-callout-text">{errorMsg}</div>
            </div>
          {/if}
          {#await fetchDevices(devicesKey)}
            <Row>
              loading
              {#snippet trailing()}
                <span class="status-text label">…</span>
              {/snippet}
            </Row>
          {:then devices}
            {#each devices.filter((d) => !d.revoked_at) as d (d.id)}
              <Row>
                <span class="device-label">
                  {d.label || "untitled"}
                  {#if d.id === status.device_id}<Chip variant="neutral">this device</Chip>{/if}
                </span>
                {#snippet trailing()}
                  {#if d.id !== status.device_id}
                    <Button variant="ghost" onClick={() => handleRevoke(d.id, d.label)} disabled={working}>revoke</Button>
                  {/if}
                {/snippet}
              </Row>
            {/each}
          {:catch err}
            <div class="error-callout">
              <div class="error-callout-label">couldn't load devices</div>
              <div class="error-callout-text">{err}</div>
            </div>
          {/await}
        {:else}
          <Row>
            devices
            {#snippet trailing()}
              <span class="status-text label">configured under account first</span>
            {/snippet}
          </Row>
        {/if}
      {:else if syncTab === "timing"}
        {#if status?.configured}
          <Row description="wait this many milliseconds after you stop typing before pushing the change. higher = fewer uploads, more battery; lower = peers see your edits sooner.">
            upload delay after edit (ms)
            {#snippet trailing()}
              <input
                type="number"
                min="0"
                max="10000"
                step="500"
                class="text-input num-input"
                bind:value={saveDebounceMs}
                onchange={() => updateSaveDebounce(saveDebounceMs)}
                aria-label="delay in milliseconds between an edit and the sync upload"
              />
            {/snippet}
          </Row>
        {:else}
          <Row>
            timing
            {#snippet trailing()}
              <span class="status-text label">configured under account first</span>
            {/snippet}
          </Row>
        {/if}
      {:else if syncTab === "mobile"}
        {#if status?.configured}
          <Row description="stop syncing when the device reports a metered connection (cellular, tethered). saves data on mobile plans. not wired up yet. your choice is saved for when it is.">
            pause sync on metered networks <span class="soon-tag">soon</span>
            {#snippet trailing()}
              <Toggle
                checked={pauseOnMetered}
                onChange={(v) => updatePauseOnMetered(v)}
                label="pause on metered"
                disabled
              />
            {/snippet}
          </Row>
          <Row description="stop syncing when battery drops below this percentage. set to 0 to never pause. not wired up yet. your choice is saved for when it is.">
            pause below battery % <span class="soon-tag">soon</span>
            {#snippet trailing()}
              <input
                type="number"
                min="0"
                max="100"
                step="5"
                class="text-input num-input"
                bind:value={batteryThreshold}
                onchange={() => updateBatteryThreshold(batteryThreshold)}
                aria-label="pause sync below battery percentage"
                disabled
              />
            {/snippet}
          </Row>
        {:else}
          <Row>
            mobile
            {#snippet trailing()}
              <span class="status-text label">configured under account first</span>
            {/snippet}
          </Row>
        {/if}
      {:else if syncTab === "storage"}
        <!-- What this device holds is local fact, not a sync fact: every
             attachment defaults to unsynced, so this reads the same
             whether or not sync is ever configured. It stays outside the
             `status?.configured` gate below on purpose — the population
             with no relay copy to fall back on is exactly who needs to
             read it. Only figures that describe the relay (quota, synced
             total, op log, danger zone) stay gated. -->
        {#await localBytesFetch(attachmentsKey)}
          <Row>
            local storage
            {#snippet trailing()}
              <span class="status-text label">loading…</span>
            {/snippet}
          </Row>
        {:then localBytes}
          <Row description="what this device is actually holding on disk. attachments you never synced count here and nowhere else.">
            local storage
            {#snippet trailing()}
              <span class="status-text mono">{formatBytes(localBytes)}</span>
            {/snippet}
          </Row>
        {:catch _err}
          <Row>
            local storage
            {#snippet trailing()}
              <span class="status-text error-text">unavailable</span>
            {/snippet}
          </Row>
        {/await}

        {#await attachmentsFetch(attachmentsKey)}
          <Row>
            attachments
            {#snippet trailing()}
              <span class="status-text label">loading…</span>
            {/snippet}
          </Row>
        {:then files}
          {@const away = awayCount(files)}
          <Row description={ATTACHMENT_LOCALITY_NOTE}>
            attachments
            {#snippet trailing()}
              <span class="status-text mono"
                >{files.length} {files.length === 1 ? "file" : "files"}</span
              >
              {#if away > 0}
                <span class="status-text label">{away} {AWAY_LABEL}</span>
              {/if}
            {/snippet}
          </Row>
        {:catch _err}
          <Row>
            attachments
            {#snippet trailing()}
              <span class="status-text label">none yet</span>
            {/snippet}
          </Row>
        {/await}

        <Row description="scan the on-disk attachment store and delete blob files nothing on this device points at anymore. database rows stay (so synced peers can re-fetch); only orphaned local files are removed. a 1-hour grace protects in-flight uploads.">
          blob garbage
          {#snippet trailing()}
            <Button variant="ghost" onClick={handleGc} disabled={working}>gc now</Button>
          {/snippet}
        </Row>
        <!-- The floor under every sweep, stated where the user meets it: a
             pin is a pointer plus a frozen cache, so a pinned file is a
             reference the gc will never collect. That is retention working,
             not a limitation — so the line names the release rather than
             apologising for the bytes. -->
        <p class="storage-note">{PIN_RETENTION_NOTE}</p>

        {#if status?.configured}
          {#await quotaFetch(attachmentsKey)}
            <Row>
              synced
              {#snippet trailing()}
                <span class="status-text label">loading…</span>
              {/snippet}
            </Row>
          {:then q}
            <Row description="bytes you authorized to leave this device, against your relay cap.">
              synced
              {#snippet trailing()}
                <span class="status-text mono">
                  {formatBytes(q.used)} / {q.cap == null ? "∞" : formatBytes(q.cap)}
                </span>
              {/snippet}
            </Row>
            <Row description="your storage tier. writing is unlimited; the cap above is for synced attachments.">
              tier
              {#snippet trailing()}
                <Chip variant="neutral">{q.tier}</Chip>
                {#if q.tier === "free"}
                  <Button variant="ghost" onClick={openPricing}>get more space</Button>
                {/if}
              {/snippet}
            </Row>
            {#if q.cap != null}
              <div class="quota-bar">
                <div
                  class="quota-bar-fill"
                  class:warn={q.used / q.cap > 0.9}
                  style:width="{Math.min(100, (q.used / q.cap) * 100).toFixed(1)}%"
                ></div>
              </div>
            {/if}
          {:catch _err}
            <Row>
              synced
              {#snippet trailing()}
                <span class="status-text error-text">quota unavailable</span>
              {/snippet}
            </Row>
          {/await}

          <details class="op-log-stats">
            <summary class="label">op log details</summary>
            {#await fetchStats(statsKey)}
              <span class="status-text label">loading…</span>
            {:then stats}
              <Row>
                total ops
                {#snippet trailing()}
                  <span class="status-text mono">{stats.total}</span>
                {/snippet}
              </Row>
              <Row>
                pending upload
                {#snippet trailing()}
                  <span class="status-text mono">{stats.local_only}</span>
                {/snippet}
              </Row>
              {#if stats.failed > 0}
                <Row>
                  failed merges
                  {#snippet trailing()}
                    <span class="status-text mono error-text">{stats.failed}</span>
                    <Button variant="ghost" onClick={handleReplayFailed} disabled={working}>replay</Button>
                  {/snippet}
                </Row>
              {/if}
              <Row>
                backfill
                {#snippet trailing()}
                  <span class="status-text label">
                    {stats.backfill_complete ? "complete" : "in progress"}
                  </span>
                {/snippet}
              </Row>
              {#if stats.by_kind && stats.by_kind.length > 0}
                <Row>
                  by kind
                  {#snippet trailing()}
                    <span class="status-text mono kinds-list">
                      {#each stats.by_kind as k, i}
                        {k.kind}={k.count}{i < stats.by_kind.length - 1 ? ", " : ""}
                      {/each}
                    </span>
                  {/snippet}
                </Row>
              {/if}
            {:catch err}
              <div class="error-callout">
                <div class="error-callout-label">stats unavailable</div>
                <div class="error-callout-text">{err}</div>
              </div>
            {/await}

            <div class="danger-zone">
              <div class="danger-label label">danger zone</div>
              <Row>
                disconnect from relay
                {#snippet trailing()}
                  <Button variant="ghost" onClick={handleReset} disabled={working}>disconnect</Button>
                {/snippet}
              </Row>
              <Row>
                switch relay
                {#snippet trailing()}
                  <Button variant="ghost" onClick={handleSwitchRelay} disabled={working}>switch</Button>
                {/snippet}
              </Row>
            </div>
          </details>
        {:else}
          <Row description="set up sync under account to see what's on the relay.">
            relay storage
            {#snippet trailing()}
              <span class="status-text label">configured under account first</span>
            {/snippet}
          </Row>
        {/if}
      {/if}
    </div>
  {/if}

  {#if copyToast}
    <div class="copy-toast label" role="status" aria-live="polite">{copyToast}</div>
  {/if}
</div>

<Modal
  open={confirmOpen}
  onClose={closeConfirm}
  title={confirmKind === "reset"
    ? "disconnect from relay"
    : confirmKind === "revoke"
      ? `revoke "${confirmRevokeTarget?.label}"`
      : "switch relay"}
>
  {#if confirmKind === "reset"}
    <p class="confirm-body">local writing is preserved. you can re-enroll later.</p>
  {:else if confirmKind === "revoke"}
    <p class="confirm-body">it will stop syncing.</p>
  {:else if confirmKind === "switch-relay-input"}
    <p class="confirm-body">enter the new relay url.</p>
    <div class="confirm-field">
      <Input
        value={switchRelayUrl}
        onInput={(v) => (switchRelayUrl = v)}
        onKeydown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            continueSwitchRelay();
          }
        }}
        placeholder="https://relay.example.com"
        ariaLabel="new relay url"
        autofocus
      />
    </div>
    {#if switchRelayError}
      <p class="confirm-error">{switchRelayError}</p>
    {/if}
  {:else if confirmKind === "switch-relay-confirm"}
    <p class="confirm-body">
      switching to <span class="mono">{switchRelayUrl}</span> means re-enrolling
      this device on the new relay.
    </p>
  {/if}

  {#snippet actions()}
    {#if confirmKind === "reset"}
      <Button variant="ghost" onClick={closeConfirm}>cancel</Button>
      <span class="danger-slot">
        <Button variant="ghost" onClick={doReset} disabled={working}>disconnect</Button>
      </span>
    {:else if confirmKind === "revoke"}
      <Button variant="ghost" onClick={closeConfirm}>cancel</Button>
      <span class="danger-slot">
        <Button variant="ghost" onClick={doRevoke} disabled={working}>revoke</Button>
      </span>
    {:else if confirmKind === "switch-relay-input"}
      <Button variant="ghost" onClick={closeConfirm}>cancel</Button>
      <Button variant="accent" onClick={continueSwitchRelay}>continue</Button>
    {:else if confirmKind === "switch-relay-confirm"}
      <Button variant="ghost" onClick={() => (confirmKind = "switch-relay-input")}>back</Button>
      <span class="danger-slot">
        <Button variant="ghost" onClick={doSwitchRelay} disabled={working}>switch</Button>
      </span>
    {/if}
  {/snippet}
</Modal>

<style>
  .wizard {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.25rem 0;
  }
  .relay-choice {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .relay-opt {
    text-align: left;
    background: none;
    border: 1px solid color-mix(in srgb, var(--ink) 16%, transparent);
    border-radius: 0.5rem;
    padding: 0.625rem 0.75rem;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    transition: border-color 120ms ease, background 120ms ease;
  }
  .relay-opt:hover {
    border-color: color-mix(in srgb, var(--warm-accent) 35%, transparent);
  }
  .relay-opt.active {
    border-color: var(--warm-accent);
    background: var(--warm-accent-soft);
  }
  .relay-opt-name {
    font-family: "DM Mono", monospace;
    font-size: 0.8125rem;
    color: var(--ink);
  }
  .relay-opt.active .relay-opt-name {
    color: var(--warm-accent);
  }
  .relay-destination {
    font-family: "DM Mono", monospace;
    font-size: 0.8125rem;
    color: var(--ink);
    opacity: 0.7;
    margin: 0 0 0.75rem;
    word-break: break-all;
  }

  .relay-opt-desc {
    font-size: 0.75rem;
    opacity: 0.6;
    line-height: 1.45;
  }
  .wizard-prompt {
    font-size: 0.85rem;
    color: var(--ink);
    opacity: 0.85;
    margin: 0;
    line-height: 1.5;
  }
  .wizard-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.2rem;
  }
  .phrase-display {
    background: color-mix(in srgb, var(--margin-bg) 90%, var(--ink) 10%);
    padding: 0.6rem 0.8rem;
    border-radius: 0.25rem;
    word-spacing: 0.3em;
    line-height: 1.7;
    user-select: text;
    font-size: 0.9rem;
  }
  .phrase-reveal {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.4rem 0 0.2rem;
  }
  .phrase-warn {
    margin: 0;
    font-size: 0.85rem;
    line-height: 1.6;
    color: color-mix(in srgb, var(--warm-accent, var(--ink)) 85%, var(--ink));
  }
  .phrase-input {
    background: color-mix(in srgb, var(--margin-bg) 95%, var(--ink) 5%);
    border: 1px solid color-mix(in srgb, var(--ink) 20%, transparent);
    border-radius: 0.25rem;
    padding: 0.5rem;
    font-family: inherit;
    font-size: 0.85rem;
    line-height: 1.5;
    color: var(--ink);
    resize: vertical;
  }
  .text-input {
    background: color-mix(in srgb, var(--margin-bg) 95%, var(--ink) 5%);
    border: 1px solid color-mix(in srgb, var(--ink) 20%, transparent);
    border-radius: 0.25rem;
    padding: 0.4rem 0.6rem;
    font-family: inherit;
    font-size: 0.85rem;
    color: var(--ink);
    width: 100%;
    box-sizing: border-box;
  }
  .mono {
    font-family: "DM Mono", ui-monospace, monospace;
  }
  .relay-url {
    font-size: 0.8rem;
    opacity: 0.85;
    overflow-wrap: anywhere;
    word-break: break-word;
    text-align: right;
    line-height: 1.4;
  }
  .error-text {
    color: color-mix(in srgb, var(--ink) 60%, #c44 40%);
    font-size: 0.8rem;
    overflow-wrap: anywhere;
    word-break: break-word;
    text-align: right;
    line-height: 1.4;
  }

  .error-callout {
    margin: 0.75rem 0;
    padding: 0.625rem 0.875rem;
    background: color-mix(in srgb, #c44 5%, transparent);
    border-left: 2px solid color-mix(in srgb, #c44 50%, transparent);
    border-radius: 0.375rem;
  }
  /* Revoked-device note — same weight as .error-callout (this is the
     "sync is broken until you act" case) but its own class since the
     content is a paragraph + action button, not a label/text pair. */
  .revoked-note {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.625rem;
    margin: 0.75rem 0;
    padding: 0.875rem;
    background: color-mix(in srgb, #c44 5%, transparent);
    border-left: 2px solid color-mix(in srgb, #c44 50%, transparent);
    border-radius: 0.375rem;
  }
  .revoked-note p {
    margin: 0;
    font-size: 0.85rem;
    line-height: 1.6;
    color: color-mix(in srgb, var(--ink) 70%, #c44 30%);
  }
  .error-callout-label {
    font-family: "Inter", sans-serif;
    font-size: 0.6875rem;
    font-weight: 500;
    text-transform: lowercase;
    letter-spacing: 0.05em;
    color: color-mix(in srgb, var(--ink) 50%, #c44 50%);
    opacity: 0.85;
    margin-bottom: 0.25rem;
  }
  .error-callout-text {
    font-family: "DM Mono", ui-monospace, monospace;
    font-size: 0.75rem;
    color: color-mix(in srgb, var(--ink) 70%, #c44 30%);
    line-height: 1.5;
    overflow-wrap: anywhere;
    word-break: break-word;
    white-space: pre-wrap;
  }
  .error-row {
    padding-top: 0.4rem;
  }
  .op-log-stats {
    margin-top: 0.5rem;
    border-top: 1px solid color-mix(in srgb, var(--ink) 8%, transparent);
    padding-top: 0.5rem;
  }
  .op-log-stats summary {
    cursor: pointer;
    opacity: 0.5;
    user-select: none;
    padding: 0.2rem 0;
    font-size: 0.7rem;
  }
  .op-log-stats summary:hover {
    opacity: 0.85;
  }
  .op-log-stats[open] > summary {
    opacity: 0.85;
    margin-bottom: 0.4rem;
  }
  .kinds-list {
    font-size: 0.7rem;
    word-break: break-word;
  }
  .danger-zone {
    margin-top: 0.8rem;
    border-top: 1px solid color-mix(in srgb, var(--ink) 8%, transparent);
    padding-top: 0.5rem;
  }
  .danger-label {
    opacity: 0.55;
    font-size: 0.7rem;
    padding: 0.2rem 0 0.3rem;
  }
  .device-label {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  /* Numbered instruction list at the top of the existing-device pair
     wizard — quiet DM Mono labels, no imperative-therapy phrasing. */
  .pair-steps {
    list-style: none;
    counter-reset: pair-step;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .pair-steps li {
    counter-increment: pair-step;
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    font-family: "DM Mono", ui-monospace, monospace;
    font-size: 0.75rem;
    opacity: 0.65;
  }
  .pair-steps li::before {
    content: counter(pair-step);
    flex: 0 0 auto;
    min-width: 1rem;
    text-align: right;
    opacity: 0.6;
  }
  /* QR + phrase are co-primaries: the qr scales down to fit a narrow
     settings sheet (never overflows), the phrase sits directly beneath. */
  .pair-primaries {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.6rem;
  }
  .qr-img {
    display: block;
    width: 100%;
    max-width: 220px;
    margin: 0 auto;
    border-radius: 0.25rem;
  }
  .pair-phrase {
    width: 100%;
    box-sizing: border-box;
    font-size: 1.25rem;
    letter-spacing: 0.05em;
    text-align: center;
    background: color-mix(in srgb, var(--margin-bg) 90%, var(--ink) 10%);
    padding: 1rem 0.8rem;
    border-radius: 0.25rem;
    user-select: text;
    word-spacing: 0.2em;
    line-height: 1.5;
  }
  /* Device-label input + "waiting…" line form one quiet group at the
     bottom of the existing-device pair wizard. */
  .pair-wait-group {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-top: 0.2rem;
  }
  .sas-display {
    font-size: 1.4rem;
    letter-spacing: 0.25em;
    text-align: center;
    background: color-mix(in srgb, var(--margin-bg) 90%, var(--ink) 10%);
    padding: 0.8rem;
    border-radius: 0.25rem;
  }
  .pair-details {
    border: 1px solid color-mix(in srgb, var(--ink) 12%, transparent);
    border-radius: 0.25rem;
    padding: 0.5rem 0.7rem;
  }
  .pair-details summary {
    cursor: pointer;
    opacity: 0.75;
  }
  .pair-meta {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
    padding: 0.2rem 0;
  }
  .meta-label {
    opacity: 0.6;
    flex: 0 0 5rem;
  }
  .meta-value {
    font-size: 0.85rem;
    word-break: break-all;
    flex: 1;
    user-select: text;
  }
  .wizard-prompt-small {
    font-size: 0.8rem;
    opacity: 0.7;
    margin: 0;
  }
  .field-label {
    font-size: 0.72rem;
    opacity: 0.6;
    margin: 0.1rem 0 -0.2rem;
  }
  .num-input {
    width: 6rem;
    text-align: right;
    padding-right: 0.5rem;
  }

  /* In-app confirm dialog (replaces native confirm()/prompt()) — body
     copy and the destructive action button. Same ink-danger convention
     Settings.svelte uses for its own delete confirm, never accent. */
  .confirm-body {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.55;
  }
  .confirm-field {
    margin-top: 0.75rem;
  }
  .confirm-error {
    margin: 0.5rem 0 0;
    font-size: 0.8rem;
    color: var(--warm-accent);
  }
  .danger-slot {
    display: inline-flex;
    align-items: center;
  }
  .danger-slot :global(.btn) {
    color: var(--warm-accent);
    opacity: 0.75;
  }
  .danger-slot :global(.btn:hover:not(:disabled)) {
    opacity: 1;
  }
  .danger-slot :global(.btn:disabled) {
    opacity: 0.25;
  }

  /* Quiet "soon" pill for mobile-awareness controls that persist a
     preference the sync worker doesn't honor yet (worker.rs TODO 0.4.1). */
  .soon-tag {
    display: inline-block;
    vertical-align: middle;
    font-family: "DM Mono", monospace;
    font-size: 0.625rem;
    letter-spacing: 0.05em;
    color: var(--ink);
    border: 1px solid color-mix(in srgb, var(--ink) 30%, transparent);
    border-radius: 1rem;
    padding: 0.0625rem 0.5rem;
    margin-left: 0.375rem;
    opacity: 0.55;
  }

  /* ── sync sub-tabs (horizontal pill bar replacing the inner sidebar) ── */
  .sync-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    padding: 0 0 0.875rem;
    margin-bottom: 0.875rem;
    border-bottom: 1px solid color-mix(in srgb, var(--ink) 10%, transparent);
  }
  .sync-tab {
    appearance: none;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 0.375rem;
    padding: 0.3125rem 0.75rem;
    font-family: "Lora", Georgia, serif;
    font-style: italic;
    font-size: 0.8125rem;
    color: var(--ink);
    opacity: 0.55;
    cursor: pointer;
    transition: opacity 120ms cubic-bezier(0.2, 0, 0, 1),
                background 120ms cubic-bezier(0.2, 0, 0, 1),
                color 120ms cubic-bezier(0.2, 0, 0, 1);
  }
  .sync-tab:hover {
    opacity: 0.85;
    background: color-mix(in srgb, var(--ink) 4%, transparent);
  }
  .sync-tab.active {
    color: var(--warm-accent);
    opacity: 1;
    background: var(--warm-accent-soft);
  }
  @media (pointer: coarse), (max-width: 480px), (orientation: landscape) and (max-height: 480px) {
    .sync-tabs {
      flex-wrap: nowrap;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
      padding-bottom: 0.625rem;
      margin-bottom: 0.75rem;
    }
    .sync-tabs::-webkit-scrollbar { display: none; }
    .sync-tab {
      padding: 0.5rem 0.875rem;
      font-size: 0.875rem;
      min-height: max(var(--touch-target), 44px);
      flex-shrink: 0;
    }
  }
  .sync-pane {
    min-height: 12rem;
  }
  /* Tappable hint on otherwise-static spans so the user knows they can
     copy. The cursor cue helps on desktop too. */
  .tappable {
    cursor: pointer;
  }
  /* Lightweight toast — pinned to the viewport so it's visible no
     matter how far the user has scrolled in the settings sheet.
     On a phone it must also clear the MobileActionBar — settings keeps the
     bar visible (hideBar={false}), and the bar is fixed at z-index 1000, so
     a bare 1.25rem left this confirmation entirely behind ~86px of opaque
     bar: the "copied" for the recovery phrase never appeared. Reserved with
     --mobile-bar-h, the bar's real height, inside the same phone query the
     bar mounts under — the token is defined on :root unconditionally, so
     applying it here without the query would shift the toast on desktop
     where there is no bar at all. */
  .copy-toast {
    position: fixed;
    bottom: 1.25rem;
    left: 50%;
    transform: translateX(-50%);
    background: color-mix(in srgb, var(--ink) 90%, transparent);
    color: var(--margin-bg);
    padding: 0.5rem 1rem;
    border-radius: 1rem;
    font-size: 0.85rem;
    z-index: 100;
    pointer-events: none;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
  }

  @media (max-width: 480px), (orientation: landscape) and (max-height: 480px) {
    .copy-toast {
      bottom: calc(var(--mobile-bar-h) + 1.25rem);
    }
  }
  /* Mobile: enlarge touch targets. 44px is the Apple/Material minimum;
     the phrase/SAS displays get a little more breathing room because
     they're the primary copy surfaces during pairing. */
  @media (max-width: 768px), (orientation: landscape) and (max-height: 480px) {
    .phrase-display,
    .pair-phrase,
    .sas-display {
      padding: 1rem;
      font-size: 1rem;
      min-height: 3rem;
      cursor: pointer;
    }
    .text-input,
    .phrase-input {
      padding: 0.75rem;
      font-size: 1rem;
      min-height: 2.75rem;
    }
    .num-input {
      width: 5rem;
      min-height: 2.75rem;
    }
  }

  /* Same register as Row's own `description` — a note that belongs to the
     row above it rather than a new kind of text. Nudged up so it reads as
     part of that row and not as a stray paragraph. */
  .storage-note {
    font-family: "Inter", sans-serif;
    font-size: 0.6875rem;
    color: var(--ink);
    opacity: 0.45;
    line-height: 1.4;
    max-width: 22rem;
    margin: -0.375rem 0 0.25rem;
  }

  /* Storage panel — slim usage bar under the used / cap row. The
     warn fill kicks in above 90% so the user sees the colour shift
     well before the relay starts refusing uploads. */
  .quota-bar {
    height: 4px;
    background: color-mix(in srgb, var(--margin-bg) 80%, var(--ink) 5%);
    border-radius: 2px;
    margin: 0.25rem 0;
    overflow: hidden;
  }
  .quota-bar-fill {
    height: 100%;
    background: color-mix(in srgb, var(--ink) 40%, transparent);
    transition: width 200ms ease;
  }
  .quota-bar-fill.warn {
    background: color-mix(in srgb, var(--ink) 30%, #c44 50%);
  }

  /* Phone overrides — keep number inputs reachable. Sync tab pill
     scroll behavior lives in the merged (pointer: coarse), (max-width:
     480px) block above. */
  @media (max-width: 480px), (orientation: landscape) and (max-height: 480px) {
    .num-input {
      width: 5rem;
    }
  }

  /* ── license redeem group ── */
  .redeem-group {
    margin-top: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .redeem-form {
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }
  .redeem-input {
    flex: 1;
    min-width: 0;
  }
  .redeem-success {
    font-size: 0.82rem;
    opacity: 0.8;
    line-height: 1.5;
  }
  .redeem-error {
    font-size: 0.82rem;
    color: color-mix(in srgb, var(--ink) 60%, #c44 40%);
    line-height: 1.5;
  }

  /* ── web access group ── */
  .web-access-group {
    margin-top: 0.75rem;
    border-top: 1px solid color-mix(in srgb, var(--ink) 8%, transparent);
    padding-top: 0.5rem;
  }
  .group-label {
    opacity: 0.55;
    font-size: 0.7rem;
    padding: 0.2rem 0 0.3rem;
  }
  .web-access-desc {
    font-size: 0.82rem;
    opacity: 0.72;
    margin: 0.25rem 0 0.5rem;
    line-height: 1.5;
  }
  .web-access-form {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-top: 0.5rem;
  }
  .web-access-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.2rem;
  }
  .email-value {
    font-size: 0.82rem;
    overflow-wrap: anywhere;
    word-break: break-word;
    text-align: right;
    line-height: 1.4;
  }
  .web-success {
    font-size: 0.82rem;
    opacity: 0.8;
    margin-top: 0.4rem;
    line-height: 1.5;
  }
</style>
