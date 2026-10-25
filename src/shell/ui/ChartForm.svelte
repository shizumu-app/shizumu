<!--
  /chart's builder body, for a thumb.

  ── WHAT "RE-HOSTED, NOT REWRITTEN" TURNED OUT TO MEAN ─────────────────
  Spec §3 says `ChartBuilder`'s FORMS are re-hosted, and its shell-rules
  allowlist says the same thing in the same words ("`ChartBuilder` forms").
  Read against the file, that phrase draws a line through the middle of it:

    the forms      ChartFormFlowchart / ChartFormMindmap / ChartFormTimeline
                   (+ NodeShapePicker, ConnectionChip, BranchTree beneath
                   them). Each takes `source` and emits `onChange(next)`
                   and owns nothing else. THESE COME ACROSS, imported, as
                   they are.

    the frame      Modal, the kind tabs, the title input, the save/cancel
                   footer, the debounced Mermaid preview, and the working
                   copy the four of them share. THIS IS NOT RE-HOSTED. It
                   is a desktop modal — `Modal.svelte` leaves the flow
                   with its own scrim and its own Escape — and mounting it
                   inside a Sheet would put an overlay on top of the one
                   overlay the shell has, which is the rule the rules test
                   spends a whole allowlist protecting.

  So the three form components are imported here unchanged and the frame is
  rebuilt out of shell parts: the kind tabs are `SegmentedControl` (one of
  the five leaves the shell may borrow, and the control ChartBuilder itself
  uses for them), the title is the host's `Field`, and the save button is
  the host's commit `Row`. The decisions the frame carried — what a fresh
  draft holds, what switching kind costs, when the draft may be written —
  are in `chart-draft.js` with a suite on them, because a decision inside a
  `.svelte` file is a decision no test can reach (CLAUDE.md).

  Rewriting the forms instead was the other real option and it was refused
  for the reason this workstream keeps rediscovering: their mutation rules
  are NOT trivial. `removeNode` also drops every edge that pointed at the
  node (ChartFormFlowchart:36) — miss that and a flowchart assembles
  Mermaid referring to an id that no longer exists. `onSink` / `onLift`
  move a branch between two levels of a recursive tree. None of it lives in
  a pure module the way `table-size-picker.js` did for Task 4, so a shell
  copy would be a second answer to "what shape is a chart source", which is
  the drift class the whole plan is written against.

  ── WHAT A THUMB CHANGES, AND WHAT IT DOES NOT ────────────────────────
  THE FLOOR IS DECLARED HERE, once, over the borrowed subtree. That is the
  cost of importing desktop components into the shell: none of them is
  scanned by the rules test (it walks `src/shell/**`), and every control in
  them is sized for a mouse — a 4-button shape picker whose buttons are
  ~28px, a `×` at 0.25rem of padding, chips at 0.625rem. `--tap` is the
  floored token — a `max()` over the bare one and 44px — so the rules
  below give the whole borrowed tree the same 44px floor a shell primitive
  carries, and `--text-input` gives its inputs the 16px that stops mobile
  Safari zooming the viewport on focus (Field.svelte's header for why that
  matters to a shell whose surfaces leave the flow).

  The unfloored token's name, and one out-of-flow CSS declaration, are
  DELIBERATELY paraphrased above and below rather than quoted. Two of the
  rules test's scans read the whole file, comments included — only the
  `--spring` scan strips block comments — so a header that quotes either
  banned form fails the rule it is explaining. Found by writing it the
  readable way first and watching both rules go red on a file that breaks
  neither.

  `min-width: 0` on the inputs is what makes the floor fit rather than
  overflow. A flex item's default `min-width: auto` is its intrinsic size,
  so a 44px-wide shape picker × 4 plus a 44px remove button beside an
  `<input>` that refuses to shrink would push the node card past the frame.
  With it, the row spends its width on the controls and the input takes
  what is left.

  NO LIVE PREVIEW, and this is the one place the shell drops something the
  desktop has. Three reasons, in the order they decided it:

    · The desktop's preview sits BELOW the form, which is where a hand
      reaching a phone is (Task 4's finding, and the reason the table
      grid's caption sits above its cells). The form is a stack of text
      fields, so the keyboard is up for most of the session and Sheet is
      lifted by --kb-overlay — the pane would be under the hand whenever it
      was on screen at all.
    · It is ~600kB of Mermaid, lazy-imported into a sheet, on the surface
      whose whole budget is a phone.
    · What it would cost is the room the forms need. The desktop's pane is
      14rem under a modal that can be as tall as the window; here a full
      detent is 0.92 of a 412×915 frame and the forms already fill it.
      Spending a third of that on a preview the hand covers is the worse
      trade of the two.

  What replaces it is the document: commit, and the NodeView draws the
  chart at full column width one drag below the sheet that made it, with
  the builder one tap away for the next pass. That loop exists on the
  desktop too — this surface just prefers it to the pane.

  The cost is real and is recorded rather than argued away: the FIRST
  commit of a new chart is made without having seen the diagram.

  ── WHAT COMES ACROSS BROKEN, AND IS LEFT THAT WAY ────────────────────
  Re-hosting means inheriting, and two things in the borrowed forms do not
  work under a finger. Both are reported rather than patched from outside,
  because a fix belongs in the component (a `main`-side commit) and not in
  a host reaching into someone else's markup:

    · ChartFormTimeline reorders events with native HTML5 drag-and-drop
      (`draggable="true"`, dragstart/drop). Spec §3 chose a pointer
      interaction for the shell's own block drag precisely because HTML5
      drag is unreliable on touch, so the timeline's `⋮⋮` handle is inert
      here. Events can still be added, edited and removed; only reordering
      is unreachable.
    · BranchTree's Tab / Shift-Tab nesting has no key to press on a soft
      keyboard. That one is only an accelerator — `+` adds a child and `×`
      removes a branch, so every shape the tree can hold is still reachable
      by tapping.

  ── STATE LIVES IN THE HOST ───────────────────────────────────────────
  `kind` and `source` come down, `onKind` and `onSource` go up. Same reason
  TableSizeGrid holds no cell: the host needs the draft anyway (its commit
  row is labelled from it and it is what the node is built from), and a
  copy here would be a second answer to the same question.
-->
<script>
  import SegmentedControl from "../../lib/ui/SegmentedControl.svelte";
  import ChartFormFlowchart from "../../components/chart/ChartFormFlowchart.svelte";
  import ChartFormMindmap from "../../components/chart/ChartFormMindmap.svelte";
  import ChartFormTimeline from "../../components/chart/ChartFormTimeline.svelte";

  /** @type {{
    kind: "flowchart" | "mindmap" | "timeline",
    source: object,
    onKind: (kind: string) => void,
    onSource: (source: object) => void,
  }} */
  let { kind, source, onKind, onSource } = $props();

  // ChartBuilder's own three, labels included — the writer who made a
  // chart on the desktop finds the same three words in the same order.
  const KIND_OPTIONS = [
    { value: "flowchart", label: "flowchart" },
    { value: "mindmap", label: "mind map" },
    { value: "timeline", label: "timeline" },
  ];
</script>

<div class="shell-chart-form">
  <!-- Above the form, not below it: this is the control that says what the
       rest of the sheet IS, and it is the one thing that must stay legible
       while a thumb is working further down. -->
  <div class="shell-chart-form-kinds">
    <SegmentedControl
      options={KIND_OPTIONS}
      value={kind}
      onChange={(next) => onKind(next)}
      ariaLabel="chart kind"
    />
  </div>

  <div class="shell-chart-form-body">
    {#if kind === "flowchart"}
      <ChartFormFlowchart {source} onChange={onSource} />
    {:else if kind === "mindmap"}
      <ChartFormMindmap {source} onChange={onSource} />
    {:else if kind === "timeline"}
      <ChartFormTimeline {source} onChange={onSource} />
    {/if}
  </div>
</div>

<style>
  .shell-chart-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-2) 0;
  }

  .shell-chart-form-kinds {
    display: flex;
  }

  /* The floor, declared once over the whole borrowed subtree. See the
     header: none of these components is scanned by the rules test, and
     every one of them is sized for a pointer that is a few pixels wide.
     `--tap` rather than the bare token for the reason the rules test
     states — unfloored, it is 38.5px at the phone's --ui-scale. */
  .shell-chart-form :global(input),
  .shell-chart-form :global(select),
  .shell-chart-form :global(textarea),
  .shell-chart-form :global(button) {
    min-height: var(--tap);
  }

  .shell-chart-form :global(input),
  .shell-chart-form :global(select),
  .shell-chart-form :global(textarea) {
    /* max(--text-base, 16px) — below 16px mobile Safari zooms the viewport
       on focus and every out-of-flow surface in the shell is the wrong
       size until the reader pinches back. */
    font-size: var(--text-input);
    /* Without this the intrinsic width of a text input keeps a flex row
       from shrinking, and a 44px-floored control beside it overflows the
       frame instead. */
    min-width: 0;
  }

  .shell-chart-form :global(button) {
    min-width: var(--tap);
  }
</style>
