<script>
  import { fade } from "svelte/transition";

  /** @type {{ onComplete: () => void, onCancel: () => void }} */
  let { onComplete, onCancel } = $props();

  const isTauri = typeof window !== "undefined" && window.__TAURI_INTERNALS__;

  let passphrase = $state("");
  let confirm = $state("");
  let submitting = $state(false);
  let error = $state("");

  let valid = $derived(
    passphrase.length >= 8 &&
    passphrase === confirm
  );

  let mismatch = $derived(
    confirm.length > 0 &&
    passphrase !== confirm
  );

  let tooShort = $derived(
    passphrase.length > 0 &&
    passphrase.length < 8
  );

  async function handleSubmit() {
    if (!valid || submitting) return;

    submitting = true;
    error = "";

    try {
      if (isTauri) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("setup_encryption", { passphrase });
      }
      onComplete();
    } catch (err) {
      error = String(err);
      submitting = false;
    }
  }

  function handleKeydown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
    if (e.key === "Enter" && valid) {
      e.preventDefault();
      handleSubmit();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="setup-screen" transition:fade={{ duration: 300 }}>
  <div class="setup-center">
    <p class="app-name">shizumu</p>

    <p class="explain">encrypt your writing. your passphrase protects the database.</p>

    <div class="fields">
      <input
        type="password"
        class="field-input"
        placeholder="passphrase"
        bind:value={passphrase}
        disabled={submitting}
        spellcheck="false"
        autocomplete="new-password"
        autofocus
      />

      <input
        type="password"
        class="field-input"
        placeholder="confirm passphrase"
        bind:value={confirm}
        disabled={submitting}
        spellcheck="false"
        autocomplete="new-password"
      />

      {#if tooShort}
        <p class="hint" transition:fade={{ duration: 150 }}>at least 8 characters</p>
      {/if}

      {#if mismatch}
        <p class="hint hint-warn" transition:fade={{ duration: 150 }}>passphrases do not match</p>
      {/if}

      {#if error}
        <p class="hint hint-warn" transition:fade={{ duration: 150 }}>{error}</p>
      {/if}
    </div>

    <p class="keyring-note">
      passphrase kept on this device so the app can unlock on launch. on some
      systems the system keyring is also used.
    </p>

    <button
      class="encrypt-btn label"
      disabled={!valid || submitting}
      onclick={handleSubmit}
    >
      {submitting ? "encrypting..." : "encrypt"}
    </button>
  </div>
</div>

<style>
  .setup-screen {
    position: fixed;
    inset: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    background: color-mix(in srgb, var(--margin-bg) 92%, transparent);
    z-index: 300;
  }

  .setup-center {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 24px;
    max-width: 340px;
    padding: 0 32px;
  }

  .app-name {
    font-family: "Lora", serif;
    font-size: 20px;
    color: var(--ink);
    opacity: 0.2;
    letter-spacing: 0.04em;
    margin: 0;
    user-select: none;
  }

  .explain {
    font-family: "Lora", serif;
    font-style: italic;
    font-size: 14px;
    color: var(--ink);
    opacity: 0.4;
    text-align: center;
    line-height: 1.7;
    margin: 0;
  }

  .fields {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    width: 100%;
  }

  .field-input {
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--horizon);
    outline: none;
    font-family: "Inter", sans-serif;
    font-size: 15px;
    color: var(--ink);
    padding: 8px 0;
    width: 240px;
    text-align: center;
    letter-spacing: 0.08em;
    transition: border-color 200ms ease;
  }

  .field-input::placeholder {
    font-family: "DM Mono", monospace;
    font-size: 13px;
    color: var(--ink);
    opacity: 0.25;
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
    color: var(--ink);
    opacity: 0.35;
    margin: 0;
  }

  .hint-warn {
    color: var(--warm-accent);
    opacity: 0.6;
  }

  .keyring-note {
    font-family: "Lora", serif;
    font-style: italic;
    font-size: 12px;
    color: var(--ink);
    opacity: 0.35;
    text-align: center;
    line-height: 1.6;
    margin: 0;
  }

  /* Encrypt button */
  .encrypt-btn {
    background: none;
    border: 1px solid var(--horizon);
    border-radius: 6px;
    cursor: pointer;
    color: var(--ink);
    opacity: 0.5;
    padding: 10px 32px;
    font-size: 13px;
    letter-spacing: 0.04em;
    transition: opacity 200ms ease, border-color 200ms ease;
    margin-top: 8px;
  }

  .encrypt-btn:hover:not(:disabled) {
    opacity: 0.8;
    border-color: color-mix(in srgb, var(--ink) 30%, transparent);
  }

  .encrypt-btn:disabled {
    opacity: 0.15;
    cursor: default;
  }
</style>
