<!--
  Settings: three named groups of rows, each row pushing a section.

  §2, in full: "Grouped rows (`Row`), each pushing a section." Which rows,
  in which groups, and what each shows in its value column is
  settings-model.js — including the five desktop sections that are absent
  and why each one is, and why the three groups are called what they are.

  ── A GROUP IS A SURFACE UNDER A NAME ─────────────────────────────────

  Each group is a `RowGroup`: an eyebrow saying what the rows are about,
  then an inset surface holding them, with the line between rows drawn by
  the group and none at its edges. That is the whole visual system for a
  list (spec §4, amended by the visual pass), and this screen adds nothing
  to it — no rule of its own, no gap of its own. It used to draw a
  `Divider` in a padded wrapper between two unnamed groups, back when a
  row underlined itself and a break between groups was the one line that
  needed saying; a group that names itself and sits on its own surface has
  nothing left for a rule to say.

  ── NOT THE CANVAS REGION ─────────────────────────────────────────────

  PinsScreen's call, for §1's reason rather than by imitation: the canvas
  region turns a swipe up at a scroller's bottom into MEMORY. That pair is
  page↔memory, and settings is neither half of it — marking this scroller
  would give the third root a one-way exit into the second that the tab
  bar already offers both ways.

  ── NO BACK ───────────────────────────────────────────────────────────

  This is a root, so the bar carries no back control: `Stack` registers a
  navstack entry for every element of `entries` EXCEPT the first, because
  back at a stack root belongs to the OS. A back button here would offer
  what the gesture and the system button both correctly refuse.
-->
<script>
  import Screen from "./ui/Screen.svelte";
  import NavBar from "./ui/NavBar.svelte";
  import Row from "./ui/Row.svelte";
  import RowGroup from "./ui/RowGroup.svelte";

  /** @type {{
    groups?: Array<{eyebrow: string, rows: Array<{id: string, label: string, value?: string}>}>,
    onOpen?: ((id: string) => void) | null,
  }} */
  let { groups = [], onOpen = null } = $props();
</script>

<Screen>
  {#snippet nav()}
    <NavBar title="settings" />
  {/snippet}

  {#each groups as group (group.eyebrow)}
    <RowGroup eyebrow={group.eyebrow}>
      {#each group.rows as row (row.id)}
        <Row
          label={row.label}
          value={row.value ?? ""}
          onSelect={onOpen ? () => onOpen(row.id) : null}
        />
      {/each}
    </RowGroup>
  {/each}
</Screen>
