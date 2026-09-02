import { describe, it, expect } from "vitest";
import { buildEditingExtensions } from "../shared-extensions.js";

/**
 * The seam that gives the mobile shell's §3 its first producer.
 *
 * §3 states one rule — editor chrome lives in exactly two places, the
 * bottom slot and the gutter handle: "No bubble menu, no floating
 * slash/mention menu, no floating `+` widget." The bubble menu already
 * obeyed, being markup in TipTapEditor.svelte that the shell never
 * renders. The rest are extensions registered in this factory, so the
 * shell inherited them by sharing it and the rule had no producer.
 *
 * The three refusals do not have the same shape, and the first version of
 * this seam — which dropped all three extensions — was unusable because of
 * it. SlashCommands and MentionCommand are not menus that happen to live in
 * an extension: each IS the @tiptap/suggestion plugin whose state produces
 * the shell's own suggestion strip, read back through
 * `SlashCommandsPluginKey.getState(state)`. Dropping them left the shell
 * with no menu at all rather than one. So two of the three stay, with their
 * renderers configured off; only TouchBlockHandle is genuinely free to omit.
 *
 * Asserted by extension NAME, because the name is what the editor keys a
 * plugin on. That is necessary and not sufficient here — a name says nothing
 * about whether the surviving extension still draws a menu — so the option
 * itself is asserted too, and the behaviour behind the option lives in
 * extensions/__tests__/suggestion-menu-off.test.js, where a real editor
 * types `/` and reads the plugin state back.
 */
const built = (opts) => buildEditingExtensions(opts);
const names = (opts) => built(opts).map((e) => e.name);
const byName = (list, name) => list.find((e) => e.name === name);

// Kept, with the menu turned off.
const MENUS = ["slashCommands", "mentionCommand"];
// Omitted outright: the shell draws its own gutter handle, and nothing
// listens for the `shizumu-block-insert` event this one fires.
const OMITTED = ["touchBlockHandle"];

describe("buildEditingExtensions — the floating-chrome seam", () => {
  it("keeps every floating surface by default, which is the desktop", () => {
    // Defaulted true rather than requiring every existing call site to
    // opt in: the desktop is the older host and the one every current
    // caller is, so a default of false would have moved the risk onto
    // the tree this change is not trying to alter.
    const got = names();
    for (const n of [...MENUS, ...OMITTED]) expect(got, `missing ${n}`).toContain(n);
  });

  it("leaves the suggestion menus on by default", () => {
    const list = built();
    for (const n of MENUS) {
      expect(byName(list, n).options.floatingMenu, `${n} menu off by default`).toBe(true);
    }
  });

  it("KEEPS the suggestion extensions when floatingChrome is false", () => {
    // The correction. Both are the query producers the host reads; the
    // menu is the only part it refuses.
    const got = names({ floatingChrome: false });
    for (const n of MENUS) expect(got, `${n} was dropped`).toContain(n);
  });

  it("turns their menus off when floatingChrome is false", () => {
    // What "keeps them" has to mean, or the shell gets two menus again.
    const list = built({ floatingChrome: false });
    for (const n of MENUS) {
      expect(byName(list, n).options.floatingMenu, `${n} menu still on`).toBe(false);
    }
  });

  it("omits TouchBlockHandle when floatingChrome is false", () => {
    const got = names({ floatingChrome: false });
    for (const n of OMITTED) expect(got, `${n} survived`).not.toContain(n);
  });

  it("omits nothing else when floatingChrome is false", () => {
    // The sharper half. An omission expressed as a spread is one typo
    // away from dropping a neighbour — TouchBlockHandle sits between
    // BlockTypeChip and LocalImage — and a test that only checked the
    // named extensions would not see it. Asserting the REMAINDER is equal
    // is what makes this a seam rather than a hole.
    const full = names();
    const trimmed = names({ floatingChrome: false });
    expect(trimmed).toEqual(full.filter((n) => !OMITTED.includes(n)));
  });

  it("still builds a usable list without it", () => {
    // Not a smoke test for its own sake: the omission is from the middle
    // of the array, and ProseMirror resolves plugin order from it. An
    // empty or truncated list would still satisfy the assertions above.
    const trimmed = names({ floatingChrome: false });
    expect(trimmed.length).toBe(names().length - OMITTED.length);
    // `list`/`listItem`, not "unifiedList" — UnifiedListExtensions is a
    // spread of two node extensions and the module name is not either of
    // their registered names (unified-list.js:29,73). Written the obvious
    // way this test failed, which is the point of naming a survivor that
    // sits after the removal rather than before it.
    expect(trimmed).toContain("list");
    expect(trimmed).toContain("listItem");
    expect(trimmed).toContain("findReplace");
  });

  it("still wires MentionCommand's callbacks through when the menu is off", () => {
    // The menu option is merged into the same options object as onCreate
    // and getCurrentLineage. A configure() call that replaced rather than
    // merged would silently drop the host's callbacks, and every
    // name-level assertion above would stay green.
    const onCreate = () => {};
    const getCurrentLineage = () => null;
    const mention = byName(
      built({ floatingChrome: false, onCreateSubtrail: onCreate, getCurrentLineage }),
      "mentionCommand",
    );
    expect(mention.options.onCreate).toBe(onCreate);
    expect(mention.options.getCurrentLineage).toBe(getCurrentLineage);
  });
});
