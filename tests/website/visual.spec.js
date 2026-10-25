import { test, expect } from "@playwright/test";
import { THEMES, setTheme } from "./helpers.js";

// baselines for the rebuilt site: five pages, two widths, three themes. each
// shot is the top of the page at viewport height, which is where a stylesheet
// regression shows first; only the landing at 1280 on cream is taken full
// length, so the baselines stay small. they are recorded inside the pinned
// playwright image (mcr.microsoft.com/playwright:v1.61.1-noble) because font
// rendering differs between hosts; a host run will not match them.
const PAGES = [
  ["home", "/"],
  ["obsidian", "/obsidian-alternative"],
  ["sync", "/docs/sync"],
  ["pricing", "/pricing"],
  ["blog", "/blog/"],
];
const WIDTHS = [
  [375, 812],
  [1280, 800],
];

for (const [name, path] of PAGES) {
  for (const [width, height] of WIDTHS) {
    for (const theme of THEMES) {
      test(`${name} ${width} ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await setTheme(page, theme);
        await page.goto(path, { waitUntil: "load" });
        await page.evaluate(() => document.fonts.ready);
        await expect(page).toHaveScreenshot(`${name}-${width}-${theme}.png`, {
          animations: "disabled",
        });
        if (name === "home" && width === 1280 && theme === "cream") {
          // lazy images below the fold load only once scrolled to; without this
          // the full-length shot races them and flakes. images hidden by the theme
          // never load, so only the rendered ones are awaited
          await page.evaluate(async () => {
            for (let y = 0; y < document.body.scrollHeight; y += 600) {
              window.scrollTo(0, y);
              await new Promise((r) => setTimeout(r, 60));
            }
            window.scrollTo(0, 0);
            await Promise.all(
              [...document.images].filter((i) => i.getClientRects().length).map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))),
            );
          });
          await expect(page).toHaveScreenshot(`${name}-${width}-${theme}-full.png`, {
            animations: "disabled",
            fullPage: true,
          });
        }
      });
    }
  }
}
