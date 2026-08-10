<!--
  ConnectionChip — one outgoing connection on a flowchart node card.
  Click the chip to open a small inline editor (target dropdown + label
  input + remove). The "+ connect" affordance reuses this same chip
  with no targetId, which opens the editor seeded empty.
-->
<script>
  /** @type {{
    targetId: string | null,
    connectionLabel: string,
    availableTargets: Array<{ id: string, label: string }>,
    onCommit: (targetId: string, connectionLabel: string) => void,
    onRemove?: () => void,
  }} */
  let { targetId = null, connectionLabel = "", availableTargets = [], onCommit, onRemove } = $props();

  let open = $state(false);
  let draftTarget = $state(targetId || (availableTargets[0]?.id || ""));
  let draftLabel = $state(connectionLabel);

  function display() {
    if (!targetId) return "+ connect";
    const t = availableTargets.find((a) => a.id === targetId);
    const name = t?.label?.trim() || "(empty)";
    return connectionLabel ? `${name} · ${connectionLabel}` : name;
  }

  function toggle() {
    if (!open) {
      draftTarget = targetId || (availableTargets[0]?.id || "");
      draftLabel = connectionLabel;
    }
    open = !open;
  }
  function commit() {
    if (!draftTarget) return;
    onCommit(draftTarget, draftLabel);
    open = false;
  }
  function cancel() { open = false; }
</script>

<span class="conn-chip-wrap">
  <button
    type="button"
    class="conn-chip"
    class:placeholder={!targetId}
    onclick={toggle}
  >{display()}</button>

  {#if open}
    <div class="conn-popover">
      <label class="conn-row">
        <span class="conn-label">target</span>
        <select class="conn-input" bind:value={draftTarget}>
          {#each availableTargets as t (t.id)}
            <option value={t.id}>{t.label?.trim() || "(empty)"}</option>
          {/each}
        </select>
      </label>
      <label class="conn-row">
        <span class="conn-label">label</span>
        <input class="conn-input" type="text" bind:value={draftLabel} placeholder="optional" />
      </label>
      <div class="conn-actions">
        {#if onRemove && targetId}
          <button type="button" class="conn-btn danger" onclick={() => { onRemove(); open = false; }}>remove</button>
        {/if}
        <button type="button" class="conn-btn" onclick={cancel}>cancel</button>
        <button type="button" class="conn-btn primary" onclick={commit}>save</button>
      </div>
    </div>
  {/if}
</span>

<style>
  .conn-chip-wrap { position: relative; display: inline-block; }
  .conn-chip {
    appearance: none;
    background: color-mix(in srgb, var(--warm-accent) 8%, transparent);
    border: 1px solid color-mix(in srgb, var(--warm-accent) 25%, transparent);
    color: var(--warm-accent);
    font-family: "DM Mono", monospace;
    font-size: 0.625rem;
    padding: 0.0625rem 0.4375rem;
    border-radius: 0.5rem;
    cursor: pointer;
    line-height: 1.4;
  }
  .conn-chip.placeholder {
    background: transparent;
    border-style: dashed;
    opacity: 0.6;
  }
  .conn-chip:hover { opacity: 1; }

  .conn-popover {
    position: absolute;
    top: 1.5rem;
    left: 0;
    background: var(--canvas-bg);
    border: 1px solid color-mix(in srgb, var(--ink) 8%, transparent);
    border-radius: 0.375rem;
    padding: 0.5rem;
    box-shadow: 0 4px 16px color-mix(in srgb, var(--ink) 12%, transparent);
    z-index: 10;
    min-width: 14rem;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }
  .conn-row {
    display: flex;
    align-items: center;
    gap: 0.4375rem;
    font-family: "DM Mono", monospace;
    font-size: 0.5625rem;
  }
  .conn-label { opacity: 0.55; width: 2.75rem; }
  .conn-input {
    flex: 1;
    appearance: none;
    background: color-mix(in srgb, var(--ink) 4%, transparent);
    border: 1px solid color-mix(in srgb, var(--ink) 6%, transparent);
    border-radius: 0.25rem;
    padding: 0.25rem 0.375rem;
    font-family: "Lora", serif;
    font-size: 0.75rem;
    color: var(--ink);
    outline: none;
  }
  .conn-actions { display: flex; gap: 0.25rem; justify-content: flex-end; margin-top: 0.25rem; }
  .conn-btn {
    appearance: none;
    background: transparent;
    border: none;
    padding: 0.1875rem 0.5rem;
    border-radius: 0.25rem;
    font-family: "DM Mono", monospace;
    font-size: 0.5625rem;
    color: var(--ink);
    opacity: 0.55;
    cursor: pointer;
  }
  .conn-btn:hover { opacity: 0.92; background: color-mix(in srgb, var(--ink) 6%, transparent); }
  .conn-btn.primary { color: var(--warm-accent); opacity: 0.92; }
  .conn-btn.danger { color: var(--warm-accent); }
</style>
