/**
 * Which two products can be compared (D48): two different products that don't overlap. One pick per series (a model
 * against its own series, or two models of one series, overlap), and a whole family only against another family.
 * Pure, so the picker and the server apply the same rules.
 */

export interface Pick {
  catalogId: number;
  nodeId: number | null;
}

/** The shape both the picker's lists and a catalog tree give: families, their series, and each series' models. */
export interface FamilyShape {
  id: number;
  series: { id: number; models: { id: number }[] }[];
}

/** The series a pick belongs to (a series is its own), null for a whole family. */
function seriesOf(families: FamilyShape[], p: Pick): number | null {
  if (p.nodeId === null) return null;
  const f = families.find((x) => x.id === p.catalogId);
  for (const s of f?.series ?? []) if (s.id === p.nodeId || s.models.some((m) => m.id === p.nodeId)) return s.id;
  return null;
}

/** Why `b` can't be compared with `a`, or null when it can. */
export function compareConflict(families: FamilyShape[], a: Pick, b: Pick): string | null {
  if (a.catalogId === b.catalogId && a.nodeId === b.nodeId) return "Picked";
  if (a.catalogId !== b.catalogId) return (a.nodeId === null) !== (b.nodeId === null) ? "Family vs product" : null;
  if (a.nodeId === null || b.nodeId === null) return "Same family";
  return seriesOf(families, a) === seriesOf(families, b) ? "Same series" : null;
}
