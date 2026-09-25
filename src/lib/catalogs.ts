import "server-only";

import { and, asc, count, countDistinct, eq, getTableColumns, inArray, isNull, sql } from "drizzle-orm";

import { requireDb } from "@/db/client";
import { catalogNodes, catalogs, postProducts, posts, searches } from "@/db/schema";

import { isListed, listedNames, treeFromReference } from "./catalog-reference";
import { referenceFor } from "./catalog-references";
import {
  cleanTree,
  compileMatcher,
  familyKey,
  findMentions,
  familyTerms,
  flatten,
  guessSeries,
  isCovered,
  modelFromMention,
  snippet,
  squashName,
  type FlatNode,
  type Level,
  type Mention,
  type TreeNode,
} from "./catalog";

/** Database side of the product catalog (docs/DECISIONS.md D29). Counts come from SQL over post_products. */

/** Everything but the official facts (read only where needed, D44), so pages keep working before migration 0004. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- left out on purpose
const { productFacts: _facts, ...catalogColumns } = getTableColumns(catalogs);
export type CatalogRow = Omit<typeof catalogs.$inferSelect, "productFacts">;

export async function getCatalog(id: number): Promise<{ catalog: CatalogRow; tree: TreeNode } | null> {
  const db = requireDb();
  const [catalog] = await db.select(catalogColumns).from(catalogs).where(eq(catalogs.id, id));
  if (!catalog) return null;
  return { catalog, tree: await loadTree(id, catalog.name) };
}

export async function catalogByKey(key: string): Promise<CatalogRow | null> {
  const [c] = await requireDb().select(catalogColumns).from(catalogs).where(eq(catalogs.key, key));
  return c ?? null;
}

/**
 * The catalog's approved nodes (proposals waiting for approval are left out). Retired nodes are included: they still
 * match posts so history adds up, and the pickers hide them.
 */
async function loadNodes(catalogId: number) {
  return requireDb()
    .select({
      id: catalogNodes.id,
      parentId: catalogNodes.parentId,
      level: catalogNodes.level,
      name: catalogNodes.name,
      aliases: catalogNodes.aliases,
      verified: catalogNodes.verified,
      retiredAt: catalogNodes.retiredAt,
    })
    .from(catalogNodes)
    .where(and(eq(catalogNodes.catalogId, catalogId), isNull(catalogNodes.proposedAt)))
    .orderBy(asc(catalogNodes.sort), asc(catalogNodes.id));
}

async function loadTree(catalogId: number, fallbackName: string): Promise<TreeNode> {
  const rows = await loadNodes(catalogId);
  const byId = new Map<number, TreeNode>();
  for (const r of rows) {
    byId.set(r.id, { id: r.id, level: r.level as Level, name: r.name, aliases: r.aliases, verified: r.verified, retired: r.retiredAt !== null, children: [] });
  }
  let root: TreeNode | null = null;
  for (const r of rows) {
    const node = byId.get(r.id)!;
    if (r.level === "family" && r.parentId === null) root ??= node;
    else if (r.parentId !== null) byId.get(r.parentId)?.children.push(node);
  }
  return root ?? { id: null, level: "family", name: fallbackName, aliases: [], verified: true, children: [] };
}

/** Creates a catalog from a tree. If saving the nodes fails, the half-made catalog is removed. */
export async function createCatalog(key: string, tree: TreeNode): Promise<number> {
  const db = requireDb();
  const clean = cleanTree(tree);
  const [c] = await db.insert(catalogs).values({ key, name: clean.name }).returning({ id: catalogs.id });
  try {
    await saveTree(c.id, clean);
  } catch (err) {
    await db.delete(catalogs).where(eq(catalogs.id, c.id));
    throw err;
  }
  return c.id;
}

type Db = ReturnType<typeof requireDb>;
type Batch = Parameters<Db["batch"]>[0];
/** Runs statements in one round trip and one transaction (all or nothing). */
const runBatch = (db: Db, items: unknown[]) => (items.length ? db.batch(items as unknown as Batch) : Promise.resolve([]));

