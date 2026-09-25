/**
 * Verified reference lists for product catalogs (docs/DECISIONS.md D30). A reference is researched from the
 * maker's and retailers' own pages and committed to the repo with a source (URL + exact quote) for every series and
 * model. When one exists for a family, it replaces the AI draft; nothing without a source is marked verified.
 * Pure: no DB, no network.
 */
import { z } from "zod";

import { cleanTree, normalize, squashName, type TreeNode } from "./catalog";

/** Only pages from the maker or major retailers count as proof. */
export const SOURCE_DOMAINS = ["hp.com", "amazon.com", "bestbuy.com", "walmart.com", "staples.com", "costco.com", "target.com"];

const hostAllowed = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && SOURCE_DOMAINS.some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
};

const SourceSchema = z.object({
  url: z.string().refine(hostAllowed, "source must be an https page on the maker's or a major retailer's site"),
  title: z.string(),
  quote: z.string().min(3).max(300),
});
export type Source = z.infer<typeof SourceSchema>;

const ModelSchema = z.object({
  name: z.string().min(1),
  number: z.string().min(1),
  aliases: z.array(z.string()),
  regions: z.array(z.string()),
  retailerExclusive: z.string().nullable(),
  discontinued: z.boolean(),
  sources: z.array(SourceSchema).min(1, "every verified model needs at least one source"),
});

export const ReferenceSchema = z
  .object({
    family: z.string().min(1),
    key: z.string().min(1),
    checkedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    familyAliases: z.array(z.string()),
    series: z.array(z.object({ name: z.string().min(1), sources: z.array(SourceSchema), models: z.array(ModelSchema) })),
    inkTank: z.array(z.object({ name: z.string(), number: z.string(), regions: z.array(z.string()), sources: z.array(SourceSchema) })).default([]),
    sharedNumbers: z.array(z.string()).default([]),
    unverified: z.array(z.object({ name: z.string(), reason: z.string() })).default([]),
    notes: z.string().default(""),
  })
  .superRefine((ref, ctx) => {
    // A model's own quote must actually name it (by number), so a source can't be attached to the wrong model.
    ref.series.forEach((s, si) =>
      s.models.forEach((m, mi) => {
        if (!m.sources.some((src) => normalize(src.quote).includes(normalize(m.number)) || normalize(src.title).includes(normalize(m.number)))) {
          ctx.addIssue({ code: "custom", path: ["series", si, "models", mi], message: `${m.name}: no source quote or title mentions ${m.number}` });
        }
      }),
    );
  });
export type Reference = z.infer<typeof ReferenceSchema>;

/** Where each verified node's proof is: normalized node name → sources. Used to show links on the review screen. */
/** Every name in the verified list (series, models, model numbers, other names), squashed for comparison. */
export function listedNames(ref: Reference): Set<string> {
  const names = ref.series.flatMap((s) => [s.name, ...s.models.flatMap((m) => [m.name, m.number, ...m.aliases])]);
  return new Set(names.map(squashName));
}

/** Whether a catalog product is in the verified list, by its name or any of its names. */
export const isListed = (listed: Set<string>, name: string, aliases: string[] = []) => [name, ...aliases].some((n) => listed.has(squashName(n)));

export function sourcesByName(ref: Reference): Record<string, (Source & { page: string | null })[]> {
  const out: Record<string, (Source & { page: string | null })[]> = {};
  const withPages = (srcs: Source[], series: string) => srcs.map((src) => ({ ...src, page: readablePage(src, series) }));
  for (const s of ref.series) {
    out[normalize(s.name)] = withPages(s.sources, s.name);
    for (const m of s.models) out[normalize(m.name)] = withPages(m.sources, s.name);
  }
  return out;
}

/** A short label for how a model is sold, e.g. "Amazon only · discontinued". */
export function modelNote(m: Reference["series"][number]["models"][number]): string {
  return [m.retailerExclusive ? `${m.retailerExclusive} only` : null, m.discontinued ? "discontinued" : null, m.regions.length ? m.regions.join(", ") : null]
    .filter(Boolean)
    .join(" · ");
}

/** The catalog tree for a reference: every node verified, other names include the bare model number. */
export function treeFromReference(ref: Reference): TreeNode {
  return cleanTree({
    id: null,
    level: "family",
    name: ref.family,
    aliases: ref.familyAliases,
    verified: true,
    children: ref.series.map((s) => ({
      id: null,
      level: "series" as const,
      name: s.name,
      aliases: [],
      verified: s.sources.length > 0,
      children: s.models.map((m) => ({ id: null, level: "model" as const, name: m.name, aliases: [m.number, ...m.aliases], verified: true, children: [] })),
    })),
  });
}

/**
 * Replaces a catalog's contents with the reference, keeping the ids of nodes that are the same product (same name,
 * or for models the same number), so links from posts survive. Returns the names of nodes the reference doesn't
 * contain; they are dropped because they couldn't be verified.
 */
export function applyReference(current: TreeNode, ref: Reference): { tree: TreeNode; removed: string[] } {
  const next = treeFromReference(ref);
  const oldSeries = current.children;
  const oldModels = oldSeries.flatMap((s) => s.children);
  const used = new Set<number>();
  const take = (candidates: TreeNode[], match: (n: TreeNode) => boolean): number | null => {
    const hit = candidates.find((n) => n.id !== null && !used.has(n.id) && match(n));
    if (hit?.id == null) return null;
    used.add(hit.id);
    return hit.id;
  };
  const numberOf = (n: TreeNode) => n.aliases.find((a) => /^\d{3,4}[a-z]{0,2}$/i.test(a.trim()));

  const tree: TreeNode = {
    ...next,
    id: current.id,
    children: next.children.map((s) => ({
      ...s,
      id: take(oldSeries, (o) => normalize(o.name) === normalize(s.name)),
      children: s.children.map((m) => {
        const num = numberOf(m);
        return {
          ...m,
          id: take(oldModels, (o) => normalize(o.name) === normalize(m.name) || (num !== undefined && [o.name, ...o.aliases].some((a) => normalize(a) === normalize(num)))),
        };
      }),
    })),
  };
  const removed = [...oldSeries, ...oldModels].filter((n) => n.id !== null && !used.has(n.id)).map((n) => n.name);
  return { tree, removed };
}

/**
 * A page a person can read for a source. HP's support site builds its pages from a JSON endpoint; when the evidence
 * is that endpoint, link the series' normal support page (same series id) next to it.
 */
export function readablePage(src: Source, seriesName: string): string | null {
  const u = new URL(src.url);
  const id = u.hostname === "support.hp.com" && u.pathname.startsWith("/wcc-services/productdata/") ? u.searchParams.get("seriesid") : null;
  if (!id || !/^\d+$/.test(id)) return null;
  const slug = seriesName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `https://support.hp.com/us-en/product/details/${slug}/${id}`;
}
