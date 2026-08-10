<!--
  SyncStatusPill — a quiet badge in PAGE's top-right that surfaces
  the sync engine's current state.

  Design rules (spec §12 + brand voice):
    * Renders NOTHING when sync isn't configured. Users who never
      opted into sync see no chrome change.
    * Renders subtly when everything is fine ("synced") so the pill
      doesn't shout for attention. It only earns visual weight when
      something is wrong (offline, paused) — the failure case is the
      one users need to notice.
    * Click opens Settings → sync section so the user can read the
      full error / pause / pair from one tap.

  States, derived from `sync_status` DTO + the wall clock:
    * "synced"   — enabled + last_sync_at_ms within ~2× tick window
    * "syncing"  — enabled + no successful sync yet (just enabled)
    * "offline"  — enabled + last_error present, OR no sync in too long
    * "paused"   — configured + !enabled
    * (hidden)   — !configured

  No "syncing" spinner during a tick — the polling worker is async
  on a 30s cadence; users don't experience save → sync as a single
  blocking event, so a spinner would imply latency that isn't real.
-->
<script>
  import { onMount, onDestroy } from "svelte";
  import { listen } from "@tauri-apps/api/event";
  import { syncStatus, syncErrorHistory } from "../lib/api.js";
  import { isPhoneViewport, watchPhoneViewport } from "../lib/responsive.js";
  import BottomSheet from "../lib/ui/BottomSheet.svelte";

  /** @type {{ onOpen?: () => void }} */
  let { onOpen = () => {} } = $props();

  // On phone the error history opens as a bottom sheet (like the date picker
  // and trail selector) instead of an anchored popover — the pill is just a
  // dot there, so a pill-anchored popover lands off to the side.
  let isPhone = $state(isPhoneViewport());
  $effect(() => {
    const unwatch = watchPhoneViewport((m) => { isPhone = m; });
    return unwatch;
  });

  let status = $state(/** @type {null | object} */ (null));
  /** @type {number | undefined} */
  let pollHandle;
  /** @type {Array<() => void>} */
  let unlistens = [];

  // Error-history popover state. Opened when the user clicks the pill
  // while it's in an error state (offline / full). Click anywhere
  // outside closes it. Kept informational — the only interactive
  // element inside is the "open settings" link that delegates to
  // onOpen so users can act on the error.
  let popoverOpen = $state(false);
  let errors = $state(/** @type {Array<{at_ms: number, kind: string, message: string}>} */ ([]));

  // Poll on the same cadence as the worker so we don't show stale
  // state for longer than the worker would have refreshed it. The
  // poll is a fallback now: the worker emits sync-pulled / sync-error
  // / sync-status-changed / sync-quota events that wake us up
  // immediately. Polling still runs because mid-session worker
  // respawns (sync_setup / pair_new_complete) lose the event
  // channel — see the NOTE in commands.rs.
  const POLL_INTERVAL_MS = 30_000;
  // After this long without a successful sync we flip to "offline"
  // even if the relay never returned an error — covers the
  // "transport timing out indefinitely" case the wire layer can't
  // surface as an explicit error.
  const STALE_AFTER_MS = 5 * 60_000;

  onMount(async () => {
    await refresh();
    pollHandle = window.setInterval(refresh, POLL_INTERVAL_MS);
    // Worker-emitted events refresh the pill within one tick instead
    // of waiting on the 30s poll. All four events route to the same
    // refresh() because the pill always renders from the latest
    // sync_status snapshot — the event channel is just a wake-up.
    unlistens = await Promise.all([
      listen("sync-pulled", () => refresh()),
      listen("sync-error", () => refresh()),
      listen("sync-status-changed", () => refresh()),
      listen("sync-quota", () => refresh()),
    ]);
  });

  onDestroy(() => {
    if (pollHandle !== undefined) window.clearInterval(pollHandle);
    for (const u of unlistens) {
      try {
        u();
      } catch {
        // listener teardown should never throw; swallow if it does
        // so onDestroy stays exception-safe.
      }
    }
    unlistens = [];
  });

  async function refresh() {
    try {
      status = await syncStatus();
    } catch {
      // Surface as offline rather than blanking the pill — if the
      // status command itself failed, sync probably is broken.
      status = { ...status, last_error: "status unavailable" };
    }
  }

  /// Quota errors are surfaced distinctly from generic offline state
  /// because they're actionable — the user can delete data, prune
  /// pins, or upgrade their plan. The relay returns 413 with code
  /// `storage_cap_exceeded` (or 429 with `quota_exceeded` for the
  /// hosted-relay rate-tier case); both land in `last_error` as a
  /// stringified WireError::Wire, which we match on substrings.
  function isQuotaError(err) {
    if (!err) return false;
    return /\b413\b|storage_cap_exceeded|quota_exceeded|storage_full/i.test(err);
  }

  let label = $derived.by(() => {
    if (!status || !status.configured) return null;
    if (!status.enabled) return "paused";
    if (status.last_error) {
      return isQuotaError(status.last_error) ? "full" : "offline";
    }
    if (!status.last_sync_at_ms) return "syncing";
    const age = Date.now() - status.last_sync_at_ms;
    if (age > STALE_AFTER_MS) return "offline";
    return "synced";
  });

  /// True iff the pill is currently in a state worth showing the
  /// error-history popover for. Synced / syncing / paused have
  /// nothing to expand into — clicking them still routes to onOpen.
  let isErrorState = $derived(label === "offline" || label === "full");

  async function handleClick() {
    if (isErrorState) {
      // Toggle the popover. Lazy-fetch the history only when opening
      // so the common case (pill never clicked) doesn't query the DB.
      if (!popoverOpen) {
        try {
          errors = await syncErrorHistory(10);
        } catch {
          errors = [];
        }
      }
      popoverOpen = !popoverOpen;
    } else {
      onOpen();
    }
  }

  function closePopover() {
    popoverOpen = false;
  }

  function relativeAge(atMs) {
    const age = Date.now() - atMs;
    if (age < 60_000) return "just now";
    const mins = Math.floor(age / 60_000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  let tooltip = $derived.by(() => {
    if (!status || !status.configured) return "";
    if (!status.enabled) return "sync paused — tap to resume";
    if (status.last_error) {
      if (isQuotaError(status.last_error)) {
        return "storage full — delete data or upgrade your relay";
      }
      return `sync error: ${status.last_error}`;
    }
    if (!status.last_sync_at_ms) return "waiting for first sync…";
    const age = Date.now() - status.last_sync_at_ms;
    if (age < 60_000) return "last synced just now";
    const mins = Math.floor(age / 60_000);
    if (mins < 60) return `last synced ${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `last synced ${hours}h ago`;
    return `last synced ${Math.floor(hours / 24)}d ago`;
  });
</script>

{#if label}
  <div class="wrap">
    <button
      class="pill label"
      class:synced={label === "synced"}
      class:syncing={label === "syncing"}
      class:offline={label === "offline"}
      class:paused={label === "paused"}
      class:full={label === "full"}
      class:active={popoverOpen}
      title={tooltip}
      onclick={handleClick}
    >
      <span class="dot"></span>
      <span class="text">{label}</span>
    </button>

    {#if isPhone}
      <!-- Phone: bottom sheet, consistent with the date picker / trail sheet. -->
      <BottomSheet open={popoverOpen && isErrorState} onClose={closePopover} title="sync errors">
        <div class="sheet-errors">{@render errorBody()}</div>
      </BottomSheet>
    {:else if popoverOpen && isErrorState}
      <!-- Desktop: anchored popover. The scrim captures the dismiss tap so a
           single click outside closes it without forwarding to what's behind. -->
      <button
        class="scrim"
        aria-label="close error history"
        onclick={closePopover}
      ></button>
      <div class="popover" role="dialog" aria-label="recent sync errors">
        {@render errorBody()}
      </div>
    {/if}
  </div>
{/if}

{#snippet errorBody()}
  <div class="popover-head">recent sync errors</div>
  {#if errors.length === 0}
    <div class="popover-empty">no errors recorded yet</div>
  {:else}
    <ul class="popover-list">
      {#each errors as err}
        <li class="popover-row">
          <div class="popover-meta">
            <span class="kind kind-{err.kind}">{err.kind}</span>
            <span class="age">{relativeAge(err.at_ms)}</span>
          </div>
          <div class="msg">{err.message}</div>
        </li>
      {/each}
    </ul>
  {/if}
  <button
    class="popover-action"
    onclick={() => {
      closePopover();
      onOpen();
    }}
  >open settings →</button>
{/snippet}

<style>
  .wrap {
    position: relative;
    display: inline-block;
  }
  /* Match the sibling header chips (TriggerChip): same Inter font, height,
     radius, border and padding, so the sync-status control reads as one
     family with "trail" / "pins". The status dot stays as this control's
     own glyph (its equivalent of the pins ↗ icon); state classes below
     only recolor it. */
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    min-height: 2rem;
    background: transparent;
    border: 1px solid color-mix(in srgb, var(--ink) 15%, transparent);
    border-radius: 0.5rem;
    padding: 0.4375rem 0.6875rem;
    cursor: pointer;
    font-family: "Inter", sans-serif;
    font-size: 0.8125rem;
    line-height: 1.3;
    color: var(--ink);
    opacity: 0.92;
    transition: background-color 0.12s, color 0.15s, border-color 0.15s, opacity 0.15s;
  }
  .pill:hover {
    background: color-mix(in srgb, var(--ink) 5%, transparent);
    color: var(--ink);
  }
  .pill:active {
    transform: scale(0.97);
  }
  .pill:focus-visible {
    outline: 1.5px solid var(--warm-accent-soft);
    outline-offset: -2px;
  }
  /* Pressed (click) + open (popover) both show the same warm-accent
     treatment as the memory mode chips' active state (TriggerChip.active),
     so clicking any header control gives the one consistent orange feedback. */
  .pill:active,
  .pill.active {
    background: var(--warm-accent-soft);
    color: var(--warm-accent);
    border-color: color-mix(in srgb, var(--warm-accent) 25%, transparent);
    opacity: 1;
  }
  /* Keep the colored status dot legible against the warm-accent fill. */
  .pill.active .dot,
  .pill:active .dot {
    background: var(--warm-accent);
  }
  .dot {
    width: 0.4375rem;
    height: 0.4375rem;
    border-radius: 50%;
    background: currentColor;
    flex: 0 0 auto;
  }
  /* Synced — quiet. Almost subliminal. */
  .pill.synced {
    color: color-mix(in srgb, var(--ink) 35%, transparent);
  }
  /* Syncing — neutral, pulses gently to show motion. */
  .pill.syncing .dot {
    animation: pulse 1.4s ease-in-out infinite;
  }
  /* Offline — earns weight. The whole point of the pill is to make
     this state visible without a modal popup. */
  .pill.offline {
    color: color-mix(in srgb, var(--ink) 50%, #b95 50%);
    border-color: color-mix(in srgb, var(--ink) 18%, #b95 30%);
  }
  /* Full — actionable warning. Distinct hue from offline so users
     understand "your storage cap is reached" is a different problem
     from "the relay can't be reached". */
  .pill.full {
    color: color-mix(in srgb, var(--ink) 40%, #c54 60%);
    border-color: color-mix(in srgb, var(--ink) 18%, #c54 35%);
  }
  /* Paused — present but quiet. User chose this state. */
  .pill.paused {
    color: color-mix(in srgb, var(--ink) 45%, transparent);
  }
  @keyframes pulse {
    0%, 100% { opacity: 0.6; }
    50%      { opacity: 1; }
  }

  /* Click-outside scrim. Invisible — its only job is to capture the
     dismiss tap. Sits between the pill and the popover so the popover
     itself stays clickable. */
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: transparent;
    border: none;
    padding: 0;
    cursor: default;
  }

  /* Popover anchored under the pill. Right-aligned because the pill
     sits in PAGE's top-right; left-anchoring would push the panel off
     screen on narrow windows. */
  .popover {
    position: absolute;
    top: calc(100% + 0.35rem);
    right: 0;
    z-index: 51;
    min-width: 18rem;
    max-width: 24rem;
    background: var(--canvas, #f5f0e8);
    border: 1px solid color-mix(in srgb, var(--ink) 18%, transparent);
    border-radius: 0.5rem;
    box-shadow: 0 4px 16px color-mix(in srgb, var(--ink) 12%, transparent);
    padding: 0.55rem 0.65rem 0.5rem;
    font-size: 0.7rem;
    color: var(--ink);
  }
  .popover-head {
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: color-mix(in srgb, var(--ink) 50%, transparent);
    margin-bottom: 0.35rem;
  }
  .popover-empty {
    color: color-mix(in srgb, var(--ink) 55%, transparent);
    padding: 0.25rem 0 0.4rem;
  }
  .popover-list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 18rem;
    overflow-y: auto;
  }
  .popover-row {
    padding: 0.3rem 0;
    border-top: 1px solid color-mix(in srgb, var(--ink) 8%, transparent);
  }
  .popover-row:first-child {
    border-top: none;
  }
  .popover-meta {
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
    margin-bottom: 0.1rem;
  }
  .kind {
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.05rem 0.35rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--ink) 15%, transparent);
    color: color-mix(in srgb, var(--ink) 65%, transparent);
  }
  .kind-quota,
  .kind-rate_limit {
    border-color: color-mix(in srgb, var(--ink) 15%, #c54 35%);
    color: color-mix(in srgb, var(--ink) 50%, #c54 50%);
  }
  .kind-network,
  .kind-auth {
    border-color: color-mix(in srgb, var(--ink) 15%, #b95 30%);
    color: color-mix(in srgb, var(--ink) 55%, #b95 45%);
  }
  .age {
    font-size: 0.62rem;
    color: color-mix(in srgb, var(--ink) 50%, transparent);
  }
  .msg {
    color: color-mix(in srgb, var(--ink) 80%, transparent);
    word-break: break-word;
  }
  .popover-action {
    margin-top: 0.5rem;
    width: 100%;
    background: transparent;
    border: 1px solid color-mix(in srgb, var(--ink) 15%, transparent);
    border-radius: 0.35rem;
    padding: 0.3rem 0.5rem;
    font-size: 0.65rem;
    color: color-mix(in srgb, var(--ink) 70%, transparent);
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
  }
  .popover-action:hover {
    color: var(--ink);
    border-color: color-mix(in srgb, var(--ink) 30%, transparent);
  }

  /* Bottom-sheet variant of the error list (phone). The base .popover-*
     content styles still apply to the rendered snippet; these add comfy
     sheet spacing + bigger tap targets, like PageNav's .sheet-cal. */
  .sheet-errors {
    padding: 0.25rem 0 0.5rem;
  }
  .sheet-errors :global(.popover-list) {
    max-height: 50vh;
  }
  .sheet-errors :global(.popover-action) {
    padding: 0.625rem;
    font-size: 0.8125rem;
  }

  /* Phone: collapse to the status dot only. The word ("offline" / "synced")
     is the longest chip in the header and the colored dot already carries the
     state; the full status stays one tap away (tooltip / settings / error
     popover). Keeps the small-screen header compact. */
  @media (max-width: 480px), (orientation: landscape) and (max-height: 480px) {
    .pill .text { display: none; }
    .pill {
      gap: 0;
      padding: 0.4375rem;
      min-width: 2rem;
      justify-content: center;
    }
  }
</style>