/**
 * Saves an edited tree, keeping node ids where they still exist (so links from posts survive renames).
 * Ids that don't belong to this catalog are treated as new nodes; nodes missing from the tree are deleted.
 * One batch per level (family, series, models), so a full catalog saves in a few round trips.
 */
export async function saveTree(catalogId: number, tree: TreeNode): Promise<void> {
  const db = requireDb();
  const clean = cleanTree(tree);
  // Proposals aren't part of the tree being saved, so they are neither updated nor deleted here.
  const existing = new Set(
    (await db.select({ id: catalogNodes.id }).from(catalogNodes).where(and(eq(catalogNodes.catalogId, catalogId), isNull(catalogNodes.proposedAt)))).map((r) => r.id),
  );
  const kept = new Set<number>();

  // Each entry: a node to write under an already-saved parent. Returns the saved children for the next level.
  let level: { node: TreeNode; parentId: number | null; sort: number }[] = [{ node: clean, parentId: null, sort: 0 }];
  while (level.length) {
    const statements = level.map(({ node, parentId, sort }) => {
      const values = { catalogId, parentId, level: node.level, name: node.name, aliases: node.aliases, verified: node.verified, sort };
      return node.id !== null && existing.has(node.id)
        ? db.update(catalogNodes).set(values).where(eq(catalogNodes.id, node.id)).returning({ id: catalogNodes.id })
        : db.insert(catalogNodes).values(values).returning({ id: catalogNodes.id });
    });
    const results = (await runBatch(db, statements)) as { id: number }[][];
    const next: typeof level = [];
    level.forEach(({ node }, i) => {
      const id = results[i][0].id;
      kept.add(id);
      node.children.forEach((c, j) => next.push({ node: c, parentId: id, sort: j }));
    });
    level = next;
  }

  const gone = [...existing].filter((id) => !kept.has(id));
  await runBatch(db, [
    ...(gone.length ? [db.delete(catalogNodes).where(inArray(catalogNodes.id, gone))] : []),
    db.update(catalogs).set({ name: clean.name }).where(eq(catalogs.id, catalogId)),
  ]);
}


export async function linkSearch(searchId: number, catalogId: number): Promise<void> {
  await requireDb().update(searches).set({ catalogId }).where(eq(searches.id, searchId));
}

const CHUNK = 500;

/**
 * Re-links posts to the catalog's series and models by name/alias match (method "alias"): one search's posts, or
 * those of every search using the catalog. Idempotent, and all or nothing: old alias links are replaced in the
 * same transaction. Links made by other methods (Jev, listings) are kept.
 */
async function relink(catalogId: number, searchId?: number): Promise<number> {
  const db = requireDb();
  const nodes: FlatNode[] = (await loadNodes(catalogId)).map((n) => ({ ...n, level: n.level as Level }));
  const [c] = await db.select({ key: catalogs.key }).from(catalogs).where(eq(catalogs.id, catalogId));
  const match = compileMatcher(nodes, { sharedNumbers: (c && referenceFor(c.key)?.sharedNumbers) || [] });
  const scope = searchId === undefined ? eq(searches.catalogId, catalogId) : and(eq(searches.catalogId, catalogId), eq(searches.id, searchId));
  const rows = await db.select({ id: posts.id, title: posts.title, text: posts.text }).from(posts).innerJoin(searches, eq(posts.searchId, searches.id)).where(scope);
  const links = rows.flatMap((p) => match(`${p.title}\n${p.text}`).map((nodeId) => ({ postId: p.id, nodeId, method: "alias" as const, confidence: 1 })));

  const inScope = db.select({ id: posts.id }).from(posts).innerJoin(searches, eq(posts.searchId, searches.id)).where(scope);
  const inserts = [];
  for (let i = 0; i < links.length; i += CHUNK) inserts.push(db.insert(postProducts).values(links.slice(i, i + CHUNK)).onConflictDoNothing());
  await runBatch(db, [db.delete(postProducts).where(and(eq(postProducts.method, "alias"), inArray(postProducts.postId, inScope))), ...inserts]);
  return links.length;
}

