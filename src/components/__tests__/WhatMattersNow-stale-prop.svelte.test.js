// The focus field keeps what the writer typed when its parent replaces the
// page object without a new focus in it (src/lib/focus-field-sync.js).
// Until 0.8.2: type a focus, create a trail from the header (Page.svelte
// replaces `page`, whose what_matters_now is still the null it was created
// with), press Return, and "" was saved over the focus. Found on the A16 run
// of 2026-11-07 (J12.1: op 2494 saved the focus, op 2497 wrote "").
// A .svelte.test.js file, so the props can be $state and change after mount,
// which src/lib/ui/test-helper.js's plain object cannot.
import { describe, it, expect, vi, afterEach } from "vitest";
import { flushSync, mount, unmount, tick } from "svelte";

vi.mock("../../lib/api.js", () => ({
  updateWhatMattersNow: vi.fn(() => Promise.resolve()),
}));

import { updateWhatMattersNow } from "../../lib/api.js";
import WhatMattersNow from "../WhatMattersNow.svelte";

let instance = null, target = null;
afterEach(() => { if (instance) unmount(instance); target?.remove(); instance = null; vi.clearAllMocks(); });

describe("WhatMattersNow keeps typed text over a stale prop", () => {
  it("a page object replaced with its old null focus does not empty the field, and Return saves the typed focus", async () => {
    const props = $state({ pageId: "p1", value: null, lineage: null });
    target = document.createElement("div");
    document.body.appendChild(target);
    instance = mount(WhatMattersNow, { target, props });
    flushSync();
    const input = target.querySelector("input.what-matters-input");

    input.value = "reading notes agate";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("blur", { bubbles: true }));
    await tick();
    expect(updateWhatMattersNow).toHaveBeenLastCalledWith("p1", "reading notes agate");

    // The parent replaces its page: a trail now, the focus still the null
    // the page was created with. Same prop value, so not news.
    props.value = undefined;
    flushSync();
    props.value = null;
    flushSync();
    expect(input.value).toBe("reading notes agate");

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await tick();
    await tick();
    expect(updateWhatMattersNow).not.toHaveBeenCalledWith("p1", "");
    expect(updateWhatMattersNow).toHaveBeenLastCalledWith("p1", "reading notes agate");
  });

  it("a real change from the other device still replaces the field", async () => {
    const props = $state({ pageId: "p1", value: "" });
    target = document.createElement("div");
    document.body.appendChild(target);
    instance = mount(WhatMattersNow, { target, props });
    flushSync();
    props.value = "from the phone";
    flushSync();
    expect(target.querySelector("input.what-matters-input").value).toBe("from the phone");
  });
});
