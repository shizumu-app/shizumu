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

// jsdom implements getClientRects/getBoundingClientRect on Element — they
// return an empty list and an all-zero rect, because there is no layout —
// but it implements NEITHER on Range. ProseMirror's coordsAtPos measures a
// caret that sits AFTER text by building a Range over that text
// (prosemirror-view's `textRange` into `singleRect`), so any scrollIntoView
// with the caret on a written line ends in "target.getClientRects is not a
// function". With the caret on an EMPTY line the same code takes the
// Element branch and survives, which is why this only ever surfaced on the
// paths that put the caret back into a sentence.
//
// It lands as an unhandled error — green assertions, exit code 1,
// attributed to whichever test happened to be running when the deferred
// callback fired (tiptap's `focus()` defers view.focus() + scrollIntoView
// into a requestAnimationFrame, so the throw is always one frame away from
// whatever caused it). ShellApp.test.js:225 documents the same class.
//
// So: give Range the answer jsdom already gives Element for the same
// question. This completes jsdom's no-layout contract rather than faking a
// measurement — every rect is still zero, so nothing can assert a position
// off it and quietly pass.
if (typeof Range !== "undefined" && typeof Range.prototype.getClientRects !== "function") {
  Range.prototype.getClientRects = function getClientRects() {
    return Object.assign([], { item: () => null });
  };
  Range.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
  };
}
