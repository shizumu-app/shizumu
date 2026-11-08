// The trail map's entries (spec 2026-11-01 §3): a page shows its preview
// line and the pins kept from it, in place of a "1 pin" badge that had to be
// opened to read.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanupAll } from "../../lib/ui/test-helper.js";
import TrailMap from "../TrailMap.svelte";

afterEach(cleanupAll);
beforeEach(() => { Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {}); });

const date = "2026-01-15";
const lineages = [{ id: "s", name: "shizumu", parent_id: null }, { id: "v", name: "v0.8", parent_id: "s" }];
const page = {
  id: "p1", date, page_number: 1, lineage_id: "v", what_matters_now: "what's left before tag", preview_lines: [],
  content_json: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "the blocks have been usable" }] }] }),
};
const pin = { id: "k1", lineage_id: "v", source_page_id: "p1", source_page_date: date, title: "the chip is not content", content: "x" };

describe("TrailMap entries", () => {
  it("shows the trail path, title, preview and the pin itself under its page", () => {
    const onOpenSpecificPin = vi.fn();
    const { target } = render(TrailMap, {
      pages: [page], pins: [pin], lineages, lineageId: null, todayStr: date,
      onSelectPage: vi.fn(), onOpenSpecificPin,
    });
    const entry = target.querySelector(".entry");
    expect(entry.querySelector(".entry-trail").textContent).toBe("shizumu › v0.8");
    expect(entry.querySelector(".entry-title").textContent).toBe("what's left before tag");
    expect(entry.querySelector(".entry-preview").textContent).toBe("the blocks have been usable");
    const pinBtn = entry.querySelector(".entry-pin");
    expect(pinBtn.textContent).toContain("the chip is not content");
    expect(target.textContent).not.toMatch(/\b1 pin\b/);
    pinBtn.click();
    expect(onOpenSpecificPin).toHaveBeenCalledWith(pin);
  });
});
