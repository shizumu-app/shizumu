import { test, expect } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";

// the version the build names: the deploy's env wins, else the app's own
// tauri.conf.json, the same precedence as website/src/lib/site-version.mjs
const conf = JSON.parse(
  await readFile(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
);
const VERSION = process.env.SHIZUMU_DL_VERSION || conf.version;

// the newest non-draft release note: the what's-new line quotes it and links
// its own release, not the deployed version's
const RELEASES_DIR = new URL("../../website/src/content/releases/", import.meta.url);
const NEWEST_NOTE = (
  await Promise.all(
    (await readdir(RELEASES_DIR)).filter((f) => f.endsWith(".md")).map(async (f) => {
      const fm = (await readFile(new URL(f, RELEASES_DIR), "utf8")).split("---")[1];
      return {
        version: fm.match(/^version:\s*"?([^"\n]+)"?/m)[1],
        date: fm.match(/^date:\s*(\S+)/m)[1],
        draft: /^draft:\s*true/m.test(fm),
      };
    }),
  )
).filter((n) => !n.draft).sort((a, b) => b.date.localeCompare(a.date))[0];

const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

// the keys of one card, read the way the test names them: "ctrl P"
async function cardKeys(page, title) {
  const card = page.locator(".verb-cards .ui-card", { has: page.locator("h3", { hasText: title }) });
  const keys = await card.locator("kbd").allTextContents();
  return keys.map((k) => k.trim()).join(" ");
}

function hero(page) {
  return page.locator("section.home-hero");
}

test.describe("homepage hero, any system", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("the words are the owner's, exactly", async ({ page }) => {
    await page.goto("/");
    const h = hero(page);
    await expect(page.locator("h1")).toHaveText(
      "you open a notes app with a thought. it asks you which folder.",
    );
    await expect(h.locator(".ui-label").first()).toHaveText(
      "a writing app that never asks where to file it",
    );
    await expect(h.locator("p.home-hero-lede")).toHaveText(
      "shizumu asks nothing. you write to think, you pin what turns out to matter, and it comes back when you pick up the thread again. everything else stays in memory, searchable.",
    );
    const first = h.locator(".home-hero-cta a").first();
    await expect(first).toHaveText("try it in your browser");
    await expect(first).toHaveAttribute("href", "/try/");
  });

  test("the facts line names what it costs, where it runs, and the version", async ({ page }) => {
    await page.goto("/");
    const facts = hero(page).locator(".home-hero-facts");
    await expect(facts).toContainText("free · open source · linux, windows, android");
    await expect(facts.locator(".version")).toHaveText(`v${VERSION}`);
  });

  test("the screenshot loads first and reserves its box", async ({ page }) => {
    await page.goto("/");
    const img = hero(page).locator(".ui-shot-light img, img.ui-shot-light").first();
    await expect(img).toHaveAttribute("fetchpriority", "high");
    await expect(img).toHaveAttribute("width", /^\d+$/);
    await expect(img).toHaveAttribute("height", /^\d+$/);
  });

  test("the old hero video is gone", async ({ page }) => {
    await page.goto("/");
    await expect(hero(page).locator("video")).toHaveCount(0);
    await expect(page.locator(".triptych")).toHaveCount(0);
  });

  test("three verb cards, the trail one teaching the word", async ({ page }) => {
    await page.goto("/");
    const titles = page.locator(".verb-cards .ui-card h3");
    await expect(titles).toHaveCount(3);
    const names = (await titles.evaluateAll((els) =>
      els.map((h) => h.firstChild.textContent.trim()),
    ));
    expect(names).toEqual(["write", "pin", "trail"]);
    await expect(page.locator(".verb-cards .ui-card").nth(0).locator(".ui-card-body")).toHaveText(
      "a page that starts empty, with real tools on it. nothing to structure first.",
    );
    await expect(page.locator(".verb-cards .ui-card").nth(1).locator(".ui-card-body")).toHaveText(
      "mark what turns out to matter. it comes back when you need it.",
    );
    await expect(page.locator(".verb-cards .ui-card").nth(2).locator(".ui-card-body")).toHaveText(
      "for a book, a job search, anything you’ll come back to. open it and your pins are already on the page.",
    );
    expect(await cardKeys(page, "write")).toBe("/");
  });

  test("the nav's /#features lands on the verb cards", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#features")).toHaveCount(1);
    await expect(page.locator("section.verb-cards#features")).toHaveCount(1);
  });

  test("the trust row sits right under the cards", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".verb-cards + .ui-trust, .verb-cards .ui-trust")).toHaveCount(1);
  });
});

