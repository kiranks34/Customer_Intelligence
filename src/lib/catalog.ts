/**
 * Product catalog helpers (docs/ARCHITECTURE.md §6, docs/DECISIONS.md D29). Pure: no DB, no network.
 *
 * A catalog is one tree per product family: family → series → model. Claude drafts it, you review it, and posts
 * are linked to the models they name by whole-word match on names and other names ("aliases"). Counting is done
 * here and in SQL, never by a model.
 */
import { z } from "zod";

// HP lists 27 Smart Tank series (up to 15 models each), so the limits leave room for a family of that size.
export const CATALOG_LIMITS = { series: 40, modelsPerSeries: 30, aliases: 12, name: 80 } as const;

/** Brands dropped when turning a family name into the words people use for it ("HP Smart Tank" → "smart tank"). */
const BRANDS = ["hp", "epson", "canon", "brother", "xerox", "lexmark", "kodak", "samsung"];
/** Generic words that don't change which family a subject means. */
const GENERIC = new Set(["printer", "printers", "series", "family", "line", "range", "products", "product", "models", "model", "the", "all"]);

/** Lowercase, unify dashes/underscores/slashes to spaces and collapse whitespace, so "Smart-Tank  7301" = "smart tank 7301". */
export function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The key that makes searches of the same family share one catalog: "HP Smart Tank printers" → "hp smart tank". */
export function familyKey(subject: string): string {
  return normalize(subject)
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .split(" ")
    .filter((w) => w && !GENERIC.has(w))
    .join(" ");
}

/**
 * A key compared loosely: without brand words, spaces or doubled letters, so "HP Smart Tank", "smart tank",
 * "SmartTank" and "smartank" are the same family.
 */
export function looseFamilyKey(key: string): string {
  const words = familyKey(key).split(" ").filter(Boolean);
  return (BRANDS.includes(words[0]) ? words.slice(1) : words).join("").replace(/(\p{L})\1+/gu, "$1");
}

