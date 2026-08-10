// Flatten the app's VR scene registry into capture cases. Imported from the
// app source (pure JS — scenes.js → fixtures.js → utils.js, no Svelte) so the
// Tier-2 matrix never drifts from Tier-1.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCENES, THEMES } from "../../src/lib/vr/scenes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SCENE_CASES = Object.keys(SCENES).flatMap((id) =>
  THEMES.map((theme) => ({ id, theme, name: `${id}-${theme}` }))
);

export const BASELINE_DIR = path.resolve(__dirname, "baselines/linux");
export const OUT_DIR = path.resolve(__dirname, "out");
