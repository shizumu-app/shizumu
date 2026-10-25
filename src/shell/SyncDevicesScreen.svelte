<!--
  Sync: what this device is, what else is on the account, and the ways
  onto one — pairing, and, for a phone with no other device, setup.

  §2 gives sync a stack of its own — "devices → pair → scanner (full-screen
  camera with its own back)" — and this is its root. It is pushed FROM the
  settings root, so it sits at depth 2; the pair screen and the setup
  screen sit at 3, and the scanner at 4 under pair.

  ── THREE GROUPS: STATUS, DEVICES, AND THE ACTS ───────────────────────

  `status` holds the state row — a toggle where there is an account to
  sync with (`syncToggleShows`), inert where there is not — with
  `syncStateNote`'s sentence as a `Note` under the group when there is one — a caption on the surface,
  not a row inside it, so the group's rule never falls between the word
  and the sentence explaining it. `devices` holds the list, and exists
  only when there is a list: an eyebrow over nothing would name a thing
  that is not there. The acts are ACTION rows in a flush group of their
  own — accent, no chevron, no surface — because starting a pairing or a
  setup is something this device does, not a screen it opens, and a lone
  act in an inset card would read as a button in a box.

  ── TWO ACTS, AND WHEN THE SECOND SHOWS ───────────────────────────────

  `pair this device` is always offered. `set up sync` is offered by
  `setupRowShows` (sync-model.js): off-account, and not while a pairing
  is mid-exchange. It was not offered at all until 2026-09-17 — Task 2
  argued a phone joins an account that already exists, and the first
  writer whose phone was their ONLY device found a pair row with nothing
  to pair with. The screen takes `pairPhase` for that decision the way it
  takes `nowMs` for the dates: a fact the host holds, passed down, so the
  model and not the markup says when the door is open.

  The screen used to draw `Divider`s in padded wrappers between those
  three, back when a row underlined itself and a break between groups was
  the one line that needed saying. A group that names itself and sits on
  its own surface has nothing left for a rule to say.

  ── WHY THREE LEVELS NEEDED NO NEW MACHINERY ──────────────────────────

  Task 1 found that Stack calls `entry.view()` with no arguments, so a
  pushed screen cannot be told which SECTION it is — which is what caps
  settings at two levels, because its four sections are one component
  parameterised by a single host variable. Sync is not that shape. Its
  three levels are three different components with three different jobs,
  so each is its own `kind` in the host's push list and its own snippet
  beside the others, and Stack renders arbitrary depth of those already
  (it keeps the top two alive and registers a navstack entry per element).
  Nothing was added: no router, no second navigation, no id variable. The
  limit Task 1 recorded is a limit on one component standing for many
  screens, not a limit on depth.

  ── IT TAKES ITS ROWS, IT DOES NOT FETCH THEM ─────────────────────────

  PinsScreen's arrangement and its reason: the host fetches on the push,
  and a fetch tied to the event that opens a surface cannot be stale. The
  host re-reads after a pairing completes for the same reason — a device
  list that still shows one row after the writer just added a second is
  the shape of a list nobody trusts.

  ── DISCONNECT, LAST AND ON ITS OWN ──────────────────────────────────

  Task 9g. `disconnect` is the screen's last row, in a flush group of its
  own below the acts, destructive-kind, and only where `disconnectRowShows`
  says there is an account to leave. It does not reset: it calls
  `onDisconnect`, and the host opens the `sync-disconnect` sheet whose
  destructive row does (9e's trail delete, the same shape). Last and apart
  because the row that takes something away is not the row a thumb lands
  on by accident.

  ── NO REVOKE ─────────────────────────────────────────────────────────

  The desktop's device rows carry one, behind a confirmation Modal. It
  has not been asked for on the phone, and removing ANOTHER device from
  the account is its own task. Named in sync-model.js's header alongside
  the rest of what the 2392-line desktop surface does that this stack
  does not.

  ── nowMs IS A PROP ───────────────────────────────────────────────────

  "Seen 20 days ago" is arithmetic against a clock, and a screen that read
  the clock itself would be a screen no test can pin. ReadingScreen takes
  its reference dates the same way and for the same reason.
-->
<script>
  import Screen from "./ui/Screen.svelte";
  import NavBar from "./ui/NavBar.svelte";
  import Row from "./ui/Row.svelte";
  import RowGroup from "./ui/RowGroup.svelte";
  import Note from "./ui/Note.svelte";
  import Empty from "../lib/ui/Empty.svelte";
  import {
    DISCONNECT,
    SET_UP_SYNC,
    deviceRows,
    disconnectRowShows,
    pairRowLabel,
    pairSide,
    setupRowShows,
    syncStateLabel,
    syncStateNote,
    syncToggleShows,
  } from "./sync-model.js";

  /** @type {{
    status?: object | null,
    devices?: any[],
    loading?: boolean,
    nowMs?: number,
    pairPhase?: string,
    onBack?: (() => void) | null,
    onPair?: (() => void) | null,
    onSetup?: (() => void) | null,
    onEnabled?: ((enabled: boolean) => void) | null,
    onDisconnect?: (() => void) | null,
  }} */
  let {
    status = null,
    devices = [],
    loading = false,
    nowMs = 0,
    pairPhase = "waiting",
    onBack = null,
    onPair = null,
    onSetup = null,
    onEnabled = null,
    onDisconnect = null,
  } = $props();

  const state = $derived(syncStateLabel(status));
  const note = $derived(syncStateNote(status));
  const rows = $derived(deviceRows({ devices, status, nowMs }));
  const side = $derived(pairSide(status));
  const offersSetup = $derived(setupRowShows({ status, pairPhase }));
  const offersToggle = $derived(syncToggleShows(status));
  const offersDisconnect = $derived(disconnectRowShows(status));
</script>

<Screen>
  {#snippet nav()}
    <NavBar title="sync" {onBack} />
  {/snippet}

  <RowGroup eyebrow="status">
    <!-- A toggle on an account, inert without one. Enrolment leaves sync
         off and only the wizard's last step ever turned it on, so this row
         is the one way back for a phone that reached `off` any other way —
         see sync-model.js's `syncToggleShows` and the omission it reverses.
         Inert off-account for about's build-row reason: a switch with
         nothing behind it promises an interaction it cannot deliver. -->
    {#if offersToggle}
      <Row
        label="sync"
        toggle
        checked={state === "on"}
        onToggle={onEnabled ? (next) => onEnabled(next) : null}
      />
    {:else}
      <Row label="sync" value={state} />
    {/if}
  </RowGroup>

  {#if note}
    <Note>{note}</Note>
  {/if}

  {#if rows.length > 0}
    <RowGroup eyebrow="devices">
      {#each rows as row (row.id)}
        <Row label={row.label} value={row.value} />
      {/each}
    </RowGroup>
  {:else if loading}
    <!-- Two empty states, not one, on PinsScreen's rule: "no devices" and
         "not read yet" are different facts, and showing the first while
         the round trip is in flight tells someone with three devices that
         they have none.

         There is no third state for "configured but the list came back
         empty": the account always holds at least the device asking, so
         an empty list on a configured install is a failed read, which
         lands here as the loading state clearing with nothing behind it —
         and the state row above still says `on`. -->
    <Empty>
      {#snippet title()}reading the devices{/snippet}
    </Empty>
  {/if}

  <RowGroup flush>
    <Row label={pairRowLabel(side)} kind="action" onSelect={onPair ? () => onPair() : null} />
    {#if offersSetup}
      <Row label={SET_UP_SYNC} kind="action" onSelect={onSetup ? () => onSetup() : null} />
    {/if}
  </RowGroup>

  {#if offersDisconnect}
    <RowGroup flush>
      <Row
        label={DISCONNECT}
        kind="destructive"
        destructive={true}
        onSelect={onDisconnect ? () => onDisconnect() : null}
      />
    </RowGroup>
  {/if}
</Screen>
