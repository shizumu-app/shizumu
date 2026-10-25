<!--
  The page's editorial header: line 1 the date and pins, line 2 the trail
  tag, the dots and the +. It folds to one line.

  It never decides its own fold. nav-collapse.js owns that rule — scroll
  hysteresis plus the keyboard — and a header that also decided would be a
  second owner of a rule that already has one, which is how chrome
  visibility latched in the desktop tree.

  Folding drops line 2 but PROMOTES the trail name into line 1. The obvious
  implementation hides line 2 whole, and then the one thing a writer needs
  to read at a glance — which trail this page is on — is what leaves the
  screen the moment they scroll, on a surface where the answer decides
  whether the sentence they are typing belongs here at all.

  The dots are the affordance, so the strip is a control only when there
  are dots to tap. A single page renders an inert spacer instead: the row
  keeps its shape, so + stays where the thumb last saw it rather than
  sliding left under a finger already on its way down.

  FIND LIVES ON LINE 1, and that is the whole reason in-page find has a way
  in at all (P2c-2 Task 2). The alternative was a control on the block
  strip, and it loses twice: that strip already carries eight controls and
  clips its first label at 412px, and it only exists while the keyboard is
  up — whereas going looking for something is exactly what you do with the
  keyboard DOWN. Line 1 is the one band that survives the fold, so find is
  reachable in both states.

  It sits to the LEFT of pins rather than to the right, for the same reason
  the dots row keeps its shape above: pins has been the right-hand control
  of this row since P2a, and inserting a sibling outboard of it would slide
  a known target under a thumb already on its way down. The new control
  takes the new position.

  THE TRAIL TAG IS A CONTROL ONLY WHEN THERE IS SOMETHING TO CHOOSE, which
  is `onTrail` being supplied, and the host is what knows (P2f Task 3: a
  continuous trail's canonical page can be assigned nowhere, so its host
  passes nothing and the tag renders as the label it always was). Same
  rule the dots already follow one line down, for the same reason: an
  affordance that opens onto nothing is worse than a label.

  AN UNTRAILED PAGE STILL GETS THE CONTROL, and it needs a word of its own
  because there is no trail name to tap. It says `trail`, the verb, which
  is what the tap leads to. Hiding it instead would make choosing a trail
  reachable only from a page that already has one, i.e. never.

  FOLDED, THE PROMOTED TRAIL NAME STAYS A LABEL. Line 1 already carries
  three targets and the fold exists to give the prose its space back; a
  fourth control in the one band that survives scrolling would spend that
  space again. The tag is a control again the moment the header unfolds,
  which is one scroll away.
-->
<script>
  import { pinsLabel } from "../pin-count.js";
  import { trailCrumb } from "../trail-crumb.js";
  import { pageDots } from "../page-dots.js";
  /** @type {{
    dateLabel: string,
    trailName?: string | null,
    trailParents?: string[],
    pageCount?: number,
    pageNumber?: number,
    pinCount?: number | null,
    collapsed?: boolean,
    onDate?: (() => void) | null,
    onFind?: (() => void) | null,
    onPins?: (() => void) | null,
    onTrail?: (() => void) | null,
    onPages?: (() => void) | null,
    onNew?: (() => void) | null,
  }} */
  let {
    dateLabel,
    trailName = null,
    trailParents = [],
    pageCount = 1,
    pageNumber = 1,
    // How many pins the `pins` control opens onto — pin-count.js says why
    // it is on the control and why null says nothing.
    pinCount = null,
    collapsed = false,
    onDate = null,
    onFind = null,
    onPins = null,
    onTrail = null,
    onPages = null,
    onNew = null,
  } = $props();

  /** The trail tag's text: its own name, with as much of what it is inside
   *  as the line can hold. The header showed a bare leaf before this, so a
   *  writer on `chapter two` could not see they were inside `the book`
   *  without opening the sheet — the structure they built was invisible on
   *  the surface they look at all day. trail-crumb.js owns which part
   *  survives when it will not all fit, and the answer is always the name. */
  const crumb = $derived(trailCrumb({ name: trailName, parents: trailParents }));

  const pinsText = $derived(pinsLabel(pinCount));

  // Dots while they can be counted, a count after that -- page-dots.js, which
  // carries the measurements. Both ends of the rule live there now, including
  // the one this file used to state here ("one dot is not a page indicator,
  // it is a smudge"); a decision a test can reach, per CLAUDE.md.
  const marks = $derived(pageDots({ pageCount, pageNumber }));
