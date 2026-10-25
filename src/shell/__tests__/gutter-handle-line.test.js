import { describe, it, expect } from "vitest";
import {
  handleTop, lineHeightPx, tapPx, handleAnchor, TAP_FLOOR_PX, NORMAL_LINE_HEIGHT,
} from "../gutter-handle-line.js";

// The numbers are the phone's: a prose paragraph is 16px × 1.6 = 25.6px a
// line (prose.css), a heading is its own size × 1.45, and the tap box is
// --tap's 44px floor. Every expected value is derived by hand beside its
// assertion rather than by calling the function — a caption computed by
// the module it describes cannot disagree with it.
describe("handleTop", () => {
  it("lifts the column so a paragraph's first line and the tap box share a centre", () => {
    // (25.6 − 44) / 2 = −9.2. The block's top is 40; the column's top is
    // 30.8, so the box 30.8..74.8 is centred at 52.8 — which is exactly
    // 40 + 25.6/2, the first line's centre. The old placement put the
    // column at 40 and its centre at 62, nine pixels into the second line.
    expect(handleTop({ blockTop: 40, firstLineHeight: 25.6, tapPx: 44 })).toBeCloseTo(30.8, 10);
  });

  it("lifts a heading less, because its line is taller", () => {
    // h2: 1.5em × 16px = 24px, × 1.45 = 34.8px a line. (34.8 − 44) / 2 =
    // −4.6. A hardcoded 25.6 would have answered 30.8 here and put the
    // heading's handle 4.6px above its line's centre.
    expect(handleTop({ blockTop: 40, firstLineHeight: 34.8, tapPx: 44 })).toBeCloseTo(35.4, 10);
  });

  it("moves the column DOWN when the line is taller than the tap box", () => {
    // A 60px line: (60 − 44) / 2 = +8. Same formula, sign the other way —
    // the centre is still the line's centre (40 + 30 = 70 = 48 + 22).
    expect(handleTop({ blockTop: 40, firstLineHeight: 60, tapPx: 44 })).toBe(48);
  });

  it("reads the tap box's size rather than assuming 44", () => {
    // --tap is the larger of the design's touch token and 44px: larger
    // where that token is larger.
    // (25.6 − 48) / 2 = −11.2.
    expect(handleTop({ blockTop: 40, firstLineHeight: 25.6, tapPx: 48 })).toBeCloseTo(28.8, 10);
  });

  it("sits at the block's top when the line could not be measured", () => {
    // Not "nothing happens": the block's top is the OLD placement, chosen
    // here because it is the honest bound of the error when the line is
    // unknown — the glyph is then within one tap box of its line, which a
    // guessed line height could not promise — and because the alternative
    // is `top: NaNpx`, which the browser drops and which parks the column
    // at the canvas's top beside a block it does not belong to. jsdom
    // reaches this branch unless a test stubs the computed style, which is
    // why PageScreen.test.js stubs it.
    expect(handleTop({ blockTop: 40, firstLineHeight: null, tapPx: 44 })).toBe(40);
  });
});

describe("lineHeightPx", () => {
  it("takes a resolved px value as it is", () => {
    // What every browser returns for a number or a length: the used value.
    expect(lineHeightPx({ lineHeight: "25.6px", fontSize: "16px" })).toBe(25.6);
  });

  it("multiplies a unitless number by the font size", () => {
    // jsdom hands an inline `line-height: 1.6` back unresolved.
    expect(lineHeightPx({ lineHeight: "1.6", fontSize: "16px" })).toBeCloseTo(25.6, 10);
  });

  it("estimates `normal` from the font size", () => {
    expect(lineHeightPx({ lineHeight: "normal", fontSize: "20px" })).toBeCloseTo(
      NORMAL_LINE_HEIGHT * 20, 10,
    );
  });

  it("answers null when there is nothing to read", () => {
    // Null and not 0 or a default: the caller's fallback is the block's top,
    // and a 0 here would centre the tap box on the block's top edge — half
    // of it above the block, which is worse than the defect being fixed.
    // Every form below is what jsdom or a detached element can produce.
    expect(lineHeightPx({ lineHeight: "", fontSize: "16px" })).toBeNull();
    expect(lineHeightPx({ lineHeight: undefined, fontSize: "16px" })).toBeNull();
    expect(lineHeightPx({ lineHeight: "1.6", fontSize: "" })).toBeNull();
    expect(lineHeightPx({ lineHeight: "normal", fontSize: "" })).toBeNull();
    // Bare jsdom's actual answer, measured: `normal` over the keyword
    // `medium`, which no ratio can be multiplied by.
    expect(lineHeightPx({ lineHeight: "normal", fontSize: "medium" })).toBeNull();
    expect(lineHeightPx({ lineHeight: "0px", fontSize: "16px" })).toBeNull();
  });
});

describe("tapPx", () => {
  it("reads the canvas's resolved left padding, which is var(--tap)", () => {
    expect(tapPx("44px")).toBe(44);
    expect(tapPx("48.125px")).toBe(48.125);
  });

  it("falls back to the token's 44px floor when the padding cannot be read", () => {
    // The floor, not a guess: --tap is the larger of the design's touch
    // token and 44px, so 44 is the one number the real value can never be
    // under. Bare jsdom answers "0" for the canvas's padding.
    expect(TAP_FLOOR_PX).toBe(44);
    expect(tapPx("")).toBe(44);
    expect(tapPx(undefined)).toBe(44);
    expect(tapPx("0px")).toBe(44);
  });
});

describe("handleAnchor", () => {
  const block = (contains) => ({ contains: (el) => contains.includes(el) });

  it("lines the column up with the caret's own line inside a container", () => {
    // THE DEFECT, reproduced on a device: in a table every cell reported the
    // same top-level `table@20` and the handle never left the table's first
    // row. The caret's chain there was div>table>tbody>tr>td>p — five levels
    // below the node the handle addresses.
    const line = { id: "cell" };
    expect(handleAnchor(block([line]), line)).toBe(line);
  });

  it("falls back to the block when the line is not inside it", () => {
    // Not defensive clutter: a line element left over from the previous
    // selection would drag the column to a block the handle does not
    // address, which is worse than the defect — it would point at the wrong
    // thing rather than at a coarse one.
    const stray = { id: "elsewhere" };
    const b = block([]);
    expect(handleAnchor(b, stray)).toBe(b);
  });

  it("uses the block when there is no line, which is the old behaviour", () => {
    const b = block([]);
    expect(handleAnchor(b, null)).toBe(b);
    expect(handleAnchor(b, b)).toBe(b);
  });

  it("answers null only when there is no block at all", () => {
    expect(handleAnchor(null, { id: "x" })).toBeNull();
  });
});