test.describe("homepage on windows", () => {
  test.use({ viewport: { width: 1280, height: 800 }, userAgent: WINDOWS_UA });

  test("the second button downloads the windows installer", async ({ page }) => {
    await page.goto("/");
    const second = hero(page).locator(".home-hero-cta a").nth(1);
    await expect(second).toHaveText("download for windows");
    await expect(second).toHaveAttribute("href", /_x64-setup\.exe$/);
  });

  test("shortcuts say ctrl", async ({ page }) => {
    await page.goto("/");
    expect(await cardKeys(page, "pin")).toBe("ctrl P");
    expect(await cardKeys(page, "trail")).toBe("ctrl K");
  });
});

test.describe("homepage on a mac", () => {
  test.use({ viewport: { width: 1280, height: 800 }, userAgent: MAC_UA });

  test("no mac build ships, so the second button points at the download section", async ({ page }) => {
    await page.goto("/");
    const second = hero(page).locator(".home-hero-cta a").nth(1);
    await expect(second).toHaveText("download");
    await expect(second).toHaveAttribute("href", "#download");
  });

  test("shortcuts say ⌘", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".verb-cards kbd", { hasText: "⌘" })).toHaveCount(2);
    expect(await cardKeys(page, "pin")).toBe("⌘ P");
    expect(await cardKeys(page, "trail")).toBe("⌘ K");
  });
});

test.describe("homepage with script off", () => {
  test.use({ viewport: { width: 1280, height: 800 }, userAgent: WINDOWS_UA, javaScriptEnabled: false });

  test("the server default still works: download to the section, ctrl keys", async ({ page }) => {
    await page.goto("/");
    const second = hero(page).locator(".home-hero-cta a").nth(1);
    await expect(second).toHaveText("download");
    await expect(second).toHaveAttribute("href", "#download");
    expect(await cardKeys(page, "pin")).toBe("ctrl P");
  });
});

test.describe("homepage hero on a phone", () => {
  test.use({ viewport: { width: 320, height: 700 } });

  test("stacked and flat, nothing scrolls sideways", async ({ page }) => {
    await page.goto("/");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const transform = await hero(page)
      .locator(".home-hero-shot")
      .evaluate((el) => getComputedStyle(el).transform);
    expect(transform).toBe("none");
  });
});

// the six sections after the cards, in reading order
const SECTIONS = ["way-back", "memory", "private", "keyboard", "download", "closing"];
const LINUX_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