/** Links one search's posts to its catalog (after linking the search, or when a collection run finishes). */
export const matchSearch = (searchId: number, catalogId: number) => relink(catalogId, searchId);

/** Re-links the posts of every search that uses this catalog (after the catalog was edited). */
export const matchCatalog = (catalogId: number) => relink(catalogId);

export interface CatalogStats {
  /** Posts in scope (the given search, or every search using the catalog). */
  posts: number;
  /** Of those, posts linked to at least one node below the family (a series or model). */
  postsNamingProduct: number;
  /** Posts per node id (the most specific node each post names). */
  byNode: Record<number, number>;
  /** Posts per series id: posts naming the series or any of its models, each post counted once. */
  bySeries: Record<number, number>;
  searches: number;
}

/** Mention counts per node, computed in SQL. Scope: one search, or all searches using the catalog. */
export async function catalogStats(catalogId: number, searchId?: number): Promise<CatalogStats> {
  const db = requireDb();
  const scope = searchId === undefined ? eq(searches.catalogId, catalogId) : and(eq(searches.catalogId, catalogId), eq(searches.id, searchId));
  const inScope = db.select({ id: posts.id }).from(posts).innerJoin(searches, eq(posts.searchId, searches.id)).where(scope);
  const nodeRows = db.select({ id: catalogNodes.id }).from(catalogNodes).where(eq(catalogNodes.catalogId, catalogId));
  const productNodes = db
    .select({ id: catalogNodes.id })
    .from(catalogNodes)
    .where(and(eq(catalogNodes.catalogId, catalogId), sql`${catalogNodes.level} <> 'family'`));

  const seriesOf = sql<number>`case when ${catalogNodes.level} = 'model' then ${catalogNodes.parentId} else ${catalogNodes.id} end`;
  const [[total], [named], perNode, [linked], perSeries] = await Promise.all([
    db.select({ n: count() }).from(posts).innerJoin(searches, eq(posts.searchId, searches.id)).where(scope),
    db
      .select({ n: countDistinct(postProducts.postId) })
      .from(postProducts)
      .where(and(inArray(postProducts.nodeId, productNodes), inArray(postProducts.postId, inScope))),
    db
      .select({ nodeId: postProducts.nodeId, n: countDistinct(postProducts.postId) })
      .from(postProducts)
      .where(and(inArray(postProducts.nodeId, nodeRows), inArray(postProducts.postId, inScope)))
      .groupBy(postProducts.nodeId),
    db.select({ n: count() }).from(searches).where(scope),
    db
      .select({ seriesId: seriesOf, n: countDistinct(postProducts.postId) })
      .from(postProducts)
      .innerJoin(catalogNodes, eq(postProducts.nodeId, catalogNodes.id))
      .where(and(eq(catalogNodes.catalogId, catalogId), sql`${catalogNodes.level} in ('series','model')`, inArray(postProducts.postId, inScope)))
      .groupBy(seriesOf),
  ]);
  return {
    posts: total?.n ?? 0,
    postsNamingProduct: named?.n ?? 0,
    byNode: Object.fromEntries(perNode.map((r) => [r.nodeId, r.n])),
    bySeries: Object.fromEntries(perSeries.map((r) => [Number(r.seriesId), r.n])),
    searches: linked?.n ?? 0,
  };
}

/** Texts of the posts in scope, for finding model mentions. */
export async function postTexts(opts: { searchId: number } | { catalogId: number }): Promise<string[]> {
  const db = requireDb();
  const where = "searchId" in opts ? eq(posts.searchId, opts.searchId) : eq(searches.catalogId, opts.catalogId);
  const rows = await db.select({ title: posts.title, text: posts.text }).from(posts).innerJoin(searches, eq(posts.searchId, searches.id)).where(where);
  return rows.map((r) => `${r.title}\n${r.text}`);
}

