<!--
  ChartFormMindmap — central idea input + recursive BranchTree with
  keyboard nesting (Tab / Shift-Tab / Enter).
-->
<script>
  import Button from "../../lib/ui/Button.svelte";
  import BranchTree from "../BranchTree.svelte";

  /** @type {{
    source: { central: string, branches: any[] },
    onChange: (next: any) => void,
  }} */
  let { source, onChange } = $props();

  function deepClone(v) { try { return JSON.parse(JSON.stringify(v)); } catch { return v; } }

  function walk(branches, path) {
    let node = null, list = branches;
    for (const i of path) {
      if (!list || i >= list.length) return null;
      node = list[i];
      list = node.children;
    }
    return node;
  }

  function updateLabel(path, label) {
    const next = deepClone(source);
    const target = walk(next.branches, path);
    if (target) target.label = label;
    onChange(next);
  }

  function addChild(path) {
    const next = deepClone(source);
    const parent = walk(next.branches, path);
    if (parent) {
      parent.children = parent.children || [];
      parent.children.push({ id: `b${Date.now()}`, label: "", children: [] });
    }
    onChange(next);
  }

  function removeBranch(path) {
    const next = deepClone(source);
    if (path.length === 1) {
      next.branches.splice(path[0], 1);
    } else {
      const parent = walk(next.branches, path.slice(0, -1));
      if (parent && parent.children) parent.children.splice(path[path.length - 1], 1);
    }
    onChange(next);
  }

  function addBranch() {
    onChange({
      ...source,
      branches: [...(source.branches || []), { id: `b${Date.now()}`, label: "", children: [] }],
    });
  }

  // Sink: move this branch under its previous sibling as that sibling's
  // last child. No-op if already first child of its parent.
  function onSink(path) {
    const i = path[path.length - 1];
    if (i === 0) return;
    const next = deepClone(source);
    const list = path.length === 1 ? next.branches : walk(next.branches, path.slice(0, -1)).children;
    const moved = list.splice(i, 1)[0];
    const prev = list[i - 1];
    prev.children = prev.children || [];
    prev.children.push(moved);
    onChange(next);
  }

  // Lift: move this branch out of its parent's children list, placing
  // it right after the parent in the grandparent's list. No-op at depth 1.
  function onLift(path) {
    if (path.length <= 1) return;
    const next = deepClone(source);
    const parentPath = path.slice(0, -1);
    const parent = walk(next.branches, parentPath);
    const grandparentList = path.length === 2
      ? next.branches
      : walk(next.branches, parentPath.slice(0, -1)).children;
    const idxInParent = path[path.length - 1];
    const idxOfParent = parentPath[parentPath.length - 1];
    const moved = parent.children.splice(idxInParent, 1)[0];
    grandparentList.splice(idxOfParent + 1, 0, moved);
    onChange(next);
  }

  function onSiblingAfter(path) {
    const next = deepClone(source);
    const i = path[path.length - 1];
    const list = path.length === 1 ? next.branches : walk(next.branches, path.slice(0, -1)).children;
    list.splice(i + 1, 0, { id: `b${Date.now()}`, label: "", children: [] });
    onChange(next);
  }
</script>

<div class="form">
  <div class="form-section">
    <div class="form-label">central idea</div>
    <input
      class="central-input selectable"
      type="text"
      placeholder="the centre"
      value={source.central || ""}
      oninput={(e) => onChange({ ...source, central: e.target.value })}
      spellcheck="false"
    />
  </div>

  <div class="form-section">
    <div class="form-label">branches</div>
    <BranchTree
      branches={source.branches || []}
      {updateLabel}
      {addChild}
      {removeBranch}
      {onSink}
      {onLift}
      {onSiblingAfter}
    />
    <Button variant="subtle" onClick={addBranch}>+ add branch</Button>
  </div>
</div>

<style>
  .form { display: flex; flex-direction: column; gap: 1rem; }
  .form-section { display: flex; flex-direction: column; gap: 0.5rem; }
  .form-label {
    font-family: "DM Mono", monospace;
    font-size: 0.625rem;
    text-transform: lowercase;
    letter-spacing: 0.05em;
    opacity: 0.55;
  }
  .central-input {
    appearance: none;
    background: color-mix(in srgb, var(--ink) 4%, transparent);
    border: 1px solid color-mix(in srgb, var(--ink) 6%, transparent);
    border-radius: 0.375rem;
    padding: 0.4375rem 0.5rem;
    font-family: "Lora", serif;
    font-size: 0.875rem;
    color: var(--ink);
    outline: none;
  }
</style>
