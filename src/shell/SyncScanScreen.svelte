<!--
  The scanner: level 4 of the sync stack, and the first surface in this
  shell that owns a hardware resource.

  ── "FULL-SCREEN WITH ITS OWN BACK", AS THIS SHELL CAN HONESTLY BUILD IT

  §2 asks for "full-screen camera with its own back". It is a `Screen`: a
  nav band carrying the back, and a content band the preview fills. That
  IS the whole display here — `toolbarFor`'s row 1 gives a pushed screen
  `strip: "none"`, so the frame stops reserving the bottom slot and
  nothing else is on the display at all.

  What it deliberately is not is a preview under a floating back button.
  That needs a control taken out of the flow and laid over content, which
  is the bug class the whole shell exists to end — and the rules test
  names the only two files allowed to leave the flow, a permission whose
  spirit is not defeated by reaching for `absolute` instead. (Spelled
  around the banned declaration rather than quoting it: that rule is a
  whole-file substring scan that does not strip comments, and
  MemoryScreen's header records the same dodge.) And the back has to be
  the SAME back: P3 made Esc,
  the Android system button and the edge flick all pop one screen through
  navstack, and a scanner with a private exit would be a second navigation
  beside the stack. NavBar's back calls the same `onBack` the other three
  converge on.

  ── WHAT HAPPENS TO THE CAMERA, IN THREE CASES ────────────────────────

  A camera left running is a battery drain the writer cannot see and will
  not attribute to a notebook app, so each of these is a decision and not
  a default.

  POPPED MID-SCAN — this screen leaves `entries`, Stack stops rendering
  it, and unmounting takes `QrScanner` with it; its own `onDestroy` calls
  `controls.stop()` on the stream (QrScanner.svelte:49-55). That covers
  every door at once, which is the point of hanging it on the mount rather
  than on one of them: the nav bar's back, the edge flick, the system
  button, and `goRoot` emptying the whole stack on a tab tap all remove
  the element, and none of them has to know a camera existed.

  BACKGROUNDED — nothing unmounts. The WebView keeps the page alive with
  the stream open, and on a phone that is a lens the writer left running
  by switching apps. So this screen listens for `visibilitychange` and
  `pagehide` and flips its status to `paused`, which unmounts `QrScanner`
  and stops the stream by the same door a pop uses. Both events, not one,
  for `installSyncFlushOnHide`'s reason (src/lib/sync-flush-on-hide.js):
  `pagehide` fires on Android app-switch and teardown paths that
  `visibilitychange` can miss. Coming back re-mounts the component at its
  own consent gate, so the reader taps "start camera" again — that is the
  cost of not editing a desktop component to add a resume door, and it is
  the honest reading anyway: the lens was off, and it goes back on when
  someone asks it to.

  PERMISSION REFUSED — `QrScanner` catches the failed `getUserMedia`,
  renders its own message and calls `onError`. This screen unmounts it on
  that error rather than letting it explain itself, because its message is
  the DESKTOP's: it tells the reader to "switch to the 'type words' tab",
  which exists in `SyncSettings.svelte` and nowhere in this tree. The
  sentence shown instead comes from `scanner-lifecycle.js`, which
  classifies the failure using QrScanner's own substrings so the two
  cannot disagree about what a refusal is.

  ON ANDROID THE REFUSAL IS THE EXPECTED FIRST ANSWER, not an edge case.
  Nothing in this repo grants the Android WebView its camera permission —
  there is no `AndroidManifest.xml` in the tree at all (`tauri android`
  has never been run) and no `onPermissionRequest` handling; the only
  grant that exists is the Linux webkit2gtk hook in
  src-tauri/src/lib.rs:74-93. Fixing that is Rust and Android
  configuration, which this branch may not touch. Recorded here rather
  than discovered on the device pass.

  ── WHY THE STATUS IS A STRING FROM A MODULE ──────────────────────────

  Mounting is the only lever this shell has over a borrowed component's
  stream, so the `{#if}` below IS the camera switch, and a duplicate
  `visibilitychange` returning a fresh value would tear down a live stream
  mid-frame. `nextScanner` returns the identical string for an event that
  means nothing; its header carries the rest.
-->
<script>
  import { onMount } from "svelte";
  import Screen from "./ui/Screen.svelte";
  import NavBar from "./ui/NavBar.svelte";
  import Note from "./ui/Note.svelte";
  import QrScanner from "../components/QrScanner.svelte";
  import { cameraLive, nextScanner, scannerNote } from "./scanner-lifecycle.js";

  /** @type {{
    onBack?: (() => void) | null,
    onRead?: ((text: string) => void) | null,
  }} */
  let { onBack = null, onRead = null } = $props();

  let status = $state("scanning");

  function apply(event) {
    status = nextScanner(status, event);
  }

  onMount(() => {
    const onVisibility = () =>
      apply({ type: document.visibilityState === "hidden" ? "hidden" : "shown" });
    // pagehide carries no visibility to read, and it only ever means the
    // page is going away — so it is `hidden` unconditionally rather than
    // routed through the reader above.
    const onHide = () => apply({ type: "hidden" });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
    };
  });

  function handleResult(text) {
    // The status moves first, so the camera is already released by the
    // time the host acts on the code — the host pops this screen, which
    // would release it anyway, but a read that stopped the stream only
    // because someone else navigated is a stream held by luck.
    apply({ type: "read" });
    onRead?.(text);
  }

  function handleError(message) {
    // The raw string goes to the console and never to the screen: it is
    // an engine exception, and the reader is looking at a viewfinder in
    // the app they write in. `scannerNote` says the phone's sentence.
    console.warn("shell: the camera did not open", message);
    apply({ type: "error", message });
  }
</script>

<Screen>
  {#snippet nav()}
    <NavBar title="scan" {onBack} />
  {/snippet}

  <div class="scan-band">
    {#if cameraLive(status)}
      <QrScanner onResult={handleResult} onError={handleError} />
    {:else if scannerNote(status)}
      <!-- The shell's own sentence, through `Note`: a sentence of
           explanation in the prose face, left-aligned like the consent
           gate's rationale it stands in for. -->
      <Note>{scannerNote(status)}</Note>
    {/if}
    <!-- No `{:else}` branch, and that is not an oversight: the two silent
         statuses that reach it are `paused`, which nobody can see because
         the OS has hidden the screen, and `read`, which the host is
         popping out from under. Both are documented at `scannerNote`. A
         placeholder for either would be copy that exists only to fill a
         branch. -->
  </div>
</Screen>

<style>
  /* The preview owns the band. Centred rather than stretched because the
     borrowed component sizes its own video to the width it is given and
     keeps the camera's aspect ratio — a band that forced a height would
     letterbox it or crop the code out of frame. */
  .scan-band {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-height: 100%;
    padding: var(--space-4);
  }
</style>