/** Model-like mentions in the catalog's posts that no model covers yet, e.g. a model Claude missed. */
export async function uncoveredMentions(catalogId: number, tree: TreeNode, key: string, limit = 15): Promise<Mention[]> {
  const nodes = flatten(tree);
  const match = compileMatcher(nodes, { sharedNumbers: referenceFor(key)?.sharedNumbers ?? [] });
  const terms = familyTerms([tree.name, ...tree.aliases]);
  return findMentions(await postTexts({ catalogId }), terms, 60)
    .filter((m) => !isCovered(m.text, match, nodes))
    .slice(0, limit);
}

/** A node of this catalog with its level and parent, or null (so actions can't touch another catalog's nodes). */
export async function catalogNode(catalogId: number, nodeId: number) {
  const [n] = await requireDb()
    .select({ id: catalogNodes.id, level: catalogNodes.level, parentId: catalogNodes.parentId, name: catalogNodes.name, aliases: catalogNodes.aliases })
    .from(catalogNodes)
    .where(and(eq(catalogNodes.id, nodeId), eq(catalogNodes.catalogId, catalogId)));
  return n ?? null;
}

export async function setAliases(nodeId: number, aliases: string[]): Promise<void> {
  await requireDb().update(catalogNodes).set({ aliases }).where(eq(catalogNodes.id, nodeId));
}

/**
 * Retires (or restores) a node. Retiring a series takes its active models with it, stamped with the same time;
 * restoring the series brings back only those, so a model retired on its own stays retired.
 */
export async function setRetired(catalogId: number, nodeId: number, retired: boolean): Promise<void> {
  const db = requireDb();
  const inCatalog = eq(catalogNodes.catalogId, catalogId);
  if (retired) {
    const at = new Date();
    await db.batch([
      db.update(catalogNodes).set({ retiredAt: at }).where(and(inCatalog, eq(catalogNodes.id, nodeId))),
      // Proposals under it stay waiting for your decision (retiring them would reject them silently).
      db
        .update(catalogNodes)
        .set({ retiredAt: at })
        .where(and(inCatalog, eq(catalogNodes.parentId, nodeId), isNull(catalogNodes.retiredAt), isNull(catalogNodes.proposedAt))),
    ]);
    return;
  }
  const [node] = await db.select({ retiredAt: catalogNodes.retiredAt }).from(catalogNodes).where(and(inCatalog, eq(catalogNodes.id, nodeId)));
  if (!node?.retiredAt) return;
  await db.batch([
    db.update(catalogNodes).set({ retiredAt: null }).where(and(inCatalog, eq(catalogNodes.parentId, nodeId), eq(catalogNodes.retiredAt, node.retiredAt))),
    db.update(catalogNodes).set({ retiredAt: null }).where(and(inCatalog, eq(catalogNodes.id, nodeId))),
  ]);
}

// ---- Families, manual additions and proposals ------------------------------------------------------------------

/** Every family (one catalog each), for the Family picker. */
export async function listFamilies(): Promise<{ id: number; name: string }[]> {
  return requireDb().select({ id: catalogs.id, name: catalogs.name }).from(catalogs).orderBy(asc(catalogs.name));
}

/** Adds a series under the family, or a model under a series, as approved (you typed it). */
export async function addNode(catalogId: number, parentId: number, level: "series" | "model", name: string, aliases: string[]): Promise<number> {
  const [{ id }] = await requireDb()
    .insert(catalogNodes)
    .values({ catalogId, parentId, level, name, aliases, verified: true, sort: 1000, evidence: { source: "manual" } })
    .returning({ id: catalogNodes.id });
  return id;
}

export interface ProposalEvidence {
  /**
   * Where it came from: model mentions in collected posts, the family's verified reference list, added by hand, or
   * confirmed by you with Keep.
   */
  source: "posts" | "reference" | "manual" | "kept";
  posts?: number;
  examples?: string[];
  url?: string;
}

export interface Proposal {
  id: number;
  level: "series" | "model";
  name: string;
  aliases: string[];
  parentId: number | null;
  evidence: ProposalEvidence | null;
}

