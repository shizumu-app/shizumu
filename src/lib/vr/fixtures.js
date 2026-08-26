// Scene fixtures: each builds deterministic state by replaying real mock
// commands through the given invoke (DRY — no duplicated store logic).
// The clock is frozen by the caller (bootstrap), so "today" is stable.
import { getLocalDateStr } from "../utils.js";
import { emptySource } from "../extensions/chart.js";

function doc(paragraphs) {
  return JSON.stringify({
    type: "doc",
    content: paragraphs.map((t) => ({
      type: "paragraph",
      content: t ? [{ type: "text", text: t }] : [],
    })),
  });
}

export async function emptyPage(invoke) {
  await invoke("get_or_create_today", {});
}

export async function pageWithContent(invoke) {
  const { page } = await invoke("get_or_create_today", {});
  await invoke("update_what_matters_now", {
    pageId: page.id,
    text: "the shape of the argument, not the word count",
  });
  await invoke("save_page_content", {
    pageId: page.id,
    contentJson: doc([
      "the page is where the thinking gets done.",
      "you write to think. the pins are where you left it.",
      "the rest sinks — and that is what makes the writing honest.",
    ]),
  });
  // A second page on today's date — exercises the phone header's pages
  // chip/sheet (railFocuses.length > 1), which needs same-day pages rather
  // than the separate-day pages memoryWithPages seeds.
  const { page: page2 } = await invoke("create_new_page", { date: page.date });
  await invoke("update_what_matters_now", {
    pageId: page2.id,
    text: "a second thread, started earlier the same day",
  });
}

export async function memoryWithPages(invoke) {
  const today = getLocalDateStr();
  // today + two prior days (parameterized Date still works under the clock)
  for (let i = 0; i < 3; i += 1) {
    const d = new Date(today + "T00:00:00.000Z");
    d.setUTCDate(d.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    const { page } = await invoke("create_new_page", { date });
    await invoke("update_what_matters_now", { pageId: page.id, text: `day ${i}` });
    await invoke("save_page_content", {
      pageId: page.id,
      contentJson: doc([`entry for ${date}`, "a few settled lines of thought."]),
    });
  }
}

export async function pinsRich(invoke) {
  const { page } = await invoke("get_or_create_today", {});
  const titles = [
    "the killer cross-product is pin x trail",
    "sink lowers the stakes",
    "continuous trails are the intentional exception",
  ];
  for (const title of titles) {
    await invoke("create_pin", {
      lineageId: null,
      sourcePageId: page.id,
      objectType: "note",
      title,
      content: doc([title]),
    });
  }

  // The shapes real pins actually come in, as opposed to the one shape a
  // fixture reaches for. TipTapEditor writes a note's content as PLAIN TEXT
  // on one creation path (`pinContent = blockText`) and as a serialized doc
  // on another, and both land here as object_type "note". Consumers that
  // assumed a single shape lost titles, pasted raw JSON in as visible
  // characters, or dropped the pin outright — every one of those escaped
  // because no fixture ever produced the other shape.
  await invoke("create_pin", {
    lineageId: null,
    sourcePageId: page.id,
    objectType: "note",
    title: "a note stored as plain text",
    content: "written straight to the row, never serialized as a doc.",
  });
  // A heading has no blockTitle slot to stamp, so its title has nowhere to
  // go but a label line. That fallback had no coverage.
  await invoke("create_pin", {
    lineageId: null,
    sourcePageId: page.id,
    objectType: "note",
    title: "a pinned heading",
    content: JSON.stringify({
      type: "doc",
      content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "three things became clear" }] }],
    }),
  });
}

// A page carrying an image reference whose bytes were never persisted:
// `src: "blob:tauri://localhost/<uuid>"` with a null localPath, which an
// older paste path really did write into content_json. It renders as a
// broken/collapsed image and can never be converted by the attachment
// backfill — the case that made the backfill a no-op on a real library
// while every fixture, having a localPath, said it worked.
export async function deadImageRef(invoke) {
  const { page } = await invoke("get_or_create_today", {});
  await invoke("update_what_matters_now", { pageId: page.id, text: "images that point at nothing" });
  await invoke("save_page_content", {
    pageId: page.id,
    contentJson: JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "the picture below has no bytes on disk." }] },
        {
          type: "paragraph",
          content: [{
            type: "localImage",
            attrs: {
              src: "blob:tauri://localhost/015ebc35-1db1-42c6-b4cf-5f8536067825",
              alt: null, title: null, width: "91px", height: null,
              localPath: null, display: "block", collapsed: true,
            },
          }],
        },
      ],
    }),
  });
}

