<!--
  One screen: a nav band, one scroll container, and nothing positioned
  over either.

  The bug this shape ends is "controls painted over prose". Every previous
  phone pass reached for absolute positioning to place a toolbar or a
  handle, and every one of them eventually placed it on top of the text
  the user was writing. Here the bands are ordered DOM siblings in a
  column: a thing can be above the content or below it, and there is no
  third option to get wrong.

  The screen is inset-blind by construction — ShellRoot has already
  subtracted the safe areas and the slot, so this component reads no
  env() and no viewport. It reports its scroll upward instead of acting on
  it, because what a scroll MEANS is nav-collapse.js's and
  gesture-owner.js's decision, not a screen's.

  onScroller is the same arrangement for the other direction: a caller that
  must MOVE the scroll (keeping a caret above the keyboard is the first,
  PageScreen) is handed two capabilities rather than the element. The
  element stays private on purpose. A parent that holds the node can style
  it, query inside it, or bind a second listener to it, and the first
  reader to see `querySelector(".shell-screen-content")` in a parent will
  reasonably copy it — which is how a private class name becomes an API
  nobody can rename. bounds() is the screen's OWN box, which is exactly the
  visible band: ShellRoot sizes to --app-height, so the box already ends
  above the keyboard and above the slot, and a caller doing this arithmetic
  from tokens instead would count both of them twice.

  `region` is the same arrangement a third time, and it is a prop rather
  than a constant for one reason: what this band MEANS to the gesture table
  differs per screen. The page root's content band is the "canvas" — a
  vertical drag there can leave for memory (§1) — and a pushed pins list is
  not, however identical the two elements look. A Screen that marked itself
  would hand every future pushed screen the canvas's space-switch by
  default, which is the shape of "the first screen to mark a full-bleed
  canvas swallowed the edge" that gesture-owner.js's header records. The
  host names the region; the element stays private either way.

  The boundaries are reported ONCE when the band mounts, before any scroll
  event. A `scroll` listener alone can only report a band the user has
  already scrolled, so on a page whose content does not fill the screen —
  a fresh page, which is the shell's most common state — nothing would ever
  report `atBottom`, and the swipe-up the table hangs off it would be dead
  exactly where a writer starts. atScrollBoundary answers `true` to both
  when nothing scrolls (gesture-arming.js:18), which is the right answer
  rather than a placeholder.
-->
<script>
  import { atScrollBoundary } from "../../lib/gesture-arming.js";

  /** @type {{
    region?: string | null,
    onScroll?: (state: {scrollTop: number, atTop: boolean, atBottom: boolean}) => void,
    onScroller?: (s: {bounds: () => DOMRect | null, scrollBy: (dy: number) => void}) => void,
    nav?: import("svelte").Snippet,
    children?: import("svelte").Snippet,
  }} */
  let { region = null, onScroll, onScroller, nav, children } = $props();

  let contentEl = $state(null);

  // Both read contentEl at call time, not at hand-off time, so the object
  // stays valid however the binding lands and whatever order the effects
  // below run in.
  const scroller = {
    bounds: () => contentEl?.getBoundingClientRect() ?? null,
    scrollBy: (dy) => {
      if (contentEl) contentEl.scrollTop += dy;
    },
  };

  $effect(() => {
    if (!contentEl) return;
    onScroller?.(scroller);
    // The first report, at mount — see the header. Same payload as a real
    // scroll, through the same function, so there is one shape of this
    // message and not two.
    handleScroll();
  });

  function handleScroll() {
    if (!contentEl || !onScroll) return;
    onScroll({
      scrollTop: contentEl.scrollTop,
      // The direction names read inverted here on purpose: they describe
      // which flick is still possible, not where the content sits. A flick
      // UP is possible only at the bottom, and vice versa. Borrowed rather
      // than re-derived because this same arithmetic needs a 1px tolerance
      // for fractional scrollTop, and gesture-arming.js already has it —
      // re-deriving it inline is how the two drift apart.
      atTop: atScrollBoundary(contentEl, "down"),
      atBottom: atScrollBoundary(contentEl, "up"),
    });
  }
</script>

<div class="shell-screen">
  <div class="shell-screen-nav">
    {#if nav}{@render nav()}{/if}
  </div>
  <div
    class="shell-screen-content"
    bind:this={contentEl}
    data-shell-region={region}
    onscroll={handleScroll}
  >
    {#if children}{@render children()}{/if}
  </div>
</div>

<style>
  .shell-screen {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
  }

  .shell-screen-nav {
    flex: 0 0 auto;
  }

  .shell-screen-content {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior-y: contain;
  }
</style>