/** Proposals waiting for your decision (rejected ones stay stored so they are never proposed again). */
export async function listProposals(catalogId: number): Promise<Proposal[]> {
  const rows = await requireDb()
    .select({ id: catalogNodes.id, level: catalogNodes.level, name: catalogNodes.name, aliases: catalogNodes.aliases, parentId: catalogNodes.parentId, evidence: catalogNodes.evidence })
    .from(catalogNodes)
    .where(and(eq(catalogNodes.catalogId, catalogId), sql`${catalogNodes.proposedAt} is not null`, isNull(catalogNodes.retiredAt)))
    .orderBy(asc(catalogNodes.id));
  return rows.map((r) => ({ ...r, level: r.level as "series" | "model", evidence: (r.evidence as ProposalEvidence | null) ?? null }));
}

const MIN_POSTS = 2;

/**
 * "Check for new models" (and each finished collection): suggests what the catalog is missing, to add or skip.
 * 1. Series and models in the family's verified reference list that aren't in the catalog.
 * 2. Model numbers written with the family's name in 2+ collected posts ("Smart Tank 7315") that no model covers,
 *    with the number of posts, two short examples and a guessed series.
 * Anything already in the catalog, retired, waiting, or rejected before is never proposed again.
 */
export async function findProposals(catalogId: number): Promise<{ reference: number; posts: number }> {
  const db = requireDb();
  const found = await getCatalog(catalogId);
  if (!found) return { reference: 0, posts: 0 };
  const { catalog, tree } = found;
  const family = tree.id;
  if (family === null) return { reference: 0, posts: 0 };

  // Everything already known, including proposals (pending or rejected), by squashed name and by model number.
  const known = await db
    .select({ name: catalogNodes.name, aliases: catalogNodes.aliases })
    .from(catalogNodes)
    .where(eq(catalogNodes.catalogId, catalogId));
  const names = new Set(known.flatMap((k) => [k.name, ...k.aliases]).map(squashName));
  const isKnown = (...xs: string[]) => xs.some((x) => names.has(squashName(x)));
  const remember = (...xs: string[]) => xs.forEach((x) => names.add(squashName(x)));
  const now = new Date();
  let fromReference = 0;
  let fromPosts = 0;

  const ref = referenceFor(catalog.key);
  if (ref) {
    // Series by name: approved ones and ones still waiting for approval, so new models attach to either.
    const waitingSeries = await db
      .select({ id: catalogNodes.id, name: catalogNodes.name })
      .from(catalogNodes)
      .where(and(eq(catalogNodes.catalogId, catalogId), eq(catalogNodes.level, "series"), sql`${catalogNodes.proposedAt} is not null`, isNull(catalogNodes.retiredAt)));
    const seriesByName = new Map<string, number>([
      ...tree.children.filter((s) => s.id !== null).map((s) => [squashName(s.name), s.id!] as [string, number]),
      ...waitingSeries.map((s) => [squashName(s.name), s.id] as [string, number]),
    ]);
    const newSeries = ref.series.filter((s) => !seriesByName.has(squashName(s.name)) && !isKnown(s.name));
    if (newSeries.length) {
      const rows = await db
        .insert(catalogNodes)
        .values(newSeries.map((s) => ({ catalogId, parentId: family, level: "series" as const, name: s.name, aliases: [], verified: true, proposedAt: now, evidence: { source: "reference", url: s.sources[0]?.url } })))
        .returning({ id: catalogNodes.id, name: catalogNodes.name });
      for (const r of rows) seriesByName.set(squashName(r.name), r.id);
      remember(...newSeries.map((s) => s.name));
      fromReference += rows.length;
    }
    const newModels = ref.series.flatMap((s) =>
      s.models
        .filter((m) => !isKnown(m.name, m.number))
        .map((m) => ({
          catalogId,
          parentId: seriesByName.get(squashName(s.name)) ?? null,
          level: "model" as const,
          name: m.name,
          aliases: [m.number, ...m.aliases],
          verified: true,
          proposedAt: now,
          evidence: { source: "reference", url: m.sources[0]?.url },
        })),
    );
    if (newModels.length) {
      await db.insert(catalogNodes).values(newModels);
      remember(...newModels.flatMap((m) => [m.name, ...m.aliases]));
      fromReference += newModels.length;
    }
  }

  const nodes = flatten(tree);
  const match = compileMatcher(nodes, { sharedNumbers: ref?.sharedNumbers ?? [] });
  const texts = await postTexts({ catalogId });
  const fromMentions = [];
  for (const m of findMentions(texts, familyTerms([tree.name, ...tree.aliases]), 60)) {
    const number = m.text.match(/(\d{3,4}[a-z]{0,2})$/)?.[1];
    if (m.posts < MIN_POSTS || !number || isCovered(m.text, match, nodes) || isKnown(m.text, number)) continue;
    const proposal = modelFromMention(m.text);
    const examples = texts.map((t) => snippet(t, m.text)).filter((x): x is string => x !== null).slice(0, 2);
    fromMentions.push({
      catalogId,
      parentId: guessSeries(tree, number.replace(/[a-z]+$/, "")),
      level: "model" as const,
      name: proposal.name,
      aliases: proposal.aliases,
      verified: false,
      proposedAt: now,
      evidence: { source: "posts", posts: m.posts, examples },
    });
    remember(m.text, number);
  }
  if (fromMentions.length) await db.insert(catalogNodes).values(fromMentions);
  fromPosts = fromMentions.length;
  // Two checks at once (a collection finishing while you click "Check for new models") can both add the same
  // product: keep the first and drop later copies, moving any models waiting under a copied series to the first.
  if (fromReference + fromPosts > 0) await dropDuplicateProposals(catalogId);
  return { reference: fromReference, posts: fromPosts };
}

