import { describe, expect, test } from "vitest";
import { chooseMarkerInsertPosition } from "../../components/TipTapEditor.svelte";

describe("chooseMarkerInsertPosition", () => {
  test("first marker on a doc with no existing markers goes at position 0", () => {
    expect(chooseMarkerInsertPosition({ markersExist: false, docSize: 100 })).toBe(0);
  });

  test("subsequent markers append at end of doc", () => {
    expect(chooseMarkerInsertPosition({ markersExist: true, docSize: 100 })).toBe(100);
  });

  test("first marker on an empty doc still works (size 2 minimum)", () => {
    expect(chooseMarkerInsertPosition({ markersExist: false, docSize: 2 })).toBe(0);
  });
});
