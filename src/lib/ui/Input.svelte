<!--
  Input — text field with always-visible hairline bottom-border.
  See docs/superpowers/specs/2026-05-12-design-system-v1.md § Per-component visual specs.

  variant="search" → Lora italic, Esc clears and fires onClear.
  variant="text"   → Lora upright (default).
-->
<script>
  /** @type {{
    value: string,
    placeholder?: string,
    variant?: "search" | "text",
    disabled?: boolean,
    ariaLabel?: string,
    autofocus?: boolean,
    onInput?: (v: string) => void,
    onClear?: () => void,
    onKeydown?: (e: KeyboardEvent) => void,
  }} */
  let {
    value = $bindable(""),
    placeholder = "",
    variant = "text",
    disabled = false,
    ariaLabel,
    autofocus = false,
    onInput,
    onClear,
    onKeydown,
  } = $props();

  function handleInput(e) {
    value = e.target.value;
    onInput?.(value);
  }

  function handleKeydown(e) {
    if (variant === "search" && e.key === "Escape" && value) {
      e.preventDefault();
      value = "";
      onInput?.("");
      onClear?.();
    }
    onKeydown?.(e);
  }
</script>

<!-- svelte-ignore a11y_autofocus -->
<input
  class="input"
  class:search={variant === "search"}
  type="text"
  {value}
  {placeholder}
  {disabled}
  aria-label={ariaLabel}
  {autofocus}
  oninput={handleInput}
  onkeydown={handleKeydown}
  spellcheck="false"
/>

<style>
  .input {
    display: block;
    width: 100%;
    padding: 0.5rem 0;
    background: transparent;
    border: none;
    border-bottom: 1px solid color-mix(in srgb, var(--ink) 6%, transparent);
    font-family: "Lora", serif;
    font-size: 0.9375rem;
    color: var(--ink);
    opacity: 0.75;
    outline: none;
    transition: border-color var(--motion-fast),
                opacity var(--motion-fast);
  }

  .input.search {
    font-style: italic;
  }

  .input:focus {
    border-bottom-color: color-mix(in srgb, var(--ink) 12%, transparent);
    opacity: 0.92;
  }

  .input::placeholder {
    color: var(--ink);
    opacity: 0.25;
    font-style: italic;
  }

  .input:disabled {
    opacity: 0.25;
    cursor: not-allowed;
  }

  @media (max-width: 480px), (orientation: landscape) and (max-height: 480px) {
    .input { font-size: 1rem; } /* 16px floor kills iOS focus-zoom */
  }
  @media (pointer: coarse) {
    .input { min-height: max(var(--touch-target), 44px); }
  }
</style>