async function dropDuplicateProposals(catalogId: number): Promise<void> {
  const db = requireDb();
  const dupes = sql`select a.id as dupe, min(b.id) as keep from catalog_nodes a join catalog_nodes b
    on b.catalog_id = a.catalog_id and b.level = a.level and lower(b.name) = lower(a.name) and b.id < a.id
    where a.catalog_id = ${catalogId} and a.proposed_at is not null and a.retired_at is null group by a.id`;
  await db.batch([
    db.execute(sql`update catalog_nodes c set parent_id = d.keep from (${dupes}) d where c.catalog_id = ${catalogId} and c.parent_id = d.dupe`),
    db.execute(sql`delete from catalog_nodes c using (${dupes}) d where c.id = d.dupe`),
  ]);
}

/**
 * Approves a proposal with the name and series you chose. For a proposed series, `childIds` are the models waiting
 * under it that can be approved with it (the action leaves out any whose name another product already has).
 */
export async function approveProposal(catalogId: number, nodeId: number, name: string, parentId: number, childIds: number[] = []): Promise<void> {
  const db = requireDb();
  const inCatalog = eq(catalogNodes.catalogId, catalogId);
  await db.batch([
    // Adding it is your confirmation, so it counts as verified from here on.
    db.update(catalogNodes).set({ name, parentId, proposedAt: null, verified: true }).where(and(inCatalog, eq(catalogNodes.id, nodeId))),
    ...(childIds.length
      ? [db.update(catalogNodes).set({ proposedAt: null, verified: true }).where(and(inCatalog, eq(catalogNodes.parentId, nodeId), inArray(catalogNodes.id, childIds), isNull(catalogNodes.retiredAt)))]
      : []),
  ]);
}

/** Rejects a proposal (and, for a series, the models proposed under it). It stays stored so it's never proposed again. */
export async function rejectProposal(catalogId: number, nodeId: number): Promise<void> {
  const db = requireDb();
  const at = new Date();
  await db.batch([
    db.update(catalogNodes).set({ retiredAt: at }).where(and(eq(catalogNodes.catalogId, catalogId), eq(catalogNodes.id, nodeId))),
    db
      .update(catalogNodes)
      .set({ retiredAt: at })
      .where(and(eq(catalogNodes.catalogId, catalogId), eq(catalogNodes.parentId, nodeId), sql`${catalogNodes.proposedAt} is not null`)),
  ]);
}

