<!-- src/lib/ui/BottomSheetToggleHarness.svelte -->
<!--
  Test-only harness for BottomSheet.test.js's teardown-race regression.

  The bug (BottomSheet.svelte's focusin effect) only reproduces when `open`
  flips true -> false through real Svelte reactivity — passing a plain
  object as `mount()` props and mutating it externally is inert (Svelte 5
  props are only reactive when threaded through a parent's own signals).
  This harness gives the test a real reactive `open` to toggle, mirroring
  how PageNav/Popover/LineageSelector actually drive BottomSheet.
-->
<script>
  import BottomSheet from "./BottomSheet.svelte";
  let open = $state(true);
</script>

<button class="harness-close" onclick={() => (open = false)}>close</button>
<BottomSheet {open} onClose={() => (open = false)}>
  <input class="harness-input" />
</BottomSheet>
