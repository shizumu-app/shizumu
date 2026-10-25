import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  sitemapPaths,
  REBUILT,
  NOT_IN_SITEMAP,
  THEMES,
  setTheme,
} from "./helpers.js";

const paths = await sitemapPaths();

// sanity: an empty sitemap would make every loop below pass without testing anything
test("the sitemap lists pages", () => {
  expect(paths.length).toBeGreaterThan(0);
});

// axe below runs only on REBUILT paths found in the sitemap, so a mistyped
// path would be skipped in silence; this makes the typo a failure instead.
// empty means every rebuilt path is one the sitemap really lists.
test("every rebuilt path is in the sitemap", () => {
  const missing = REBUILT.filter(
    (p) => !paths.includes(p) && !NOT_IN_SITEMAP.includes(p),
  );
  expect(missing).toEqual([]);
});

for (const width of [320, 1280]) {
  for (const path of paths) {
    test(`${path} at ${width}px: loads, fits, one h1`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      const res = await page.goto(path);
      expect(res.status()).toBe(200);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      // a positive number is horizontal scroll on a phone
      expect(overflow).toBeLessThanOrEqual(0);
      await expect(page.locator("h1")).toHaveCount(1);
    });
  }
}

// a rebuilt page runs axe when the sitemap lists it, or when it is one of the
// pages kept out of the sitemap on purpose
const axePaths = REBUILT.filter(
  (p) => paths.includes(p) || NOT_IN_SITEMAP.includes(p),
);
for (const path of axePaths) {
  for (const theme of THEMES) {
    test(`${path} in ${theme}: no serious axe violations`, async ({ page }) => {
      await setTheme(page, theme);
      await page.goto(path);
      const { violations } = await new AxeBuilder({ page }).analyze();
      const bad = violations.filter((v) =>
        ["serious", "critical"].includes(v.impact),
      );
      expect(bad.map((v) => v.id)).toEqual([]);
    });
  }
}

// a post title joins the site name with a dot, and says it without an em-dash
for (const path of REBUILT.filter((p) => p.startsWith("/blog/") && p !== "/blog/")) {
  test(`${path}: title ends with the dot and the site name, no em-dash`, async ({ page }) => {
    await page.goto(path);
    const title = await page.title();
    expect(title).toMatch(/ · shizumu$/);
    expect(title).not.toContain("\u2014");
  });
}

// the nav is sticky and in flow, so a heading reached by an anchor has to land
// below it, not under it
test("/docs/sync: an anchor lands the heading below the nav", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 500 });
  await page.goto("/docs/sync#more-than-two-devices");
  const { top, navH } = await page.evaluate(() => {
    const h = document.getElementById("more-than-two-devices");
    const navH = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--nav-h"),
    );
    return { top: h ? h.getBoundingClientRect().top : -1, navH };
  });
  expect(navH).toBeGreaterThan(0);
  expect(top).toBeGreaterThanOrEqual(navH);
});