/** A proposal of this catalog, or null. */
export async function proposalNode(catalogId: number, nodeId: number) {
  const [n] = await requireDb()
    .select({ id: catalogNodes.id, level: catalogNodes.level, name: catalogNodes.name })
    .from(catalogNodes)
    .where(and(eq(catalogNodes.catalogId, catalogId), eq(catalogNodes.id, nodeId), sql`${catalogNodes.proposedAt} is not null`, isNull(catalogNodes.retiredAt)));
  return n ?? null;
}

/**
 * Makes sure a search uses its family's catalog: links it to the existing catalog for its subject (spelling and
 * brand ignored), or creates the catalog from the family's verified list when there is one. Topics outside any
 * known family (e.g. "Gen Z printers") get no catalog. Returns the catalog id, or null.
 */
export async function ensureCatalogForSearch(searchId: number, subject: string): Promise<number | null> {
  const db = requireDb();
  const [s] = await db.select({ catalogId: searches.catalogId }).from(searches).where(eq(searches.id, searchId));
  if (!s) return null;
  if (s.catalogId) return s.catalogId;
  const key = familyKey(subject);
  if (!key) return null;
  const reference = referenceFor(key);
  let catalog = await catalogByKey(reference?.key ?? key);
  if (!catalog && reference) {
    try {
      await createCatalog(reference.key, treeFromReference(reference));
    } catch {
      // Created by another request a moment ago (unique key): use that one.
    }
    catalog = await catalogByKey(reference.key);
  }
  if (!catalog) return null;
  await linkSearch(searchId, catalog.id);
  await matchSearch(searchId, catalog.id);
  return catalog.id;
}

export interface Unlisted {
  id: number;
  level: string;
  name: string;
  /** A series that holds models from the verified list: Remove would hide those too, so it's refused. */
  holdsListed: boolean;
}

/**
 * Products in a catalog that its family's verified list doesn't have and that you haven't added, approved or kept
 * yourself (those carry evidence; old AI-draft nodes don't). Compared with the list itself, not the stored `verified` flag, which old drafts set
 * by guessing. Empty for a family without a verified list.
 */
export async function unverifiedNodes(catalogId: number): Promise<Unlisted[]> {
  const found = await getCatalog(catalogId);
  const ref = found ? referenceFor(found.catalog.key) : null;
  if (!found || !ref) return [];
  const listed = listedNames(ref);
  const rows = await requireDb()
    .select({ id: catalogNodes.id, level: catalogNodes.level, name: catalogNodes.name, aliases: catalogNodes.aliases, parentId: catalogNodes.parentId, evidence: catalogNodes.evidence })
    .from(catalogNodes)
    .where(and(eq(catalogNodes.catalogId, catalogId), isNull(catalogNodes.proposedAt), isNull(catalogNodes.retiredAt), sql`${catalogNodes.level} <> 'family'`))
    .orderBy(asc(catalogNodes.id));
  const holdsListed = new Set(rows.filter((r) => r.level === "model" && isListed(listed, r.name, r.aliases)).map((r) => r.parentId));
  return rows
    .filter((r) => !isListed(listed, r.name, r.aliases) && r.evidence === null)
    .map((r) => ({ id: r.id, level: r.level, name: r.name, holdsListed: r.level === "series" && holdsListed.has(r.id) }));
}

/** "Keep": you confirm a product that isn't in the verified list, so it isn't asked about again. */
export async function markVerified(catalogId: number, nodeId: number): Promise<void> {
  await requireDb()
    .update(catalogNodes)
    .set({ verified: true, evidence: { source: "kept" } })
    .where(and(eq(catalogNodes.catalogId, catalogId), eq(catalogNodes.id, nodeId)));
}

/** How many new products are waiting for review in a catalog (for the search page notice). */
export async function waitingCount(catalogId: number): Promise<number> {
  const [r] = await requireDb()
    .select({ n: count() })
    .from(catalogNodes)
    .where(and(eq(catalogNodes.catalogId, catalogId), sql`${catalogNodes.proposedAt} is not null`, isNull(catalogNodes.retiredAt)));
  return r?.n ?? 0;
}