test.describe("homepage sections", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("six sections after the cards, in order", async ({ page }) => {
    await page.goto("/");
    const ids = await page.locator("main section[id]").evaluateAll((els) => els.map((e) => e.id));
    expect(ids.filter((id) => SECTIONS.includes(id))).toEqual(SECTIONS);
    // the old sections are gone, not hidden
    for (const old of ["built-differently", "source", "whats-new", "sync", "pricing", "roadmap", "apple", "support"]) {
      await expect(page.locator(`#${old}`)).toHaveCount(0);
    }
  });

  test("no inline styles and no scroll-reveal classes", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("main [style]")).toHaveCount(0);
    await expect(page.locator(".fade-in")).toHaveCount(0);
  });

  test("one form outside the download tabs: the closing ask, a labelled email field a phone will not zoom", async ({ page }) => {
    await page.goto("/");
    // the download tabs carry their own beta signups (mac, android, iphone); the rest of the page has one form
    const outside = await page.locator("form").evaluateAll((els) => els.filter((f) => !f.closest("#download")).length);
    expect(outside).toBe(1);
    const form = page.locator("#closing form");
    await expect(form).toHaveCount(1);
    // outside links still point at /#notify
    await expect(page.locator("#closing #notify")).toHaveCount(1);
    const input = form.locator('input[type="email"]');
    await expect(input).toHaveAttribute("autocomplete", "email");
    const size = await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(16);
    const id = await input.getAttribute("id");
    await expect(page.locator(`label[for="${id}"]`)).toBeVisible();
  });

  test("submitting stays in this tab: no popup", async ({ page }) => {
    await page.route("https://buttondown.com/**", (r) =>
      r.fulfill({ status: 200, contentType: "text/html", body: "<p>ok</p>" }),
    );
    const popups = [];
    page.on("popup", (p) => popups.push(p));
    await page.goto("/");
    const form = page.locator("#closing form");
    await expect(form).not.toHaveAttribute("target", /.+/);
    await form.locator('input[type="email"]').fill("reader@example.com");
    await Promise.all([page.waitForURL(/buttondown\.com/), form.locator('button[type="submit"]').click()]);
    expect(popups).toHaveLength(0);
  });

  test("nothing rotates: the way-back images hold still", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-carousel]")).toHaveCount(0);
    const imgs = page.locator("#way-back img");
    expect(await imgs.count()).toBeGreaterThan(0);
    const before = await imgs.evaluateAll((els) => els.map((e) => e.getAttribute("src")));
    await page.waitForTimeout(6000);
    const after = await imgs.evaluateAll((els) => els.map((e) => e.getAttribute("src")));
    expect(after).toEqual(before);
  });

  test("what's new is one line to the release it quotes, on github", async ({ page }) => {
    await page.goto("/");
    const line = page.locator(".home-news");
    await expect(line).toHaveCount(1);
    await expect(line).toContainText(`v${NEWEST_NOTE.version}`);
    await expect(line.locator("a")).toHaveCount(1);
    await expect(line.locator("a")).toHaveAttribute(
      "href",
      `https://github.com/shizumu-app/shizumu/releases/tag/v${NEWEST_NOTE.version}`,
    );
  });

  test("the way back uses the context-clause shape", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#way-back")).toContainText("a new page starts empty.");
    await expect(page.locator("#way-back")).toContainText("a trail is for a project, not a day");
  });

  test("private carries the sync claim, the docs and the source", async ({ page }) => {
    await page.goto("/");
    const s = page.locator("#private");
    await expect(s).toContainText(
      "sync is optional and end-to-end encrypted. the relay holds what it cannot read, and neither can we.",
    );
    await expect(s.locator('a[href="/docs/encryption"]')).toHaveCount(1);
    await expect(s.locator('a[href="/docs/threat-model"]')).toHaveCount(1);
    await expect(s.locator('a[href="https://github.com/shizumu-app/shizumu"]')).toHaveCount(1);
    await expect(s).toContainText("apache-2.0");
    await expect(s).toContainText("agpl-3.0-or-later");
  });

  test("keyboard lists the real shortcuts", async ({ page }) => {
    await page.goto("/");
    const keys = await page.locator("#keyboard kbd").allTextContents();
    for (const k of ["/", "@", "K", "P", "F", "alt", "↑", "↓"]) expect(keys).toContain(k);
  });

  test("download notes are readable, not 11px", async ({ page }) => {
    await page.goto("/");
    const sizes = await page
      .locator("#download p, #download li")
      .evaluateAll((els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(14);
  });

  // hosted sync is free on a limited number of devices; the line must say so
  test("the support line says where sync is free, not that it all is", async ({ page }) => {
    await page.goto("/");
    const kofi = page.locator(".home-kofi");
    await expect(kofi).not.toContainText("so is the sync");
    await expect(kofi).toContainText("sync is free on 2 devices through our relay, and on every device through your own.");
  });
});

