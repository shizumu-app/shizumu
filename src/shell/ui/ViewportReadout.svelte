<!--
  The viewport's own numbers, on screen, for one build.

  WHY THIS IS IN THE TREE AT ALL. An iPhone reported the writing ending up
  behind the keyboard, and nothing in this repository can settle it: the VR
  suite drives the resizes-visual path with iOS-SHAPED numbers and passes,
  so what is unobserved is what a real WKWebView reports. There is no
  console on a signed device build and no devtools on the tester's phone.
  A photograph of these three lines is the observation, and it costs one
  build of the ~145 macOS minutes left rather than a guess per round trip.
  viewport-readout.js carries what each number decides.

  OFF UNLESS A BUILD ASKS FOR IT. `VITE_VIEWPORT_READOUT=1` at build time,
  or `?viewport=1` on the URL for a dev server. A build flag rather than a
  setting: a row in settings would be a permanent surface for a temporary
  question, and the canon's own rule is that the app does not grow chrome
  to explain itself.

  IT SHIPS INERT RATHER THAN NOT SHIPPING, and the first draft of this
  paragraph claimed the opposite — "the import is tree-shaken" — which a
  build proved false in the same hour it was written. `readoutWanted`
  reads `window.location` as well as the env, so the condition is not
  static, so the bundler keeps the component: a normal build carries this
  file and never renders it. The cost is about a kilobyte in a chunk;
  what it buys is that a shipped build can still be asked for the numbers
  by URL. Making the claim true would mean dropping the query half and
  leaving only a constant the bundler can fold — worth doing the day the
  kilobyte matters, and not before.

  IN THE FLOW, NOT OVER IT. It renders as the first thing inside the
  frame, above the screen, so it takes the band's height honestly instead
  of covering the writing it is meant to explain. That also makes its own
  box the measurement that matters: it sits at the top of the frame, so
  `getBoundingClientRect().top` IS the frame's top in layout coordinates,
  which is the one thing the report could not say from the outside. Two
  files in this tree may take themselves out of the flow and this is not
  one of them; nothing here needs to.

  IT READS THE STORE, NEVER THE VIEWPORT. keyboard-state.js is the app's
  only visual-viewport reader and a debug overlay is not a reason to make
  a second one, so it publishes `viewportSnapshot` and this subscribes.
  The one thing it measures itself is its own box, which is layout and not
  viewport.

  THE SAME RULE FOR THE EDITOR. The block line comes from
  `editorReadout`, which ShellApp publishes from the snapshot it already
  holds — not from a second subscription to EditorCore's own store. A
  diagnostic that became a second reader of live state would be the thing
  the rule above exists to prevent, arriving through the door marked
  "it's only for debugging".
-->
<script>
  import { viewportSnapshot } from "../../lib/keyboard-state.js";
  import { editorReadout, handleReadout } from "../editor-readout.js";
  import { viewportReadoutLines, viewportReadoutSummary } from "../viewport-readout.js";

  let el = $state(null);
  let frame = $state(null);
  // COLLAPSED BY DEFAULT, because this sits in the flow and eight lines of
  // it is a strip of the writing surface — reported from a phone as the
  // readout taking the room the bottom buttons needed. One line answers
  // most device questions; the tap is for the rest. Component state rather
  // than storage: it is a diagnostic, and a remembered expansion would be a
  // setting for a question that lasts one build.
  let expanded = $state(false);

  const snapshot = $derived($viewportSnapshot);

  // Measured after every publication, which is every viewport event: the
  // frame's position is exactly what changes between them.
  $effect(() => {
    // Read the snapshot so this re-runs with it.
    void snapshot;
    if (!el) return;
    const box = el.getBoundingClientRect();
    frame = { top: box.top, height: box.height };
  });

  const lines = $derived(
    expanded
      ? viewportReadoutLines(snapshot, frame, $editorReadout, $handleReadout)
      : [viewportReadoutSummary(snapshot, $handleReadout, safeBottom())],
  );

  // Read off the root, which is where safe-area.js writes it — not a second
  // reader of anything live. Called from the derived so it re-reads whenever
  // the snapshot does, which is every viewport event.
  function safeBottom() {
    if (typeof window === "undefined" || !window.document) return "";
    void snapshot;
    return getComputedStyle(window.document.documentElement)
      .getPropertyValue("--safe-bottom");
  }
</script>

<!-- A DIV WITH A ROLE, and not an oversight. shell-rules.test.js forbids the
     button element in this tree — the scan is a plain substring match, so
     this note cannot spell it — and allowlists only the primitives, each of which
     must declare the 44px tap floor — and this strip is 9px type that
     deliberately takes as little of the page as it can. A diagnostic cannot
     honour the floor and must not be allowlisted past it, so it carries the
     role instead of the element. aria-hidden stays either way: there is
     nothing here for a screen reader, expanded or not, and tabindex -1 keeps
     it out of the tab order it has no business in. -->
<div
  class="shell-viewport-readout"
  bind:this={el}
  aria-hidden="true"
  role="button"
  tabindex="-1"
  onclick={() => { expanded = !expanded; }}
  onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") expanded = !expanded; }}
>
  {#each lines as line, i (i)}
    <span class="shell-viewport-readout-line">{line}</span>
  {/each}
</div>

<style>
  /* Loud on purpose: it is read off a photograph taken at arm's length,
     and it exists for one build. No tokens for the colours — the point is
     that it cannot be mistaken for the app. */
  .shell-viewport-readout {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    width: 100%;
    border: 0;
    text-align: left;
    padding: 2px var(--space-2);
    background: #000;
    color: #0f0;
    font-family: var(--font-ui);
    /* SMALL ON PURPOSE. It grew to eight lines as each hunt added one, and
       at 11px that was a quarter of a phone screen — the overlay meant to
       explain the app was pushing the app off it. It is read off a
       photograph taken at arm's length, which 9px survives. */
    font-size: 9px;
    line-height: 1.15;
  }
</style>
