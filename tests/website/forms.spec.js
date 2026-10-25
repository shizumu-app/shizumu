import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// the shared email capture (answer pages, blog posts, the demo page) has to be
// a form a person can use: a visible label, the right input type and
// autocomplete, a font size that does not make a phone zoom, and a submit that
// stays in the tab.
const CAPTURE_PAGES = ["/standard-notes-alternative", "/blog/2026-06-12-what-we-keep", "/try"];

for (const path of CAPTURE_PAGES) {
  test(`${path}: the email capture is a usable form`, async ({ page }) => {
    await page.goto(path);
    const form = page.locator("section.email-cta form");
    await expect(form).toHaveCount(1);
    // no popup: a target attribute or an inline submit handler opens a window
    expect(await form.getAttribute("target")).toBeNull();
    expect(await form.getAttribute("onsubmit")).toBeNull();
    const input = form.locator("input[type=email]");
    await expect(input).toHaveAttribute("autocomplete", "email");
    // a visible label, tied to the input; aria-label alone is not visible
    const id = await input.getAttribute("id");
    expect(id).toBeTruthy();
    const label = form.locator(`label[for="${id}"]`);
    await expect(label).toBeVisible();
    const size = await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(16);
    // the note is read text: no opacity dimming
    const note = page.locator(".email-cta-note");
    expect(await note.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  });
}

// the pricing claims on these pages must match /pricing: the app is free, two
// devices sync free, every device is what is paid for. a claim of "no tiers",
// "no subscription" or "forever" is false there.
const CLAIM_PAGES = ["standard-notes-alternative", "penzu-alternative", "evernote-alternative", "docs/self-deploy"];
for (const p of CLAIM_PAGES) {
  test(`/${p}: no claim that contradicts pricing`, async () => {
    const dist = fileURLToPath(new URL("../../website/dist/", import.meta.url));
    let html;
    try { html = await readFile(`${dist}${p}.html`, "utf8"); }
    catch { html = await readFile(`${dist}${p}/index.html`, "utf8"); }
    const body = html.replace(/<(script|style)[\s\S]*?<\/\1>/g, "");  // tags stay in: the meta description is part of what is claimed
    expect(body).not.toMatch(/forever|no tiers?|no subscription|nothing to renew/i);
  });
}
