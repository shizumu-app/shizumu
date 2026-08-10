<script>
  import { fade } from "svelte/transition";

  /** @type {{ onUnlock: () => void }} */
  let { onUnlock } = $props();

  const isTauri = typeof window !== "undefined" && window.__TAURI_INTERNALS__;

  let passphrase = $state("");
  let shaking = $state(false);
  let unlocking = $state(false);

  async function handleSubmit() {
    if (!passphrase.trim() || unlocking) return;

    unlocking = true;

    try {
      if (isTauri) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("unlock", { passphrase });
      }
      // In web dev mode (non-Tauri), any passphrase works
      onUnlock();
    } catch {
      // Wrong passphrase — shake
      shaking = true;
      passphrase = "";
      unlocking = false;
      setTimeout(() => { shaking = false; }, 500);
    }
  }

  function handleKeydown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  }
</script>

<div class="lock-screen" transition:fade={{ duration: 300 }}>
  <div class="lock-center">
    <p class="app-name">shizumu</p>

    <input
      type="password"
      class="passphrase-input"
      class:shake={shaking}
      placeholder="passphrase"
      bind:value={passphrase}
      onkeydown={handleKeydown}
      disabled={unlocking}
      spellcheck="false"
      autocomplete="off"
      autofocus
    />
  </div>
</div>

<style>
  .lock-screen {
    width: 100%;
    align-self: stretch;
    display: flex;
    justify-content: center;
    align-items: center;
    background: var(--canvas-bg);
    /* Honor safe-area on every side so the input clears notches, the
       home indicator, and curved corners on phones. The app-shell
       already applies safe-area-inset-bottom; this adds the
       per-screen treatment so the centered input is never pushed
       out of the safe region. */
    padding:
      var(--safe-top)
      var(--safe-right)
      var(--safe-bottom)
      var(--safe-left);
    box-sizing: border-box;
  }

  .lock-center {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 48px;
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

  .passphrase-input {
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

  .passphrase-input::placeholder {
    font-family: "DM Mono", monospace;
    font-size: 13px;
    color: var(--ink);
    opacity: 0.25;
    letter-spacing: 0.04em;
  }

  .passphrase-input:focus {
    border-bottom-color: color-mix(in srgb, var(--ink) 40%, transparent);
  }

  .passphrase-input:disabled {
    opacity: 0.4;
  }

  /* Shake animation for wrong passphrase */
  .shake {
    animation: shake 400ms cubic-bezier(0.36, 0.07, 0.19, 0.97);
  }

  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    10%      { transform: translateX(-6px); }
    20%      { transform: translateX(5px); }
    30%      { transform: translateX(-4px); }
    40%      { transform: translateX(3px); }
    50%      { transform: translateX(-2px); }
    60%      { transform: translateX(1px); }
    70%      { transform: translateX(0); }
  }
</style>
