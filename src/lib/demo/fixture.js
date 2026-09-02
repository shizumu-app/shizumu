// The workspace a visitor to /try arrives in.
//
// Built by replaying real mock commands, the same way src/lib/vr/fixtures.js
// does, so there is no second copy of the store's rules. Unlike those, this
// one is built against the REAL clock: a VR fixture exists to be frozen, and
// a demo whose newest page is dated three months ago teaches the wrong thing
// about a writing app.
//
// Today's page is deliberately left empty and untrailed. That is what puts
// the demo's whole point two clicks away: the visitor types, chooses the book
// trail, and the pins they never wrote arrive on the page.

/** Bump when the SHAPE changes (a trail, a command, a pin structure), never
 *  for prose. A bump reseeds returning visitors and takes what they wrote. */
export const SEED_VERSION = 2;

export function daysBefore(now, n) {
  const d = new Date(now.getTime());
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// Block builders. These emit the schema the app SAVES, which for lists is the
// unified `list` / `listItem` with a `marker` attr — not `taskList` /
// `taskItem`. Those still load, but only by way of migrate-list-schema.js, and
// a fresh fixture written in the legacy shape would be a fixture that needs
// migrating on every single boot.
const inline = (t) => (t ? [{ type: "text", text: t }] : []);
const p = (t) => ({ type: "paragraph", content: inline(t) });
const h = (t) => ({ type: "heading", attrs: { level: 2 }, content: inline(t) });
const quote = (t) => ({ type: "blockquote", content: [p(t)] });
const rule = () => ({ type: "horizontalRule" });

/** `blockTitle` is a real slot on the block, and the search walker indexes it. */
const listOf = (marker, title, items) => ({
  type: "list",
  attrs: title ? { blockTitle: title } : {},
  content: items.map((item) => {
    const [text, checked] = Array.isArray(item) ? item : [item];
    return {
      type: "listItem",
      attrs: marker === "task" ? { marker, checked: !!checked } : { marker },
      content: [p(text)],
    };
  }),
});
const tasks = (title, items) => listOf("task", title, items);
const bullets = (title, items) => listOf("bullet", title, items);

/** A bare string is a paragraph, so prose-only pages stay readable as prose. */
function doc(nodes) {
  return JSON.stringify({
    type: "doc",
    content: nodes.map((n) => (typeof n === "string" ? p(n) : n)),
  });
}

async function pageOn(invoke, date, lineageId, focus, nodes) {
  const { page } = await invoke("create_new_page", { date });
  if (lineageId) await invoke("set_focus_lineage", { pageId: page.id, lineageId });
  if (focus) await invoke("update_what_matters_now", { pageId: page.id, text: focus });
  await invoke("save_page_content", { pageId: page.id, contentJson: doc(nodes) });
  return page;
}

async function carriedPin(invoke, lineageId, sourcePageId, title, content) {
  const pin = await invoke("create_pin", {
    lineageId, sourcePageId, objectType: "note", content, title,
  });
  await invoke("update_pin_auto_insert", { id: pin.id, autoInsert: true });
  return pin;
}

/**
 * @param {(cmd: string, args?: any) => Promise<any>} invoke
 * @param {Date} now
 */
export async function seedDemo(invoke, now) {
  await invoke("mark_onboarding_complete", {});
  await invoke("set_setting", { key: "mobile_gestures_tip_seen", value: "true" });

  const book = await invoke("create_lineage", { name: "book", mode: "discrete" });
  const letters = await invoke("create_lineage", { name: "letters", mode: "discrete" });

  const p30 = await pageOn(invoke, daysBefore(now, 30), book.id, "who is telling this", [
    h("the narrator problem"),
    "the narrator knows more than she says, and the reader has to feel the gap.",
    "if she explains herself once, the whole book turns into an explanation.",
  ]);
  const p17 = await pageOn(invoke, daysBefore(now, 17), book.id, "the harbour chapter", [
    "the harbour at dusk, and nobody in it who wants to be there.",
    quote("the boats are the only thing in the chapter that still has somewhere to go."),
    rule(),
    tasks("before the next pass", [
      ["cut the second description of the light", true],
      ["name the harbour, or decide it stays unnamed", true],
      ["the fisherman gets one line, not three", false],
      ["check the tide turns when i say it turns", false],
    ]),
  ]);
  const p9 = await pageOn(invoke, daysBefore(now, 9), book.id, "what the middle is for", [
    "the middle is not a bridge between two good scenes. it is where she decides.",
    bullets("the three she could choose", [
      "stay, and tell him nothing",
      "stay, and tell him everything",
      "leave before the harbour empties",
    ]),
  ]);
  await pageOn(invoke, daysBefore(now, 3), book.id, "cut the second ending", [
    "two endings means i did not believe the first one.",
  ]);

  await carriedPin(invoke, book.id, p30.id, "the rule", "she never explains herself. not once.");
  await carriedPin(invoke, book.id, p17.id, "image to keep", "the boats are the only thing that still has somewhere to go.");
  await carriedPin(invoke, book.id, p9.id, "the question", "what does she decide in the middle, and what does it cost her.");

  // The task-shaped trail. A book is the canonical trail and a job search is
  // the other one CLAUDE.md names, which is the honest place for checkboxes:
  // they belong to a project that produces them, not sprinkled over a novel.
  const jobs = await invoke("create_lineage", { name: "job search", mode: "discrete" });

  const j24 = await pageOn(invoke, daysBefore(now, 24), jobs.id, "what i actually want", [
    "the last two years i took what was offered. this time i get to choose, and i should act like it.",
    bullets("not negotiable", [
      "writing time that survives a bad week",
      "people who read what they publish",
      "somewhere i can say i do not know",
    ]),
    "everything under that line is negotiable. i keep pretending it is all one list.",
  ]);
  await pageOn(invoke, daysBefore(now, 14), jobs.id, "the shortlist", [
    tasks("sent, or not yet", [
      ["the university reader post", true],
      ["the small press, editorial", true],
      ["the magazine, still drafting the letter", false],
      ["the agency, decide whether to bother at all", false],
    ]),
    "three of the four want a covering letter. the letter's whole job is to sound like a person.",
  ]);
  const j6 = await pageOn(invoke, daysBefore(now, 6), jobs.id, "after the second interview", [
    "they asked what i would cut first, and i had an answer ready, which told me something.",
    quote("the answer i gave them is the one i have been avoiding giving myself."),
    rule(),
    tasks("this week", [
      ["send the reading sample", true],
      ["ask about the teaching load before saying yes", false],
      ["write back to the press even if the answer is no", false],
    ]),
  ]);

  await carriedPin(invoke, jobs.id, j24.id, "the test", "does the work survive a bad week. if it does not, it is not the job.");
  await carriedPin(invoke, jobs.id, j6.id, "before saying yes", "ask about the teaching load, and what happened to the last person in the role.");

  await pageOn(invoke, daysBefore(now, 12), letters.id, "the reply to m", [
    "say the thing plainly. the softening is for me, not for her.",
  ]);
  await pageOn(invoke, daysBefore(now, 5), letters.id, "unsent", [
    "wrote it, read it back, and the anger was doing the arguing.",
  ]);

  await pageOn(invoke, daysBefore(now, 21), null, "a day that was not part of anything", [
    "read most of the afternoon. nothing to keep, which is most days.",
  ]);
  await pageOn(invoke, daysBefore(now, 8), null, null, [
    "the shape of an argument i am not ready to make yet.",
  ]);

  // Last, so it is today's newest page and the one the app opens on.
  await invoke("get_or_create_today", {});
}
