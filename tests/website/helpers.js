import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const THEMES = ["cream", "white", "dark"];

// paths whose redesign is done; axe runs on these only. later tasks append here
// as they rebuild a page, so the suite tightens with the work.
export const REBUILT = [
  "/",
  // the answer pages, all on AnswerLayout
  "/obsidian-alternative",
  "/logseq-alternative",
  "/notion-alternative",
  "/evernote-alternative",
  "/joplin-alternative",
  "/google-keep-alternative",
  "/day-one-alternative",
  "/penzu-alternative",
  "/notesnook-alternative",
  "/simplenote-alternative",
  "/standard-notes-alternative",
  "/journal-app-for-linux",
  "/journal-app-for-android",
  "/journal-app-for-windows",
  "/self-hosted-notes-app",
  "/cross-platform-note-taking-app",
  "/encrypted-note-taking-app",
  "/open-source-journaling-app",
  "/open-source-note-taking-app",
  "/morning-pages-app",
  "/distraction-free-writing-app",
  "/second-brain",
  "/free-journaling-app",
  // the docs, all on DocsLayout
  "/docs/",
  "/docs/no-tags-no-folders",
  "/docs/journaling-that-doesnt-keep-everything",
  "/docs/sync",
  "/docs/encryption",
  "/docs/threat-model",
  "/docs/self-deploy",
  "/docs/in-practice/founder",
  "/docs/in-practice/novelist",
  "/docs/in-practice/phd-researcher",
  "/docs/in-practice/reader",
  "/docs/in-practice/decision",
  "/docs/in-practice/developer",
  // the blog
  "/blog/",
  "/blog/2026-06-12-what-we-keep",
  "/blog/2026-07-27-devblog",
  "/blog/2026-08-01-devblog",
  "/blog/2026-08-20-open-beta",
  "/blog/2026-08-22-flathub",
  "/blog/2026-08-23-sync-recovery",
  "/blog/2026-08-23-write-to-think",
  "/blog/2026-08-29-where-does-this-go",
  "/blog/2026-09-02-the-demo-is-the-app",
  "/blog/2026-09-13-no-folders",
  // pricing
  "/pricing",
  // legal, contact, the demo front door, the checkout return and the account
  // screens (the last two are noindexed, so NOT_IN_SITEMAP)
  "/terms",
  "/privacy",
  "/refund",
  "/contact",
  "/try/",
  "/success",
  "/account/",
  "/account/reset",
];

// rebuilt paths that are deliberately not in the sitemap: the account screens
// are noindexed, and a sitemap must not list a page it tells search to skip.
// every other REBUILT path has to be in the sitemap (pages.spec.js checks).
export const NOT_IN_SITEMAP = ["/success", "/account/", "/account/reset"];

const SITEMAP = fileURLToPath(
  new URL("../../website/dist/sitemap-0.xml", import.meta.url),
);

// the sitemap holds absolute https://shizumu.app urls; the preview server
// serves the same pages at the same paths, so keep only the path.
export async function sitemapPaths() {
  const xml = await readFile(SITEMAP, "utf8");
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  return locs.map((u) => new URL(u).pathname);
}

// sets the stored theme before any page script runs. the key is the one
// website/src/layouts/Base.astro reads.
export async function setTheme(page, theme) {
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("shizumu-theme", t);
    } catch (e) {}
  }, theme);
}
