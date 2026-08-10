#!/usr/bin/env node
// Seed the shizumu dev DB from a fixture corpus.
//
//   node scripts/seed-corpus.js [--fixture <path>] [--reset] [--db <path>]
//
//   --fixture   path to a fixture module (default: ./fixtures/shizumu-meta)
//               the module must export { lineages, pages, pins }
//   --reset     wipe pages / lineages / shared_objects / pages_fts before insert
//   --db        override the dev DB path (default: resolved via dev-db-path.js)
//
// Convenience:
//   npm run seed:demo         === --reset on the bundled shizumu-meta corpus
//
// Safety:
//   - refuses to run if --reset is omitted and any of the target tables are
//     non-empty (use --reset to explicitly wipe)
//   - does NOT touch op_log, lines, settings, or any sync infrastructure
//   - the app should be closed when this runs (SQLite file lock)

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { devDbPath } from "./lib/dev-db-path.js";

const args = parseArgs(process.argv.slice(2));
const dbPath = args.db || devDbPath();
const fixturePath = path.resolve(args.fixture || "fixtures/shizumu-meta/index.js");

console.log(`→ db:       ${dbPath}`);
console.log(`→ fixture:  ${fixturePath}`);
console.log(`→ reset:    ${args.reset ? "yes" : "no"}`);

if (!fs.existsSync(dbPath)) {
  fail(
    `dev DB does not exist at: ${dbPath}\n` +
    `launch the app once (npx tauri dev) so migrations run, then re-run this script.`,
  );
}

const fixture = await import(pathToFileURL(fixturePath).href);
const { lineages = [], pages = [], pins = [] } = fixture;

if (lineages.length === 0 && pages.length === 0) {
  fail("fixture is empty — nothing to seed.");
}

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys = ON");

const counts = currentCounts(db);
if (!args.reset && (counts.pages > 0 || counts.lineages > 0 || counts.pins > 0)) {
  fail(
    `target tables are not empty:\n` +
    `  pages=${counts.pages}  lineages=${counts.lineages}  pins=${counts.pins}\n` +
    `pass --reset to wipe them before inserting.`,
  );
}

const txn = db.exec.bind(db);
try {
  txn("BEGIN");
  if (args.reset) reset(db);
  insertLineages(db, lineages);
  insertPages(db, pages);
  insertPins(db, pins);
  txn("COMMIT");
} catch (err) {
  try { txn("ROLLBACK"); } catch {}
  throw err;
}

const after = currentCounts(db);
console.log(`✓ done · lineages=${after.lineages}  pages=${after.pages}  pins=${after.pins}`);
db.close();

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { reset: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--reset") out.reset = true;
    else if (a === "--fixture") out.fixture = argv[++i];
    else if (a === "--db") out.db = argv[++i];
    else if (a === "--help" || a === "-h") usage();
    else fail(`unknown argument: ${a}`);
  }
  return out;
}

function usage() {
  console.log(fs.readFileSync(new URL(import.meta.url).pathname, "utf8")
    .split("\n").slice(1).filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
  process.exit(0);
}

function fail(msg) {
  console.error("✗ " + msg);
  process.exit(1);
}

function currentCounts(db) {
  return {
    lineages: db.prepare("SELECT COUNT(*) AS n FROM lineages").get().n,
    pages: db.prepare("SELECT COUNT(*) AS n FROM pages").get().n,
    pins: db.prepare("SELECT COUNT(*) AS n FROM shared_objects").get().n,
  };
}

function reset(db) {
  // Order matters because of FKs.
  db.exec("DELETE FROM shared_objects");
  db.exec("DELETE FROM pages_fts");
  db.exec("DELETE FROM lines");
  db.exec("DELETE FROM pages");
  db.exec("DELETE FROM lineages");
}

function insertLineages(db, lineages) {
  // Sort by depth ascending so parent_id resolves on insert.
  const sorted = sortByDepth(lineages);
  const stmt = db.prepare(
    `INSERT INTO lineages (id, name, mode, parent_id, created_at) VALUES (?, ?, ?, ?, ?)`,
  );
  for (const l of sorted) {
    stmt.run(l.id, l.name, l.mode || "discrete", l.parent || null, nowIso(l.created_at));
  }
}

function insertPages(db, pages) {
  const pageStmt = db.prepare(
    `INSERT INTO pages (
       id, date, page_number, content_json, what_matters_now, lineage_id,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const ftsStmt = db.prepare(
    `INSERT INTO pages_fts (page_id, content, what_matters_now) VALUES (?, ?, ?)`,
  );
  for (const pg of pages) {
    const json = JSON.stringify(pg.content);
    const text = extractText(pg.content);
    const ts = nowIso(pg.created_at || pageTimestamp(pg.date));
    pageStmt.run(pg.id, pg.date, pg.page_number || 1, json, pg.focus || null, pg.lineage || null, ts, ts);
    ftsStmt.run(pg.id, text, pg.focus || "");
  }
}

function insertPins(db, pins) {
  // object_type is the app's pin-kind enum:
  //   "note"                              → text/manifesto pin (default)
  //   "artifact" | "board" | "table"      → board-style pins (kanban/table)
  // The SharedObjectsPanel + pin-display.js + Page.svelte all branch on
  // these exact strings, so the seed default ("note") must match the UI.
  const stmt = db.prepare(
    `INSERT INTO shared_objects (
       id, lineage_id, source_page_id, object_type, title, content,
       status, position, auto_insert, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const pin of pins) {
    const ts = nowIso(pin.created_at);
    stmt.run(
      pin.id,
      pin.lineage || null,
      pin.source_page || null,
      pin.object_type || "note",
      pin.title || null,
      pin.content,
      pin.status || "open",
      pin.position || 0,
      pin.auto_insert ? 1 : 0,
      ts, ts,
    );
  }
}

function sortByDepth(lineages) {
  const byId = new Map(lineages.map((l) => [l.id, l]));
  const depth = new Map();
  function d(l) {
    if (depth.has(l.id)) return depth.get(l.id);
    if (!l.parent) { depth.set(l.id, 0); return 0; }
    const p = byId.get(l.parent);
    if (!p) throw new Error(`lineage ${l.id} references missing parent ${l.parent}`);
    const r = d(p) + 1;
    depth.set(l.id, r);
    return r;
  }
  return [...lineages].sort((a, b) => d(a) - d(b));
}

function extractText(node) {
  if (!node) return "";
  if (node.type === "text") return node.text || "";
  if (Array.isArray(node.content)) {
    return node.content.map(extractText).filter(Boolean).join(" ");
  }
  return "";
}

function pageTimestamp(dateStr) {
  // anchor created_at to noon of the page's date so the dev UI orders pages
  // by date, not by seed-time.
  return new Date(`${dateStr}T12:00:00.000Z`).toISOString();
}

function nowIso(override) {
  if (override) return typeof override === "string" ? override : override.toISOString();
  return new Date().toISOString();
}
