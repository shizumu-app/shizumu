import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Resolved from the vitest root rather than import.meta.url: under the
// jsdom transform import.meta.url is not a file: URL, so fileURLToPath
// throws before a single assertion runs.
const css = readFileSync(resolve(process.cwd(), "src/styles/prose.css"), "utf8");
const globalCss = readFileSync(resolve(process.cwd(), "src/styles/global.css"), "utf8");

/**
 * Lora's own metrics, measured in the browser at each heading's size:
 * ink height / font size is 1.269 at 26px, 1.273 at 22px, 1.263 at 19px.
 * That is the font's ascent + descent, so a line-height below it makes the
 * line box SHORTER than the glyphs it holds — ascenders and descenders
 * then paint outside the box and are cut off top and bottom wherever
 * anything clips. This is a real reported symptom, not a hypothetical.
 *
 * The floor is set a little above the measured 1.273 so a different
 * engine's font metrics (webkit2gtk on Linux is the app's actual webview,
 * and this project has a history of it disagreeing with Chromium) has a
 * margin before it starts clipping.
 */
const LINE_HEIGHT_FLOOR = 1.3;

function headingRule(tag) {
  const m = css.match(new RegExp(`\\.prose ${tag} \\{([^}]*)\\}`));
  if (!m) throw new Error(`no .prose ${tag} rule in prose.css`);
  return m[1];
}

function lineHeightOf(tag) {
  const body = headingRule(tag);
  const m = body.match(/line-height:\s*([0-9.]+)\s*;/);
  if (!m) throw new Error(`.prose ${tag} has no unitless line-height`);
  return parseFloat(m[1]);
}

describe("heading line-height floor", () => {
  for (const tag of ["h1", "h2", "h3"]) {
    it(`${tag} keeps its line box taller than Lora's own glyphs`, () => {
      expect(lineHeightOf(tag)).toBeGreaterThanOrEqual(LINE_HEIGHT_FLOOR);
    });
  }

  it("still reads as heading leading, not body leading", () => {
    // The other half of the fix: these carried 1.7, a BODY line-height
    // applied to display type, which is what made one line of h1 occupy
    // 82px. Guarding only the floor would let that come straight back.
    for (const tag of ["h1", "h2", "h3"]) {
      expect(lineHeightOf(tag)).toBeLessThan(1.6);
    }
  });
});

/**
 * The block-title slot is the same class of bug in a worse place: it is an
 * <input> that CLIPS (overflow: hidden, so the reveal can transition
 * max-height), so a line box under the font's own ink cuts the title top
 * and bottom with no scrollbar and no other symptom.
 *
 * Italic Lora at the slot's rendered 12.48px measures 17px of ink — ratio
 * 1.362, taller than the roman 1.27 the headings deal with. It carried
 * 1.9, which built a 23.7px box around 17px of text: 6.7px of dead space
 * on a caption, and its own scrollHeight already rounding to the same
 * pixel as its box.
 */
const TITLE_SLOT_FLOOR = 1.45;

function titleSlotRule() {
  const m = globalCss.match(/\.ProseMirror \.board-title-slot \{([\s\S]*?)\n\}/);
  if (!m) throw new Error("no .ProseMirror .board-title-slot rule in global.css");
  return m[1];
}

describe("block-title slot line-height floor", () => {
  it("keeps the slot's line box taller than italic Lora's ink", () => {
    const m = titleSlotRule().match(/\n\s*line-height:\s*([0-9.]+)\s*;/);
    expect(m, "board-title-slot has no unitless line-height").not.toBeNull();
    expect(parseFloat(m[1])).toBeGreaterThanOrEqual(TITLE_SLOT_FLOOR);
  });

  it("does not go back to a caption with more air than text", () => {
    const m = titleSlotRule().match(/\n\s*line-height:\s*([0-9.]+)\s*;/);
    expect(parseFloat(m[1])).toBeLessThan(1.8);
  });

  it("keeps the reveal cap clear of the content it reveals", () => {
    // max-height exists only to give the reveal something to animate from
    // 0 to. Sized close to the content it becomes the thing that decides
    // the title's height — and the element clips, so that is a cut-off
    // waiting for an engine that measures <input> differently. It was
    // 2.6em against a 1.9 line box; both numbers moved apart.
    // Only the rules that actually reveal this slot — global.css has other
    // max-heights that have nothing to do with it.
    const caps = globalCss
      .split("}")
      .filter((chunk) => chunk.includes("board-title-slot"))
      .flatMap((chunk) => [...chunk.matchAll(/max-height:\s*([0-9.]+)em;/g)])
      .map((m) => parseFloat(m[1]));
    expect(caps.length, "found no board-title-slot max-height rules").toBeGreaterThan(0);
    for (const cap of caps) expect(cap).toBeGreaterThanOrEqual(2.8);
  });
});
