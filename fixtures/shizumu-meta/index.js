// shizumu-meta — the demo corpus.
//
// shizumu's developer uses shizumu to manage shizumu. Five trails, seven
// pages, twenty-five pins. Items (tasks, issues, decisions, vision posts)
// live as pins — pins ARE the items, no separate task/issue trails needed.
//
//   shizumu (continuous)     · manifesto + global · daily long-form writing
//   ├── v0.* (discrete)      · historical releases parent
//   │   ├── v0.2 (discrete)  · past release · retrospective summary
//   │   └── v0.3 (discrete)  · current release · daily writing apr 26 → may 19
//   └── v1 (discrete)        · upcoming · vision posts
//
// Each v0.3 daily page captures the day's thinking. Pins are the artifacts
// extracted from that thinking — durable, scoped to the trail.

import {
  doc, p, h, ul, li, task, olItem, blockquote, codeBlock, chart, bold, italic, code,
} from "../../scripts/lib/tiptap-builders.js";

// ──────────────────────────────────────────────────────────────────────────
// Trails — lineages.name is UNIQUE
// ──────────────────────────────────────────────────────────────────────────

export const lineages = [
  { id: "ln-shizumu",  name: "shizumu", mode: "continuous", parent: null },
  { id: "ln-versions", name: "v0.*",    mode: "discrete",   parent: "ln-shizumu" },
  { id: "ln-v02",      name: "v0.2",    mode: "discrete",   parent: "ln-versions" },
  { id: "ln-v03",      name: "v0.3",    mode: "discrete",   parent: "ln-versions" },
  { id: "ln-v1",       name: "v1",      mode: "discrete",   parent: "ln-shizumu" },
];

// ──────────────────────────────────────────────────────────────────────────
// Pages
// ──────────────────────────────────────────────────────────────────────────