test("the roadmap moved to /docs/", async ({ page }) => {
  await page.goto("/docs/");
  await expect(page.getByRole("heading", { name: "roadmap" })).toHaveCount(1);
});

// ── the download section: a tab per system ────────────────────────────────
// the build offers only what latest.json names (website/src/lib/downloads.mjs).
// this suite's build reads no manifest, so it offers the windows installer and
// no mac file; linux is always flathub. the mac tab reads the page's
// data-downloads map, so a test can stand in for a deploy that carries the
// dmgs by rewriting that map in the served html: the stubbed latest.json, one
// step on.
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const LINUX_ARM_UA =
  "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const MAC_FILES = {
  "macos-dmg-arm": `/downloads/shizumu_${VERSION}_aarch64.dmg`,
  "macos-dmg-intel": `/downloads/shizumu_${VERSION}_x64.dmg`,
};

async function offerMore(page, extra) {
  await page.route(/\/$/, async (route) => {
    const res = await route.fetch();
    const body = (await res.text()).replace(/data-downloads="([^"]*)"/g, (_, json) => {
      const map = { ...JSON.parse(json.replaceAll("&quot;", '"')), ...extra };
      return `data-downloads="${JSON.stringify(map).replaceAll('"', "&quot;")}"`;
    });
    await route.fulfill({ response: res, body });
  });
}

// chromium reports the machine's real architecture whatever the ua says;
// a test names the chip it means, or removes the hint as safari does
async function chip(page, architecture) {
  await page.addInitScript((arch) => {
    const value = arch === null ? undefined : {
      getHighEntropyValues: async () => ({ architecture: arch }),
    };
    Object.defineProperty(Navigator.prototype, "userAgentData", { get: () => value, configurable: true });
  }, architecture);
}

const tabs = (page) => page.locator('#download [role="tab"]');
const selected = (page) => page.locator('#download [role="tab"][aria-selected="true"]');
const shown = (page) => page.locator('#download [role="tabpanel"]:visible');

test.describe("download tabs on linux", () => {
  test.use({ viewport: { width: 1280, height: 800 }, userAgent: LINUX_UA });

  test("a tab each for linux, windows, mac, android and iphone, linux open", async ({ page }) => {
    await page.goto("/");
    expect((await tabs(page).allTextContents()).map((n) => n.trim())).toEqual(["linux", "windows", "mac", "android", "iphone"]);
    await expect(page.locator('#download [role="tablist"]')).toHaveCount(1);
    await expect(selected(page)).toHaveText("linux");
    await expect(shown(page)).toHaveCount(1);
    await expect(shown(page)).toHaveAttribute("id", "dl-linux");
  });

  test("the linux tab is one flathub button, its line, and the source", async ({ page }) => {
    await page.goto("/");
    const panel = page.locator("#dl-linux");
    const btn = panel.locator(".ui-btn");
    await expect(btn).toHaveCount(1);
    await expect(btn).toHaveText("get it on flathub");
    await expect(btn).toHaveAttribute("href", "https://flathub.org/apps/app.shizumu.Shizumu");
    await expect(btn).toHaveAttribute("data-platform", "linux-flathub");
    await expect(panel).toContainText("x86_64 and arm64 · updates itself through flathub");
    await expect(panel.locator('a[href="https://github.com/shizumu-app/shizumu"]')).toHaveText("source code");
    await expect(page.locator("#download .home-dl-version")).toContainText(`v${VERSION}`);
  });

  test("no link in the section hands out a linux package or the signing key", async ({ page }) => {
    await page.goto("/");
    const hrefs = await page.locator("#download a").evaluateAll((els) => els.map((a) => a.getAttribute("href") ?? ""));
    expect(hrefs.filter((h) => /\.(deb|rpm|tar\.gz)$/.test(h) || h.endsWith(".asc"))).toEqual([]);
    // the filter above would pass on an empty section; this shows the links were read
    expect(hrefs).toContain("https://flathub.org/apps/app.shizumu.Shizumu");
  });

  test("arrow keys move between tabs, home and end jump to the ends", async ({ page }) => {
    await page.goto("/");
    await selected(page).focus();
    await page.keyboard.press("ArrowRight");
    await expect(selected(page)).toHaveText("windows");
    await expect(selected(page)).toBeFocused();
    await expect(shown(page)).toHaveAttribute("id", "dl-windows");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(selected(page)).toHaveText("iphone");
    await page.keyboard.press("Home");
    await expect(selected(page)).toHaveText("linux");
    await page.keyboard.press("End");
    await expect(selected(page)).toHaveText("iphone");
    // the roving tabindex: only the selected tab is in the tab order
    expect(await tabs(page).evaluateAll((els) => els.map((e) => e.tabIndex))).toEqual([-1, -1, -1, -1, 0]);
  });

  test("a click opens a tab without jumping the page", async ({ page }) => {
    await page.goto("/");
    await tabs(page).filter({ hasText: "windows" }).click();
    await expect(shown(page)).toHaveAttribute("id", "dl-windows");
    expect(new URL(page.url()).hash).toBe("");
  });

  test("windows: the installer and what it needs", async ({ page }) => {
    await page.goto("/");
    await tabs(page).filter({ hasText: "windows" }).click();
    const btn = page.locator("#dl-windows .ui-btn");
    await expect(btn).toHaveText("download for windows");
    await expect(btn).toHaveAttribute("href", /_x64-setup\.exe$/);
    await expect(page.locator("#dl-windows")).toContainText("setup .exe · windows 10 and 11");
  });
});

