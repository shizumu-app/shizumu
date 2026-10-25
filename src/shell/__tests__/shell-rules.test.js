import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

// The shell's structural rules, enforced by test because five mobile passes
// proved convention does not hold. Each rule below is a bug class that
// reached a device:
//
//  - raw <button>: sub-44px targets. The primitives carry the floor; a bare
//    button opts out of it silently.
//  - env(safe-area): the shell root pads for the inset ONCE. A surface that
//    re-adds it double-counts — memory's list sat ~50px too low for a
//    release because of exactly this.
//  - visualViewport: keyboard-state.js is the app's single viewport owner.
//    A second subscriber re-creates the hidden-field/latched-bar desync.
//  - @media (max-width): the shell IS the phone tree. A width branch inside
//    it means a second layout nobody screenshots.
//  - position: fixed: only Sheet and the shell root may leave the flow;
//    anything else lands on top of prose, which is the controls-over-content
//    class the whole shell exists to end.
//  - var(--spring) beside a var(--motion-*) token in one transition: both
//    tokens already END in an easing function, and the shorthand accepts
//    one. The pair makes the declaration invalid, so it is dropped WHOLE
//    and the animation silently never runs — Sheet's detents snapped for
//    as long as that rule stood, and neither jsdom nor the VR harness
//    could see it.
//  - imports from src/components/, src/lib/ui/ and the rest of src/lib/:
//    the shell borrows LOGIC freely and components only from three named
//    lists — the opinion-free leaves, the allowlisted hosts, and one
//    renderer — and owns all its own chrome. A desktop component imported
//    here drags its desktop assumptions in with it.

const SHELL = "src/shell";

// Spec §4 allows three hosts: `EditorCore`, `ChartBuilder` FORMS,
// `QrScanner`. The middle one is a plural in the spec and it decides which
// files belong here. `ChartBuilder.svelte` itself is the desktop MODAL —
// Modal frame, kind tabs, save/cancel footer, Mermaid preview — and §3
// re-hosts the forms while replacing that frame, so the shell imports the
// three per-kind form components and never the orchestrator above them.
//
// The orchestrator's name stood on this list from the day the list was
// written (a116c8bb) until P2f-2 Task 5, when something finally imported
// from this directory and the distinction became load-bearing. It is
// corrected rather than widened: allowing the modal would allow a
// `position: fixed` overlay into the one tree whose only overlay is Sheet.
//
// The components BENEATH the forms — NodeShapePicker, ConnectionChip,
// BranchTree — are not listed and do not need to be: `importedPaths` reads
// each shell file's own import statements, so a transitive import is
// invisible to this rule. That is a limit of the scan, not a permission,
// and it is the reason ChartForm.svelte declares the 44px floor over the
// whole borrowed subtree itself.
const COMPONENT_ALLOWLIST = [
  "components/editor/EditorCore.svelte",
  "components/chart/ChartFormFlowchart.svelte",
  "components/chart/ChartFormMindmap.svelte",
  "components/chart/ChartFormTimeline.svelte",
  "components/QrScanner.svelte",
];

const UI_LEAF_ALLOWLIST = ["Icon", "Toggle", "SegmentedControl", "Empty", "Divider"];

// The rules below cover `src/components/` and `src/lib/ui/`, and until P3
// Task 4 those were the only two directories a `.svelte` could reach the
// shell from. The reading view opened a third:
// `src/lib/render/ProseHTML.svelte`, which renders one page's writing as
// static prose over the desktop's own READONLY_EXTENSIONS. It belongs on a
// list for the same reason the five leaves do — it is opinion-free, it
// renders no chrome, and a shell copy would be a second doc renderer whose
// schema could drift from the editor's.
//
// It gets a rule of its own rather than being waved through, because the
// hole is wider than the file: `src/lib/` outside `ui/` holds exactly one
// `.svelte` today, and with no scan looking at that directory the next one
// to land there would be importable with nothing to say so. Matched from
// `lib/` onward; `lib/ui/**` is excluded here because it has its own rule.
const LIB_SVELTE_ALLOWLIST = ["lib/render/ProseHTML.svelte"];

