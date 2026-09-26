import { describe, expect, it } from "vitest";

import { pickLabel, shortName } from "./picker-data";

describe("shortName", () => {
  it("drops the brand and family words the picker already shows", () => {
    expect(shortName("HP Smart Tank 7300 series", "HP Smart Tank")).toBe("7300 series");
    expect(shortName("Smart Tank 5100 All-in-One Printer Series", "HP Smart Tank")).toBe("5100 All-in-One Printer Series");
    expect(shortName("HP SmartTank 7301", "HP Smart Tank")).toBe("7301");
    expect(shortName("Ink Tank 315", "HP Smart Tank")).toBe("Ink Tank 315");
    expect(shortName("HP Smart Tank", "HP Smart Tank")).toBe("Smart Tank");
  });
});

describe("pickLabel", () => {
  const fams = [{ id: 1, name: "HP Smart Tank", posts: 9, series: [{ id: 2, name: "HP Smart Tank 7600 series", posts: 5, models: [{ id: 3, name: "HP Smart Tank 7602", posts: 4 }] }] }];
  it("names the whole family, a series or a model; null when it's gone", () => {
    expect(pickLabel(fams, 1, null)).toBe("All of HP Smart Tank");
    expect(pickLabel(fams, 1, 2)).toBe("HP Smart Tank 7600 series");
    expect(pickLabel(fams, 1, 3)).toBe("HP Smart Tank 7602");
    expect(pickLabel(fams, 1, 9)).toBeNull();
    expect(pickLabel(fams, 7, null)).toBeNull();
  });
});