test.describe("download tabs on arm linux", () => {
  test.use({ viewport: { width: 1280, height: 800 }, userAgent: LINUX_ARM_UA });

  // flathub builds arm64 too, so an arm machine gets the same button
  test("the linux tab is still the flathub button", async ({ page }) => {
    await chip(page, "arm");
    await page.goto("/");
    await expect(selected(page)).toHaveText("linux");
    await expect(page.locator("#dl-linux .ui-btn")).toHaveAttribute("href", /flathub\.org/);
  });
});

test.describe("download tabs on windows", () => {
  test.use({ viewport: { width: 1280, height: 800 }, userAgent: WINDOWS_UA });

  test("the windows tab opens first", async ({ page }) => {
    await page.goto("/");
    await expect(selected(page)).toHaveText("windows");
    await expect(shown(page).locator(".ui-btn")).toHaveAttribute("href", /_x64-setup\.exe$/);
  });
});

test.describe("download tabs on android", () => {
  test.use({ viewport: { width: 412, height: 915 }, userAgent: ANDROID_UA });

  test("the android tab opens on the closed-test form, and no link hands out an apk", async ({ page }) => {
    await page.goto("/");
    await expect(selected(page)).toHaveText("android");
    const form = shown(page).locator("form");
    await expect(form.locator('input[name="tag"]')).toHaveValue("android-beta");
    await expect(form.locator('button[type="submit"]')).toHaveText("ask to join");
    await expect(form.locator('input[type="email"]')).toBeVisible();
    await expect(shown(page)).toContainText("use the google account on your phone");
    await expect(shown(page).locator('a[href="/journal-app-for-android"]')).toHaveCount(1);
    const hrefs = await page.locator("a").evaluateAll((els) => els.map((a) => a.getAttribute("href") ?? ""));
    expect(hrefs.filter((h) => /\.apk$/.test(h))).toEqual([]);
  });

  test("each form's label names its own field", async ({ page }) => {
    await page.goto("/");
    const ids = await page.locator('#download input[type="email"]').evaluateAll((els) => els.map((e) => e.id));
    expect(ids.length).toBe(3);
    expect(new Set([...ids, "notify-email"]).size).toBe(4);
    for (const id of ids) await expect(page.locator(`label[for="${id}"]`)).toHaveCount(1);
  });

  test("nothing scrolls sideways at a phone's width", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("the android page holds the signup, tagged for the closed test", async ({ page }) => {
    await page.goto("/journal-app-for-android");
    const form = page.locator("#android-beta form");
    await expect(form.locator('input[name="tag"]')).toHaveValue("android-beta");
    await expect(form.locator('input[type="email"]')).toBeVisible();
  });
});

test.describe("download tabs on an iphone", () => {
  test.use({ viewport: { width: 390, height: 844 }, userAgent: IPHONE_UA });

  test("the iphone tab opens on the testflight form, and points at the demo", async ({ page }) => {
    await page.goto("/");
    await expect(selected(page)).toHaveText("iphone");
    const form = shown(page).locator("form");
    await expect(form.locator('input[name="tag"]')).toHaveValue("iphone-beta");
    await expect(form.locator('button[type="submit"]')).toHaveText("ask to join");
    await expect(shown(page)).toContainText("join the iphone beta");
    await expect(shown(page)).toContainText("testflight");
    await expect(shown(page).locator('a[href="/try/"]')).toHaveCount(1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("download tabs on a mac, before the mac build", () => {
  test.use({ viewport: { width: 1280, height: 800 }, userAgent: MAC_UA });

  test("the mac tab opens on the mac-beta form, with no dmg link", async ({ page }) => {
    await page.goto("/");
    await expect(selected(page)).toHaveText("mac");
    const form = shown(page).locator("form");
    await expect(form).toBeVisible();
    await expect(form.locator('input[name="tag"]')).toHaveValue("mac-beta");
    await expect(page.locator('#download a[href$=".dmg"]')).toHaveCount(0);
  });
});

test.describe("download tabs on a mac, once the mac build ships", () => {
  test.use({ viewport: { width: 1280, height: 800 }, userAgent: MAC_UA });

  const macButtons = (page) => page.locator("#dl-mac .ui-btn:visible");

  test("a browser that will not say the chip gets both, apple silicon first, and the beta line", async ({ page }) => {
    await chip(page, null);
    await offerMore(page, MAC_FILES);
    await page.goto("/");
    await expect(selected(page)).toHaveText("mac");
    await expect(macButtons(page)).toHaveCount(2);
    expect(await macButtons(page).allTextContents()).toEqual(["apple silicon", "intel"]);
    await expect(macButtons(page).first()).toHaveAttribute("href", MAC_FILES["macos-dmg-arm"]);
    await expect(macButtons(page).first()).toHaveAttribute("data-platform", "macos-dmg-arm");
    await expect(shown(page).locator('a[href="https://github.com/shizumu-app/shizumu/issues"]')).toHaveCount(1);
    await expect(shown(page).locator("form")).toBeHidden();
  });

  test("an intel mac sees intel first", async ({ page }) => {
    await chip(page, "x86");
    await offerMore(page, MAC_FILES);
    await page.goto("/");
    expect(await macButtons(page).allTextContents()).toEqual(["intel", "apple silicon"]);
    await expect(macButtons(page).first()).toHaveAttribute("href", MAC_FILES["macos-dmg-intel"]);
  });
});

test.describe("download tabs with script off", () => {
  test.use({ viewport: { width: 1280, height: 800 }, userAgent: LINUX_UA, javaScriptEnabled: false });

  test("every panel shows under its own heading, and the tab row links to each", async ({ page }) => {
    await page.goto("/");
    for (const id of ["linux", "windows", "mac", "android", "iphone"]) {
      await expect(page.locator(`#dl-${id}`)).toBeVisible();
      await expect(page.locator(`#download .home-dl-tabs a[href="#dl-${id}"]`)).toHaveCount(1);
    }
    await expect(page.locator("#dl-linux .ui-btn")).toHaveAttribute("href", /flathub\.org/);
    await expect(page.locator('#download [role="tab"]')).toHaveCount(0);
  });
});
