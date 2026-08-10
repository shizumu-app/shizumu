<!--
  BranchTree — recursive node list for the mindmap form in ChartBuilder.

  Tab on a label input sinks the branch under the previous sibling
  (becomes its last child). Shift-Tab lifts the branch out to its
  parent's sibling list. Enter creates a new empty sibling right after
  this branch. Callbacks bubble to the parent so mutation logic stays
  centralized in ChartFormMindmap.
-->
<script>
  import BranchTree from "./BranchTree.svelte";

  /** @type {{
    branches: Array<{ id: string, label: string, children?: any[] }>,
    updateLabel: (path: number[], label: string) => void,
    addChild: (path: number[]) => void,
    removeBranch: (path: number[]) => void,
    onSink?: (path: number[]) => void,
    onLift?: (path: number[]) => void,
    onSiblingAfter?: (path: number[]) => void,
    path?: number[],
    depth?: number,
  }} */
  let {
    branches,
    updateLabel,
    addChild,
    removeBranch,
    onSink = () => {},
    onLift = () => {},
    onSiblingAfter = () => {},
    path = [],
    depth = 0,
  } = $props();

  function handleKey(e, idx) {
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      onSink([...path, idx]);
    } else if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      onLift([...path, idx]);
    } else if (e.key === "Enter") {
      e.preventDefault();
      onSiblingAfter([...path, idx]);
    }
  }
</script>

<ul class="branch-list" style:padding-left={depth === 0 ? "0" : "1rem"}>
  {#each branches as branch, i (branch.id)}
    <li class="branch-row">
      <div class="branch-line">
        <span class="branch-glyph" aria-hidden="true">·</span>
        <input
          class="branch-input selectable"
          type="text"
          placeholder="branch"
          value={branch.label}
          oninput={(e) => updateLabel([...path, i], e.target.value)}
          onkeydown={(e) => handleKey(e, i)}
          spellcheck="false"
          data-branch-id={branch.id}
        />
        <button class="branch-action" onclick={() => addChild([...path, i])} title="add child">+</button>
        <button class="branch-action" onclick={() => removeBranch([...path, i])} aria-label="remove branch" title="remove">×</button>
      </div>
      {#if branch.children && branch.children.length}
        <BranchTree
          branches={branch.children}
          {updateLabel}
          {addChild}
          {removeBranch}
          {onSink}
          {onLift}
          {onSiblingAfter}
          path={[...path, i]}
          depth={depth + 1}
        />
      {/if}
    </li>
  {/each}
</ul>

<style>
  .branch-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .branch-row {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .branch-line {
    display: flex;
    align-items: center;
    gap: 0.375rem;
  }
  .branch-glyph {
    color: var(--ink);
    opacity: 0.35;
    width: 0.875rem;
    text-align: center;
  }
  .branch-input {
    flex: 1;
    min-width: 0;
    background: color-mix(in srgb, var(--ink) 4%, transparent);
    border: 1px solid color-mix(in srgb, var(--ink) 6%, transparent);
    border-radius: 0.375rem;
    padding: 0.3125rem 0.5rem;
    font-family: "Lora", serif;
    font-size: 0.875rem;
    color: var(--ink);
    outline: none;
    transition: background 180ms cubic-bezier(0.2, 0, 0, 1),
                border-color 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  .branch-input:focus {
    background: color-mix(in srgb, var(--ink) 6%, transparent);
    border-color: color-mix(in srgb, var(--ink) 25%, transparent);
  }
  .branch-input::placeholder {
    color: var(--ink);
    opacity: 0.25;
  }
  .branch-action {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--ink);
    opacity: 0.45;
    font-size: 0.875rem;
    padding: 0 0.25rem;
    line-height: 1;
    transition: opacity 180ms cubic-bezier(0.2, 0, 0, 1);
  }
  .branch-action:hover { opacity: 0.85; }
</style>
