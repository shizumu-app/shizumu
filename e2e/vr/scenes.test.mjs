import { test } from "node:test";
import assert from "node:assert/strict";
import { SCENE_CASES } from "./scenes.mjs";
// Import THEMES from the same app registry the matrix is built from, so the
// membership assertion can't drift from the live theme list.
import { THEMES } from "../../src/lib/vr/scenes.js";

test("SCENE_CASES is the full scene×theme matrix", () => {
  // 7 scenes × 3 themes. Deliberately a literal, not derived from SCENES —
  // deriving it from the same registry the matrix is built from would make
  // the assertion tautological. Bump it when you add a scene, on purpose.
  assert.equal(SCENE_CASES.length, 21);
  for (const c of SCENE_CASES) {
    assert.equal(typeof c.id, "string");
    assert.ok(THEMES.includes(c.theme));
    assert.equal(c.name, `${c.id}-${c.theme}`);
  }
  // names are unique
  assert.equal(new Set(SCENE_CASES.map((c) => c.name)).size, 21);
});
