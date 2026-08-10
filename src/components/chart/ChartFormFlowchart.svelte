<!--
  ChartFormFlowchart — direction toggle + node cards with inline
  outgoing connections. Each node owns its own shape, label, and
  outgoing connection list. The Builder shell mounts this and passes
  source + onChange.
-->
<script>
  import SegmentedControl from "../../lib/ui/SegmentedControl.svelte";
  import Button from "../../lib/ui/Button.svelte";
  import NodeShapePicker from "./NodeShapePicker.svelte";
  import ConnectionChip from "./ConnectionChip.svelte";

  /** @type {{
    source: { direction: string, nodes: any[], edges: any[] },
    onChange: (next: any) => void,
  }} */
  let { source, onChange } = $props();

  function setDirection(dir) {
    onChange({ ...source, direction: dir });
  }

  function addNode() {
    onChange({
      ...source,
      nodes: [...(source.nodes || []), { id: `n${Date.now()}`, label: "", shape: "rect" }],
    });
  }

  function updateNode(i, patch) {
    const next = [...source.nodes];
    next[i] = { ...next[i], ...patch };
    onChange({ ...source, nodes: next });
  }

  function removeNode(i) {
    const removed = source.nodes[i];
    const id = removed?.id;
    onChange({
      ...source,
      nodes: source.nodes.filter((_, idx) => idx !== i),
      edges: (source.edges || []).filter((e) => e.from !== id && e.to !== id),
    });
  }

  function edgesFrom(nodeId) {
    return (source.edges || [])
      .map((e, idx) => ({ ...e, _idx: idx }))
      .filter((e) => e.from === nodeId);
  }

  function commitConnection(nodeId, edgeIdx, targetId, label) {
    const edges = [...(source.edges || [])];
    if (edgeIdx === -1) {
      edges.push({ from: nodeId, to: targetId, label });
    } else {
      edges[edgeIdx] = { ...edges[edgeIdx], to: targetId, label };
    }
    onChange({ ...source, edges });
  }

  function removeConnection(edgeIdx) {
    onChange({ ...source, edges: source.edges.filter((_, i) => i !== edgeIdx) });
  }

  function availableTargets() {
    return (source.nodes || []).map((n) => ({ id: n.id, label: n.label }));
  }
</script>

<div class="form">
  <div class="form-section">
    <div class="form-label">direction</div>
    <div class="dir-row">
      <SegmentedControl
        options={[
          { value: "TB", label: "top-down" },
          { value: "LR", label: "left-right" },
        ]}
        value={source.direction || "TB"}
        onChange={(v) => setDirection(v)}
        ariaLabel="flowchart direction"
      />
    </div>
  </div>

  <div class="form-section">
    <div class="form-label">nodes</div>
    <ul class="node-list">
      {#each source.nodes || [] as node, i (node.id)}
        <li class="node-card">
          <div class="node-head">
            <NodeShapePicker
              value={node.shape || "rect"}
              onChange={(s) => updateNode(i, { shape: s })}
            />
            <input
              class="node-input selectable"
              type="text"
              placeholder="node label"
              value={node.label}
              oninput={(e) => updateNode(i, { label: e.target.value })}
              spellcheck="false"
            />
            <button class="node-remove" onclick={() => removeNode(i)} aria-label="remove node" title="remove">×</button>
          </div>
          <div class="node-conns">
            <span class="conn-prefix">→</span>
            {#each edgesFrom(node.id) as edge (edge._idx)}
              <ConnectionChip
                targetId={edge.to}
                connectionLabel={edge.label || ""}
                availableTargets={availableTargets().filter((t) => t.id !== node.id)}
                onCommit={(target, label) => commitConnection(node.id, edge._idx, target, label)}
                onRemove={() => removeConnection(edge._idx)}
              />
            {/each}
            {#if (source.nodes || []).length > 1}
              <ConnectionChip
                targetId={null}
                connectionLabel=""
                availableTargets={availableTargets().filter((t) => t.id !== node.id)}
                onCommit={(target, label) => commitConnection(node.id, -1, target, label)}
              />
            {/if}
          </div>
        </li>
      {/each}
    </ul>
    <Button variant="subtle" onClick={addNode}>+ add node</Button>
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
  .dir-row { display: flex; gap: 0.4375rem; }

  .node-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .node-card {
    background: color-mix(in srgb, var(--ink) 2%, transparent);
    border: 1px solid color-mix(in srgb, var(--ink) 6%, transparent);
    border-radius: 0.5rem;
    padding: 0.5rem 0.625rem;
    display: flex;
    flex-direction: column;
    gap: 0.4375rem;
  }
  .node-head { display: flex; align-items: center; gap: 0.5rem; }
  .node-input {
    flex: 1;
    appearance: none;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 0.25rem;
    padding: 0.25rem 0.375rem;
    font-family: "Lora", serif;
    font-size: 0.875rem;
    color: var(--ink);
    outline: none;
  }
  .node-input:focus {
    border-color: color-mix(in srgb, var(--ink) 12%, transparent);
    background: color-mix(in srgb, var(--ink) 4%, transparent);
  }
  .node-remove {
    appearance: none;
    background: transparent;
    border: none;
    color: var(--ink);
    opacity: 0.35;
    cursor: pointer;
    font-size: 1rem;
    line-height: 1;
    padding: 0 0.25rem;
  }
  .node-remove:hover { opacity: 0.85; }

  .node-conns {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3125rem;
    padding-left: 0.25rem;
  }
  .conn-prefix {
    font-family: "DM Mono", monospace;
    font-size: 0.625rem;
    opacity: 0.45;
    color: var(--warm-accent);
  }
</style>
