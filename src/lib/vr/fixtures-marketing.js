// Marketing/store screenshot fixtures.
//
// Same seeded-mock mechanism the VR scenes use (src/lib/vr/seed.js), with
// content written for a PRODUCT SHOT rather than for a regression: the
// writing on screen has to read like someone thinking, because a listing
// image full of "a line before the block" sells worse than no image at all.
//
// These are deliberately SEPARATE from fixtures.js and their scenes carry
// `marketing: true` so the VR sweep never photographs them — see scenes.js's
// VR_SCENE_IDS and the note there. A marketing fixture is copy, and copy
// changes; a baselined copy change is a VR diff for no coverage gain.
//
// The subject matter is the repo's own work (the block editor landing, the
// convert-from-chip fix, the relay), so nothing on screen claims a feature
// that does not exist.
import { getLocalDateStr } from "../utils.js";

// ── node helpers ──────────────────────────────────────────────────────

const text = (t) => [{ type: "text", text: t }];
const p = (t) => (t ? { type: "paragraph", content: text(t) } : { type: "paragraph" });
const h = (level, t) => ({ type: "heading", attrs: { level }, content: text(t) });

/** A unified-list node. `marker` is "task" | "bullet" | "ordered". */
function list(marker, items, blockTitle) {
  return {
    type: "list",
    ...(blockTitle ? { attrs: { blockTitle } } : {}),
    content: items.map(([body, checked]) => ({
      type: "listItem",
      attrs: { marker, ...(marker === "task" ? { checked: !!checked } : {}) },
      content: [p(body)],
    })),
  };
}

/** decisionBlock — content is "block paragraph paragraph": the considered
 *  list, then chose, then because. See extensions/decision-block.js. */
function decision(considered, chose, because) {
  return {
    type: "decisionBlock",
    content: [list("bullet", considered.map((c) => [c])), p(chose), p(because)],
  };
}

/** recipeBlock — content is "paragraph block paragraph": given, do, result. */
function recipe(given, steps, result) {
  return {
    type: "recipeBlock",
    content: [p(given), list("ordered", steps.map((s) => [s])), p(result)],
  };
}

function code(language, source) {
  return {
    type: "codeBlock",
    attrs: { language },
    content: text(source),
  };
}

function flowchart(blockTitle, nodes, edges, direction = "LR") {
  return {
    type: "chart",
    attrs: { kind: "flowchart", blockTitle, source: { direction, nodes, edges } },
  };
}

/** An all-empty table — cells carry an empty paragraph, which is what
 *  `/table` inserts. */
function emptyTable(cols, rows) {
  const cell = (type) => ({ type, content: [{ type: "paragraph" }] });
  return {
    type: "table",
    content: [
      { type: "tableRow", content: Array.from({ length: cols }, () => cell("tableHeader")) },
      ...Array.from({ length: rows }, () => ({
        type: "tableRow",
        content: Array.from({ length: cols }, () => cell("tableCell")),
      })),
    ],
  };
}

/** The blob hash the evidence screenshot is stored under.
 *
 *  Content-addressed in the real app; here it is just a stable key shared
 *  by the node below and blobs-marketing.js, which maps it to the actual
 *  bytes. Declared HERE rather than there so the fixture module never has
 *  to import a quarter-megabyte data URI to know its own attachment's id.
 */
export const EVIDENCE_BLOB_HASH = "f3c9a24e08b17d65e4a1c802f9b36de7";

function image(blobHash, filename, width) {
  return {
    type: "paragraph",
    content: [{
      type: "attachment",
      attrs: {
        kind: "image",
        blob_hash: blobHash,
        filename,
        mime_type: "image/png",
        size_bytes: 118_204,
        sync: false,
        created_at: "2026-08-25T16:41:00.000Z",
        pinId: null,
        width,
        display: "block",
        collapsed: false,
      },
    }],
  };
}

const doc = (content) => JSON.stringify({ type: "doc", content });

