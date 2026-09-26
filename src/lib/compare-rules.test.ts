import { describe, expect, it } from "vitest";

import { compareConflict } from "./compare-rules";

describe("compareConflict", () => {
  const fam = (id: number, name: string, series: [number, number[]][]) => ({
    id,
    name,
    posts: 0,
    series: series.map(([sid, models]) => ({ id: sid, name: `S${sid}`, posts: 0, models: models.map((m) => ({ id: m, name: `M${m}`, posts: 0 })) })),
  });
  const families = [fam(1, "HP Smart Tank", [[10, [11, 12]], [20, [21]]]), fam(2, "Epson EcoTank", [[30, [31]]])];
  it("allows two products that don't overlap, across families too", () => {
    expect(compareConflict(families, { catalogId: 1, nodeId: 11 }, { catalogId: 1, nodeId: 21 })).toBeNull();
    expect(compareConflict(families, { catalogId: 1, nodeId: 10 }, { catalogId: 1, nodeId: 20 })).toBeNull();
    expect(compareConflict(families, { catalogId: 1, nodeId: 11 }, { catalogId: 2, nodeId: 31 })).toBeNull();
    expect(compareConflict(families, { catalogId: 1, nodeId: null }, { catalogId: 2, nodeId: null })).toBeNull();
  });
  it("names why the rest can't be compared", () => {
    expect(compareConflict(families, { catalogId: 1, nodeId: 11 }, { catalogId: 1, nodeId: 11 })).toBe("Picked");
    expect(compareConflict(families, { catalogId: 1, nodeId: 11 }, { catalogId: 1, nodeId: 12 })).toBe("Same series");
    expect(compareConflict(families, { catalogId: 1, nodeId: 11 }, { catalogId: 1, nodeId: 10 })).toBe("Same series");
    expect(compareConflict(families, { catalogId: 1, nodeId: null }, { catalogId: 1, nodeId: 21 })).toBe("Same family");
    expect(compareConflict(families, { catalogId: 1, nodeId: null }, { catalogId: 2, nodeId: 31 })).toBe("Family vs product");
    expect(compareConflict(families, { catalogId: 1, nodeId: 20 }, { catalogId: 2, nodeId: null })).toBe("Family vs product");
  });
});
