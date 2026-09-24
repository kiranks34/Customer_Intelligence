import { describe, expect, it } from "vitest";

import { safeNext } from "./redirect";

describe("safeNext", () => {
  it("keeps same-site paths with their query", () => {
    expect(safeNext("/searches/1")).toBe("/searches/1");
    expect(safeNext("/searches?id=5&tab=quotes")).toBe("/searches?id=5&tab=quotes");
  });
  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "",
    null,
    42,
  ])("rejects %j", (v) => {
    expect(safeNext(v)).toBe("/");
  });
});
