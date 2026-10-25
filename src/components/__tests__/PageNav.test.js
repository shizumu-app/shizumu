// PageNav's page-picker chip on a busy day. MEASURED ON A DESKTOP: with
// twenty-one pages the chip held twenty-one dots too small to tell apart.
// Past eight it says where you are instead (lib/rail-dots.js), as the top
// rail and the phone do.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";
import PageNav from "../PageNav.svelte";

afterEach(cleanupAll);

const props = (totalPages, pageNumber) => ({
  date: "2026-10-14", pageNumber, totalPages,
  onPrev: vi.fn(), onNext: vi.fn(), onDateSelect: vi.fn(),
  focuses: Array.from({ length: totalPages }, (_, i) => ({ id: `f${i}`, page_number: i + 1, what_matters_now: null })),
});

describe("PageNav — the page-picker chip", () => {
  it("says 20 / 21 on a busy day instead of drawing twenty-one dots", () => {
    const { target } = render(PageNav, props(21, 20));
    expect(target.querySelectorAll(".page-dot").length).toBe(0);
    expect(target.querySelector(".page-count").textContent.trim()).toBe("20 / 21");
  });

  it("keeps its dots on an ordinary day", () => {
    const { target } = render(PageNav, props(3, 2));
    expect(target.querySelectorAll(".page-dot").length).toBe(3);
    expect(target.querySelector(".page-count")).toBeNull();
  });
});