function dayBefore(n) {
  const d = new Date(getLocalDateStr() + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// ── the shared world ──────────────────────────────────────────────────
// One trail shape across every marketing scene, so the trail chip on the
// page and the breadcrumb in memory agree with each other shot to shot.

async function seedTrails(invoke) {
  const shizumu = await invoke("create_lineage", { name: "shizumu", mode: "discrete", parentId: null });
  const v08 = await invoke("create_lineage", { name: "v0.8", mode: "discrete", parentId: shizumu.id });
  const relay = await invoke("create_lineage", { name: "the relay", mode: "discrete", parentId: shizumu.id });
  const book = await invoke("create_lineage", { name: "the book", mode: "continuous", parentId: null });
  return { shizumu, v08, relay, book };
}

/** The pins that read as kept thinking rather than "pin 1 / pin 2".
 *
 *  Every one of these corresponds to something visible elsewhere in the
 *  set — the convert rule is the decision on the evidence page, the chip
 *  rule is the chip the convert shot is opened from, the relay pair is the
 *  sync panel's own claim. A pin nobody can trace back to a page in the
 *  same set is what makes six screenshots read as six products. */
const PINS = [
  ["v08", "a test that cannot fail is a comment", "the mock took an order the relay refuses, so the suite passed on a feature that never ran."],
  ["v08", "convert keeps the text, not the shape", "a task list becomes a q&a and every line survives. a convert that drops what it cannot flatten does not run at all."],
  ["v08", "the chip is not content", "it names the block and opens its actions. copy the block and the chip stays behind, because it was never in the doc."],
  ["relay", "post the metadata, then put the blob", "the relay refuses an unannounced blob. order is the contract, not an implementation detail."],
  ["relay", "keys never leave the device", "the relay stores sealed bytes it cannot read. that is the entire security model."],
  ["book", "the page did the work", "a pin is a pointer back into thinking, never the thinking itself."],
];

async function seedPins(invoke, trails, sourcePageId) {
  for (const [trailKey, title, body] of PINS) {
    await invoke("create_pin", {
      lineageId: trails[trailKey].id,
      sourcePageId,
      objectType: "note",
      title,
      content: doc([p(body)]),
    });
  }
}

/** Prior days, newest first — the spine memory draws its cards from.
 *  Nothing here lands on `the book`: it is a CONTINUOUS trail, so it owns
 *  exactly one page ever, and that page is written today (below). */
const DAYS = [
  ["v08", "why the convert menu ate the chart", [
    "converting a chart offered rows that did nothing, because the target list was computed from the type name and never from the node.",
    "the fix looks ahead: build the shape, and if the build refuses, do not offer the row.",
  ]],
  ["relay", "twelve seconds from scan to first page", [
    "pairing a second device end to end, on a phone, over a relay i run myself.",
    "the wait is nginx buffering the live channel, not the protocol.",
  ]],
  ["shizumu", "cut the second onboarding slide", [
    "it explained the thing the empty page already says.",
    "one screen fewer is one less promise to keep.",
  ]],
  ["shizumu", "what the reader saw that i did not", [
    "someone compared it to howm. fragments written freely, read collectively.",
    "the comparison is fair and i had not seen it.",
  ]],
];

async function seedPriorDays(invoke, trails) {
  for (let i = 0; i < DAYS.length; i += 1) {
    const [trailKey, focus, lines] = DAYS[i];
    const { page } = await invoke("create_new_page", { date: dayBefore(i + 1) });
    await invoke("update_what_matters_now", { pageId: page.id, text: focus });
    await invoke("set_focus_lineage", { pageId: page.id, lineageId: trails[trailKey].id });
    await invoke("save_page_content", { pageId: page.id, contentJson: doc(lines.map(p)) });
  }
  // One untrailed page. Most writing belongs to nothing and sinks; a memory
  // shot with every page neatly trailed would be a lie about the product.
  const { page: loose } = await invoke("create_new_page", { date: dayBefore(DAYS.length + 1) });
  await invoke("update_what_matters_now", { pageId: loose.id, text: "a thought with nowhere to put it yet" });
  await invoke("save_page_content", {
    pageId: loose.id,
    contentJson: doc([p("not every page belongs to something. most of them sink, and that is the point.")]),
  });
}

/** Today's page, trailed to v0.8 with the release focus line. */
async function todayOnV08(invoke, trails) {
  const { page } = await invoke("get_or_create_today", {});
  await invoke("set_focus_lineage", { pageId: page.id, lineageId: trails.v08.id });
  await invoke("update_what_matters_now", { pageId: page.id, text: "what's left before tag" });
  return page;
}

// ── the scenes ────────────────────────────────────────────────────────

/** page_with_tasks — the writing page: prose, then what is left to do. */
export async function marketingTasks(invoke) {
  const trails = await seedTrails(invoke);
  const page = await todayOnV08(invoke, trails);
  await invoke("save_page_content", {
    pageId: page.id,
    contentJson: doc([
      p("the blocks have been usable for two weeks and i keep not tagging. what i am waiting on is the shell, and the shell is not mine to wait on."),
      p("so the real question is not whether the blocks are done. it is whether a release that ships them alone is worth someone's afternoon. it is."),
      list("task", [
        ["convert a block from its chip", true],
        ["the decision block", true],
        ["a divider survives a convert", true],
        ["screenshots against the new ui", false],
        ["tag and push", false],
      ], "before tag"),
      p("the rest of the list is the part i keep rewriting instead of doing. two of those lines have been there since sunday, which is its own answer."),
      // Not "the two lines i pinned": the trail chip beside it reads
      // "pins 3", and a store image that contradicts its own header is the
      // kind of detail a reader notices and nobody can un-notice.
      p("none of this needs to survive the week. the lines i pinned do."),
    ]),
  });
  await seedPins(invoke, trails, page.id);
}

/** page_with_tools — chart, recipe, code and the decision block, one page. */
export async function marketingTools(invoke) {
  const trails = await seedTrails(invoke);
  const page = await todayOnV08(invoke, trails);
  await invoke("save_page_content", {
    pageId: page.id,
    // Four blocks, one document, one viewport. Every line here is kept
    // short on purpose: the shot has to show all four whole, and a clipped
    // fourth block is a failed store image.
    //
    // The lead paragraph is load-bearing, not decoration: with a chart
    // (an atom node) as the doc's first node, the editor's initial
    // selection resolves to a NodeSelection ON it and the chart renders
    // accent-tinted as "selected" in every capture. A textblock first puts
    // the caret in prose instead, which is also what a real page looks
    // like.
    contentJson: doc([
      p("everything below is one document. no embeds, no second app."),
      flowchart(
        "the release path",
        [
          { id: "a", label: "blocks land", shape: "rect" },
          { id: "b", label: "shoot the listing", shape: "rect" },
          { id: "c", label: "tag", shape: "rounded" },
          { id: "d", label: "flathub builds", shape: "rounded" },
        ],
        [
          { from: "a", to: "b", label: "" },
          { from: "b", to: "c", label: "" },
          // No label on this edge either. "mirrors" rendered with the
          // arrow running straight through the word, which photographs as
          // strikethrough — a store image where the diagram looks struck
          // out is a failed shot, and the label carried nothing the two
          // node names did not already say.
          { from: "c", to: "d", label: "" },
        ],
      ),
      recipe(
        "given a tag that has to reach three stores",
        ["build the appimage and the flatpak", "push the tag and let the runner take it"],
        "one release, three listings, nothing uploaded by hand",
      ),
      code("bash", "git tag -s v0.8 -m 'blocks' && git push --tags"),
      decision(
        ["ship the blocks now", "wait for the shell"],
        "ship the blocks",
        "the shell lands on its own schedule, and the blocks are what people asked for",
      ),
    ]),
  });
  await seedPins(invoke, trails, page.id);
}

/** trail_map + pin_panel — memory, with days, trails and pins behind it.
 *
 *  Today carries a page on each of the three trails the pins land on. That
 *  is deliberate: TrailMap renders one block per (day × trail), and a trail
 *  with pins but no page that day renders as a header alone — correct
 *  behaviour, but in a store image an empty rounded card reads as a
 *  rendering fault rather than as "you pinned here without writing here".
 */
export async function marketingMemory(invoke) {
  const trails = await seedTrails(invoke);
  const page = await todayOnV08(invoke, trails);
  await invoke("save_page_content", {
    pageId: page.id,
    contentJson: doc([
      p("the blocks have been usable for two weeks and i keep not tagging."),
      p("what is left is the listing, and then the tag."),
    ]),
  });

  const today = getLocalDateStr();
  const { page: relayPage } = await invoke("create_new_page", { date: today });
  await invoke("update_what_matters_now", { pageId: relayPage.id, text: "what pairing actually costs" });
  await invoke("set_focus_lineage", { pageId: relayPage.id, lineageId: trails.relay.id });
  await invoke("save_page_content", {
    pageId: relayPage.id,
    contentJson: doc([p("two devices, one relay i run myself, and no key on it that can read anything.")]),
  });

  // The book is continuous: one canonical doc, written into over months.
  const { page: bookPage } = await invoke("create_new_page", { date: today });
  await invoke("update_what_matters_now", { pageId: bookPage.id, text: "chapter three, the part about attention" });
  await invoke("set_focus_lineage", { pageId: bookPage.id, lineageId: trails.book.id });
  await invoke("save_page_content", {
    pageId: bookPage.id,
    contentJson: doc([p("thinking happens while the sentence is being produced, not while it is being marked.")]),
  });

  await seedPriorDays(invoke, trails);
  await seedPins(invoke, trails, page.id);
}

/** mention — a page with somewhere to type `@`, and pages and pins to find. */
export async function marketingMention(invoke) {
  const trails = await seedTrails(invoke);
  const page = await todayOnV08(invoke, trails);
  await invoke("save_page_content", {
    pageId: page.id,
    contentJson: doc([
      p("the convert fix from yesterday is the one worth naming in the notes, and the pin that explains why it was wrong."),
      p("so: "),
    ]),
  });
  await seedPriorDays(invoke, trails);
  await seedPins(invoke, trails, page.id);
}

/** blocks-slash / table picker / chart builder — a page with a line to type on. */
export async function marketingBlocks(invoke) {
  const trails = await seedTrails(invoke);
  const page = await todayOnV08(invoke, trails);
  await invoke("save_page_content", {
    pageId: page.id,
    contentJson: doc([
      h(2, "release notes, first pass"),
      p("four blocks landed since 0.7.5, and each one started as a paragraph i kept reformatting by hand."),
      p(""),
    ]),
  });
  await seedPins(invoke, trails, page.id);
}

/** blocks-decision — the decision block, filled, with room to read it. */
export async function marketingDecision(invoke) {
  const trails = await seedTrails(invoke);
  const page = await todayOnV08(invoke, trails);
  await invoke("save_page_content", {
    pageId: page.id,
    contentJson: doc([
      p("i have argued both sides of this for a week, which is how i know the argument is not the hard part. writing down which side won is."),
      decision(
        ["ship the blocks now", "wait for the shell"],
        "ship the blocks",
        "the shell lands on its own schedule, and the blocks are what people asked for",
      ),
      p("in six months this is the line i will want back, not the week of arguing that produced it."),
    ]),
  });
  await seedPins(invoke, trails, page.id);
}

/** blocks-evidence — the page the fix was worked out on: a photograph of
 *  the bug, the reasoning, the decision, and the pin it became.
 *
 *  The focus line is deliberately the SAME string as the v0.8 day in DAYS
 *  above ("why the convert menu ate the chart"), because `mention` shoots
 *  the `@` menu finding that page by name. The two shots reference one
 *  page, not two pages that happen to be worded alike. */
export async function marketingEvidence(invoke) {
  const trails = await seedTrails(invoke);
  const { page } = await invoke("get_or_create_today", {});
  await invoke("set_focus_lineage", { pageId: page.id, lineageId: trails.v08.id });
  await invoke("update_what_matters_now", { pageId: page.id, text: "why the convert menu ate the chart" });
  await invoke("save_page_content", {
    pageId: page.id,
    contentJson: doc([
      p("found it by running the app, not by reading it. second time this month."),
      // 28rem is measured, not chosen: capture-evidence.mjs clips at 530
      // CSS px, so this is a 0.85 downscale — near enough to 1:1 that the
      // gutter button and the type chip inside the picture still read,
      // while leaving the last paragraph clear of the bottom bar at 900.
      // Widen it and the closing line disappears under the bar.
      image(EVIDENCE_BLOB_HASH, "empty table, gutter revealed.png", "28rem"),
      p("an empty table offers delete and nothing else — there is no text in it to pin or copy. the convert bug is that same assumption one step further."),
      p("a convert flattens what is inside a block down to paragraphs. a chart keeps its data in attributes, not in text, so it flattened to nothing and the convert reported success. the guard was already there — it asked whether the child had a content array, and a chart does not have one."),
      decision(
        ["drop the chart and warn", "refuse the convert"],
        "refuse",
        "a convert that deletes a diagram is worse than one that will not run",
      ),
      p("pinned it as “convert keeps the text, not the shape”, so the next person meets the rule before the code."),
    ]),
  });
  await seedPins(invoke, trails, page.id);
}

/** The SUBJECT of the evidence photograph, not a shot of its own.
 *
 *  `_capture/capture-evidence.mjs` loads this scene, hovers the empty
 *  table so the gutter reveals, and clips that region to
 *  `_capture/assets/evidence-empty-table.png` — which is then the bitmap
 *  marketingEvidence above puts on the page. Shooting the picture with the
 *  same harness is the point: the image on the listing is the app, not an
 *  illustration of it.
 *
 *  Deliberately NOT FIXTURES.pageWithEmptyTable: that one says "a line
 *  before the table", which is correct for a regression baseline and reads
 *  as filler inside a photograph someone is going to look at. */
export async function marketingEvidenceSubject(invoke) {
  const trails = await seedTrails(invoke);
  const { page } = await invoke("get_or_create_today", {});
  await invoke("set_focus_lineage", { pageId: page.id, lineageId: trails.relay.id });
  await invoke("update_what_matters_now", { pageId: page.id, text: "what pairing actually costs" });
  await invoke("save_page_content", {
    pageId: page.id,
    contentJson: doc([
      p("pairing numbers go here once i have run it on the phone."),
      emptyTable(2, 2),
    ]),
  });
}

export const MARKETING_FIXTURES = {
  marketingTasks,
  marketingTools,
  marketingMemory,
  marketingMention,
  marketingBlocks,
  marketingDecision,
  marketingEvidence,
  marketingEvidenceSubject,
};
