import { test, expect } from "@playwright/test";

test.describe("phone nav at 375px", () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test("the menu toggle discloses the menu and Escape puts focus back", async ({ page }) => {
    await page.goto("/");
    const toggle = page.locator("#site-nav button[aria-controls]");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    const controls = await toggle.getAttribute("aria-controls");
    const menu = page.locator(`#${controls}`);
    await expect(menu).toBeHidden();

    const box = await toggle.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(menu).toBeVisible();

    // focus has moved into the menu; Escape must bring it home
    await menu.locator("a").first().focus();
    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(menu).toBeHidden();
    await expect(toggle).toBeFocused();
  });

  test("the download button stays in the bar", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#site-nav .sn-download")).toBeVisible();
  });

  // the bar has no room for two buttons at 375, so try lives in the menu
  test("try in browser is one tap away in the menu", async ({ page }) => {
    await page.goto("/");
    await page.locator("#site-nav button[aria-controls]").click();
    await expect(page.locator('#site-menu a[href="/try/"]')).toBeVisible();
  });
});

test.describe("try in browser", () => {
  for (const width of [480, 1280]) {
    test(`sits beside download in the bar at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      const tryLink = page.locator('#site-nav .sn-bar a[href="/try/"]:visible');
      await expect(tryLink).toHaveCount(1);
      await expect(tryLink).toHaveText("try in browser");
      const box = await tryLink.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
    });
  }

});

test.describe("try in browser with script off on a phone", () => {
  test.use({ javaScriptEnabled: false, viewport: { width: 375, height: 800 } });

  test("is still a visible link", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('#site-nav a[href="/try/"]:visible')).toHaveCount(1);
  });
});

test.describe("theme control", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("a radio group of three, arrow keys move, choosing dark applies it", async ({ page }) => {
    await page.goto("/");
    const group = page.locator('#site-nav [role="radiogroup"]:visible');
    await expect(group).toHaveCount(1);
    const radios = group.locator('[role="radio"]');
    await expect(radios).toHaveCount(3);
    // each swatch has a name a screen reader can say
    await expect(radios.nth(0)).toHaveAccessibleName("cream");
    await expect(radios.nth(1)).toHaveAccessibleName("white");
    await expect(radios.nth(2)).toHaveAccessibleName("dark");

    await page.evaluate(() => localStorage.removeItem("shizumu-theme"));
    await page.reload();
    const checked = group.locator('[role="radio"][aria-checked="true"]');
    await expect(checked).toHaveCount(1);
    await checked.focus();
    const before = await checked.getAttribute("aria-label");
    await page.keyboard.press("ArrowRight");
    const after = await group.locator('[role="radio"][aria-checked="true"]').getAttribute("aria-label");
    expect(after).not.toBe(before);

    await radios.nth(2).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await page.evaluate(() => localStorage.getItem("shizumu-theme"))).toBe("dark");
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#181614");
  });

  test("the nav is as tall as --nav-h", async ({ page }) => {
    await page.goto("/");
    const { nav, token } = await page.evaluate(() => ({
      nav: document.querySelector("#site-nav").getBoundingClientRect().height,
      token: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--nav-h")),
    }));
    expect(nav).toBe(token);
  });

  test("tab reaches the skip link first, then the nav links in order", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.locator(".skip-link")).toBeFocused();
    const hrefs = [];
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Tab");
      hrefs.push(await page.evaluate(() => document.activeElement.getAttribute("href")));
    }
    // home mark, then features, docs, blog, pricing
    expect(hrefs).toEqual(["/", "/#features", "/docs/", "/blog/", "/pricing"]);
  });
});

test.describe("footer", () => {
  test("four labelled columns, no account link", async ({ page }) => {
    await page.goto("/");
    const cols = page.locator(".site-footer nav[aria-labelledby]");
    await expect(cols).toHaveCount(4);
    await expect(page.locator('.site-footer a[href^="/account"]')).toHaveCount(0);
    await expect(page.locator(".site-footer")).not.toContainText("no ads");
  });
});
