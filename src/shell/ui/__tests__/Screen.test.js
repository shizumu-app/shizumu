import { describe, it, expect, afterEach, vi } from "vitest";
import { flushSync } from "svelte";
import { render, cleanupAll } from "../../../lib/ui/test-helper.js";
import Screen from "../Screen.svelte";

afterEach(cleanupAll);

/** jsdom reports 0 for every layout box, so scroll geometry is stubbed
 *  explicitly rather than faked by writing to scrollTop and hoping. */
function setGeometry(el, { scrollTop, scrollHeight, clientHeight }) {
  Object.defineProperty(el, "scrollTop", { value: scrollTop, configurable: true });
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: clientHeight, configurable: true });
}

describe("Screen", () => {
  it("renders exactly one scroll container", () => {
    // Two nested scrollers is how a phone ends up with the inner list
    // scrolling while the outer one rubber-bands — the shell has one.
    const { target } = render(Screen, {});
    expect(target.querySelectorAll(".shell-screen-content").length).toBe(1);
  });

  it("reports scroll position and both boundaries", () => {
    const onScroll = vi.fn();
    const { target } = render(Screen, { onScroll });
    // bind:this has not landed yet; without this the handler sees a null
    // element and early-returns, which reads as "the event never fired".
    flushSync();
    const content = target.querySelector(".shell-screen-content");
    setGeometry(content, { scrollTop: 0, scrollHeight: 1000, clientHeight: 500 });
    content.dispatchEvent(new Event("scroll"));
    expect(onScroll).toHaveBeenCalledWith({ scrollTop: 0, atTop: true, atBottom: false });
  });

  it("reports atBottom when the content is scrolled to its end", () => {
    const onScroll = vi.fn();
    const { target } = render(Screen, { onScroll });
    flushSync();
    const content = target.querySelector(".shell-screen-content");
    setGeometry(content, { scrollTop: 500, scrollHeight: 1000, clientHeight: 500 });
    content.dispatchEvent(new Event("scroll"));
    expect(onScroll).toHaveBeenCalledWith({ scrollTop: 500, atTop: false, atBottom: true });
  });

  it("reports both boundaries at once when the content does not fill the screen", () => {
    // Not a contradiction: a short page is simultaneously at its top and
    // its bottom, and gestureOwner needs both to be true so a swipe-up
    // still reaches memory from a nearly-empty page.
    const onScroll = vi.fn();
    const { target } = render(Screen, { onScroll });
    flushSync();
    const content = target.querySelector(".shell-screen-content");
    setGeometry(content, { scrollTop: 0, scrollHeight: 300, clientHeight: 500 });
    content.dispatchEvent(new Event("scroll"));
    expect(onScroll).toHaveBeenCalledWith({ scrollTop: 0, atTop: true, atBottom: true });
  });

  it("renders the nav snippet above the content", () => {
    const { target } = render(Screen, {});
    const screen = target.querySelector(".shell-screen");
    // The bands are ordered in the DOM, not positioned: nav, then content.
    // Absolute positioning is what put controls over prose for five passes.
    expect(screen.firstElementChild.classList.contains("shell-screen-nav")).toBe(true);
  });

  it("lends its own box and its scroll, and not the element", () => {
    // PageScreen has to know where the visible band is and be able to move
    // it, to keep a caret off the keyboard. What it gets is these two
    // functions — the element itself stays private, so no caller can style
    // it, query inside it, or bind a second scroll listener to it.
    let scroller = null;
    const { target } = render(Screen, { onScroller: (s) => (scroller = s) });
    flushSync();
    const content = target.querySelector(".shell-screen-content");
    Object.defineProperty(content, "getBoundingClientRect", {
      value: () => ({ top: 120, bottom: 600 }),
      configurable: true,
    });
    let position = 0;
    Object.defineProperty(content, "scrollTop", {
      get: () => position,
      set: (v) => { position = v; },
      configurable: true,
    });

    expect(scroller.bounds()).toMatchObject({ top: 120, bottom: 600 });
    scroller.scrollBy(38);
    expect(content.scrollTop).toBe(38);
    // Relative, not absolute: a second correction adds to where the writer
    // already is instead of teleporting the page to 38.
    scroller.scrollBy(-8);
    expect(content.scrollTop).toBe(30);
  });

  it("reports atBottom at a fractional scroll position", () => {
    // Real browsers report fractional scrollTop, so at the true end
    // scrollTop + clientHeight can land a hair SHORT of scrollHeight. The
    // bare >= this replaced would read false here, and gestureOwner would
    // eat the swipe-up to memory — on a device, intermittently, at the
    // bottom of a long page.
    const onScroll = vi.fn();
    const { target } = render(Screen, { onScroll });
    flushSync();
    const content = target.querySelector(".shell-screen-content");
    setGeometry(content, { scrollTop: 499.6, scrollHeight: 1000, clientHeight: 500 });
    content.dispatchEvent(new Event("scroll"));
    expect(onScroll).toHaveBeenCalledWith(
      expect.objectContaining({ atBottom: true }),
    );
  });
});
