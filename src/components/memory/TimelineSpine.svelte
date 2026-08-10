<!--
  TimelineSpine — SVG main spine + branch arcs + day rows.
  Children (DayBlock instances) are rendered via children snippet. The
  parent (TrailMap) shapes the day list; this component only owns geometry.
  Branch arcs are computed after layout from DOM rect positions and
  recomputed on container resize.
-->
<script>
  import { onMount, onDestroy } from "svelte";

  /** @type {{
    branchSpawns: Array<{ id: string, parentDateKey: string, branchDateKeys: string[] }>,
    children: import("svelte").Snippet,
  }} */
  let { branchSpawns = [], children } = $props();

  let container = $state(/** @type {HTMLDivElement | null} */ (null));
  let mainSpine = $state({ x: 0, top: 0, bottom: 0 });
  let arcs = $state(/** @type {Array<{ id: string, d: string, subSpine: { x: number, top: number, bottom: number } }>} */ ([]));

  let resizeObserver = null;

  function dotCenterFor(dayKey) {
    if (!container) return null;
    const el = container.querySelector(`[data-day-key="${dayKey}"] .dot`);
    if (!el) return null;
    const cRect = container.getBoundingClientRect();
    const dRect = el.getBoundingClientRect();
    return { x: dRect.left - cRect.left + dRect.width / 2, y: dRect.top - cRect.top + dRect.height / 2 };
  }

  function recompute() {
    if (!container) return;
    const firstDot = container.querySelector(".day-block .dot");
    const lastDot = container.querySelectorAll(".day-block .dot");
    if (!firstDot || lastDot.length === 0) {
      mainSpine = { x: 0, top: 0, bottom: 0 };
      arcs = [];
      return;
    }
    const cRect = container.getBoundingClientRect();
    const firstRect = firstDot.getBoundingClientRect();
    const lastRect = lastDot[lastDot.length - 1].getBoundingClientRect();
    const x = firstRect.left - cRect.left + firstRect.width / 2;
    const top = firstRect.top - cRect.top + firstRect.height / 2;
    const bottom = lastRect.top - cRect.top + lastRect.height / 2;
    mainSpine = { x, top, bottom };

    const nextArcs = [];
    for (const spawn of branchSpawns) {
      const start = dotCenterFor(spawn.parentDateKey);
      if (!start) continue;
      for (const bkey of spawn.branchDateKeys) {
        const end = dotCenterFor(bkey);
        if (!end) continue;
        const cx = start.x + 32;
        const cy = start.y + 12;
        const d = `M ${start.x} ${start.y} Q ${cx} ${cy} ${end.x} ${end.y}`;
        // sub-spine runs from this branch end down to the last branch dot
        const subBottom = spawn.branchDateKeys
          .map((b) => dotCenterFor(b))
          .filter(Boolean)
          .reduce((max, p) => Math.max(max, p.y), end.y);
        nextArcs.push({
          id: `${spawn.id}-${bkey}`,
          d,
          subSpine: { x: end.x, top: end.y, bottom: subBottom },
        });
        break; // arc only on the first branch dot; sub-spine handles the rest
      }
    }
    arcs = nextArcs;
  }

  onMount(() => {
    recompute();
    if (typeof ResizeObserver !== "undefined" && container) {
      resizeObserver = new ResizeObserver(() => recompute());
      resizeObserver.observe(container);
    }
  });

  onDestroy(() => {
    if (resizeObserver) resizeObserver.disconnect();
  });

  $effect(() => {
    // Recompute when branchSpawns reference changes (data reload).
    branchSpawns;
    requestAnimationFrame(() => recompute());
  });
</script>

<div class="timeline" bind:this={container}>
  <svg class="spine" aria-hidden="true">
    {#if mainSpine.bottom > mainSpine.top}
      <line
        x1={mainSpine.x} y1={mainSpine.top}
        x2={mainSpine.x} y2={mainSpine.bottom}
        stroke="color-mix(in srgb, var(--ink) 18%, transparent)"
        stroke-width="1.5"
      />
    {/if}
    {#each arcs as arc (arc.id)}
      <path
        d={arc.d}
        stroke="color-mix(in srgb, var(--warm-accent) 55%, transparent)"
        stroke-width="1.5"
        fill="none"
      />
      {#if arc.subSpine.bottom > arc.subSpine.top}
        <line
          x1={arc.subSpine.x} y1={arc.subSpine.top}
          x2={arc.subSpine.x} y2={arc.subSpine.bottom}
          stroke="color-mix(in srgb, var(--warm-accent) 35%, transparent)"
          stroke-width="1.5"
        />
      {/if}
    {/each}
  </svg>
  <div class="rows">
    {@render children()}
  </div>
</div>

<style>
  .timeline {
    position: relative;
  }
  .spine {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .rows {
    position: relative;
    z-index: 1;
  }
</style>
