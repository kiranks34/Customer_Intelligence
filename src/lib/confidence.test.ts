import { describe, expect, it } from "vitest";

import { band } from "./confidence";

describe("band", () => {
  it.each([
    [1, "counted"],
    [0.8, "counted"],
    [0.79, "uncertain"],
    [0.5, "uncertain"],
    [0.49, "review"],
    [0, "review"],
  ] as const)("%s -> %s", (c, expected) => {
    expect(band(c)).toBe(expected);
  });
  it("rejects values outside [0, 1]", () => {
    expect(() => band(1.2)).toThrow(RangeError);
    expect(() => band(-0.1)).toThrow(RangeError);
    expect(() => band(Number.NaN)).toThrow(RangeError);
  });
  it("supports custom thresholds and validates them", () => {
    expect(band(0.85, { counted: 0.9, review: 0.6 })).toBe("uncertain");
    expect(() => band(0.5, { counted: 0.4, review: 0.6 })).toThrow(RangeError);
  });
});
