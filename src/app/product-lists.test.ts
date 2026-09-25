import { describe, expect, it } from "vitest";

import { defaultPick, shortName } from "./product-lists";

describe("shortName", () => {
  it("drops the brand and family words the tab already shows", () => {
    expect(shortName("HP Smart Tank 7300 series", "HP Smart Tank")).toBe("7300 series");
    expect(shortName("Smart Tank 5100 All-in-One Printer Series", "HP Smart Tank")).toBe("5100 All-in-One Printer Series");
    expect(shortName("HP SmartTank 7301", "HP Smart Tank")).toBe("7301");
    expect(shortName("Ink Tank 315", "HP Smart Tank")).toBe("Ink Tank 315");
    expect(shortName("HP Smart Tank", "HP Smart Tank")).toBe("Smart Tank");
  });
});

describe("defaultPick", () => {
  const series = (id: number, name: string, posts: number) => ({ id, name, posts, models: [] });
  it("picks the most discussed series with all its models, so Plan search always has a target", () => {
    const family = { id: 1, name: "HP Smart Tank", posts: 9, waiting: 0, series: [series(1, "580 series", 2), series(2, "7300 series", 7)] };
    expect(defaultPick(family)).toEqual({ seriesId: 2, modelId: null });
  });
  it("falls back to the whole family when there are no series", () => {
    expect(defaultPick({ id: 1, name: "HP DeskJet", posts: 0, waiting: 0, series: [] })).toEqual({ seriesId: null, modelId: null });
  });
});