// A page carrying a board block (blockquote) — the class of node the
// touch tap-to-reveal-title path (TipTapEditor.svelte's
// handleEditorPointerDown, `.block-active-touch > .board-title-slot`) only
// ever fires on (`.block-shell` / `.code-block-wrap`; see
// block-hover-guard.js's hoverClassTarget). `doc()` above only ever emits
// bare paragraphs, which never carry a title slot at all — none of the
// existing scenes exercise this path, so a dedicated fixture is needed for
// its VR interaction state.
export async function pageWithBoardContent(invoke) {
  const { page } = await invoke("get_or_create_today", {});
  await invoke("update_what_matters_now", {
    pageId: page.id,
    text: "a block with a title, tapped on touch",
  });
  await invoke("save_page_content", {
    pageId: page.id,
    contentJson: JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a line before the block." }] },
        {
          type: "blockquote",
          attrs: { blockTitle: "a quoted aside" },
          content: [
            { type: "paragraph", content: [{ type: "text", text: "the first line of the block — this must stay fully visible when its title reveals." }] },
            { type: "paragraph", content: [{ type: "text", text: "a second line, so a covered first line would be obvious against it." }] },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "a line after the block." }] },
      ],
    }),
  });
}

// A SHORT titled board (a two-item task list) with plain blocks after it —
// the shape the "tap many times" report came in on. Short matters: the
// gutter toolbar is taller than this block, so its lower buttons hang past
// the block and over what follows, which is the whole setup for the bug.
// Titled matters: a board's title slot reveals and collapses IN FLOW, so
// anything that moves .block-active-touch off this block reflows the page
// under the finger. pageWithBoardContent's blockquote is too tall to show
// either — every one of its buttons still lands inside it.
export async function pageWithShortBoard(invoke) {
  const { page } = await invoke("get_or_create_today", {});
  await invoke("update_what_matters_now", {
    pageId: page.id,
    text: "a short titled board, and the buttons that hang past it",
  });
  await invoke("save_page_content", {
    pageId: page.id,
    contentJson: JSON.stringify({
      type: "doc",
      content: [
        {
          type: "list",
          attrs: { blockTitle: "the short board" },
          content: [
            {
              type: "listItem",
              attrs: { marker: "task", checked: false },
              content: [{ type: "paragraph", content: [{ type: "text", text: "first task" }] }],
            },
            {
              type: "listItem",
              attrs: { marker: "task", checked: false },
              content: [{ type: "paragraph", content: [{ type: "text", text: "second task" }] }],
            },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "a line under the board." }] },
        { type: "paragraph", content: [{ type: "text", text: "and one more under that." }] },
      ],
    }),
  });
}

// Task 6 — one fixture per board type that had zero VR presence before this
// pass, plus the two EMPTY variants that are the regression photograph for
// Task 1's chip-tap bug (an empty chart/table used to open no sheet at all).
// Each follows pageWithBoardContent's own recipe: a page, a focus line, one
// board plus a paragraph before and after, seeded through save_page_content.

// A 3x2 table (header row + 2 body rows), titled, cells filled with short
// words — the shape the touch action-sheet's title-row and convert-absence
// assertions (BLOCK_ACTIONS_SHEET_TOUCH) need a real filled table to prove.
export async function pageWithTableContent(invoke) {
  const { page } = await invoke("get_or_create_today", {});
  await invoke("update_what_matters_now", {
    pageId: page.id,
    text: "a table with a title, and short filled cells",
  });
  await invoke("save_page_content", {
    pageId: page.id,
    contentJson: JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a line before the table." }] },
        {
          type: "table",
          attrs: { blockTitle: "ingredients on hand" },
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "item" }] }] },
                { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "qty" }] }] },
              ],
            },
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "flour" }] }] },
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "two" }] }] },
              ],
            },
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "salt" }] }] },
                { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] },
              ],
            },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "a line after the table." }] },
      ],
    }),
  });
}

// A 2x2 table with every cell blank and no blockTitle set — the actual repro
// shape of Task 1's bug (tapping the chip on an empty table used to open no
// sheet at all; it now opens with title + delete only, no pin/copy/convert).
export async function pageWithEmptyTable(invoke) {
  const { page } = await invoke("get_or_create_today", {});
  await invoke("update_what_matters_now", {
    pageId: page.id,
    text: "a table with nothing filled in yet",
  });
  await invoke("save_page_content", {
    pageId: page.id,
    contentJson: JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a line before the table." }] },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableHeader", content: [{ type: "paragraph" }] },
                { type: "tableHeader", content: [{ type: "paragraph" }] },
              ],
            },
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "paragraph" }] },
                { type: "tableCell", content: [{ type: "paragraph" }] },
              ],
            },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "a line after the table." }] },
      ],
    }),
  });
}

