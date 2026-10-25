<!--
  A trail: its name, where it sits, and the way to delete it.

  Pushed from memory's trails sheet (the row memory is already showing —
  trail-manage.js's `scopeRowAction` says why that row), because
  trail-sheet-model.js's header put trail management in memory and not on
  the writing surface. The laptop's LineageSelector does the same three
  things with the same three commands; fold stays laptop-only.

  ── THE ANATOMY ───────────────────────────────────────────────────────

  The bar says `trail`. Under it the name, in a TitleField at Title's size
  — the pin screen's shape, for the pin screen's reason: the name is the
  writer's own words and is edited where it is read. Then the rows
  (`trailScreenRows`): `move under…` with where the trail sits now, and
  `delete trail`, destructive and last.

  ── WHEN THE NAME IS WRITTEN ──────────────────────────────────────────

  On commit — blur or return (TitleField) — and, through `onDraft`, when
  the screen is left with the field still holding a change: the host
  writes the last draft on pop, the pin screen's rule (a screen cannot
  save itself from inside its own teardown, and a field removed while
  focused fires no blur to commit with). What a commit MEANS is
  `renameIntent`'s: an emptied field puts the name back, and a name
  another trail carries is refused here with the laptop's sentence,
  without the round trip.

  NOT THE CANVAS REGION, PinArtifactScreen's call: a swipe up at the
  bottom of a pushed screen must not leave for memory.
-->
<script>
  import Screen from "./ui/Screen.svelte";
  import NavBar from "./ui/NavBar.svelte";
  import TitleField from "./ui/TitleField.svelte";
  import RowGroup from "./ui/RowGroup.svelte";
  import Row from "./ui/Row.svelte";
  import Note from "./ui/Note.svelte";
  import Empty from "../lib/ui/Empty.svelte";
  import { renameIntent, trailErrorText, trailScreenRows } from "./trail-manage.js";

  /** @type {{
    lineage?: any,
    lineages?: any[],
    error?: string,
    onBack?: (() => void) | null,
    onRename?: ((name: string) => void) | null,
    onDraft?: ((name: string) => void) | null,
    onRow?: ((id: string) => void) | null,
  }} */
  let {
    lineage = null,
    lineages = [],
    // The host's last failure (a rename or a move the backend refused).
    error = "",
    onBack = null,
    onRename = null,
    onDraft = null,
    onRow = null,
  } = $props();

  /** The field's text — a writable derived, so a rename that lands (or a
   *  sync pull that renames the trail elsewhere) re-seeds it. */
  let name = $derived(lineage?.name ?? "");
  /** A refusal this screen made itself (a taken name). */
  let localError = $state("");

  const rows = $derived(trailScreenRows({ lineage, lineages }));
  const shownError = $derived(localError || error);

  $effect(() => {
    onDraft?.(name);
  });

  function commit() {
    const intent = renameIntent({ lineage, lineages, typed: name });
    localError = "";
    if (intent.action === "revert") {
      name = lineage?.name ?? "";
    } else if (intent.action === "taken") {
      localError = trailErrorText("lineage_name_taken", intent.name);
    } else if (intent.action === "rename") {
      onRename?.(intent.name);
    }
  }
</script>

<Screen>
  {#snippet nav()}
    <NavBar title="trail" {onBack} />
  {/snippet}

  {#if lineage}
    <div class="trail-screen-title">
      <TitleField label="rename" placeholder="name this trail" bind:value={name} onCommit={commit} />
    </div>
    {#if shownError}
      <Note tone="warm">{shownError}</Note>
    {/if}
    {#if rows.length > 0}
      <RowGroup>
        {#each rows as row (row.id)}
          <Row
            label={row.label}
            value={row.value}
            kind={row.kind}
            destructive={row.kind === "destructive"}
            onSelect={onRow ? () => onRow(row.id) : null}
          />
        {/each}
      </RowGroup>
    {/if}
  {:else}
    <!-- The trail went while its screen was up — a delete that came in by
         sync. Nothing left to rename, move or delete. -->
    <Empty>
      {#snippet title()}this trail is not here any more{/snippet}
      {#snippet body()}go back to memory to see the trails there are.{/snippet}
    </Empty>
  {/if}
</Screen>

<style>
  /* The pin screen's title box (PinArtifactScreen), for the same field. */
  .trail-screen-title {
    --title-field-size: var(--text-xl);
    margin: var(--space-3) var(--space-4) 0;
  }
</style>