</script>

{#snippet dotRow()}
  {#if marks.kind === "count"}
    <span class="ph-dot-count">{marks.label}</span>
  {:else}
    {#each marks.dots as n (n)}
      <span class="ph-dot" class:ph-dot-on={n === pageNumber}></span>
    {/each}
  {/if}
{/snippet}

<div class="ph" class:collapsed>
  <div class="ph-line1">
    <button class="ph-date" type="button" onclick={() => onDate?.()}>
      <span class="ph-date-label">{dateLabel}</span>
      <!-- Drawn rather than typed, for the reason PageScreen's handle
           carries: the bundled DM Mono is a 138-codepoint subset ending at
           U+2113, so ▾ (U+25BE, Geometric Shapes) was only ever whatever
           the platform substituted. A border triangle always paints. -->
      <span class="ph-caret" aria-hidden="true"></span>
    </button>
    {#if collapsed && trailName}
      <span class="ph-folded-trail">· {trailName}</span>
    {/if}
    <span class="ph-spacer"></span>
    <button class="ph-find" type="button" onclick={() => onFind?.()}>find</button>
    <button class="ph-pins" type="button" onclick={() => onPins?.()}>{pinsText}</button>
  </div>

  {#if !collapsed}
    <div class="ph-line2">
      {#if onTrail}
        <button class="ph-trail-button" type="button" onclick={() => onTrail?.()}>
          <!-- A separate class rather than an empty .ph-trail, because
               .ph-trail means "the name of the trail this page is on" and
               nothing in the tree should have to read its TEXT to find out
               whether there is one. -->
          {#if trailName}
            <span class="ph-trail">{crumb}</span>
          {:else}
            <span class="ph-trail-empty">trail</span>
          {/if}
        </button>
      {:else if trailName}
        <span class="ph-trail">{crumb}</span>
      {/if}
      <span class="ph-spacer"></span>
      <!--
        THE DOTS ARE A NAMED GESTURE REGION, on the control branch only.
        gesture-owner.js orders header-dots ABOVE the left edge and says
        why in as many words: both rows claim "drag-right", and a dots
        strip drawn within EDGE_PX of the screen edge is a real layout, so
        a thumb on the dots must switch page rather than navigate back.
        Without this attribute that ordering decides nothing, because the
        table only ever sees a region the DOM supplies.

        The inert branch below carries no region, and the rule is the same
        one that makes it inert: it is a spacer holding the row's shape,
        not an affordance. Marking it would claim the strokes over an
        element with nothing to switch to — and the region it would take
        them from is the canvas, which does have somewhere to go.
      -->
      {#if marks.kind !== "none" && onPages}
        <button
          class="ph-dots"
          type="button"
          aria-label="pages of the day"
          data-shell-region="header-dots"
          onclick={() => onPages?.()}
        >
          {@render dotRow()}
        </button>
      {:else}
        <div class="ph-dots">{@render dotRow()}</div>
      {/if}
      <button class="ph-new" type="button" aria-label="new page" onclick={() => onNew?.()}>+</button>
    </div>
  {/if}
</div>

<style>
  .ph {
    display: flex;
    flex-direction: column;
    padding: 0 var(--space-4);
    border-bottom: 1px solid transparent;
    transition: border-color var(--motion-fast);
  }

  /* Folded, the band earns its hairline: the header is now the only thing
     between the prose and the top of the screen, and without the rule it
     reads as the first line of the page. */
  .ph.collapsed {
    border-bottom-color: var(--hairline);
  }

  .ph-line1,
  .ph-line2 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--tap);
  }

  .ph-spacer {
    flex: 1 1 auto;
    min-width: 0;
  }

  .ph-date,
  .ph-find,
  .ph-pins,
  .ph-new,
  .ph-trail-button,
  .ph-dots {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    min-height: var(--tap);
    background: none;
    border: none;
    padding: 0;
    color: var(--ink);
    font-family: var(--font-ui);
    cursor: pointer;
  }

  .ph-date {
    justify-content: flex-start;
    min-width: 0;
    font-size: var(--text-lg);
    line-height: var(--leading-lg);
  }

  .ph-date-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ph-caret {
    /* A triangle made of borders: 4px tall, 7px wide, pointing down. The
       colour is a border colour rather than `color`, so --ink-soft still
       names it exactly as it did when this was a character. */
    display: inline-block;
    width: 0;
    height: 0;
    border-left: 3.5px solid transparent;
    border-right: 3.5px solid transparent;
    border-top: 4px solid var(--ink-soft);
  }

  .ph-find,
  .ph-pins,
  .ph-new {
    min-width: var(--tap);
    color: var(--ink-soft);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
  }

  .ph-new {
    font-size: var(--text-lg);
    /* NEVER SHRINKS. `+` is the only way to start a page from this surface,
       and on the day it ran off the right edge it was because everything in
       this row was free to push it. The dots yield now; this one does not. */
    flex: 0 0 auto;
  }

  /* The tag's own control: a reset and the 44px floor, with the text in a
     child span so the ellipsis below still applies to it — the same shape
     .ph-date and .ph-date-label already take, and for the same reason
     (text-overflow does not reach the anonymous text of a flex box). It
     hugs the left of the row rather than centring, so the trail name sits
     exactly where the label it replaces sat. */
  .ph-trail-button {
    justify-content: flex-start;
    min-width: 0;
    text-align: left;
  }

  .ph-folded-trail,
  .ph-trail-empty,
  .ph-trail {
    color: var(--ink-soft);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* THE TRAIL'S NAME IS THE WRITER'S WORD, and it was drawn in the tone
     this file gives its own labels — the fourth device pass: "imported
     things such trail name are not clear". `trail` (the placeholder, and
     `find`, and `pins`) are the interface talking, and stay soft; the
     name of the trail this page is on is a fact about the page, and
     reads at full ink. The two then tell apart at a glance, which is
     what `.ph-trail-empty` being a separate class was always for. */
  .ph-trail,
  .ph-folded-trail {
    color: var(--ink);
  }

  /* The strip holds its height whether or not it holds dots, so the + does
     not step up and down as pages come and go. */
  .ph-dots {
    /* SHRINKABLE, and the `+` is not. Measured on an A16 with 28 pages on
       the day: `flex: 0 0 auto` here meant the row never yielded, so it
       pushed `+` to l=364 in a 384px viewport -- off the screen -- and
       squeezed the trail control to w=0. A writer could neither start a new
       page nor put that page on a trail. page-dots.js caps the dots so the
       row cannot grow like that again; this is the other half, so that a
       long trail name cannot do it either. */
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    gap: var(--space-2);
  }

  /* `12 / 28` wears the interface face, like every other label in this bar
     that is a fact rather than the writer's own words. */
  .ph-dot-count {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--ink-soft);
    white-space: nowrap;
  }

  .ph-dot {
    width: 5px;
    height: 5px;
    border-radius: var(--radius-lg);
    background: var(--ink-soft);
    opacity: var(--ink-tertiary);
  }

  .ph-dot-on {
    background: var(--warm-accent);
    opacity: 1;
  }
</style>