/** The words people use for a family without its brand: "hp smart tank" → "smart tank". */
export function familyTerms(names: string[]): string[] {
  const out = new Set<string>();
  for (const n of names) {
    const words = normalize(n).split(" ").filter((w) => !GENERIC.has(w));
    const t = (BRANDS.includes(words[0]) ? words.slice(1) : words).join(" ");
    if (t.length >= 3) out.add(t);
  }
  return [...out];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A family term matched with or without spaces: "smart tank" also finds "smarttank". */
/**
 * A family term matched however people type it: any case, with or without spaces, and with the shared letter
 * written once: "smart tank" also finds "SmartTank", "smarttank" and "smartank".
 */
function termPattern(t: string): string {
  const words = t.split(" ").filter(Boolean);
  let out = escape(words[0] ?? "");
  for (let i = 1; i < words.length; i++) {
    const prev = words[i - 1];
    const w = words[i];
    out += prev.at(-1) === w[0] ? `\\s*${escape(w[0])}?${escape(w.slice(1))}` : `\\s*${escape(w)}`;
  }
  return out;
}

/**
 * What may come right before a model number: a family term ("smart tank") or any form ending in the family's last
 * word, with one optional word in front ("tank", "ink tank", "inktank", "hp tank"). Numbers alone are too common
 * to match, so this is how "580" becomes Smart Tank 580 but "580 pages" stays nothing. It only ever matches
 * numbers that are models in the catalog (compileMatcher), so another family's "Ink Tank 415" is not claimed.
 */
function numberPrefix(terms: string[], loose = true): string {
  const last = [...new Set(terms.map((t) => t.split(" ").at(-1)!).filter(Boolean))];
  const looseRe = last.length ? `(?:\\p{L}+\\s+)?\\p{L}*(?:${last.map(escape).join("|")})` : null;
  return [...terms.map(termPattern), ...(loose && looseRe ? [looseRe] : [])].join("|");
}

export interface Mention {
  /** e.g. "smart tank 7301" */
  text: string;
  /** Number of posts that mention it (each post counts once). */
  posts: number;
}

/**
 * Finds model-like mentions ("Smart Tank 7301", "smarttank plus 555") in post texts and counts the posts that
 * mention each one. Used to show Claude which models people actually talk about, and to list mentions the
 * catalog doesn't cover yet.
 */
export function findMentions(texts: string[], terms: string[], limit = 40): Mention[] {
  if (terms.length === 0) return [];
  // Only the family's own name counts here ("Smart Tank", "SmartTank", "smartank"). The looser forms ("tank",
  // "ink tank") are only trusted for numbers already in the catalog (compileMatcher); here they would suggest
  // other product lines or phrases like "the tank 210".
  const strict = terms.map((t) => ({ t, re: new RegExp(`^(?:${termPattern(t)})$`, "u") }));
  const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])(${numberPrefix(terms, false)})\\s*(plus\\s*)?(\\d{3,4}[a-z]{0,2})(?![\\p{L}\\p{N}])`, "gu");
  const counts = new Map<string, number>();
  for (const t of texts) {
    const seen = new Set<string>();
    for (const m of normalize(t).matchAll(re)) {
      const canonical = strict.find((x) => x.re.test(m[1]))?.t ?? m[1];
      seen.add(`${canonical}${m[2] ? " plus" : ""} ${m[3]}`);
    }
    for (const k of seen) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([text, posts]) => ({ text, posts }))
    .sort((a, b) => b.posts - a.posts || a.text.localeCompare(b.text))
    .slice(0, limit);
}

// ---- The tree -------------------------------------------------------------------------------------------------

export type Level = "family" | "series" | "model";

export const TreeNodeSchema: z.ZodType<TreeNode> = z.lazy(() =>
  z.object({
    id: z.number().int().positive().nullable(),
    level: z.enum(["family", "series", "model"]),
    name: z.string(),
    aliases: z.array(z.string()),
    verified: z.boolean(),
    retired: z.boolean().optional(),
    children: z.array(TreeNodeSchema),
  }),
);

export interface TreeNode {
  /** Null for a node not saved yet. */
  id: number | null;
  level: Level;
  name: string;
  aliases: string[];
  verified: boolean;
  /** Retired (sunset): kept for history, hidden from pickers and new reports. */
  retired?: boolean;
  children: TreeNode[];
}

/** What Claude returns. Kept flat and small so it fits a structured-output schema. */
export const CatalogDraftSchema = z.object({
  family: z.object({ name: z.string(), aliases: z.array(z.string()) }),
  series: z.array(
    z.object({
      name: z.string().describe("Series name as HP uses it, e.g. 'Smart Tank 7000 series'"),
      aliases: z.array(z.string()),
      verified: z.boolean().describe("true only if you are confident this series exists"),
      models: z.array(
        z.object({
          name: z.string().describe("Model name, e.g. 'Smart Tank 7301'"),
          aliases: z.array(z.string()).describe("How people write it: '7301', 'ST 7301', 'SmartTank 7301'"),
          verified: z.boolean().describe("true only if you are confident this exact model exists"),
        }),
      ),
    }),
  ),
  notes: z.string().describe("One or two sentences: what is uncertain and should be checked"),
});
export type CatalogDraft = z.infer<typeof CatalogDraftSchema>;

const cleanName = (s: string) => s.trim().replace(/\s+/g, " ").slice(0, CATALOG_LIMITS.name);
/** Trimmed, deduplicated (ignoring case and dashes), without the node's own name, capped. */
function cleanAliases(aliases: string[], name: string): string[] {
  const seen = new Set([normalize(name)]);
  const out: string[] = [];
  for (const a of aliases.map(cleanName)) {
    const k = normalize(a);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out.slice(0, CATALOG_LIMITS.aliases);
}

/**
 * Applies limits and removes empty or duplicate nodes, whatever an edit or Claude proposes. Siblings with the
 * same name are merged first (other names and children combined), so duplicates below them merge too.
 * Nodes past the limits are dropped; use `treeLimitError` to refuse an edited tree instead.
 */
export function cleanTree(root: TreeNode): TreeNode {
  const clean = (n: TreeNode, level: Level): TreeNode | null => {
    const name = cleanName(n.name);
    if (!name) return null;
    const childLevel: Level | null = level === "family" ? "series" : level === "series" ? "model" : null;
    const max = level === "family" ? CATALOG_LIMITS.series : CATALOG_LIMITS.modelsPerSeries;
    const groups: TreeNode[] = [];
    if (childLevel) {
      for (const c of n.children) {
        const key = normalize(cleanName(c.name));
        if (!key) continue;
        const same = groups.find((g) => normalize(cleanName(g.name)) === key);
        if (same) {
          same.aliases = [...same.aliases, ...c.aliases];
          same.children = [...same.children, ...c.children];
        } else groups.push({ ...c, aliases: [...c.aliases], children: [...c.children] });
      }
    }
    const kids = childLevel
      ? groups
          .map((g) => clean(g, childLevel))
          .filter((k): k is TreeNode => k !== null)
          .slice(0, max)
      : [];
    return { id: n.id, level, name, aliases: cleanAliases(n.aliases, name), verified: n.verified, children: kids };
  };
  return clean(root, "family") ?? { ...root, name: "Unnamed family", children: [] };
}

/** Why an edited tree can't be saved as is (too many series or models), or null. Saving never drops nodes silently. */
export function treeLimitError(root: TreeNode): string | null {
  const named = (xs: TreeNode[]) => xs.filter((x) => cleanName(x.name));
  if (named(root.children).length > CATALOG_LIMITS.series) return `A catalog can have up to ${CATALOG_LIMITS.series} series.`;
  const full = root.children.find((s) => named(s.children).length > CATALOG_LIMITS.modelsPerSeries);
  return full ? `${full.name || "A series"} has more than ${CATALOG_LIMITS.modelsPerSeries} models. Merge or remove some.` : null;
}

/** Turns Claude's draft into a tree (nothing saved yet, so no ids). */
export function treeFromDraft(d: CatalogDraft): TreeNode {
  return cleanTree({
    id: null,
    level: "family",
    name: d.family.name,
    aliases: d.family.aliases,
    verified: true,
    children: d.series.map((s) => ({
      id: null,
      level: "series" as const,
      name: s.name,
      aliases: s.aliases,
      verified: s.verified,
      children: s.models.map((m) => ({ id: null, level: "model" as const, name: m.name, aliases: m.aliases, verified: m.verified, children: [] })),
    })),
  });
}

// ---- Matching posts to nodes ----------------------------------------------------------------------------------

export interface FlatNode {
  id: number;
  parentId: number | null;
  level: Level;
  name: string;
  aliases: string[];
}

/** 3-digit numbers and years are too common ("$500", "500 pages", "2023") to match on their own. */
const needsFamilyWord = (alias: string) => /^\d{1,3}[a-z]{0,2}$/.test(alias) || /^(19|20)\d\d$/.test(alias);

/**
 * Builds a matcher that returns the most specific nodes a text names: a model hides its own series and family.
 * Matching is whole-word and ignores case and dashes. Short numbers ("580") only count right after a family word
 * ("Smart Tank 580"); longer ones ("7301") count on their own.
 */
export function compileMatcher(nodes: FlatNode[], opts: { sharedNumbers?: string[] } = {}): (text: string) => number[] {
  const family = nodes.find((n) => n.level === "family");
  const terms = family ? familyTerms([family.name, ...family.aliases]) : [];
  const termsRe = terms.length ? numberPrefix(terms) : "";
  // Numbers another product line also uses (e.g. an "Ink Tank" model) only count after this family's own name.
  const strictRe = terms.length ? numberPrefix(terms, false) : "";
  const shared = new Set((opts.sharedNumbers ?? []).map(normalize));
  const parent = new Map(nodes.map((n) => [n.id, n.parentId]));

  const rules = nodes.map((n) => {
    const patterns = [n.name, ...n.aliases]
      .map(normalize)
      .filter(Boolean)
      .map((a) => {
        const body = a.split(" ").map(escape).join(" ");
        const prefixRe = shared.has(a) ? strictRe : termsRe;
        const prefixed = prefixRe ? `(?:${prefixRe})\\s*(?:plus\\s*)?${body}` : null;
        if (shared.has(a)) return prefixed;
        if (needsFamilyWord(a)) return prefixed;
        // Multi-word names ("Smart Tank 7301") also match typed without spaces or with the shared letter once.
        return a.includes(" ") ? termPattern(a) : body;
      })
      .filter((p): p is string => p !== null);
    return { id: n.id, re: patterns.length ? new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${patterns.join("|")})(?![\\p{L}\\p{N}])`, "u") : null };
  });

  return (text: string) => {
    const t = normalize(text);
    const hits = new Set(rules.filter((r) => r.re?.test(t)).map((r) => r.id));
    // Drop any hit that is an ancestor of another hit.
    for (const id of [...hits]) {
      let p = parent.get(id) ?? null;
      while (p !== null) {
        hits.delete(p);
        p = parent.get(p) ?? null;
      }
    }
    return [...hits].sort((a, b) => a - b);
  };
}

