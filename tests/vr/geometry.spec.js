// Layout facts asserted as numbers, not pictures. A screenshot baseline
// would catch these too, but the baselines wait on a re-record; a rect
// comparison needs none and says exactly what broke.
//
//   npx playwright test tests/vr/geometry.spec.js --project android-webview
import { test, expect } from "@playwright/test";

test.describe("phone layout geometry", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "android-webview", "the phone layout's facts");
  });

  test("a chart's type chip sits under the chart, not on it", async ({ page }) => {
    // The phone's charts fill the column, and the chip (absolute,
    // bottom-right) printed "flowchart" over the chart's last node until
    // the chart block reserved a line for it (prose.css, .ps-canvas).
    await page.goto("/?vr=1&scene=mk-shell-tools&theme=cream");
    await page.waitForFunction(() => window.__VR_READY__ === true, null, { timeout: 60000 });
    await page.waitForFunction(() => document.querySelector(".chart-block .chart-render svg"), null, { timeout: 60000 });
    const { chip, svg } = await page.evaluate(() => {
      const r = (el) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
      return {
        chip: r(document.querySelector(".chart-block .block-type-chip")),
        svg: r(document.querySelector(".chart-block .chart-render svg")),
      };
    });
    const overlaps = !(chip.top >= svg.bottom || chip.bottom <= svg.top || chip.left >= svg.right || chip.right <= svg.left);
    expect(overlaps, `chip ${JSON.stringify(chip)} over chart ${JSON.stringify(svg)}`).toBe(false);
  });
});
