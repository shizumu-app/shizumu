import { describe, it, expect } from "vitest";
import { commandItems } from "../slash-commands.js";

// There were two image commands: /image and /inline image. The second
// inserted the same node with display: "inline" and collapsed: true — but a
// collapsed image is a chip that flows in the sentence whatever its display
// mode is (global.css: [data-collapsed="true"] { display: inline }). So the
// two commands produced two things that render identically the moment
// either is collapsed, and the only way to tell them apart was to expand
// them. Collapsing an image is the inline form; it doesn't need a command.
describe("image slash commands", () => {
  const imageCommands = commandItems.filter((i) => /image/i.test(i.title));

  it("offers exactly one image command", () => {
    expect(imageCommands.map((i) => i.title)).toEqual(["image"]);
  });

  it("does not offer a separate inline variant", () => {
    expect(commandItems.some((i) => i.title === "inline image")).toBe(false);
  });
});
