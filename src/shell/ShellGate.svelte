<!--
  The two chromeless states that are whole screens: onboarding and lock.

  §2: "Onboarding / lock / midnight use the bands too (nav bar hidden,
  content centred, bottom slot holds the primary action)." Midnight is not
  here — it is a non-dismissable Sheet inside ShellApp, and midnight.js
  argues that split at length. These two are gates: they stand in FRONT of
  the shell rather than inside it, so they are not roots, not pushed
  screens, and they mount no ShellApp at all.

  ── WHY THIS IS A SIBLING OF ShellApp AND NOT A SCREEN INSIDE IT ──

  App.svelte's chain is onboarding → lock → the boot fork → the spaces, and
  the fork's position below the two gates is a correctness requirement that
  P2a corrected a plan for: a fork above the lock branch renders the shell
  over a LOCKED DATABASE, which is a lock bypass reachable by flipping one
  setting. shell-boot.test.js asserts the ordering as text, because nothing
  at the branch itself can show it.

  So ShellApp cannot own these. Putting onboarding inside the shell would
  mean moving the shell above onboarding; putting lock inside it would mean
  moving it above lock. Both are the same edit and one of them is the
  bypass. The gates instead render INSIDE their existing branches, chosen by
  the same `bootShell` the fork below reads — the chain keeps deciding
  whether a gate applies, and the flag only decides what a gate looks like.

  The consequence is written down rather than discovered: `bootShell` needs
  `getSetting("try_new_shell")`, and on a locked database that read can
  fail. It fails toward the desktop LockScreen (shell-boot.js: an
  unreadable flag is off), which is a full-screen centred passphrase field
  that works — a degradation, not a hole. Nothing here invents a second
  source for the flag to route around it.

  ── THE BANDS ──

  It renders its own ShellRoot, which is what keeps the inset function in
  exactly one place (CLAUDE.md; shell-rules.test.js enforces it, and it is
  named obliquely here for the reason ShellRoot's own header gives — those
  scans are plain substring checks over every file in src/, so spelling the
  literal would make this file their first offender). The root subtracts the
  safe-area tokens and the slot height once and this file re-adds nothing:
  "content centred" is `margin: auto` inside the content band, not padding
  arithmetic against those tokens. A chromeless state is exactly the shape
  that invites that arithmetic, which is why it is said out loud here.

  Nav bar hidden is the absence of a Screen, not a Screen with an empty nav
  — Screen's nav band is a flex child that would collapse to nothing anyway,
  but the gate has no title, no back and no actions, so there is no band to
  render rather than an empty one.

  `hasStrip` is `strip === "primary-action"` rather than `strip !== "none"`,
  which is the ShellApp expression. Deliberate: this frame can render
  exactly one shape, so it reserves the band for exactly that shape. Written
  the other way, a `gateAction` that ever came back null would reserve a
  band and put nothing in it — an empty strip of chrome under a screen whose
  only control it was supposed to be holding.

  `hasNav` is passed through rather than hardcoded false, and toolbarFor
  answers false for every gate. That is not tidiness: with the two-row band,
  a nav row here would be page / memory / settings offered under the unlock
  box, which is a way around the lock rather than a cosmetic slip. The rule
  lives in toolbar-model.js's gate row, where the ordering argument is, and
  this frame keeps asking rather than deciding.

  ── WHAT THE SLOT HOLDS IS STILL toolbar-model.js's CALL ──

  This component does not decide; it asks, exactly as ShellApp does. That
  matters most for the input it passes alongside the gate: `keyboardOpen`.
  Lock is a passphrase FIELD, so tapping it raises the soft keyboard and
  that flag goes true on a surface with no editor anywhere in the tree.
  Without the gate row sitting above `keyboardOpen`, `toolbarFor` would
  hand this screen the block strip — bold, italic, insert, pin, undo —
  over a password box. That is P3's `space` bug (memory's search field, one
  root over) repeated one level up, and passing the real flag rather than a
  convenient `false` is what keeps the row's position under test.