export const pages = [
  // ─── shizumu · continuous manifesto + global ───────────────────────────
  {
    id: "pg-shizumu",
    lineage: "ln-shizumu",
    date: "2026-04-25",
    page_number: 1,
    focus: "what shizumu is, in long form",
    content: doc(
      h(2, "what shizumu is"),
      p("a private thinking space. four verbs: write, pin, trail, sink. three active, one passive default."),
      p("the writing surface is the page. ephemeral by default. you write to think. what matters, you pin. what continues across days, you trail. the rest sinks."),

      h(3, "april 25"),
      p("the positioning anchor took two weeks to land. ", italic("not a notebook you pile into"), " — describes the behavior shift, not a category swap. the volume of writing is not the artifact."),

      h(3, "april 30"),
      p("trail-exception clause: continuous trails ", italic("look"), " like piling because they're one document the user keeps adding to. they're not. they're the intentional refusal of sinking, for one focused topic."),

      h(3, "may 4"),
      p("pin × trail is the executive summary nobody else can produce. six months of one topic, condensed to the things you pinned. notion can't do this. obsidian can't do this. they don't have pins as a primitive."),

      h(3, "may 9"),
      p("trail map view came back into v0.3 scope. visualizing the structure is what makes branching feel earned. without it, branching is a database operation. with it, branching is a thinking move."),

      h(3, "may 14"),
      p("the four-verb stanza is now in onboarding, landing page, metainfo, store summary. every user-facing string threads one of write / pin / trail / sink, or stays neutral chrome."),

      h(3, "may 19"),
      p("ship day. v0.2 + v0.3 is the durable substrate. v1 is the next pass."),
    ),
  },

  // ─── v0.2 · retrospective ──────────────────────────────────────────────
  {
    id: "pg-v02",
    lineage: "ln-v02",
    date: "2026-04-25",
    page_number: 2,
    focus: "v0.2 — the foundation pass",
    content: doc(
      h(2, "v0.2 — the foundation pass"),
      p("before v0.3 could ship branching, v0.2 had to settle the underlying primitives. block + pin rewrite. rail system rewrite. list-marker unification. retroactively, that line of work is what made v0.3 ship-able."),
      blockquote(
        p("you cannot ship branching trails on a wobbly block model."),
      ),
      p("v0.2.7 closed the foundation pass. the block + pin rewrite let pins anchor to any block; the rail system rewrite gave the editor a consistent baseline; the list-marker unification put bullets, ordered, and tasks in one schema. each of those was a quiet release. together they paid for v0.3."),
    ),
  },

  // ─── v0.3 · kickoff · 2026-04-26 ───────────────────────────────────────
  {
    id: "pg-v03-apr26",
    lineage: "ln-v03",
    date: "2026-04-26",
    page_number: 1,
    focus: "frame v0.3 around four verbs · write, pin, trail, sink",
    content: doc(
      h(2, "kickoff"),
      p("the four-verb stanza locks in today. three active verbs, one passive default. every user-facing string for v0.3 threads one of them, or stays neutral chrome."),
      h(3, "the cut"),
      ul(
        olItem("trail-folder export · per-trail or all-trails, as readable markdown"),
        olItem("branching trails · rename, move under, fold into, delete"),
        olItem("trail map view · vertical spine + bezier subtrail arcs"),
        olItem("midnight transition · stay on yesterday or start fresh"),
        olItem("editor refresh · block titles, mixed list markers, codeblocks with titles"),
      ),
      h(3, "load-bearing call"),
      p("export emits markdown, not json. it has to be readable in any editor. ", bold("json over xml — local-first is non-negotiable"), "."),
      p("pins serialize as html comments above the block they anchor:"),
      codeBlock("markdown",
        "<!-- shizumu:pin:p_abc123 -->\n> json over xml — local-first is non-negotiable.",
        "pin anchor shape",
      ),
    ),
  },

  // ─── v0.3 · mid-sprint · 2026-05-05 ────────────────────────────────────
  {
    id: "pg-v03-may05",
    lineage: "ln-v03",
    date: "2026-05-05",
    page_number: 1,
    focus: "mid-sprint check · what's solid, what's risky",
    content: doc(
      h(2, "where we are"),
      p("export design is solid. round-trip is byte-equal in tests. branching ux is the long pole — four operations (rename, move, fold, delete) share a search + tree component. building it once costs more upfront, saves three rebuilds."),
      h(3, "burndown"),
      ul(
        task("markdown serializer", true),
        task("parser (test-only)", true),
        task("round-trip suite passing byte-equal", true),
        task("export_to_folder rust command", true),
        task("rename trail"),
        task("move under another trail"),
        task("fold into parent"),
        task("delete with reparenting"),
      ),
      h(3, "folder shape"),
      codeBlock("text",
        "shizumu-export/\n  README.md\n  shizumu/\n    _trail.md\n    2026-04-25-1.md\n  v0.*/\n    _trail.md\n    v0.3/\n      _trail.md\n      2026-04-26-1.md\n      2026-05-05-1.md\n",
        "one folder per lineage; subfolders for child trails",
      ),
    ),
  },

  // ─── v0.3 · late sprint · 2026-05-12 ───────────────────────────────────
  {
    id: "pg-v03-may12",
    lineage: "ln-v03",
    date: "2026-05-12",
    page_number: 1,
    focus: "scope revised · trail-map view back in",
    content: doc(
      h(2, "the revision"),
      p("trail-map was pushed to v0.3.1 last week. pulling it back. without it, branching is a feature without a payoff visualization — users branch trails and then have no way to see the shape they built. the map is what makes the structure visible."),
      blockquote(
        p("v0.3.0 will not tag until the bundle ships."),
      ),
      h(3, "added back to ship gate"),
      ul(
        olItem("trail-map view"),
        olItem("midnight transition modal"),
        olItem("ctrl+k day-jump palette inside continuous trails"),
        olItem("@-spawn subtrail in editor"),
      ),
      p("the trail-map renders any depth as a vertical spine with bezier subtrail arcs. dot density per day reads like a calendar at a glance."),
    ),
  },

  // ─── v0.3 · ship day · 2026-05-19 ──────────────────────────────────────
  {
    id: "pg-v03-may19",
    lineage: "ln-v03",
    date: "2026-05-19",
    page_number: 1,
    focus: "what's left before tag",
    content: doc(
      h(2, "last gate"),
      ul(
        task("trail-folder export e2e on real corpus"),
        task("re-shoot store screenshots against v0.3 ui"),
        task("create liberapay account for donation url"),
        task("tag v0.3.0 and push"),
      ),
      h(3, "shipped"),
      ul(
        task("trail-folder export · per-trail or all-trails", true),
        task("branching trails · rename / move / fold / delete", true),
        task("trail map view", true),
        task("midnight transition", true),
        task("ctrl+k day-jump palette", true),
        task("@-spawn subtrail", true),
        task("editor refresh · block titles, mixed lists, codeblocks", true),
        task("chart tool · flowchart, mindmap, timeline", true),
        task("release video · 81s · 9 scenes · music-only", true),
        task("landing page v0.3 mockups inline", true),
        task("onboarding trail slide with reshape strip", true),
      ),
      h(3, "deferred to v0.3.1"),
      ul(
        li("bullet", "import_from_folder · symmetric inverse of export"),
        li("bullet", "memory revamp · scoped then pushed forward"),
      ),
      h(3, "open issue routed today"),
      p("codeblock arrowup on the first line jumps past the title to the paragraph above. fix routes through the block-title plugin: arrowup at atBoardStart refocuses the title slot before falling through."),
    ),
  },

  // ─── v1 · vision ───────────────────────────────────────────────────────
  {
    id: "pg-v1",
    lineage: "ln-v1",
    date: "2026-05-18",
    page_number: 1,
    focus: "what shizumu becomes",
    content: doc(
      h(2, "the next pass"),
      p("v0.3 is the trail revamp. v1 is the durability + reach pass — the work that makes shizumu portable across devices without compromising the local-first guarantee."),
      h(3, "the through-line"),
      p("v1 makes shizumu ", italic("reachable"), " (sync, mobile) and ", italic("durable"), " (import is the inverse of export). it does not add new primitives. the four verbs stay. the permanent refusals stay."),
      blockquote(
        p("v1 is the trust pass. v2 is when shizumu earns more vocabulary, if it earns it at all."),
      ),
      h(3, "what stays refused"),
      p("prompts, tags, folders, templates, streaks, social, plugins, graph view, ai-generated writing. these are not features we left out. they're features we refuse."),
      p("live collaborative multiplayer also stays refused. cloud sync is for the same user across their own devices. shizumu is a solo writing surface."),
    ),
  },
];

