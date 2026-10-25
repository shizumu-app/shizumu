import { describe, it, expect, afterEach } from "vitest";
import { render, cleanupAll } from "../../../lib/ui/test-helper.js";
import PageHeader from "../PageHeader.svelte";

afterEach(cleanupAll);

describe("PageHeader", () => {
  it("shows both lines when expanded", () => {
    const { target } = render(PageHeader, {
      dateLabel: "today", trailName: "the book", pageCount: 3, pageNumber: 2,
    });
    expect(target.querySelector(".ph-line1")).not.toBeNull();
    expect(target.querySelector(".ph-line2")).not.toBeNull();
    expect(target.textContent).toContain("today");
    expect(target.textContent).toContain("pins");
  });

  it("folds to one line, keeping the date and the trail", () => {
    // Collapsed is not "line 2 hidden" -- the trail name is the one thing
    // from line 2 that still has to read at a glance while scrolling, so
    // it moves up rather than disappearing (spec section 2: "today . the book").
    const { target } = render(PageHeader, {
      dateLabel: "today", trailName: "the book", collapsed: true,
    });
    expect(target.querySelector(".ph-line2")).toBeNull();
    expect(target.textContent).toContain("today");
    expect(target.textContent).toContain("the book");
  });

  it("renders one dot per page, marking the current one", () => {
    const { target } = render(PageHeader, {
      dateLabel: "today", pageCount: 3, pageNumber: 2,
    });
    const dots = target.querySelectorAll(".ph-dot");
    expect(dots.length).toBe(3);
    expect(dots[1].classList.contains("ph-dot-on")).toBe(true);
  });

  it("shows no dots for a single page", () => {
    // One dot is not a page indicator, it is a smudge. The row still
    // renders so the "+" keeps its position rather than sliding left.
    const { target } = render(PageHeader, { dateLabel: "today", pageCount: 1 });
    expect(target.querySelectorAll(".ph-dot").length).toBe(0);
    expect(target.querySelector(".ph-new")).not.toBeNull();
  });

  it("calls back on each control", () => {
    const calls = [];
    const { target } = render(PageHeader, {
      dateLabel: "today", pageCount: 2,
      onDate: () => calls.push("date"),
      onFind: () => calls.push("find"),
      onPins: () => calls.push("pins"),
      onNew: () => calls.push("new"),
    });
    target.querySelector(".ph-date").click();
    target.querySelector(".ph-find").click();
    target.querySelector(".ph-pins").click();
    target.querySelector(".ph-new").click();
    expect(calls).toEqual(["date", "find", "pins", "new"]);
  });

  it("keeps find on the folded line, beside pins and left of it", () => {
    // Two claims, and both are the reason find is in the header at all.
    //
    // It survives the fold, because folding is what the keyboard does
    // (nav-collapse.js) and a control for going looking for something is
    // useless if it leaves the screen the moment you start typing.
    //
    // And it sits LEFT of pins: pins has been this row's right-hand
    // control since P2a, so a new sibling takes the new position rather
    // than pushing a known target sideways. Asserted through
    // compareDocumentPosition rather than by reading the markup, so a
    // reorder fails here instead of only on a screenshot.
    const { target } = render(PageHeader, {
      dateLabel: "today", trailName: "the book", collapsed: true,
    });
    const find = target.querySelector(".ph-find");
    const pins = target.querySelector(".ph-pins");
    expect(find).not.toBeNull();
    expect(find.compareDocumentPosition(pins) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("PageHeader — a trail that lives inside another", () => {
  it("names the parent beside the trail's own name", () => {
    // The gap this closes: the tag showed a bare leaf, so the nesting a
    // writer built was visible only inside the trail sheet — not on the
    // surface they look at all day.
    const { target } = render(PageHeader, {
      dateLabel: "today",
      trailName: "chapter two",
      trailParents: ["the book"],
      onTrail: () => {},
    });
    expect(target.querySelector(".ph-trail").textContent.trim()).toBe("the book › chapter two");
  });

  it("shows a top-level trail by itself, with no separator", () => {
    // Not "nothing happens": a crumb that drew its separator unconditionally
    // would put a dangling "› " in front of every untrailed-but-named page,
    // which is the shape the bug would take if trail-crumb ever lost its
    // empty-ancestors guard.
    const { target } = render(PageHeader, {
      dateLabel: "today",
      trailName: "the book",
      trailParents: [],
      onTrail: () => {},
    });
    expect(target.querySelector(".ph-trail").textContent.trim()).toBe("the book");
  });

  it("still says `trail` when there is none, rather than an empty crumb", () => {
    const { target } = render(PageHeader, { dateLabel: "today", onTrail: () => {} });
    expect(target.querySelector(".ph-trail")).toBeNull();
    expect(target.querySelector(".ph-trail-empty").textContent.trim()).toBe("trail");
  });
});