/** Flattens a saved tree (every node has an id) for matching. */
export function flatten(root: TreeNode): FlatNode[] {
  const out: FlatNode[] = [];
  const walk = (n: TreeNode, parentId: number | null) => {
    if (n.id === null) return;
    out.push({ id: n.id, parentId, level: n.level, name: n.name, aliases: n.aliases });
    for (const c of n.children) walk(c, n.id);
  };
  walk(root, null);
  return out;
}

/** True when some node's name or alias already covers a mention like "smart tank 750". */
export function isCovered(mention: string, matcher: (text: string) => number[], nodes: FlatNode[]): boolean {
  const levels = new Map(nodes.map((n) => [n.id, n.level]));
  return matcher(mention).some((id) => levels.get(id) === "model");
}

// ---- Editing helpers (used by the review screen) --------------------------------------------------------------

/** Position of a model in the tree: [series index, model index]. */
export type ModelPath = [number, number];

/**
 * Merges one model into another (e.g. a duplicate "7301" into "Smart Tank 7301"): the merged model's name and
 * other names become other names of the target, and the merged model is removed.
 */
export function mergeModel(root: TreeNode, from: ModelPath, into: ModelPath): TreeNode {
  if (from[0] === into[0] && from[1] === into[1]) return root;
  const src = root.children[from[0]]?.children[from[1]];
  const dst = root.children[into[0]]?.children[into[1]];
  if (!src || !dst) return root;
  const children = root.children.map((s, si) => ({
    ...s,
    children: s.children
      .map((m, mi) => (si === into[0] && mi === into[1] ? { ...m, aliases: cleanAliases([...m.aliases, src.name, ...src.aliases], m.name) } : m))
      .filter((_, mi) => !(si === from[0] && mi === from[1])),
  }));
  return { ...root, children };
}