// ──────────────────────────────────────────────────────────────────────────
// Pins — items live here, not as separate trails
// ──────────────────────────────────────────────────────────────────────────

export const pins = [
  // ─── shizumu · global manifesto (3) ─────────────────────────────────────
  {
    id: "pin-trail-exception", lineage: "ln-shizumu", source_page: "pg-shizumu", position: 0,
    content: "trail-exception clause is load-bearing — continuous trails are the deliberate refusal of sinking for one focused topic.",
  },
  {
    id: "pin-executive-summary", lineage: null, source_page: "pg-shizumu", position: 1,
    content: "pin × trail = the executive summary — six months of one topic, condensed to what you pinned.",
  },
  {
    id: "pin-refusals", lineage: "ln-shizumu", source_page: "pg-shizumu", position: 2,
    content: "permanent refusals stay: prompts · tags · folders · templates · streaks · social · plugins · graph view · ai-generated writing.",
  },

  // ─── v0.* · carry-forward pins (auto_insert=true, scoped to parent) ────
  // These appear when viewing v0.* AND inherit down to v0.2 and v0.3 — the
  // ancestor walk in SharedObjectsPanel surfaces them on every release page
  // automatically. Demonstrates the "carries" filter and the auto-insert
  // toggle in PinArtifactModal.
  {
    id: "pin-stanza-carry", lineage: "ln-versions", source_page: "pg-v02", position: 0,
    auto_insert: true,
    content: "every shizumu release threads the four-verb stanza — write · pin · trail · sink.",
  },
  {
    id: "pin-local-first-carry", lineage: "ln-versions", source_page: "pg-v02", position: 1,
    auto_insert: true,
    content: "every shizumu release is local-first by default. cloud sync stays opt-in and self-deployed.",
  },

  // ─── v0.2 · retrospective (4) ───────────────────────────────────────────
  {
    id: "pin-v02-nesting", lineage: "ln-v02", source_page: "pg-v02", position: 0,
    content: "v0.2 · trail nesting · unified list markers · pins panel.",
  },
  {
    id: "pin-v027-block-pin", lineage: "ln-v02", source_page: "pg-v02", position: 1,
    content: "v0.2.7 · block + pin rewrite · rail system rewrite.",
  },
  {
    id: "pin-list-marker-prep", lineage: "ln-v02", source_page: "pg-v02", position: 2,
    content: "list-marker unification cleared the path for the v0.3 editor refresh.",
  },
  {
    id: "pin-rail-foundation", lineage: "ln-v02", source_page: "pg-v02", position: 3,
    content: "rail system rewrite — the durable foundation for branching.",
  },

  // ─── v0.3 · active items extracted from each day's writing (12) ─────────
  // apr 26 — kickoff
  {
    id: "pin-ship-date", lineage: "ln-v03", source_page: "pg-v03-apr26", position: 0,
    content: "ship date: 2026-05-19.",
  },
  {
    id: "pin-json-xml", lineage: "ln-v03", source_page: "pg-v03-apr26", position: 1,
    content: "json over xml — local-first is non-negotiable.",
  },

  // may 5 — mid-sprint
  {
    id: "pin-export-shape", lineage: "ln-v03", source_page: "pg-v03-may05", position: 2,
    object_type: "board",
    title: "export shape",
    content: JSON.stringify(doc(
      blockquote(
        p("scope of export?"),
        p("per-trail or all-trails, as readable markdown — symmetric round-trip."),
      ),
    )),
  },
  {
    id: "pin-branching-ops", lineage: "ln-v03", source_page: "pg-v03-may05", position: 3,
    object_type: "board",
    title: "branching ops",
    content: JSON.stringify(doc(
      ul(
        task("rename trail",         true),
        task("move under another",   true),
        task("fold into parent",     true),
        task("delete with reparent"),
      ),
    )),
  },

  // may 12 — late sprint
  {
    id: "pin-round-trip", lineage: "ln-v03", source_page: "pg-v03-may12", position: 4,
    content: "round-trip tests passing byte-equal — the format is provably symmetric.",
  },
  {
    id: "pin-trail-map", lineage: "ln-v03", source_page: "pg-v03-may12", position: 5,
    content: "trail map view · vertical spine + bezier subtrail arcs.",
  },
  {
    id: "pin-midnight", lineage: "ln-v03", source_page: "pg-v03-may12", position: 6,
    content: "midnight transition · stay on yesterday or start fresh.",
  },

  // may 19 — ship day
  {
    id: "pin-screenshots", lineage: "ln-v03", source_page: "pg-v03-may19", position: 7,
    content: "screenshots are the last gate before flathub submission.",
  },
  {
    id: "pin-liberapay", lineage: "ln-v03", source_page: "pg-v03-may19", position: 8,
    content: "liberapay account needed for the metainfo donation url.",
  },
  {
    id: "pin-codeblock-arrowup", lineage: "ln-v03", source_page: "pg-v03-may19", position: 9,
    object_type: "board",
    title: "codeblock arrowup",
    content: JSON.stringify(doc(
      codeBlock(
        "js",
        "// codeBlock arrowup focuses the title via the shared plugin\n" +
        "if (event.key === \"ArrowUp\" && atTitleEntry) {\n" +
        "  const title = (board.attrs?.blockTitle || \"\").trim();\n" +
        "  if (!title) return false;\n" +
        "  event.preventDefault();\n" +
        "  slot.__enterEdit();\n" +
        "  return true;\n" +
        "}",
      ),
    )),
  },
  {
    id: "pin-v02-capstone", lineage: "ln-v03", source_page: "pg-v03-may19", position: 10,
    content: "block + pin rewrite is the v0.2 capstone — v0.3 ships on top of that foundation.",
  },
  {
    id: "pin-at-picker", lineage: "ln-v03", source_page: "pg-v03-may19", position: 11,
    content: "@ command opened the door for any picker — palette, file, link, pin.",
  },

  // ─── v1 · vision posts (6) ──────────────────────────────────────────────
  {
    id: "pin-cloud-sync", lineage: "ln-v1", source_page: "pg-v1", position: 0,
    content: "self-deploy relay sync — privacy stays intact. users run their own server.",
  },
  {
    id: "pin-import", lineage: "ln-v1", source_page: "pg-v1", position: 1,
    content: "import_from_folder — the symmetric inverse of export. round-trip is already proven.",
  },
  {
    id: "pin-mobile", lineage: "ln-v1", source_page: "pg-v1", position: 2,
    content: "mobile — tablet-first. phone is too cramped for the column.",
  },
  {
    id: "pin-dashboards", lineage: "ln-v1", source_page: "pg-v1", position: 3,
    content: "pin × trail dashboards — the executive view materialized.",
  },
  {
    id: "pin-kamae", lineage: "ln-v1", source_page: "pg-v1", position: 4,
    content: "kamae graph — pin relationships as a private weave.",
  },
  {
    id: "pin-no-multiplayer", lineage: "ln-v1", source_page: "pg-v1", position: 5,
    content: "live collaborative multiplayer stays refused — shizumu is a solo writing surface.",
  },

  // ─── titled board pin · v0.3 ship checklist (1) ─────────────────────────
  // object_type=board means the SharedObjectsPanel renders this as a card
  // with a title row + body. Content is a JSON-stringified TipTap doc so the
  // body renders as actual mixed-marker list, not plain text.
  {
    id: "pin-ship-checklist", lineage: "ln-v03", source_page: "pg-v03-may19", position: 12,
    object_type: "board",
    title: "ship checklist",
    content: JSON.stringify({
      type: "doc",
      content: [{
        type: "list",
        content: [
          { type: "listItem", attrs: { marker: "task", checked: true  }, content: [{ type: "paragraph", content: [{ type: "text", text: "trail-folder export e2e" }] }] },
          { type: "listItem", attrs: { marker: "task", checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "screenshots against v0.3 ui" }] }] },
          { type: "listItem", attrs: { marker: "task", checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "create liberapay account" }] }] },
          { type: "listItem", attrs: { marker: "task", checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "tag v0.3.0 and push" }] }] },
        ],
      }],
    }),
  },

  // ─── orphaned pin (1) ──────────────────────────────────────────────────
  // source_page_id=null + status='orphaned' demonstrates the orphan pill
  // in the panel. Schema lets source_page_id be NULL since migration 013;
  // the pin's content cache is frozen at the moment the source page was
  // deleted, so it stays visible as a fossil of an earlier decision.
  {
    id: "pin-orphan", lineage: "ln-v03", source_page: null, position: 13,
    status: "orphaned",
    content: "earlier idea — flow-mode mechanic with rising lines. dropped during v0.3 design; deleted page leaves this pin as a fossil.",
  },
];