// A filled flowchart — chart had named CHART_BUILDER states (the modal) but
// never a rendered-block fixture at all, so the chip-tap → action-sheet path
// on an actual chart node had zero VR coverage.
export async function pageWithChartContent(invoke) {
  const { page } = await invoke("get_or_create_today", {});
  await invoke("update_what_matters_now", {
    pageId: page.id,
    text: "a flowchart with real labels",
  });
  await invoke("save_page_content", {
    pageId: page.id,
    contentJson: JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a line before the chart." }] },
        {
          type: "chart",
          attrs: {
            kind: "flowchart",
            blockTitle: "the release path",
            source: {
              direction: "TB",
              nodes: [
                { id: "a", label: "draft", shape: "rect" },
                { id: "b", label: "ship", shape: "rounded" },
              ],
              edges: [{ from: "a", to: "b", label: "review" }],
            },
          },
        },
        { type: "paragraph", content: [{ type: "text", text: "a line after the chart." }] },
      ],
    }),
  });
}

// emptySource("flowchart") — same shape ChartBuilder hands a fresh chart of
// this kind, all labels blank. The other half of Task 1's repro: an empty
// CHART used to open no action sheet either.
export async function pageWithEmptyChart(invoke) {
  const { page } = await invoke("get_or_create_today", {});
  await invoke("update_what_matters_now", {
    pageId: page.id,
    text: "a chart with nothing filled in yet",
  });
  await invoke("save_page_content", {
    pageId: page.id,
    contentJson: JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a line before the chart." }] },
        {
          type: "chart",
          attrs: { kind: "flowchart", source: emptySource("flowchart") },
        },
        { type: "paragraph", content: [{ type: "text", text: "a line after the chart." }] },
      ],
    }),
  });
}

// recipeBlock — given / do (a 2-step ordered list) / result, all filled.
export async function pageWithRecipeContent(invoke) {
  const { page } = await invoke("get_or_create_today", {});
  await invoke("update_what_matters_now", {
    pageId: page.id,
    text: "a recipe block, given/do/result all filled",
  });
  await invoke("save_page_content", {
    pageId: page.id,
    contentJson: JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a line before the block." }] },
        {
          type: "recipeBlock",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "given a cold start" }] },
            {
              type: "list",
              content: [
                {
                  type: "listItem",
                  attrs: { marker: "ordered" },
                  content: [{ type: "paragraph", content: [{ type: "text", text: "warm the pan" }] }],
                },
                {
                  type: "listItem",
                  attrs: { marker: "ordered" },
                  content: [{ type: "paragraph", content: [{ type: "text", text: "add the batter" }] }],
                },
              ],
            },
            { type: "paragraph", content: [{ type: "text", text: "produce an even pancake" }] },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "a line after the block." }] },
      ],
    }),
  });
}

// qaBlock — two qaPairs, both fully answered.
export async function pageWithQaContent(invoke) {
  const { page } = await invoke("get_or_create_today", {});
  await invoke("update_what_matters_now", {
    pageId: page.id,
    text: "two questions, both answered",
  });
  await invoke("save_page_content", {
    pageId: page.id,
    contentJson: JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a line before the block." }] },
        {
          type: "qaBlock",
          content: [
            {
              type: "qaPair",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "why does the page sink by default?" }] },
                { type: "paragraph", content: [{ type: "text", text: "so writing stays honest." }] },
              ],
            },
            {
              type: "qaPair",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "what keeps the pins from piling up?" }] },
                { type: "paragraph", content: [{ type: "text", text: "unpinning — pins sink too." }] },
              ],
            },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "a line after the block." }] },
      ],
    }),
  });
}