-->
<script>
  import ShellRoot from "./ShellRoot.svelte";
  import Field from "./ui/Field.svelte";
  import Note from "./ui/Note.svelte";
  import PrimaryAction from "./ui/PrimaryAction.svelte";
  import { toolbarFor } from "./toolbar-model.js";
  import { gateStep, gateAdvance, ONBOARDING_SLIDES } from "./gate-model.js";
  import { markOnboardingComplete, unlock } from "../lib/api.js";

  /** @type {{
    kind: "onboarding" | "lock",
    keyboardOpen?: boolean,
    onComplete?: () => void,
    onUnlock?: () => void,
  }} */
  let { kind, keyboardOpen = false, onComplete, onUnlock } = $props();

  let index = $state(0);
  let passphrase = $state("");
  let wrong = $state(false);
  let busy = $state(false);

  const step = $derived(gateStep({ kind, index }));

  // Dead until there is something to unlock WITH. A control that submits an
  // empty passphrase can only ever fail, and on a screen holding one button
  // a failure the user could not have avoided reads as the app refusing
  // them. Onboarding's button is never dead — every slide can advance.
  const ready = $derived(kind !== "lock" || (passphrase.trim().length > 0 && !busy));

  const toolbar = $derived(toolbarFor({ gateAction: step.action, keyboardOpen }));

  function finish() {
    // ADVANCE FIRST, PERSIST AFTER, and never wait on the write.
    //
    // This used to `await markOnboardingComplete()` inside a try/catch, and
    // the comment said what it was for: a failed write must not strand a new
    // user on the last slide with a button that stops working. It guarded
    // against the write THROWING. It did not guard against it never
    // resolving — a locked database, a migration still running — and an
    // await that never returns is a button that does nothing, on the one
    // screen with no other control and no way back. The next launch shows
    // onboarding again, because the flag was never written, so it is not
    // even a state the writer can get out of by restarting.
    //
    // Nothing downstream needs the write to have landed: handleOnboardingComplete
    // (App.svelte) flips a flag in memory. Persisting is what makes it stick
    // across launches, and the stated worst case — seeing onboarding once
    // more — is exactly what a dropped write costs. So it is fired and not
    // waited on, and the catch stays for the rejection.
    onComplete?.();
    Promise.resolve()
      .then(() => markOnboardingComplete())
      .catch(() => {});
  }

  async function runUnlock() {
    if (busy || !passphrase.trim()) return;
    busy = true;
    wrong = false;
    try {
      const ok = await unlock(passphrase);
      // STRICTLY `=== false`. The Rust command returns Ok(false) for a
      // wrong passphrase rather than throwing (commands.rs:4030-4050), so
      // the answer has to be read, not just awaited. The desktop screen
      // used to await the invoke and call onUnlock() regardless of what
      // came back — a wrong passphrase got in there — and this gate was
      // written as the one place the shell knowingly diverged from it.
      // main fixed src/components/LockScreen.svelte the same way on
      // 133b66d6 ("a wrong passphrase is an answer, not an error"), so the
      // two now agree, down to the null case: the browser mock returns
      // null, which is not `false`, so web dev still lets any passphrase
      // through on both screens.
      if (ok === false) {
        wrong = true;
        passphrase = "";
        return;
      }
      onUnlock?.();
    } catch {
      wrong = true;
      passphrase = "";
    } finally {
      busy = false;
    }
  }

  function press(id) {
    if (id === "unlock") {
      runUnlock();
      return;
    }
    // Both onboarding ids land here, and neither is compared against:
    // `gateAdvance` reads `last` off the same comparison that chose the
    // label, so the button that says "begin" is the one that finishes by
    // construction rather than by two expressions agreeing.
    const next = gateAdvance({ kind, index });
    if (next.done) {
      finish();
      return;
    }
    index = next.index;
  }
</script>

