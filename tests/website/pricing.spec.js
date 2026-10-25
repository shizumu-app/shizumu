import { test, expect } from "@playwright/test";

// the plans as the data file states them, in the order the page shows them
const PLANS = [
  { id: "self", devices: "your own relay, every device" },
  { id: "free", devices: "2 devices" },
  { id: "paid", devices: "every device you own" },
  { id: "founding", devices: "every device you own" },
];

const EXIT =
  "your writing lives on your device. the relay is open source. if hosted sync ever stops, run your own and nothing is lost.";
const FREE_LIMIT = "hosted sync costs money to run. your own relay is unlimited.";

function plan(page, id) {
  return page.locator(`.plans > .plan[data-plan="${id}"]`);
}

test.describe("pricing", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("title and description", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page).toHaveTitle("pricing · shizumu");
    const desc = await page.locator('meta[name="description"]').getAttribute("content");
    expect(desc.length).toBeGreaterThanOrEqual(70);
    expect(desc.length).toBeLessThanOrEqual(160);
  });

  test("four plans, in order, each leading with its devices", async ({ page }) => {
    await page.goto("/pricing");
    const ids = await page.locator(".plans > .plan").evaluateAll((els) => els.map((e) => e.dataset.plan));
    expect(ids).toEqual(PLANS.map((p) => p.id));
    for (const p of PLANS) {
      const card = plan(page, p.id);
      // the devices are the card's first element, so they are what a reader meets first
      const first = card.locator(":scope > :first-child");
      await expect(first).toHaveClass(/plan-devices/);
      await expect(first).toHaveText(p.devices);
      // storage follows in smaller type
      const sizes = await card.evaluate((el) => {
        const d = el.querySelector(".plan-devices");
        const s = el.querySelector(".plan-storage");
        const after = d.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING;
        return { d: parseFloat(getComputedStyle(d).fontSize), s: parseFloat(getComputedStyle(s).fontSize), after: !!after };
      });
      expect(sizes.after).toBe(true);
      expect(sizes.s).toBeLessThan(sizes.d);
    }
  });

  test("yearly shows first, monthly is a switch away", async ({ page }) => {
    await page.goto("/pricing");
    const card = plan(page, "paid");
    await expect(card.locator('input[name="billing"][value="yearly"]')).toBeChecked();
    await expect(card.locator(".price-yearly")).toBeVisible();
    await expect(card.locator(".price-yearly")).toHaveText("$48/yr");
    await expect(card.locator(".price-monthly")).toBeHidden();
    await card.getByText("monthly", { exact: true }).click();
    await expect(card.locator('input[name="billing"][value="monthly"]')).toBeChecked();
    await expect(card.locator(".price-monthly")).toBeVisible();
    await expect(card.locator(".price-monthly")).toHaveText("$5/mo");
    await expect(card.locator(".price-yearly")).toBeHidden();
  });

  test("the exit is named under the plans", async ({ page }) => {
    await page.goto("/pricing");
    const exit = page.locator(".plans-exit");
    await expect(exit).toHaveText(EXIT);
    await expect(exit).toBeVisible();
    // under the plans, not lost in the fine print at the end
    const order = await page.evaluate(() => {
      const plans = document.querySelector(".plans");
      const exit = document.querySelector(".plans-exit");
      return !!(plans.compareDocumentPosition(exit) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(order).toBe(true);
  });

  test("the free plan says why it has a limit", async ({ page }) => {
    await page.goto("/pricing");
    await expect(plan(page, "free")).toContainText(FREE_LIMIT);
  });

  test("no open-ended promises, no allowances", async ({ page }) => {
    await page.goto("/pricing");
    const text = await page.locator("main").innerText();
    expect(text).not.toMatch(/forever|always|quota|allowance/i);
    // the old founding clause promised features that do not exist yet
    expect(text).not.toContain("every paid feature");
  });

  test("while payments are off, founding holds a seat by email and sells nothing", async ({ page }) => {
    await page.goto("/pricing");
    const card = plan(page, "founding");
    await expect(card).toContainText("opens at 1.0");
    await expect(card.locator('form input[name="tag"][value="founding"]')).toHaveCount(1);
    await expect(card.locator('form input[type="email"]')).toBeVisible();
    // no checkout anywhere: nothing is sold before 1.0
    await expect(page.locator('a[href*="dodopayments"]')).toHaveCount(0);
    // no remaining-places count either: there is no data source for one
    await expect(card).not.toContainText(/left|remaining/i);
  });

  test("prices line up digit for digit", async ({ page }) => {
    await page.goto("/pricing");
    const prices = page.locator(".plans .price");
    expect(await prices.count()).toBeGreaterThanOrEqual(4);
    const variants = await prices.evaluateAll((els) => els.map((e) => getComputedStyle(e).fontVariantNumeric));
    for (const v of variants) expect(v).toContain("tabular-nums");
  });

  test("a short faq, answered in place", async ({ page }) => {
    await page.goto("/pricing");
    const n = await page.locator(".faq details").count();
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(5);
    await expect(page.locator('.faq a[href="/refund"]')).toHaveCount(1);
    // the cap is relay config outside this repo, so the faq names no trigger
    // number; it says what the app does, which is wait and say storage is full
    await expect(page.locator(".faq")).toContainText("what happens when free storage is full?");
    await expect(page.locator(".faq")).not.toContainText(/past \d/);
  });

  test("structured data lists the free offer first", async ({ page }) => {
    await page.goto("/pricing");
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    const app = blocks.flatMap((b) => [JSON.parse(b)].flat()).find((n) => n["@type"] === "SoftwareApplication");
    expect(app).toBeTruthy();
    expect(app.offers[0].price).toBe("0");
    expect(app.offers.map((o) => o.price)).toEqual(["0", "0", "48", "5", "99"]);
  });
});

test.describe("pricing without script", () => {
  test.use({ javaScriptEnabled: false, viewport: { width: 375, height: 800 } });

  test("yearly shows, with monthly named beside it", async ({ page }) => {
    await page.goto("/pricing");
    const card = plan(page, "paid");
    await expect(card.locator(".price-yearly")).toBeVisible();
    await expect(card.locator(".price-alt-monthly")).toBeVisible();
    await expect(card.locator(".price-alt-monthly")).toHaveText("or $5/mo");
  });
});
