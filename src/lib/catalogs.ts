import "server-only";

import { and, asc, count, countDistinct, eq, inArray, isNull, sql } from "drizzle-orm";

import { requireDb } from "@/db/client";
import { catalogNodes, catalogs, postProducts, posts, searches } from "@/db/schema";

import { referenceFor } from "./catalog-references";
import { cleanTree, compileMatcher, findMentions, familyTerms, flatten, isCovered, type FlatNode, type Level, type Mention, type TreeNode } from "./catalog";

/** Database side of the product catalog (docs/DECISIONS.md D29). Counts come from SQL over post_products. */

export type CatalogRow = typeof catalogs.$inferSelect;

export async function getCatalog(id: number): Promise<{ catalog: CatalogRow; tree: TreeNode } | null> {
  const db = requireDb();
  const [catalog] = await db.select().from(catalogs).where(eq(catalogs.id, id));
  if (!catalog) return null;
  return { catalog, tree: await loadTree(id, catalog.name) };
}

export async function catalogByKey(key: string): Promise<CatalogRow | null> {
  const [c] = await requireDb().select().from(catalogs).where(eq(catalogs.key, key));
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

export async function approveCatalog(catalogId: number): Promise<void> {
  await requireDb().update(catalogs).set({ status: "approved", approvedAt: sql`now()` }).where(eq(catalogs.id, catalogId));
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
      db.update(catalogNodes).set({ retiredAt: at }).where(and(inCatalog, eq(catalogNodes.parentId, nodeId), isNull(catalogNodes.retiredAt))),
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
