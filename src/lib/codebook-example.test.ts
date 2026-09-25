import { describe, expect, it } from "vitest";

import { exampleFrom } from "./codebook-example";

describe("exampleFrom", () => {
  const post = "Just bought the Smart Tank 7301.   The printhead error showed up on day one!";
  it("uses Claude's quote only when it is really in the post, in the post's own words", () => {
    expect(exampleFrom(post, "the PRINTHEAD error showed up")).toBe("The printhead error showed up");
  });
  it("falls back to the post's opening words when the quote isn't there", () => {
    expect(exampleFrom(post, "wifi keeps dropping")).toBe("Just bought the Smart Tank 7301. The printhead error showed up on day one!");
    expect(exampleFrom("a ".repeat(200), null)!.endsWith("…")).toBe(true);
  });
  it("gives nothing without a post", () => {
    expect(exampleFrom(undefined, "anything")).toBeUndefined();
    expect(exampleFrom("   ", null)).toBeUndefined();
  });
});
