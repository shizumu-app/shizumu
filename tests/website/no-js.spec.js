import { test, expect } from "@playwright/test";

test.use({ javaScriptEnabled: false });

test("no-js: nothing in main is hidden at opacity 0", async ({ page }) => {
  await page.goto("/");
  // without a main the count below is zero for the wrong reason
  await expect(page.locator("main")).toHaveCount(1);
  const hidden = await page.evaluate(
    () =>
      [...document.querySelectorAll("main *")].filter(
        (el) => getComputedStyle(el).opacity === "0",
      ).length,
  );
  // zero hidden elements: a reader without script must still see the page
  expect(hidden).toBe(0);
  await expect(page.locator("#download")).toBeVisible();
});

test.describe("dark os", () => {
  test.use({ colorScheme: "dark" });
  // tokens.css carries the dark values under prefers-color-scheme for a root
  // with no data-theme, which is every page when script is off
  test("no-js: body follows a dark OS", async ({ page }) => {
    await page.goto("/");
    const bg = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    );
    expect(bg).toBe("rgb(24, 22, 20)");
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 800 } });
  // below 960px the links live in a menu only script can open, so without
  // script they must show as a plain row or they are unreachable
  test("no-js: the nav links are reachable on a phone", async ({ page }) => {
    await page.goto("/");
    for (const href of ["/docs/", "/blog/", "/pricing"]) {
      await expect(page.locator(`#site-nav .sn-links a[href="${href}"]`)).toBeVisible();
    }
  });
});
