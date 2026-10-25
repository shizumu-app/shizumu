<!--
  The shell's segmented control: `src/lib/ui/SegmentedControl.svelte`,
  one of the five opinion-free leaves the rules test lets the shell
  import, wrapped so that its segments reach the shell's floor.

  THE 40px SEGMENT. The leaf floors a segment on a coarse pointer at
  40px — its own rule, written for the desktop's touch-tablet case, and
  four short of the shell's --tap (44px, the floor every control in this
  tree carries). The memory mode segment and the pins filter both
  inherited that, and the P3 handoff recorded the shortfall as a debt
  ("the memory mode segment is 40px"). The leaf is not the shell's to
  edit — `src/lib/ui/**` is off limits while the two trees coexist — so
  the floor is raised from outside: this wrapper reaches the leaf's
  segments through `:global(.seg-btn)` and declares `min-height:
  var(--tap)` on them, which wins on specificity (the wrapper's own scoped
  class plus the leaf's) over the leaf's coarse-pointer rule.

  The two class names it reaches for, `.seg` and `.seg-btn`, are the
  leaf's own — read off SegmentedControl.svelte, not guessed — and
  Segment.test.js reads the leaf's source to hold them, so a rename there
  goes red here rather than silently dropping the floor.

  `.seg` is made a full-width flex and each segment `flex: 1 1 0`, so
  three modes share the band evenly instead of hugging their labels; the
  face and size are the shell's mono --text-sm, the same as every other
  control label, rather than the leaf's hard-coded Inter.

  It renders no control of its own — the leaf renders the buttons — so it
  is NOT on the rules test's PRIMITIVE_BUTTON_FILES, and must not be added
  there: that list is for files that write the element themselves.

  Props pass straight through: `options`, `value` (bindable, as the leaf's
  is), `onChange`, `ariaLabel`. No prop is renamed, so a caller moving
  from the leaf to this wrapper changes one import and nothing else.
-->
<script>
  import SegmentedControl from "../../lib/ui/SegmentedControl.svelte";

  /** @type {{
    options: Array<{ value: string, label: string }>,
    value?: string,
    onChange?: (value: string) => void,
    ariaLabel?: string,
  }} */
  let { options = [], value = $bindable(""), onChange, ariaLabel } = $props();
</script>

<div class="shell-segment">
  <SegmentedControl {options} bind:value {onChange} {ariaLabel} />
</div>

<style>
  .shell-segment :global(.seg) {
    display: flex;
    width: 100%;
  }

  .shell-segment :global(.seg-btn) {
    flex: 1 1 0;
    min-height: var(--tap);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }
</style>
