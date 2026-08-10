<!--
  ChartBuilder — orchestrator modal for the /chart node.

  Owns: the modal frame, kind tabs, working copy of (kind, source), and
  save/cancel routing. The per-kind form components own their own
  fields and emit `onChange(nextSource)` to update the working copy.
  Mermaid is rendered inline in the editor on save — no live preview
  inside the builder.
-->
<script>
  import Modal from "../lib/ui/Modal.svelte";
  import Button from "../lib/ui/Button.svelte";
  import SegmentedControl from "../lib/ui/SegmentedControl.svelte";
  import { emptySource } from "../lib/extensions/chart.js";
  import ChartFormFlowchart from "./chart/ChartFormFlowchart.svelte";
  import ChartFormMindmap from "./chart/ChartFormMindmap.svelte";
  import ChartFormTimeline from "./chart/ChartFormTimeline.svelte";

  /** @type {{
    builderState: { mode: "create" | "edit", pos?: number, insertAt?: number, attrs?: { kind, source } } | null,
    onSave: (attrs: { kind: string, source: any }) => void,
    onCancel: () => void,
  }} */
  let { builderState, onSave, onCancel } = $props();

  let kind = $state("flowchart");
  let source = $state(emptySource("flowchart"));
  let blockTitle = $state("");

  // Re-seed on each open.
  $effect(() => {
    if (builderState) {
      const inboundKind = builderState.attrs?.kind || "flowchart";
      const inboundSource = builderState.attrs?.source && Object.keys(builderState.attrs.source).length > 0
        ? deepClone(builderState.attrs.source)
        : emptySource(inboundKind);
      kind = inboundKind;
      source = inboundSource;
      blockTitle = (builderState.attrs?.blockTitle || "").trim();
    }
  });

  function deepClone(v) { try { return JSON.parse(JSON.stringify(v)); } catch { return v; } }

  function pickKind(next) {
    if (next === kind) return;
    kind = next;
    source = emptySource(next);
  }
  function commitSave() {
    if (!canSave) return;
    onSave({
      kind,
      source: deepClone(source),
      blockTitle: blockTitle.trim() || null,
    });
  }
  function handleChange(nextSource) {
    source = nextSource;
  }

  // Timeline events without a date render as orphaned boxes around the
  // spine and the chart loses its temporal meaning. Block save until
  // every event carries a date. Other kinds have no equivalent gate.
  let canSave = $derived.by(() => {
    if (kind !== "timeline") return true;
    const events = source?.events || [];
    if (events.length === 0) return true;
    return events.every((e) => (e?.date || "").trim().length > 0);
  });
</script>

{#if builderState}
  <Modal open={true} title="chart" onClose={onCancel}>
    <div class="builder">
      <input
        class="title-input selectable"
        type="text"
        placeholder="title (optional)"
        bind:value={blockTitle}
        spellcheck="false"
      />

      <div class="kind-tabs">
        <SegmentedControl
          options={[
            { value: "flowchart", label: "flowchart" },
            { value: "mindmap", label: "mind map" },
            { value: "timeline", label: "timeline" },
          ]}
          value={kind}
          onChange={(v) => pickKind(v)}
          ariaLabel="chart kind"
        />
      </div>

      <div class="builder-body">
        {#if kind === "flowchart"}
          <ChartFormFlowchart source={source} onChange={handleChange} />
        {:else if kind === "mindmap"}
          <ChartFormMindmap source={source} onChange={handleChange} />
        {:else if kind === "timeline"}
          <ChartFormTimeline source={source} onChange={handleChange} />
        {/if}
      </div>
    </div>

    {#snippet actions()}
      {#if !canSave}
        <span class="save-hint">every event needs a date</span>
      {/if}
      <Button variant="subtle" onClick={onCancel}>cancel</Button>
      <Button variant="accent" onClick={commitSave} disabled={!canSave}>save</Button>
    {/snippet}
  </Modal>
{/if}

<style>
  .builder {
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
    width: 32rem;
    max-width: 90vw;
  }

  /* Phone: the builder is dense (multi-column form fields + grid).
     Stack everything vertically and bump inputs to touch-comfy size. */
  @media (pointer: coarse) {
    .builder {
      width: 100%;
      max-width: 100%;
      gap: 1rem;
    }
    .builder :global(input),
    .builder :global(select),
    .builder :global(textarea),
    .builder :global(button) {
      min-height: 2.5rem;
      font-size: 0.9375rem;
    }
    .kind-tabs {
      flex-wrap: wrap;
    }
  }
  .kind-tabs {
    display: flex;
    gap: 0.4375rem;
  }
  .builder-body {
    overflow: visible;
    padding-right: 0.25rem;
  }
  .title-input {
    appearance: none;
    background: color-mix(in srgb, var(--ink) 4%, transparent);
    border: 1px solid color-mix(in srgb, var(--ink) 6%, transparent);
    border-radius: 0.375rem;
    padding: 0.4375rem 0.625rem;
    font-family: "Lora", serif;
    font-size: 0.9375rem;
    font-style: italic;
    color: var(--ink);
    outline: none;
  }
  .title-input::placeholder {
    color: var(--ink);
    opacity: 0.45;
  }
  .save-hint {
    font-family: "DM Mono", monospace;
    font-size: 0.6875rem;
    color: var(--warm-accent);
    opacity: 0.75;
    align-self: center;
    margin-right: 0.4375rem;
  }
</style>
