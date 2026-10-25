import { test, expect } from "@playwright/test";

// the demo's front door: what it is, three steps that match the seed
// (src/lib/demo/fixture.js), the film for the screen it is on, and the way to
// install after.

test.describe("/try on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the phone film shows, the desktop film does not", async ({ page }) => {
    await page.goto("/try/");
    await expect(page.locator("video.try-film-phone")).toBeVisible();
    await expect(page.locator("video.try-film-desktop")).toBeHidden();
    await expect(page.locator("video.try-film-phone")).toHaveAttribute("poster", "/assets/video/v1-beta-mobile-vertical-poster.png");
    // the vertical cut stands taller than it is wide on a phone
    const box = await page.locator("video.try-film-phone").boundingBox();
    expect(box.height).toBeGreaterThan(box.width);
  });

  test("it says the demo opens in the phone layout", async ({ page }) => {
    await page.goto("/try/");
    await expect(page.locator(".try-cta")).toContainText("on a phone it opens in the phone layout.");
  });

  test("nothing scrolls sideways", async ({ page }) => {
    await page.goto("/try/");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("/try on a desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("the desktop film shows, the phone film does not", async ({ page }) => {
    await page.goto("/try/");
    await expect(page.locator("video.try-film-desktop")).toBeVisible();
    await expect(page.locator("video.try-film-phone")).toBeHidden();
    // never the older film: its opening card carries the retired word
    await expect(page.locator('.try-film source[src*="vbeta-release"]')).toHaveCount(0);
  });

  test("neither film downloads before it is played", async ({ page }) => {
    await page.goto("/try/");
    for (const v of await page.locator(".try-film video").all()) await expect(v).toHaveAttribute("preload", "none");
  });

  test("the demo button opens the app", async ({ page }) => {
    await page.goto("/try/");
    await expect(page.locator(".try-cta a")).toHaveAttribute("href", "/try/app/");
  });

  test("three steps: write, pin, the book trail", async ({ page }) => {
    await page.goto("/try/");
    const steps = await page.locator(".try-steps h3").allTextContents();
    expect(steps).toEqual(["write a line", "pin it", "choose the book trail"]);
    await expect(page.locator(".try-steps")).toContainText("the three pins already kept there land on the page");
  });

  test("install points at every download, and the email capture is last", async ({ page }) => {
    await page.goto("/try/");
    await expect(page.locator('.try-install a[href="/#download"]').first()).toBeVisible();
    await expect(page.locator("main > .email-cta")).toHaveCount(1);
    const last = await page.locator("main > *").last().getAttribute("class");
    expect(last).toContain("email-cta");
  });
});

test.describe("/try on a mac", () => {
  test.use({
    viewport: { width: 1280, height: 800 },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  });

  test("the pin step names the command key", async ({ page }) => {
    await page.goto("/try/");
    expect((await page.locator(".try-steps kbd").allTextContents()).join(" ")).toBe("⌘ P");
  });
});

test.describe("/try on windows", () => {
  test.use({
    viewport: { width: 1280, height: 800 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  });

  test("the install button names the windows installer", async ({ page }) => {
    await page.goto("/try/");
    const btn = page.locator(".try-install-cta a");
    await expect(btn).toHaveText("download for windows");
    await expect(btn).toHaveAttribute("href", /_x64-setup\.exe$/);
  });
});
