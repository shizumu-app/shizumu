<script>
  // Shown when the local clock crosses midnight while the app is open.
  // Forces a choice: start a fresh page for the new day, or carry
  // yesterday's page forward. On phone it slides up as a bottom sheet
  // (consistent with the date / trail / sync pickers); on desktop it's a
  // centered modal. Both are non-dismissable — the user must pick.
  import Modal from "../lib/ui/Modal.svelte";
  import BottomSheet from "../lib/ui/BottomSheet.svelte";
  import Button from "../lib/ui/Button.svelte";
  import { isPhoneViewport, watchPhoneViewport } from "../lib/responsive.js";

  let {
    open = false,
    onStartFresh = () => {},
    onContinue = () => {},
  } = $props();

  let isPhone = $state(isPhoneViewport());
  $effect(() => {
    const unwatch = watchPhoneViewport((m) => { isPhone = m; });
    return unwatch;
  });
</script>

{#if isPhone}
  <!-- onClose is a no-op so the scrim / back can't dismiss without a pick,
       matching the desktop modal's dismissable={false}. -->
  <BottomSheet {open} onClose={() => {}} title="a new day">
    <p class="midnight-msg">a new day. yesterday is still here.</p>
    <div class="midnight-actions">
      <Button variant="subtle" onClick={onStartFresh}>start fresh</Button>
      <Button variant="accent" onClick={onContinue}>stay on yesterday</Button>
    </div>
  </BottomSheet>
{:else}
  <Modal {open} title="a new day" dismissable={false}>
    a new day. yesterday is still here.

    {#snippet actions()}
      <Button variant="subtle" onClick={onStartFresh}>start fresh</Button>
      <Button variant="accent" onClick={onContinue}>stay on yesterday</Button>
    {/snippet}
  </Modal>
{/if}

<style>
  .midnight-msg {
    margin: 0 0 1rem;
    font-family: "Lora", serif;
    font-size: 0.9375rem;
    line-height: 1.55;
    color: var(--ink);
    opacity: 0.75;
  }
  /* Full-width, stacked buttons read as a clear phone choice. */
  .midnight-actions {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding-bottom: 0.5rem;
  }
  .midnight-actions :global(button) {
    width: 100%;
    justify-content: center;
  }
</style>
