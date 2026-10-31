<!-- src/lib/ui/Row.svelte -->
<!--
  Row primitive. Horizontal label-and-trailing-control row used by
  Settings. Label sits on the left in Lora 13px ink 0.75; trailing
  slot is right-aligned for controls (toggles, inputs, buttons).
  Optional `description` prop renders a one-line help text under the
  label in Inter 11px muted. Hidden prop suppresses render entirely.
-->
<script>
  /** @type {{
    hidden?: boolean,
    description?: string,
    children?: import("svelte").Snippet,
    trailing?: import("svelte").Snippet,
  }} */
  let { hidden = false, description, children, trailing } = $props();
</script>

{#if !hidden}
  <div class="settings-row">
    <div class="label-col">
      <div class="label">
        {#if children}{@render children()}{/if}
      </div>
      {#if description}
        <div class="description">{description}</div>
      {/if}
    </div>
    {#if trailing}
      <div class="trailing">{@render trailing()}</div>
    {/if}
  </div>
{/if}

<style>
  .settings-row {
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.875rem;
    padding: 0.75rem 0;
  }
  /* Rows read as one group, as the phone's do: a soft hairline between
     them, none above the first (2026-10-31). */
  .settings-row + .settings-row {
    border-top: 1px solid var(--hairline-soft);
  }

  .label-col {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    flex: 0 1 auto;
    min-width: 0;
  }

  .label {
    font-family: "Lora", Georgia, serif;
    font-size: 0.875rem;
    color: var(--ink);
    line-height: 1.3;
  }

  /* A sentence the writer reads, so the reading face and the soft ink,
     at full strength: at 0.45 opacity it was under any reading bar. */
  .description {
    font-family: var(--font-prose);
    font-size: 0.75rem;
    color: var(--ink-soft);
    line-height: 1.45;
    max-width: 22rem;
  }

  .trailing {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: flex-end;
    gap: 0.5rem;
    flex: 1 1 auto;
    min-width: 0;
    overflow-wrap: anywhere;
    word-break: break-word;
    padding-top: 0.0625rem;
  }

  /* Phone: stack label above trailing if both are present. Drops the
     nowrap on the label so multi-word settings don't get cropped. */
  @media (max-width: 480px), (orientation: landscape) and (max-height: 480px) {
    .settings-row {
      flex-direction: column;
      align-items: stretch;
      gap: 0.375rem;
    }
    .label {
      white-space: normal;
    }
    .trailing {
      justify-content: flex-start;
    }
  }
</style>
