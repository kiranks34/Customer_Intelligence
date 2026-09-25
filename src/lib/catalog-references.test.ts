import { describe, expect, it } from "vitest";

import { familyKey, normalize } from "./catalog";
import { ReferenceSchema } from "./catalog-reference";
import { referenceFor, registeredReferences } from "./catalog-references";

describe.each(registeredReferences())("verified reference %s", (key, raw) => {
  const parsed = ReferenceSchema.safeParse(raw);
  it("matches the schema: https maker/retailer sources, and every model's source names its number", () => {
    expect(parsed.error?.issues ?? []).toEqual([]);
  });
  const ref = parsed.data!;
  it("is registered under its own family key", () => {
    expect(ref.key).toBe(key);
    expect(familyKey(ref.family)).toBe(key);
    expect(referenceFor(key)?.family).toBe(ref.family);
  });
  it("lists every model number once", () => {
    const numbers = ref.series.flatMap((s) => s.models.map((m) => normalize(m.number)));
    expect(numbers.filter((n, i) => numbers.indexOf(n) !== i)).toEqual([]);
  });
  it("marks every number used by both lines as shared", () => {
    const own = new Set(ref.series.flatMap((s) => s.models.map((m) => normalize(m.number))));
    const both = ref.inkTank.map((m) => normalize(m.number)).filter((n) => own.has(n));
    expect([...new Set(both)].sort()).toEqual([...new Set(ref.sharedNumbers.map(normalize))].sort());
  });
});

it("returns null for families without a verified list", () => {
  expect(referenceFor("no such family")).toBeNull();
});

it("finds a reference however the family is written", () => {
  for (const k of ["hp smart tank", "smart tank", "hp smarttank", "smartank"]) expect(referenceFor(k)?.key).toBe("hp smart tank");
});
