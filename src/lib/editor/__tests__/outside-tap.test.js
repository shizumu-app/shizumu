import { describe, it, expect } from "vitest";
import { isOutsideTap } from "../outside-tap.js";

function fakeEvent(target) {
  return { target };
}

describe("isOutsideTap", () => {
  it("is true when the target is outside the container", () => {
    const container = document.createElement("div");
    const outsider = document.createElement("span");
    document.body.appendChild(container);
    document.body.appendChild(outsider);
    try {
      expect(isOutsideTap(fakeEvent(outsider), container)).toBe(true);
    } finally {
      container.remove();
      outsider.remove();
    }
  });

  it("is false when the target IS the container — a tap on the menu itself must not close it", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    try {
      expect(isOutsideTap(fakeEvent(container), container)).toBe(false);
    } finally {
      container.remove();
    }
  });

  it("is false when the target is a descendant of the container", () => {
    const container = document.createElement("div");
    const row = document.createElement("button");
    container.appendChild(row);
    document.body.appendChild(container);
    try {
      expect(isOutsideTap(fakeEvent(row), container)).toBe(false);
    } finally {
      container.remove();
    }
  });

  it("is true when there is no container to check against (menu not mounted / already torn down)", () => {
    // Not "nothing happens for no reason": with no menu element to compare
    // against, there is nothing the tap could be "inside," so every tap is
    // correctly outside — this is the state right after onExit tears the
    // menu down, where a caller must not still try to keep it open.
    const target = document.createElement("span");
    expect(isOutsideTap(fakeEvent(target), null)).toBe(true);
    expect(isOutsideTap(fakeEvent(target), undefined)).toBe(true);
  });

  it("is true when the event carries no real DOM target", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    try {
      expect(isOutsideTap(fakeEvent(null), container)).toBe(true);
      expect(isOutsideTap({}, container)).toBe(true);
    } finally {
      container.remove();
    }
  });
});
