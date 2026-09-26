/** The products the New study picker lists, with posts collected so far (all studies), counted in SQL. */

export interface ListModel {
  id: number;
  name: string;
  /** Posts collected so far (all studies) that name this model. */
  posts: number;
}

export interface ListSeries {
  id: number;
  name: string;
  /** Posts collected so far that name this series or one of its models. */
  posts: number;
  models: ListModel[];
}

export interface ListFamily {
  id: number;
  name: string;
  /** Posts collected so far that name any series or model of the family. */
  posts: number;
  series: ListSeries[];
}

/** A name without the brand and family words the picker already shows: "HP Smart Tank 7300 series" → "7300 series". */
export function shortName(name: string, familyName: string): string {
  const family = familyName.replace(/^HP\s+/i, "");
  const out = name
    .replace(/^HP\s+/i, "")
    .replace(new RegExp(`^${family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*")}\\s+`, "i"), "")
    .trim();
  return out || name;
}

export const byPostsThenName = <T extends { posts: number; name: string }>(a: T, b: T) =>
  b.posts - a.posts || a.name.localeCompare(b.name, undefined, { numeric: true });

/** What a pick is called: "All of HP Smart Tank", a series or a model by its full name. */
export function pickLabel(families: ListFamily[], catalogId: number, nodeId: number | null): string | null {
  const f = families.find((x) => x.id === catalogId);
  if (!f) return null;
  if (nodeId === null) return `All of ${f.name}`;
  for (const s of f.series) {
    if (s.id === nodeId) return s.name;
    const m = s.models.find((x) => x.id === nodeId);
    if (m) return m.name;
  }
  return null;
}