// Only these two files may hold `position: fixed`. Sheet is the one overlay;
// ShellRoot is the frame everything else lives inside.
const FIXED_ALLOWLIST = ["src/shell/ui/Sheet.svelte", "src/shell/ShellRoot.svelte"];

// Boundary before `position:` so `background-position: fixed` (a real,
// unrelated declaration) is not mistaken for the banned rule.
const POSITION_FIXED_RE = /(?<![\w-])position:\s*fixed/;

// One `transition` declaration's value, up to the `;` (or the `}` that ends
// the last declaration in a block). Deliberately not comma-split: a
// cubic-bezier() carries commas of its own, so splitting on them would
// shred a value rather than segment it. The cost of the whole-declaration
// span is that `transition: height var(--motion-normal), transform 200ms
// var(--spring)` — legal, since --spring pairs with a bare duration there —
// would also trip this rule. The shell has no such declaration and pairing
// the two tokens in one rule is never what an author means, so the honest
// trade is the coarse span with its limit written down.
const TRANSITION_DECL_RE = /transition:[^;}]*/g;

// Block comments are stripped before the scan above runs, and only for that
// scan. Stack.svelte:256-271 documents this exact defect by quoting the
// broken form, which is the behaviour to reward — a text scan that read
// comments would go red on the one file that got it right and would make
// writing the lesson down cost a failing build. Comments animate nothing,
// so judging declarations only loses no coverage. `/* */` alone, not `//`:
// stripping line comments would eat the `//` inside every `https://` URL.
const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;

// Matches an import specifier from EITHER static (`from "x"` / `from 'x'`)
// or dynamic (`import("x")` / `import('x')`) syntax. A rule that only
// matched `from "..."` let `await import("../components/X.svelte")` —
// already the idiom App.svelte uses to lazy-load a desktop component —
// through silently.
const IMPORT_RE = /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g;

// The specifier's path from `marker` onward (e.g. "components/Foo.svelte"),
// for exact comparison against an allowlist — not `endsWith`, which would
// let a wrong-directory file match by matching only its filename tail.
function importedPaths(src, marker) {
  return [...src.matchAll(IMPORT_RE)]
    .map((m) => m[1])
    .map((spec) => {
      const idx = spec.indexOf(marker);
      return idx === -1 ? null : spec.slice(idx);
    })
    .filter((tail) => tail !== null);
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|svelte|css|ts)$/.test(f)) out.push(p);
  }
  return out;
}

function shellFiles() {
  return walk(SHELL).filter((p) => !p.includes("__tests__"));
}

function offenders(predicate) {
  return shellFiles().filter((p) => predicate(readFileSync(p, "utf8"), p));
}

