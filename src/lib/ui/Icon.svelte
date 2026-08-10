<!--
  Icon — the one definition of the small interface glyphs.

  The phone header drew these as text characters, and measuring them showed
  why they read as unrelated: ▾ was DM Mono at 5.3px wide, ↗ was Inter at
  11px, and two independently-defined › carets sat at 4px, all at 11px
  nominal with opacities of 0.5, 0.55 and 1. Five icon roles, two font
  families, three widths — glyph metrics, not a design.

  Drawing them instead of typing them fixes both halves at once: one box
  size and one stroke weight make them a set, and strokes render identically
  across WebKitGTK, WebView2 and Android WebView instead of depending on
  which font happens to carry the character. Same language as
  MobileActionBar (viewBox 24, 1.75 stroke, currentColor, round joins).

  Colour comes from `currentColor` and emphasis from the caller's opacity,
  so an icon always matches the text it sits beside.
-->
<script>
  /** @type {{ name: "chevron-down" | "chevron-right" | "chevron-left" | "arrow-up-right" | "loop", size?: number, label?: string | null }} */
  let { name, size = 14, label = null } = $props();
</script>

<svg
  class="icon"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  role={label ? "img" : "presentation"}
  aria-label={label}
  aria-hidden={label ? undefined : "true"}
>
  {#if name === "chevron-down"}
    <polyline points="6,10 12,16 18,10" />
  {:else if name === "chevron-right"}
    <polyline points="10,6 16,12 10,18" />
  {:else if name === "chevron-left"}
    <polyline points="14,6 8,12 14,18" />
  {:else if name === "arrow-up-right"}
    <line x1="7" y1="17" x2="17" y2="7" />
    <polyline points="9,7 17,7 17,15" />
  {:else if name === "loop"}
    <!-- continuous trail: one document that keeps coming back round -->
    <polyline points="4,7 4,12 9,12" />
    <path d="M6 15a7 7 0 1 0 1.5-8" />
  {/if}
</svg>

<style>
  .icon {
    display: inline-block;
    /* Sits on the text baseline rather than the line box, so an icon inside
       a chip lines up with the label instead of riding above it. */
    vertical-align: -0.15em;
    flex-shrink: 0;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.75;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