const titleCase = (s: string) => s.replace(/(^|\s)(\p{L})/gu, (_, sp: string, c: string) => sp + c.toUpperCase());

/** A new model from a mention like "smart tank plus 555": named "Smart Tank Plus 555", with "555" as another name. */
export function modelFromMention(mention: string): TreeNode {
  const num = mention.match(/(\d{3,4}[a-z]{0,2})$/)?.[1];
  return { id: null, level: "model", name: titleCase(mention), aliases: num ? [num] : [], verified: false, children: [] };
}

// ---- Names: what's recognised automatically, and conflicts ----------------------------------------------------

/** Compared ignoring case, spaces, dashes and doubled letters ("Smart-Tank 7301" = "smarttank7301" = "smartank 7301"). */
const squash = (s: string) => normalize(s).replace(/\s+/g, "").replace(/(\p{L})\1+/gu, "$1");

/**
 * Examples of how a model's number is recognised without anyone typing them in (shown on the catalog page), e.g.
 * for 7301: "SmartTank 7301", "Smartank 7301", "tank 7301", "ink tank 7301", "inktank 7301". Case never matters.
 */
export function automaticVariants(model: TreeNode, family: TreeNode, limit = 8): string[] {
  const numbers = [model.name, ...model.aliases].map((a) => a.match(/(\d{3,4}[a-z]{0,2})\s*$/i)?.[1]).filter((n): n is string => !!n);
  const n = numbers[0];
  if (!n) return [];
  // The family's words ("smart tank"); single-word forms like "SmartTank" are covered by the spelling rules.
  const words = familyTerms([family.name, ...family.aliases]).find((t) => t.includes(" "))?.split(" ");
  if (!words) return [];
  const cap = (w: string) => w[0].toUpperCase() + w.slice(1);
  const joined = words.map(cap).join("");
  const last = words.at(-1)!;
  const forms = new Set([joined, joined.replace(/(\p{L})\1+/giu, "$1"), last, `ink ${last}`, `ink${last}`]);
  const taken = new Set([model.name, ...model.aliases].map(normalize));
  return [...forms].map((f) => `${f} ${n}`).filter((v) => !taken.has(normalize(v))).slice(0, limit);
}

/**
 * The other node a new name would clash with, if any: the same name or other name (ignoring case, spaces and doubled
 * letters) already belongs to another series or model, so adding it would merge two products by mistake.
 */
export function nameConflict(root: TreeNode, nodeId: number, name: string): string | null {
  const key = squash(name);
  if (!key) return null;
  const walk = (n: TreeNode): string | null => {
    // The family's own names count too: a model called "smart tank" would claim every general family post.
    const names = n.level === "family" ? [n.name, ...n.aliases, ...familyTerms([n.name, ...n.aliases])] : [n.name, ...n.aliases];
    if (n.id !== nodeId && names.some((a) => squash(a) === key)) return n.level === "family" ? `the whole ${n.name} family` : n.name;
    for (const c of n.children) {
      const hit = walk(c);
      if (hit) return hit;
    }
    return null;
  };
  return walk(root);
}