describe("shell rules", () => {
  it("actually finds files to scan — a rule that fails closed on nothing is not failing closed", () => {
    // `walk` returns [] when `src/shell` does not exist, which makes
    // shellFiles() empty and every `toEqual([])` below pass VACUOUSLY. This
    // guard's entire purpose is to fail the build when the tree is renamed
    // or vitest runs from an unexpected cwd — the exact case where an empty
    // scan result would otherwise look identical to "the rules held".
    expect(shellFiles().length).toBeGreaterThan(0);
  });

  it("uses no raw <button> — every control is a primitive with the 44px floor", () => {
    // Empty is the only correct result: PRIMITIVE_BUTTON_FILES at the foot
    // of this file names every file where a real <button> may exist, and
    // they live in src/shell/ui/ where this rule still applies — they
    // render one via the primitives' own markup, which this scan reads.
    // See Step 3.
    expect(offenders((src, p) => /<button/.test(src) && !isPrimitiveButton(p))).toEqual([]);
  });

  it("holds every button-rendering primitive to the 44px floor", () => {
    // The allowlist above is why the raw-<button> rule can be satisfied at
    // all, so it must cost something: a primitive permitted to render a
    // button has to declare the floor the rule exists to protect.
    //
    // This checks for `var(--tap)`, not `var(--touch-target)`. The bare
    // token is 2.75rem, which resolves to 38.5px at the phone's default
    // --ui-scale (0.875) — under the 44px minimum the whole shell exists
    // to guarantee. A version of this test that accepted `--touch-target`
    // was worse than no test at all: it was green on every primitive in
    // the codebase while every one of them shipped a sub-44px target,
    // because it rewarded citing the token's name rather than the floor
    // it actually resolves to. `--tap` is `max(var(--touch-target), 44px)`
    // (global.css) — the only form that holds at every scale.
    //
    // What this catches: forgetting the floor entirely, and stripping it
    // in a refactor. What it does NOT catch: the token applied to some
    // other element in the file while the button itself carries a
    // hardcoded size — this is a whole-file substring check, not a
    // selector-aware one. Scoping it properly would mean parsing CSS,
    // which is brittle enough to be its own bug source; the honest trade
    // is a narrow guard with its limits written down.
    //
    // Allowlisted files that do not exist yet are skipped rather than
    // failed — they arrive across later tasks in this plan.
    const missing = PRIMITIVE_BUTTON_FILES
      .filter((p) => existsSync(p))
      .filter((p) => !readFileSync(p, "utf8").includes("var(--tap)"));
    expect(missing).toEqual([]);
  });

  it("uses no bare --touch-target anywhere in the shell", () => {
    // The presence check above says a primitive DECLARES the floor
    // somewhere in its file; it cannot say the floor is declared at every
    // site that needs it, because it is satisfied the moment `var(--tap)`
    // appears ONCE. NavBar declares var(--tap) at four sites (base bar,
    // .collapsed, and the two button rules) — reverting only the two
    // button sites back to the unfloored token left the presence check
    // green while shipping a 38.5px control, because the other two sites
    // still said `--tap`. Field.svelte and Sheet.svelte aren't even on
    // PRIMITIVE_BUTTON_FILES (they don't render a <button>), so the
    // presence check never looks at them at all — this is the only guard
    // that catches `.shell-field-input` or `.shell-sheet-handle` reverting.
    // This scan is what actually can't be defeated by a second occurrence:
    // it fails on ANY remaining `var(--touch-target)`, anywhere in the
    // shell, regardless of how many compliant sites sit next to it.
    expect(offenders((src) => src.includes("var(--touch-target)"))).toEqual([]);
  });

  it("pads --safe-bottom at the root when there is no slot", () => {
    // Spec §2: the content band is padded on top / bottom / slot. With a
    // slot, .shell-slot's own padding-bottom covers the bottom safe area.
    // Without one — every pushed Screen, every screen with a sheet open —
    // nothing else in the frame accounts for it, so the root must pad it
    // directly or the last row of content runs under the iOS home
    // indicator. ShellRoot.test.js can only prove the `.has-slot` class
    // flips (jsdom applies no scoped Svelte stylesheet, so it cannot see
    // padding); this source-text check is the real proof that the CSS
    // rule doing the padding still exists.
    const src = readFileSync("src/shell/ShellRoot.svelte", "utf8");
    expect(src.includes(":not(.has-slot)")).toBe(true);
    expect(src.includes("padding-bottom: var(--safe-bottom)")).toBe(true);
  });

  it("draws its symbols instead of typing them", () => {
    // THE BUG: a Galaxy A34 showed a 44px block handle that was in the DOM,
    // tappable, labelled — and invisible. The glyph was the character ⋮
    // (U+22EE), and the bundled DM Mono is a 138-codepoint subset ending at
    // U+2113, so every symbol in shell chrome is drawn by whatever the
    // platform substitutes. A Linux test runner substitutes DejaVu Sans
    // Mono and sees it; an Android fallback chain need not carry
    // Mathematical Operators at all, and the date button's ▾ (Geometric
    // Shapes) was the same wager.
    //
    // The rule is narrow on purpose. Latin-1 and General Punctuation — the
    // · — … ‹ › this shell leans on — are covered by every platform font
    // there is, and banning them would be a rule nobody could follow. What
    // is refused is the SYMBOL blocks: arrows, mathematical operators, box
    // drawing, geometric shapes, dingbats. Those are pictures, and a
    // picture belongs in CSS or an SVG where it cannot go missing.
    //
    // Comments are stripped first: the file headers in this tree draw their
    // own rules with box characters, and a banner nobody renders is not a
    // glyph anyone can fail to see.
    const RISKY = /[\u2190-\u21FF\u2200-\u22FF\u2500-\u257F\u25A0-\u25FF\u2600-\u27BF]/;
    const found = [];
    for (const path of shellFiles()) {
      if (!path.endsWith(".svelte")) continue;
      const src = readFileSync(path, "utf8")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(BLOCK_COMMENT_RE, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const [i, line] of src.split("\n").entries()) {
        const hit = line.match(RISKY);
        if (hit) found.push(`${path}:${i + 1} ${hit[0]}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("writes no store from inside a $derived", () => {
    // THE CRASH: PageScreen's gutterHandle published its reason with
    // `handleReadout.set(...)` from inside `$derived.by`. That write wakes
    // a `$store` auto-subscription in ViewportReadout, which updates
    // reactive state while the derived is still evaluating, and Svelte
    // throws state_unsafe_mutation. The shell rendered an empty document.
    //
    // It survived four builds because it is INVISIBLE WITHOUT A
    // SUBSCRIBER: nothing listens to those stores unless ViewportReadout is
    // mounted, which only a VITE_VIEWPORT_READOUT build does. The suite was
    // green at 2937 while every APK handed over was broken.
    //
    // A source rule, because the runtime one needs a component subscriber
    // to exist before it can fire — PageScreen.test.js has that test too,
    // and it only works because it renders ViewportReadout by hand. This
    // one needs no fixture and no flag: a derived computes, an effect
    // reports.
    const offenders = [];
    for (const path of shellFiles()) {
      if (!path.endsWith(".svelte")) continue;
      const src = readFileSync(path, "utf8");
      // Each `$derived.by(() => {` and the balanced body after it.
      for (const m of src.matchAll(/\$derived(?:\.by)?\(/g)) {
        let depth = 0;
        let i = m.index + m[0].length - 1;
        for (; i < src.length; i++) {
          if (src[i] === "(") depth += 1;
          else if (src[i] === ")") { depth -= 1; if (depth === 0) break; }
        }
        const body = src.slice(m.index, i);
        const hit = body.match(/\b(\w*[Rr]eadout|\w*[Ss]tore)\.set\(/);
        if (hit) offenders.push(`${path}: ${hit[0]} inside a $derived`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("pays --safe-bottom once, below both rows of the band", () => {
    // The band holds two rows now — an editor strip above, the nav row
    // below — and the inset belongs to the band, not to a row. A row that
    // re-added it would double-count exactly the way memory's list did
    // when it started ~50px too low for a release (CLAUDE.md's rule: the
    // shell reserves the inset once).
    //
    // A source check for the same reason the rule above is one: jsdom
    // applies no scoped Svelte stylesheet, so nothing here can observe
    // padding. Two occurrences is the whole claim — the root's, for the
    // no-band case, and the band's.
    const src = readFileSync("src/shell/ShellRoot.svelte", "utf8");
    expect((src.match(/padding-bottom:\s*var\(--safe-bottom\)/g) ?? []).length).toBe(2);
    expect(/\.shell-slot-(strip|nav)[^}]*--safe-bottom/.test(src)).toBe(false);
    // The rows stack rather than sharing a line; without this the two
    // render side by side and the "strip above nav" order means nothing.
    expect(src.includes("flex-direction: column")).toBe(true);
  });

  it("moves the frame with the visible band when the keyboard pans it", () => {
    // jsdom applies no scoped stylesheet, so this is a source check, the
    // same way the safe-bottom rule above is. The arithmetic is held in
    // keyboard-state.test.js (`viewportOffsetTopPx`); this holds that the
    // frame READS it. Drop the declaration and the shell is back to the
    // second device pass's photograph: header under the status bar, strip
    // floating a hand's width above the keyboard.
    const src = readFileSync("src/shell/ShellRoot.svelte", "utf8");
    expect(src.includes("top: var(--vv-offset-top, 0px)")).toBe(true);
    expect(src.includes("bottom: auto")).toBe(true);
  });

  it("declares the 16px input floor on Field's input", () => {
    // jsdom cannot resolve a scoped Svelte <style>, so Field.test.js cannot
    // assert the rendered font-size (see its own comment). This is the real
    // proof: Field.svelte must cite var(--text-input) (max(var(--text-base),
    // 16px), global.css) on its input, not just var(--text-base), or mobile
    // Safari zooms the viewport on focus and every position:fixed shell
    // surface is wrong until the user pinches back (ShellRoot, Sheet).
    const src = readFileSync("src/shell/ui/Field.svelte", "utf8");
    expect(src.includes("var(--text-input)")).toBe(true);
  });

  it("reads no env(safe-area-*) — the root pads for insets once", () => {
    expect(offenders((src) => src.includes("env(safe-area"))).toEqual([]);
  });

  it("reads no var(--kb-inset) — the inset is never a surface's number here", () => {
    // --kb-inset is the keyboard's HEIGHT, for a flow-level box reserving
    // space against the full layout viewport (Page.svelte and Modal.svelte,
    // in the desktop tree, are its only consumers). Inside the shell it is
    // always the wrong variable, and twice over.
    //
    // A normal-flow surface here sits in a frame whose height is ALREADY the
    // band the keyboard leaves (--app-height, keyboard-state.js's
    // visibleBandHeight), so subtracting the keyboard again double-counts it
    // — the bug caret-visible.js's header was written about and the one
    // PageScreen's canvas note refuses. A fixed surface wants --kb-overlay,
    // which is how much of the keyboard the LAYOUT viewport did not take,
    // and Sheet.svelte says why beside its own lift.
    //
    // Four comments in this tree warn about it, which is a rule living
    // nowhere. So the check looks for a DECLARATION — the var() reference on
    // a line that ends in a semicolon — rather than for the name. ShellRoot's
    // header quotes `var(--kb-inset)` in the middle of explaining why it is
    // the wrong one, and a rule that outlawed the explanation along with the
    // mistake would get the explanation deleted.
    const usesIt = (src) => src.split("\n").some(
      (line) => /var\(--kb-inset/.test(line) && line.trimEnd().endsWith(";"),
    );
    expect(offenders(usesIt)).toEqual([]);
  });

  it("subscribes to no visualViewport — keyboard-state.js is the only owner", () => {
    expect(offenders((src) => src.includes("visualViewport"))).toEqual([]);
  });

  it("declares no max-width media query — the shell is already the phone tree", () => {
    expect(offenders((src) => /@media[^{]*max-width/.test(src))).toEqual([]);
  });

  it("pairs var(--spring) with no var(--motion-*) token in any one transition", () => {
    // Every --motion-* token ends in its own easing function (global.css:
    // 72-77), and so does --spring. Putting both in one `transition`
    // shorthand hands it two timing functions and no delay, and the fourth
    // positional slot must be a <time> — so the declaration is invalid and
    // the browser drops it WHOLE. Not a wrong curve: no transition at all,
    // silently, with nothing in the console.
    //
    // Sheet.svelte shipped `transition: height var(--motion-sheet-open)
    // var(--spring)` and its detents snapped from the day the rule was
    // written. Nothing could see it. jsdom computes no transitions, and the
    // VR harness runs reducedMotion: "reduce", which collapses every
    // --motion-* token to `0ms linear` (global.css:999-1007) — so the
    // correct rule and the broken one render byte-identical screenshots.
    // This scan is the only thing in the tree that can catch the class.
    //
    // Written as an absence scan over every shell file, not as a check that
    // Sheet is correct, for the reason the --touch-target rule above
    // records: a presence check is satisfied by one compliant site and says
    // nothing about the next one. Two of three authors on this plan reached
    // for this pairing independently, so it is a trap in the token
    // vocabulary rather than one file's slip, and the guard has to cover
    // files that do not exist yet.
    expect(
      offenders((src) =>
        [...src.replace(BLOCK_COMMENT_RE, "").matchAll(TRANSITION_DECL_RE)].some(
          (m) => m[0].includes("var(--spring)") && m[0].includes("var(--motion-"),
        ),
      ),
    ).toEqual([]);
  });

  it("uses position: fixed only in Sheet and the shell root", () => {
    // Boundary before `position:` — otherwise `background-position: fixed`
    // (a legitimate, unrelated declaration) trips this rule too.
    expect(
      offenders(
        (src, p) => POSITION_FIXED_RE.test(src) && !FIXED_ALLOWLIST.includes(p),
      ),
    ).toEqual([]);
  });

  // Named for the list rather than for its length: §4 allows three HOSTS
  // and one of them ("ChartBuilder forms") is more than one file, so a
  // number in this name would be wrong in one of the two readings whatever
  // it said. Count COMPONENT_ALLOWLIST.
  it("imports from src/components/ only the allowlisted hosts", () => {
    expect(
      offenders((src) => {
        return importedPaths(src, "components/").some(
          (tail) => !COMPONENT_ALLOWLIST.includes(tail),
        );
      }),
    ).toEqual([]);
  });

  it("imports from src/lib/ui/ only the five opinion-free leaves", () => {
    expect(
      offenders((src) => {
        return importedPaths(src, "lib/ui/").some((tail) => {
          const leaf = /^lib\/ui\/([A-Za-z]+)\.svelte$/.exec(tail);
          return !leaf || !UI_LEAF_ALLOWLIST.includes(leaf[1]);
        });
      }),
    ).toEqual([]);
  });

  it("imports from src/lib/ outside lib/ui/ only the allowlisted .svelte", () => {
    // The `.js` modules of src/lib/ are the shell's to borrow freely —
    // that is where every shared decision lives, and the shell imports a
    // dozen of them. This rule is about COMPONENTS, which carry markup,
    // styling and lifecycle the shell would then own without saying so.
    expect(
      offenders((src) =>
        importedPaths(src, "lib/")
          .filter((tail) => tail.endsWith(".svelte") && !tail.startsWith("lib/ui/"))
          .some((tail) => !LIB_SVELTE_ALLOWLIST.includes(tail)),
      ),
    ).toEqual([]);
  });

  it("keeps a stack entry opaque, because two of them share one cell", () => {
    // Not a style preference — a shipping defect the photograph caught and
    // no unit test could. Stack renders `entries.slice(-2)` into ONE grid
    // cell so a back drag reveals a real screen rather than a hole, and
    // .shell-root paints --canvas-bg once for the whole frame. With
    // nothing painting in between, both live screens read through each
    // other: memory's nav bar, search field and every timeline row showed
    // letter-over-letter through the reading view's writing.
    //
    // Stack's header used to assert the top screen "covers the one beneath
    // by DOM order alone". DOM order decides paint ORDER, not opacity.
    //
    // Guarded as text because that is the only place it can be guarded
    // here: jsdom applies no scoped stylesheet and has no compositing, so
    // every model assertion passed while the screen was unreadable. The
    // real proof is the five pushed-screen VR baselines; this stops the
    // declaration being deleted as redundant between runs of a suite that
    // cannot see it.
    const stack = readFileSync("src/shell/ui/Stack.svelte", "utf8");
    const rule = stack.slice(stack.indexOf(".shell-stack-entry {"));
    expect(
      /background:\s*var\(--canvas-bg\)/.test(rule.slice(0, rule.indexOf("}"))),
      ".shell-stack-entry must paint a background — see the comment in this test",
    ).toBe(true);
  });

  it("declares each appended shell token in global.css exactly once", () => {
    // global.css is append-only while the two trees coexist (CLAUDE.md,
    // "Two trees"): the shell adds tokens after the last one and never
    // edits an existing line. The failure that policy invites is the
    // second append — a plan that says "add --scrim" landing on a tree
    // where a concurrent commit already did. CSS takes the LAST
    // declaration of a custom property and says nothing about the first,
    // so a duplicate is invisible everywhere: jsdom resolves no custom
    // property, the VR harness photographs whichever value won, and both
    // are green while the file carries a stale line the next reader will
    // trust. This is the only guard that can see it.
    //
    // Counted as DECLARATIONS — the name followed by a colon at the start
    // of a line — not as mentions, because the tokens name each other in
    // their own comments (--raised's comment cites --surface, and
    // --hairline-soft's cites --hairline) and a mention is not an append.
    // `--hairline-soft:` cannot match `--hairline:` or the reverse, since
    // the colon closes the name. Listed by name rather than derived from
    // the file: a token this list does not carry is one this rule does
    // not hold, and adding it here is part of appending it.
    const css = readFileSync("src/styles/global.css", "utf8");
    for (const token of ["--scrim", "--hairline-soft", "--raised"]) {
      const declared = css.match(new RegExp(`^\\s*${token}:`, "gm")) ?? [];
      expect(declared.length, `${token} declared ${declared.length} times`).toBe(1);
    }
  });

  it("finds the one lib/ .svelte the shell really does import", () => {
    // The rule above is an absence scan, and an absence scan over a
    // directory nothing imports from passes whatever it says — the same
    // vacuous-green trap the "actually finds files" guard at the top of
    // this describe exists for. This is its pair: the allowlist has to be
    // load-bearing, so at least one shell file must genuinely import from
    // it. Delete the ProseHTML import from StaticProse and this goes red
    // rather than the shell quietly gaining a rule about nothing.
    const importers = offenders((src) =>
      importedPaths(src, "lib/").some(
        (tail) => tail.endsWith(".svelte") && !tail.startsWith("lib/ui/"),
      ),
    );
    //
    // ONE importer, and the list is spelled out rather than loosened to a
    // length check. It was two — ReadingScreen and PinArtifactScreen each
    // reached for the renderer directly — until a phone showed a static
    // list drawing the browser's bullet beside the schema's marker, and
    // the shell's copy of the editor's list rules needed one owner. That
    // owner is `ui/StaticProse.svelte`: ProseHTML plus those rules, and
    // the only file that now touches the renderer. Naming it is what
    // still goes red the day a screen bypasses the wrapper (and the
    // rules) by importing ProseHTML itself, or a third file reaches into
    // `lib/` for a component nobody argued for.
    expect(importers.slice().sort()).toEqual(["src/shell/ui/StaticProse.svelte"]);
  });
});

// The primitives that legitimately render a <button> element. Everything
// else in the shell must go through them.
//
// Being on this list is permission in exchange for an obligation, not a
// pass: the raw-<button> rule exists for the 44px floor, and the test
// below holds every name here to it. NavBar earns its place the way Row
// and TabBar do — it is a primitive that renders its own controls and
// declares the floor. ToolbarButton is deliberately NOT the answer for a
// nav bar: spec §4 scopes it to bottom-slot strips, where its
// pointerdown+preventDefault exists to keep focus inside the editor.
//
// PageHeader is a second band rather than a NavBar variant, and the list
// says so rather than leaving the next reader to wonder: NavBar's shape is
// one line — title, optional back, at most two actions — and the page root
// needs two lines, four controls and a dots strip that is its own gesture
// region (§1). Bending NavBar to that would lift its action cap, which is
// the rule stopping screens smuggling a toolbar into the bar.
//
// TableSizeGrid is the one entry that is not a list/bar control: it is 36
// cells in a 6×6 grid, and there is no composing it out of Row without
// making a table size read as a 36-row list. It earns the permission the
// same way — `minmax(var(--tap), 1fr)` is both the floor and the stretch,
// so the cells cannot fall under 44px however narrow the frame gets.
//
// Calendar is the second of that kind and earns it the same way: a month
// is up to six weeks of seven days, and forty-two Rows would be forty-two
// 44px stripes where a writer wants a grid to read at a glance. Its cells
// carry `min-height: var(--tap)` and its month arrows carry both floors.
const PRIMITIVE_BUTTON_FILES = [
  "src/shell/ui/ToolbarButton.svelte",
  "src/shell/ui/Row.svelte",
  "src/shell/ui/TabBar.svelte",
  "src/shell/ui/NavBar.svelte",
  "src/shell/ui/PageHeader.svelte",
  "src/shell/ui/TableSizeGrid.svelte",
  "src/shell/ui/Calendar.svelte",
];

function isPrimitiveButton(path) {
  return PRIMITIVE_BUTTON_FILES.includes(path);
}
