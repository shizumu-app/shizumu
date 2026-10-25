import { test, expect } from "@playwright/test";

test.describe("dark os, nothing stored", () => {
  test.use({ colorScheme: "dark" });
  test("the page opens dark before load, with a matching theme-color", async ({ page }) => {
    // domcontentloaded, not load: the theme must already be right before
    // the end-of-body nav script or any image has run
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const bg = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    );
    expect(bg).toBe("rgb(24, 22, 20)");
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
      "content",
      "#181614",
    );
  });
});

test("a stored choice wins over the os", async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("shizumu-theme", "white");
    } catch (e) {}
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "white");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    "content",
    "#ffffff",
  );
});

test("storage that throws still gets a theme", async ({ page }) => {
  // private windows and blocked site data make localStorage itself throw;
  // the head script must fall back to the os, not stop
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("storage blocked");
      },
    });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    /^(cream|white|dark)$/,
  );
});
