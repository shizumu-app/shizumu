// src/lib/extensions/__tests__/block-shell.test.js
import { describe, it, expect } from "vitest";
import { createBlockShell } from "../block-shell.js";

function fakeNode(name, attrs = {}) {
  return { type: { name }, attrs, content: { size: 0 } };
}

describe("createBlockShell", () => {
  it("builds a .block-shell wrapper with a title slot, content DOM, and chip", () => {
    const shell = createBlockShell({
      node: fakeNode("blockquote", { blockTitle: null }),
      view: { state: { doc: { resolve: () => ({ depth: 0 }) } } },
      getPos: () => 1,
      ext: { storage: {} },
    });
    expect(shell.dom.classList.contains("block-shell")).toBe(true);
    expect(shell.dom.dataset.type).toBe("blockquote");
    expect(shell.titleSlot).toBeInstanceOf(HTMLInputElement);
    expect(shell.contentDOM).toBeTruthy();
    expect(shell.dom.querySelector(".block-type-chip")).toBeTruthy();
  });

  it("builds the correct content host per board type", () => {
    const mk = (name) => createBlockShell({
      node: { type: { name }, attrs: {}, content: { size: 0 } },
      view: { state: { doc: { resolve: () => ({ depth: 0 }) } } },
      getPos: () => 1,
      ext: { storage: {} },
    }).contentDOM;
    expect(mk("list").tagName).toBe("UL");
    expect(mk("list").dataset.list).toBe("");
    expect(mk("blockquote").tagName).toBe("BLOCKQUOTE");
    const qa = mk("qaBlock");
    expect(qa.dataset.type).toBe("qa-block");
    expect(qa.classList.contains("qa-block")).toBe(true);
    const recipe = mk("recipeBlock");
    expect(recipe.dataset.type).toBe("recipe-block");
    expect(recipe.classList.contains("recipe-block")).toBe(true);
    const decision = mk("decisionBlock");
    expect(decision.dataset.type).toBe("decision-block");
    expect(decision.classList.contains("decision-block")).toBe(true);
    expect(mk("paragraph").tagName).toBe("DIV");
    [mk("list"), mk("blockquote"), mk("qaBlock"), mk("recipeBlock"), mk("decisionBlock"), mk("paragraph")]
      .forEach((el) => expect(el.classList.contains("board-content")).toBe(true));
  });

  it("renders the type chip for a known board type", () => {
    const shell = createBlockShell({
      node: { type: { name: "blockquote" }, attrs: {}, content: { size: 0 } },
      view: { state: { doc: { resolve: () => ({ depth: 0 }) } } },
      getPos: () => 1,
      ext: { storage: {} },
    });
    expect(shell.chip.textContent).toBe("outline");
    expect(shell.chip.style.display).not.toBe("none");
  });

  it("reflects blockTitle via setTitle onto the input value and data attr", () => {
    const shell = createBlockShell({
      node: fakeNode("blockquote", { blockTitle: null }),
      view: { state: { doc: { resolve: () => ({ depth: 0 }) } } },
      getPos: () => 1,
      ext: { storage: {} },
    });
    shell.setTitle("the index, not the join");
    expect(shell.titleSlot.value).toBe("the index, not the join");
    expect(shell.dom.getAttribute("data-block-title")).toBe("the index, not the join");
    shell.setTitle("");
    expect(shell.dom.hasAttribute("data-block-title")).toBe(false);
  });
});
