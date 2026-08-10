// Build a deterministic, pre-seeded invoke for one scene. The caller must
// have already installed the fixed clock + sequential uuid (so the mock's
// internal new Date()/crypto.randomUUID() are frozen).
import { createMockInvoke } from "../api.js";

export async function createSeededInvoke(fixture) {
  const invoke = createMockInvoke();
  // Suppress the one-time mobile gestures tip before the fixture runs. It is
  // a transient toast fired on coarse pointers when this setting is unset, so
  // whether a screenshot catches it depends on how long the fixture's awaits
  // happened to take — adding one await to a fixture is enough to start
  // capturing it. Deterministic scenes can't depend on losing that race.
  await invoke("set_setting", { key: "mobile_gestures_tip_seen", value: "true" });
  await fixture(invoke);
  return invoke;
}