<ShellRoot hasStrip={toolbar.strip === "primary-action"} hasNav={toolbar.nav}>
  <div class="shell-gate">
    <div class="shell-gate-body">
      {#if kind === "lock"}
        <p class="shell-gate-brand">shizumu</p>
        <!--
          NOT AUTOFOCUSED, for LineageSelector's finding, which every sheet
          with a field in this tree already declines autofocus for: a mobile
          webview raises the IME only for focus that traces to a user
          gesture, so a programmatic focus here leaves a caret in a field
          with no keyboard under it. The writer taps the field and the tap
          raises the keyboard. The desktop LockScreen autofocuses because a
          laptop has no IME to raise.
        -->
        <Field label="passphrase" placeholder="passphrase" secure bind:value={passphrase} />
        {#if wrong}
          <!-- The error, through `Note` in its warm tone: the shell's one
               colour for "this one" beside a field the writer just used,
               rather than a red the shell does not have. The gate's own
               centring is inherited; the note adds no rule of its own. -->
          <Note tone="warm">wrong passphrase</Note>
        {/if}
      {:else if step.slide}
        <p class="shell-gate-title">{step.slide.title}</p>
        <p class="shell-gate-prose">{step.slide.body}</p>
        <div class="shell-gate-progress" aria-hidden="true">
          {#each ONBOARDING_SLIDES as slide, i (slide.id)}
            <span class="shell-gate-dash" class:current={i === index}></span>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  {#snippet slot()}
    {#if toolbar.strip === "primary-action"}
      <!-- ONBOARDING ACTIVATES ON THE LIFT, LOCK ON THE PRESS. Onboarding
           has no field to keep focused, and a press that dismisses this gate
           hands the rest of the gesture to the tab bar that mounts in this
           band — which put a brand-new writer on memory instead of the page.
           Lock does have a focused field and a soft keyboard to lose, so it
           keeps the press. PrimaryAction's header carries the measurement and
           the reason the two differ. -->
      <PrimaryAction
        id={toolbar.buttons[0]}
        disabled={!ready}
        activateOn={kind === "onboarding" ? "click" : "pointerdown"}
        onPress={press}
      />
    {/if}
  {/snippet}
</ShellRoot>

<style>
  /* The content band, scrolling, with nothing centred by absolute
     positioning. `margin: auto` on the child rather than `align-items:
     center` on the parent: a centred flex item that outgrows its scroll
     container has its overflowing top CLIPPED and unreachable, and the
     onboarding slide is prose whose height is a translation and a font size
     away from doing exactly that. `margin: auto` centres while there is
     room and yields to the scroller when there is not. */
  .shell-gate {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    overscroll-behavior-y: contain;
  }

  .shell-gate-body {
    margin: auto;
    width: 100%;
    /* The prose column, not the frame's width. §2 caps content at the prose
       measure; a gate is the one screen with nothing but a paragraph on it,
       so the cap is the whole layout. */
    max-width: 32ch;
    padding: var(--space-6) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    text-align: center;
  }

  .shell-gate-brand,
  .shell-gate-title {
    margin: 0;
    font-family: var(--font-prose);
    font-size: var(--text-lg);
    line-height: var(--leading-lg);
    color: var(--ink);
  }

  /* The brand is a mark, not a heading — it names the app on a screen that
     has nothing else on it, and at full weight it would read as an
     instruction. Same treatment the desktop lock screen gives it. */
  .shell-gate-brand {
    opacity: var(--ink-tertiary);
    letter-spacing: 0.04em;
  }

  .shell-gate-prose {
    margin: 0;
    font-family: var(--font-prose);
    font-size: var(--text-base);
    line-height: var(--leading-base);
    color: var(--ink-soft);
    text-align: left;
  }

  .shell-gate-progress {
    display: flex;
    gap: var(--space-2);
    justify-content: center;
  }

  .shell-gate-dash {
    width: var(--space-5);
    height: 2px;
    border-radius: 1px;
    background: var(--hairline);
  }

  .shell-gate-dash.current {
    background: var(--warm-accent);
  }
</style>
