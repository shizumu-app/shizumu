<!--
  Toggle. Sliding binary toggle in the iOS / macOS lineage. Wraps a
  native checkbox for keyboard and a11y; the visible track and thumb
  are decorative. Coarse pointer mode upgrades the hit area to 44x44px
  while keeping the visual track unchanged.
-->
<script>
  /** @type {{
    checked?: boolean,
    disabled?: boolean,
    label?: string,
    onChange?: (checked: boolean) => void,
  }} */
  let {
    checked = $bindable(false),
    disabled = false,
    label,
    onChange,
  } = $props();

  function onClick(e) {
    if (disabled) {
      if (e && typeof e.preventDefault === "function") e.preventDefault();
      return;
    }
    const next = !checked;
    checked = next;
    onChange?.(next);
  }

  function onKeydown(e) {
    if (disabled) return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      onClick(e);
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<label
  class="toggle"
  class:checked
  class:disabled
  onkeydown={onKeydown}
>
  <input
    type="checkbox"
    {checked}
    {disabled}
    aria-label={label}
    onchange={onClick}
  />
  <span class="track" aria-hidden="true">
    <span class="thumb"></span>
  </span>
</label>

<style>
  .toggle {
    position: relative;
    display: inline-flex;
    align-items: center;
    cursor: pointer;
    user-select: none;
    width: 2.75rem;
    height: 2.75rem;
    justify-content: center;
  }

  .toggle.disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .toggle input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
    width: 0;
    height: 0;
  }

  .track {
    width: 2.25rem;
    height: 1.25rem;
    border-radius: 0.75rem;
    background: color-mix(in srgb, var(--ink) 12%, transparent);
    position: relative;
    transition: background 280ms cubic-bezier(0.2, 0, 0, 1);
  }

  .toggle.checked .track {
    background: color-mix(in srgb, var(--warm-accent) 60%, transparent);
  }

  .thumb {
    position: absolute;
    top: 0.125rem;
    left: 0.125rem;
    width: 1rem;
    height: 1rem;
    border-radius: 50%;
    background: color-mix(in srgb, var(--ink) 92%, transparent);
    transition: transform 280ms cubic-bezier(0.2, 0, 0, 1);
  }

  .toggle.checked .thumb {
    transform: translateX(1rem);
  }

  .toggle:focus-within .track {
    outline: 1px solid var(--warm-accent-soft);
    outline-offset: 2px;
  }
</style>
