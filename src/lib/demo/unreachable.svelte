<!--
  Stands in for app UI the browser demo can never reach, so its code stays out
  of the public bundle: the onboarding slides (the demo's fixture marks
  onboarding complete, so they never render) and the dev playground gallery.

  This is not only about bytes. Those files still carry a word retired from
  user-facing copy, and a public artifact that contains it is a surface where
  someone can read it. The word is being removed from the slides under its own
  spec, with the VR snapshot re-record that requires; until then, the demo
  simply does not ship them.
-->
<script>
  // Accepts and ignores whatever the real components take, so a caller that
  // passes props or a callback still type-checks and still mounts.
  let props = $props();
  void props;
</script>
