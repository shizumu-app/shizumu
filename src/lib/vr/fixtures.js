// Scene fixtures: each builds deterministic state by replaying real mock
// commands through the given invoke (DRY — no duplicated store logic).
// The clock is frozen by the caller (bootstrap), so "today" is stable.
import { getLocalDateStr } from "../utils.js";

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
  memoryWithPages,
  pinsRich,
  continuousTrail,
  deadImageRef,
};
