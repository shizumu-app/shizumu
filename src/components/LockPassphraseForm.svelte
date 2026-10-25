<!--
  Change the lock's passphrase, or turn the lock off. Shown in a modal from
  settings > encryption once the lock is on: until 0.8 that row said "on"
  and offered nothing, so a writer who set a passphrase was stuck with it.
  What the form accepts lives in src/lib/lock-passphrase.js.
-->
<script>
  import Button from "../lib/ui/Button.svelte";
  import { changePassphrase, removeEncryption } from "../lib/api.js";
  import { lockFormState } from "../lib/lock-passphrase.js";

  /** @type {{ mode: "change"|"off", onDone: () => void, onCancel: () => void }} */
  let { mode, onDone, onCancel } = $props();

  let current = $state("");
  let next = $state("");
  let confirm = $state("");
  let submitting = $state(false);
  // The backend's own words: a wrong current passphrase, or a file that
  // could not be re-keyed (in which case it was put back as it was).
  let error = $state("");

  const form = $derived(lockFormState({ mode, current, next, confirm }));
  const action = $derived(mode === "change" ? "change passphrase" : "turn off");

  async function submit() {
    if (!form.valid || submitting) return;
    submitting = true;
    error = "";
    try {
      if (mode === "change") await changePassphrase(current, next);
      else await removeEncryption(current);
      onDone();
    } catch (err) {
      error = String(err);
      submitting = false;
    }
  }

  function onKeydown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  }
</script>

<div class="lock-form">
  <p class="explain">
    {#if mode === "change"}
      the app unlocks with the new passphrase from now on.
    {:else}
      your pages stay on this device, without a passphrase. anyone who can open this computer's files can read them.
    {/if}
  </p>

  <input
    type="password"
    class="field-input"
    placeholder="current passphrase"
    aria-label="current passphrase"
    bind:value={current}
    disabled={submitting}
    spellcheck="false"
    autocomplete="current-password"
    autofocus
    onkeydown={onKeydown}
  />
  {#if mode === "change"}
    <input
      type="password"
      class="field-input"
      placeholder="new passphrase"
      aria-label="new passphrase"
      bind:value={next}
      disabled={submitting}
      spellcheck="false"
      autocomplete="new-password"
      onkeydown={onKeydown}
    />
    <input
      type="password"
      class="field-input"
      placeholder="confirm new passphrase"
      aria-label="confirm new passphrase"
      bind:value={confirm}
      disabled={submitting}
      spellcheck="false"
      autocomplete="new-password"
      onkeydown={onKeydown}
    />
  {/if}

  {#if form.hint}
    <p class="hint hint-warn">{form.hint}</p>
  {/if}
  {#if error}
    <p class="hint hint-warn" role="alert">{error}</p>
  {/if}

  <div class="actions">
    <Button variant="ghost" onClick={onCancel} disabled={submitting}>cancel</Button>
    <Button variant="accent" onClick={submit} disabled={!form.valid || submitting}>
      {submitting ? "..." : action}
    </Button>
  </div>
</div>

<style>
  .lock-form {
    display: flex;
    flex-direction: column;
    gap: 14px;
    max-width: 22rem;
  }

  .explain {
    font-family: "Lora", serif;
    font-style: italic;
    font-size: 14px;
    line-height: 1.6;
    color: var(--ink-soft);
    margin: 0;
  }

  /* The setup screen's field (SetupEncryption.svelte), left-aligned to sit
     in a modal rather than centred on an empty screen. */
  .field-input {
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--horizon);
    outline: none;
    font-family: "Inter", sans-serif;
    font-size: 15px;
    color: var(--ink);
    padding: 8px 0;
    letter-spacing: 0.08em;
    transition: border-color 200ms ease;
  }

  .field-input::placeholder {
    font-family: "DM Mono", monospace;
    font-size: 13px;
    color: var(--ink);
    opacity: 0.35;
    letter-spacing: 0.04em;
  }

  .field-input:focus {
    border-bottom-color: color-mix(in srgb, var(--ink) 40%, transparent);
  }

  .field-input:disabled {
    opacity: 0.4;
  }

  .hint {
    font-family: "Lora", serif;
    font-style: italic;
    font-size: 12px;
    margin: 0;
  }

  .hint-warn {
    color: var(--warm-accent);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    margin-top: 6px;
  }
</style>
