<!--
  ChartBuilder — orchestrator modal for the /chart node.

  Owns: the modal frame, kind tabs, working copy of (kind, source), and
  save/cancel routing. The per-kind form components own their own
  fields and emit `onChange(nextSource)` to update the working copy.
  A debounced preview pane below the form renders the same Mermaid
  syntax the NodeView will render on save, via the shared
  renderMermaidInto() (chart-render.js) — the two paths can't drift.
-->
<script>
  import Modal from "../lib/ui/Modal.svelte";
  import Button from "../lib/ui/Button.svelte";
  import SegmentedControl from "../lib/ui/SegmentedControl.svelte";
  import { emptySource } from "../lib/extensions/chart.js";
  import { renderMermaidInto } from "../lib/extensions/chart-render.js";
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
  let previewEl = $state(null);

  // Debounced live preview — re-renders ~150ms after the last edit to
  // (kind, source). Same module-local setTimeout pattern as
  // CommandPalette.svelte's debounceTimer (no shared debounce utility
  // exists in src/lib/utils.js).
  let previewSyntaxKey = $derived(JSON.stringify({ kind, source }));
  let previewDebounceTimer = null;

  // The debounce alone does not order the renders. renderMermaidInto writes
  // `el.innerHTML` AFTER an await, so two renders in flight at once can
  // resolve out of order and leave the preview showing the PREVIOUS diagram
  // until the next keystroke — a slow render is still running when the next
  // debounce window closes. Serialise them with the same two-flag pair the
  // NodeView uses (chart.js's isRendering/queuedRender): one render at a
  // time, and a single coalesced re-run afterwards using the LATEST
  // kind/source rather than the ones captured when the queued call was made.
  // Chosen over threading an `isStale()` token through renderMermaidInto
  // because that would change the signature the NodeView also calls — one
  // proven idiom in two places beats a new mechanism in the shared renderer.
  let previewRendering = false;
  let previewQueued = false;
  let previewKind = null;
  let previewSource = null;

  async function renderPreview(el) {
    if (previewRendering) {
      previewQueued = true;
      return;
    }
    previewRendering = true;
    try {
      await renderMermaidInto(el, { kind: previewKind, source: previewSource, idPrefix: "chart-preview" });
    } finally {
      previewRendering = false;
      if (previewQueued) {
        previewQueued = false;
        renderPreview(el);
      }
    }
  }

  $effect(() => {
    previewSyntaxKey;
    if (!builderState || !previewEl) return;
    const el = previewEl;
    const nextKind = kind;
    const nextSource = source;
    if (previewDebounceTimer) clearTimeout(previewDebounceTimer);
    previewDebounceTimer = setTimeout(() => {
      previewKind = nextKind;
      previewSource = nextSource;
      renderPreview(el);
    }, 150);
    return () => {
      if (previewDebounceTimer) {
        clearTimeout(previewDebounceTimer);
        previewDebounceTimer = null;
      }
    };
  });

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

      <!-- data-kind mirrors the editor's `.chart-block[data-kind]` so the
           per-kind sizing rules in prose.css (the timeline width cap) reach
           the preview too — otherwise the preview renders a timeline wider
           than the chart the user is about to save. -->
      <div class="builder-preview" data-kind={kind}>
        <div class="prose">
          <div class="chart-render" bind:this={previewEl}></div>
        </div>
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
  .builder-preview {
    max-height: 14rem;
    overflow: auto;
    border: 1px solid color-mix(in srgb, var(--ink) 6%, transparent);
    border-radius: 0.375rem;
    padding: 0.5rem;
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