// decisionBlock (content: "block paragraph paragraph") — considered is a
// 2-item bullet list, chose and because are both filled paragraphs. See
// src/lib/extensions/decision-block.js for the exact slot order.
export async function pageWithDecisionContent(invoke) {
  const { page } = await invoke("get_or_create_today", {});
  await invoke("update_what_matters_now", {
    pageId: page.id,
    text: "a decision block, considered/chose/because all filled",
  });
  await invoke("save_page_content", {
    pageId: page.id,
    contentJson: JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a line before the block." }] },
        {
          type: "decisionBlock",
          content: [
            {
              type: "list",
              content: [
                {
                  type: "listItem",
                  attrs: { marker: "bullet" },
                  content: [{ type: "paragraph", content: [{ type: "text", text: "keep the discrete trail" }] }],
                },
                {
                  type: "listItem",
                  attrs: { marker: "bullet" },
                  content: [{ type: "paragraph", content: [{ type: "text", text: "switch to continuous" }] }],
                },
              ],
            },
            { type: "paragraph", content: [{ type: "text", text: "switch to continuous" }] },
            { type: "paragraph", content: [{ type: "text", text: "it is one topic that keeps growing" }] },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "a line after the block." }] },
      ],
    }),
  });
}

// The CURRENT `attachment` node, kind "image", inline inside a paragraph
// (same position deadImageRef's legacy localImage occupies). The VR mock's
// attachment_local_src always returns null (src/lib/api.js — "no blob store
// in mock mode"), so this deterministically resolves to AttachmentBlock's
// "image not on this device" fallback rather than a real bitmap — that
// fallback IS the deterministic thing this fixture photographs.
export async function pageWithImageContent(invoke) {
  const { page } = await invoke("get_or_create_today", {});
  await invoke("update_what_matters_now", {
    pageId: page.id,
    text: "a picture, referenced but not resolvable in this mock",
  });
  await invoke("save_page_content", {
    pageId: page.id,
    contentJson: JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a line before the image." }] },
        {
          type: "paragraph",
          content: [{
            type: "attachment",
            attrs: {
              kind: "image",
              blob_hash: "b7e2f5c1a9d84630b7f2c5e1a9d84630",
              filename: "the whiteboard sketch.png",
              mime_type: "image/png",
              size_bytes: 245678,
              sync: false,
              created_at: "2026-08-20T09:00:00.000Z",
              pinId: null,
              width: null,
              display: "block",
              collapsed: false,
            },
          }],
        },
        { type: "paragraph", content: [{ type: "text", text: "a line after the image." }] },
      ],
    }),
  });
}

// An `attachment` node, kind "file" — renders the compact inline file chip
// (filename, formatted size, local/synced dot). No attachmentLocalSrc call
// on this path, so nothing in the mock's blob-store gap affects it.
export async function pageWithFileContent(invoke) {
  const { page } = await invoke("get_or_create_today", {});
  await invoke("update_what_matters_now", {
    pageId: page.id,
    text: "a file, attached and shown as a compact chip",
  });
  await invoke("save_page_content", {
    pageId: page.id,
    contentJson: JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a line before the file." }] },
        {
          type: "paragraph",
          content: [{
            type: "attachment",
            attrs: {
              kind: "file",
              blob_hash: "af31c9e0d2b74815af31c9e0d2b74815",
              filename: "field-notes.pdf",
              mime_type: "application/pdf",
              size_bytes: 88214,
              sync: false,
              created_at: "2026-08-20T09:05:00.000Z",
              pinId: null,
              width: null,
              display: "block",
              collapsed: false,
            },
          }],
        },
        { type: "paragraph", content: [{ type: "text", text: "a line after the file." }] },
      ],
    }),
  });
}

export async function continuousTrail(invoke) {
  const { page } = await invoke("get_or_create_today", {});
  await invoke("update_what_matters_now", { pageId: page.id, text: "the book" });
  // This scene used to stop here — no lineage, so page.lineage_id stayed
  // null and Page.svelte read currentTrailMode as "discrete". The scene
  // rendered as an ordinary untrailed page while claiming to be the
  // continuous-trail scene, which meant VR had no coverage of continuous
  // trails at all and a pass here said nothing about them.
  const lineage = await invoke("create_lineage", {
    name: "the book",
    mode: "continuous",
    parentId: null,
  });
  await invoke("set_focus_lineage", { pageId: page.id, lineageId: lineage.id });
  await invoke("save_page_content", {
    pageId: page.id,
    contentJson: doc([
      "chapter one keeps growing because i chose to trail it.",
      "the pins keep it from becoming a wall to re-read.",
    ]),
  });
}

export const FIXTURES = {
  emptyPage,
  pageWithContent,
  pageWithBoardContent,
  pageWithShortBoard,
  pageWithTableContent,
  pageWithEmptyTable,
  pageWithChartContent,
  pageWithEmptyChart,
  pageWithRecipeContent,
  pageWithQaContent,
  pageWithDecisionContent,
  pageWithImageContent,
  pageWithFileContent,
  memoryWithPages,
  pinsRich,
  continuousTrail,
  deadImageRef,
};
