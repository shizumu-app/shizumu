<!--
  A notice that lives in the flow, under the nav bar.

  It is in the flow rather than floating, because a floating notice is a
  control painted over prose by another name — and the one message this
  carries at first is the pin-time breadcrumb ("joins 11 pins on the book
  trail"), which the user should be able to read without it covering the
  block they just pinned.

  An empty message renders no BAND at all rather than an empty one: a
  zero-height strip that still takes layout space reads as a glitch.

  It is set in --font-prose. The message is a sentence addressed to the
  writer — "joins 11 pins on the book trail" — not a label on a control,
  and the shell's type roles give prose to what is read and the interface
  face to what is operated. Toast.test.js holds the face by reading this
  file, since jsdom applies no scoped stylesheet.

  ── what its first real call turned up (P2f Task 2) ───────────────────

  Written in P1a, catalogued in Gallery, tested — and called by nothing in
  the app until the pin flow needed it. Two findings, recorded because
  neither is visible from outside the file:

  1. THE LIVE REGION USED TO ARRIVE WITH ITS MESSAGE ALREADY IN IT. The
     `role="status"` / `aria-live="polite"` pair sat on the element inside
     the `{#if}`, so the region was created and filled in one mutation. A
     live region has to be in the DOM BEFORE its content changes for
     assistive tech to announce the change; a region inserted already-full
     is announced unreliably, and TalkBack — the shell's first target — is
     among the ones that stay silent. This toast is the only channel
     saying where a pin landed, so a missed announcement is the whole
     message lost. The region is mounted always now, and the visible band
     is what the `{#if}` guards. The wrapper carries no styles at all, so
     an empty toast still contributes no height and no margin:
     `.shell-screen-nav` and `.shell-screen-content` are plain flex/block
     containers with no `gap`, so a zero-height child moves nothing.

  2. IT HAS NO LIFETIME OF ITS OWN — no timer, no dismiss, no state. That
     is right for a primitive and worth saying out loud, because the
     obvious reading of the word "toast" is that it leaves by itself. It
     does not: whoever sets `message` owns clearing it, or the breadcrumb
     outlives the pin it describes and goes on asserting a count that
     later pins have moved past. ShellApp does that with `PIN_TOAST_MS`
     (pin-toast.js).

  WHERE IT IS MOUNTED was the third thing the first call decided, and it
  went against this file's first sentence, which used to say "lives in the
  content": PageScreen renders it in the NAV band. The content band is the
  scroll container, so a toast at the top of it is above the fold for any
  writer who has scrolled — and a pin happens wherever the caret is, which
  on a page worth pinning from is rarely the first screenful. In the nav
  band it is still a DOM sibling in a column and still positioned by
  nothing, which is the property that mattered; it is simply in the band
  that does not scroll. PageScreen's own comment carries the rest.
-->
<script>
  /** @type {{ message?: string }} */
  let { message = "" } = $props();
</script>

<div class="shell-toast-live" role="status" aria-live="polite">
  {#if message}
    <div class="shell-toast">{message}</div>
  {/if}
</div>

<style>
  .shell-toast {
    margin: var(--space-2) var(--space-4);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: var(--warm-accent-soft);
    color: var(--ink);
    font-family: var(--font-prose);
    font-size: var(--text-sm);
    line-height: var(--leading-sm);
  }
</style>
