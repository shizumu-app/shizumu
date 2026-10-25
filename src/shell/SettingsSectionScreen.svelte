<!--
  One settings section, pushed.

  It renders whatever `settingsSection` describes rather than knowing any
  setting by name: four row kinds, one shape each. That is what lets one
  component stand behind every section, which is what keeps the host's
  pushed entries to a single `kind` — Stack calls `entry.view()` with no
  arguments, so a screen cannot be told which section it is, and a second
  section component would mean a second kind, a second snippet and a
  second row of the host's kind-to-view chain per section added.

  ── ONE GROUP, AND EVERY ROW SAYS WHAT IT IS ──────────────────────────

  The rows sit in a single `RowGroup` on the section's surface, with the
  line between them the group's. A section is one list about one setting,
  so there is nothing to name over it — the bar already carries the
  section's title and its blurb — and a group with no eyebrow is that
  surface and nothing more.

  A choice row is `kind="choice"`: it selects and pops, so it draws no
  chevron (row-kind.js — the chevron is the promise that a tap opens a
  screen, and a tone option opens none). Every option row used to carry
  one, a wart this file's header recorded and the trail index shipped
  alongside, because making the chevron optional was a change to `Row`'s
  §4 shape that the first pass could not photograph; the visual pass made
  that change, and this is the screen it was waiting for.

  ── A CHOICE ROW IS SELECTABLE EVEN WHEN IT IS THE CHOSEN ONE ─────────

  Picking the tone that is already showing is inert, and dropping the
  row's onSelect to say so would swap its element mid-list — `Row` renders
  a control only when it does something — so the chosen row alone would
  lose its tab stop, and the list would reflow as the reader moved through
  it. The word in the value column is what says which one is current.

  (Spelled without naming the element, because the shell rules test's scan
  for a raw control is a whole-file substring check that does not strip
  comments. MemoryScreen's header records the same dodge for the tap
  token.)

  ── THE FOURTH KIND IS PROSE, UNDER THE GROUP, AND ONLY THE MODEL DECIDES IT APPEARS

  A `note` row is a sentence about the row above it, and today exactly one
  thing produces one: the layout switch, which is the only control on the
  phone whose effect waits for the next boot. It is a `kind` like the
  others rather than an `{#if}` about that switch, so this component still
  knows no setting by name — the model decides when there is something to
  say, and this decides what a sentence looks like: a `Note`, the shell's
  one primitive for a sentence of explanation.

  It renders UNDER the group, not inside its body. The body rules every
  direct child after the first, and a line between the note and the switch
  it explains is exactly the wrong line — it would read as a divider
  between two rows rather than as a caption on one. Today the only note is
  the last row of labs, so "under the group" and "under its switch" are
  the same place; the day a section puts a row after a note is the day
  RowGroup needs a way to hold prose unruled, and that is a change to the
  primitive, not a wrapper here.

  ── THE BLURB RIDES THE BAR ───────────────────────────────────────────

  `NavBar` already has a subtitle line and already drops it on collapse.
  The desktop puts the same sentence in a hero above the list and hides it
  on phone widths; here it costs no band of its own and disappears under a
  scroll for free.
-->
<script>
  import Screen from "./ui/Screen.svelte";
  import NavBar from "./ui/NavBar.svelte";
  import Row from "./ui/Row.svelte";
  import RowGroup from "./ui/RowGroup.svelte";
  import Note from "./ui/Note.svelte";
  import { CHOSEN } from "./settings-model.js";

  /** @type {{
    section?: {title: string, blurb?: string, rows: Array<any>} | null,
    onBack?: (() => void) | null,
    onChoose?: ((rowId: string) => void) | null,
    onToggle?: ((rowId: string, checked: boolean) => void) | null,
  }} */
  let { section = null, onBack = null, onChoose = null, onToggle = null } = $props();

  const rows = $derived(section?.rows ?? []);
  // The split the header argues: rows in the group, sentences under it.
  const listed = $derived(rows.filter((row) => row.kind !== "note"));
  const notes = $derived(rows.filter((row) => row.kind === "note"));
</script>

<Screen>
  {#snippet nav()}
    <NavBar title={section?.title ?? ""} subtitle={section?.blurb ?? ""} {onBack} />
  {/snippet}

  {#if listed.length > 0}
    <RowGroup>
      {#each listed as row (row.id)}
        {#if row.kind === "toggle"}
          <Row
            label={row.label}
            toggle
            checked={row.checked}
            onToggle={onToggle ? (next) => onToggle(row.id, next) : null}
          />
        {:else if row.kind === "choice"}
          <Row
            label={row.label}
            value={row.chosen ? CHOSEN : ""}
            kind="choice"
            onSelect={onChoose ? () => onChoose(row.id) : null}
          />
        {:else}
          <Row label={row.label} value={row.value ?? ""} />
        {/if}
      {/each}
    </RowGroup>
  {/if}

  {#each notes as row (row.id)}
    <Note>{row.text}</Note>
  {/each}
</Screen>
