// The desktop's onboarding awaited markOnboardingComplete before calling
// onComplete. The try/catch around it guarded a write that THROWS, not one
// that never resolves: a locked database left a new writer on the last slide
// with a dead button, and since the flag was never written either, the next
// launch showed onboarding again. The shell's ShellGate fixed its copy by
// advancing first and firing the write unawaited; this is the desktop's.
import { describe, it, expect, vi, afterEach } from "vitest";
import { tick } from "svelte";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";

const api = vi.hoisted(() => ({
  // Never settles: the locked database.
  markOnboardingComplete: vi.fn(() => new Promise(() => {})),
}));
vi.mock("../../lib/api.js", () => ({
  markOnboardingComplete: (...a) => api.markOnboardingComplete(...a),
}));

import Onboarding from "../Onboarding.svelte";

afterEach(() => { cleanupAll(); api.markOnboardingComplete.mockClear(); });

async function flush() {
  for (let i = 0; i < 5; i++) { await Promise.resolve(); await tick(); }
}

function buttonNamed(target, label) {
  return [...target.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(label));
}

describe("Onboarding — leaving it", () => {
  it("lets the writer out with begin even when the write never resolves", async () => {
    const onComplete = vi.fn();
    const { target } = render(Onboarding, { onComplete });
    for (let i = 0; i < 5; i++) {
      buttonNamed(target, "next").click();
      await tick();
    }
    buttonNamed(target, "begin").click();
    await flush();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(api.markOnboardingComplete).toHaveBeenCalled();
  });

  it("lets the writer out with skip even when the write never resolves", async () => {
    const onComplete = vi.fn();
    const { target } = render(Onboarding, { onComplete });
    buttonNamed(target, "skip").click();
    await flush();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("still lets the writer out when the write rejects, and does not surface the rejection", async () => {
    api.markOnboardingComplete.mockImplementationOnce(() => Promise.reject(new Error("database is locked")));
    const onComplete = vi.fn();
    const { target } = render(Onboarding, { onComplete });
    buttonNamed(target, "skip").click();
    await flush();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
