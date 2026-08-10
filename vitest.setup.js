// jsdom does not implement the Web Animations API. Svelte transitions
// (transition:fade, transition:fly, …) call element.animate() on
// mount/unmount, which throws "element.animate is not a function" as an
// uncaught error under jsdom and is reported by Vitest as an unhandled
// error (potential false-positive failure). Stub it with a no-op
// Animation-like object so transition-using component tests run cleanly.
// Loaded via test.setupFiles in vitest.config.js.
if (typeof Element !== "undefined" && typeof Element.prototype.animate !== "function") {
  Element.prototype.animate = function animate() {
    return {
      cancel() {},
      finish() {},
      play() {},
      pause() {},
      reverse() {},
      addEventListener() {},
      removeEventListener() {},
      onfinish: null,
      oncancel: null,
      currentTime: 0,
      playState: "finished",
      finished: Promise.resolve(),
    };
  };
}

if (typeof Element !== "undefined" && typeof Element.prototype.getAnimations !== "function") {
  Element.prototype.getAnimations = function getAnimations() {
    return [];
  };
}
