// Props a test can change after mount, the way a host changes them: a
// $state object handed to mount() stays reactive, so setting `pageId` on it
// runs EditorCore's page-switch effect exactly as a real page switch does.
export function reactiveProps(initial) {
  const props = $state(initial);
  return props;
}
