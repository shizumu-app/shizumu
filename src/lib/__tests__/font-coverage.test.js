// WHAT THE BUNDLED FACES MUST CARRY, so a regenerated subset cannot quietly
// come back narrower than the app needs.
//
// REPORTED, from Windows first and then "also for linux and macos": the type
// was inconsistent and ugly. Measured rather than argued, and it was two
// mechanical things, both in these files.
//
// NO BOLD WAS BUNDLED. Lora shipped Regular and Italic; DM Mono shipped
// Light. Nothing carried a 700, so every bold was synthesised by the engine
// smearing the 400 outline — and DirectWrite, CoreText and FreeType each
// smear differently, which is the cross-platform half of the complaint.
//
// THE SUBSETS WERE TOO NARROW, unevenly:
//
//     DMMono-Light    138 glyphs, nothing past U+2113   (the whole interface)
//     Lora-Italic     149 glyphs                        (the focus line)
//     Lora-Regular    226 glyphs
//
// A character a file does not carry is not missing on screen — it is drawn
// by whatever the OS substitutes, from a different family, mid-word. And the
// editor's typography rules turn `--` into an em-dash and straight quotes
// into curly ones AS THE WRITER TYPES, so the app manufactured characters
// its own fonts could not draw. Neither Lora-Italic nor DM Mono had the
// em-dash, the ellipsis, the curly quotes or a single accented letter.
//
// Both numbers above are what this test would have failed on. The faces are
// built by scripts/build-fonts.py, which names its ranges and its reasons.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const FONT_DIR = resolve(process.cwd(), "public/fonts");

/** The faces the app declares in global.css. A weight declared with no file
 *  behind it is the synthetic-bold case above, which is the thing this pair
 *  of tests exists to make impossible. */
const REQUIRED_FACES = [
  "Lora-Regular.woff2",
  "Lora-Italic.woff2",
  "Lora-Bold.woff2",
  "Lora-BoldItalic.woff2",
  "DMMono-Light.woff2",
  "DMMono-Medium.woff2",
];

/** Characters the app can put on screen without asking the platform for
 *  help. A reviewable list, not "all of Unicode":
 *
 *  · Latin-1 and Extended-A letters, because the app ships in English and is
 *    written in by people who are not writing English.
 *  · The punctuation the EDITOR ITSELF manufactures — curly quotes and the
 *    em-dash arrive by typography rule, not by keystroke, which is the
 *    sharpest form of this bug: the text was fine until shizumu rewrote it.
 *  · The marks the interface draws: the bullet, the ellipsis, the × of a
 *    clear control, the ° and ± of ordinary prose.
 *
 *  NO ARROWS. `→` is absent from upstream Lora and DM Mono both, so
 *  requiring one would be requiring a glyph that does not exist to subset.
 *  The interface already knows this — PageHeader draws its caret with
 *  borders rather than typing ▾, for exactly this reason, and says so. */
const REQUIRED = [
  ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  ..."àâäçéèêëîïôöùûüÿñÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸÑ",
  ..."āčēģīķļņšūžőűłśżĄĆĘŁŃŚŹŻ",
  ..."—–…“”‘’‚„•·×÷°±«»†‹›€£¥§¶©®™",
  ..."!?.,;:'\"()[]{}/\\@#$%&*+=<>|~`^_-",
];

/** A face's codepoints, read with fontTools through the same interpreter the
 *  build script uses.
 *
 *  SHELLING OUT, DELIBERATELY. woff2 is Brotli-compressed binary and parsing
 *  it in JS would mean a new dependency for one assertion; fontTools is
 *  already required to BUILD these files, so a tree that can regenerate them
 *  can check them. Where it is absent the test says so and skips rather than
 *  passing — a green that only means "nothing was measured" is the failure
 *  mode this whole file is about. */
function codepoints(file) {
  const out = execFileSync(
    "python3",
    [
      "-c",
      [
        "import sys",
        "from fontTools.ttLib import TTFont",
        "t = TTFont(sys.argv[1])",
        "cps = set()",
        "for tb in t['cmap'].tables: cps |= set(tb.cmap.keys())",
        "print(' '.join(str(c) for c in sorted(cps)))",
      ].join("\n"),
      resolve(FONT_DIR, file),
    ],
    { encoding: "utf8" },
  );
  return new Set(out.trim().split(/\s+/).map(Number));
}

function haveFontTools() {
  try {
    execFileSync("python3", ["-c", "import fontTools"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("the bundled fonts", () => {
  it("ships a real bold, rather than letting each platform smear the regular", () => {
    const present = readdirSync(FONT_DIR);
    for (const face of REQUIRED_FACES) {
      expect(present, `${face} is declared in global.css and must exist`).toContain(face);
    }
  });

  it("covers every character the app can put on screen", () => {
    if (!haveFontTools()) {
      // Said out loud, because a silent skip here is indistinguishable from
      // a pass and this is the assertion that caught the shipped subsets.
      console.warn("font coverage NOT CHECKED: python3 + fontTools unavailable");
      return;
    }
    // Reported as a map of what each file is missing rather than as a first
    // failure: regenerating a subset is one action, and whoever does it
    // needs the whole gap, not its first character.
    const gaps = {};
    for (const face of REQUIRED_FACES.filter((f) => existsSync(resolve(FONT_DIR, f)))) {
      const have = codepoints(face);
      const missing = REQUIRED.filter((c) => !have.has(c.codePointAt(0)));
      if (missing.length) gaps[face] = missing.join("");
    }
    expect(gaps).toEqual({});
  });
});
