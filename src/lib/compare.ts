import "server-only";

import { and, eq, isNull, or, sql } from "drizzle-orm";

import { requireDb } from "@/db/client";
import { codebooks, comparisons, searches } from "@/db/schema";

import { latestCodebook, sampleOf, saveCodebook } from "./analysis";
import { CodebookError, draftCodebook } from "./codebook-drafter";
import type { Codebook } from "./codebook";
import { recordCost } from "./cost";
import { loadPlan } from "./collect";
import { storedFactsFor } from "./product-knowledge";

/**
 * Comparison studies (D48): two ordinary studies (side A and side B) run with the same sources, period, depth and
 * categories, shown as one. Each side keeps its own posts, answers, reviews and product knowledge; what they share
 * are the category lists (themes, stages, touchpoints, user types, competitors), so every number lines up by key.
 */

export interface Comparison {
  id: number;
  title: string;
  a: number;
  b: number;
  createdAt: Date;
}

export async function createComparison(title: string, a: number, b: number): Promise<number> {
  const [row] = await requireDb().insert(comparisons).values({ title: title.slice(0, 300), searchA: a, searchB: b }).returning({ id: comparisons.id });
  return row.id;
}

export async function getComparison(id: number): Promise<Comparison | null> {
  const [row] = await requireDb()
    .select()
    .from(comparisons)
    .where(and(eq(comparisons.id, id), isNull(comparisons.hiddenAt)));
  return row ? { id: row.id, title: row.title, a: row.searchA, b: row.searchB, createdAt: row.createdAt } : null;
}

/** The comparison a study is a side of, if any, with the other side. */
export async function comparisonOf(searchId: number): Promise<{ id: number; title: string; side: "a" | "b"; other: number } | null> {
  const [row] = await requireDb()
    .select()
    .from(comparisons)
    .where(and(or(eq(comparisons.searchA, searchId), eq(comparisons.searchB, searchId)), isNull(comparisons.hiddenAt)));
  if (!row) return null;
  const side = row.searchA === searchId ? "a" : "b";
  return { id: row.id, title: row.title, side, other: side === "a" ? row.searchB : row.searchA };
}

export async function renameComparison(id: number, title: string): Promise<boolean> {
  const clean = title.trim().slice(0, 300);
  if (!clean) return false;
  const res = await requireDb()
    .update(comparisons)
    .set({ title: clean })
    .where(and(eq(comparisons.id, id), isNull(comparisons.hiddenAt)))
    .returning({ id: comparisons.id });
  return res.length > 0;
}

/** Removes a comparison from Studies, with both sides (their posts and costs are kept, as for any study). */
export async function hideComparison(id: number): Promise<boolean> {
  const db = requireDb();
  const c = await getComparison(id);
  if (!c) return false;
  await db.batch([
    db.update(comparisons).set({ hiddenAt: sql`now()` }).where(eq(comparisons.id, id)),
    db.update(searches).set({ hiddenAt: sql`now()` }).where(or(eq(searches.id, c.a), eq(searches.id, c.b))),
  ]);
  return true;
}

/** The lists both sides share; product knowledge stays each side's own. */
const LISTS = ["stages", "segments", "themes", "competitors", "touchpoints"] as const;
const listsOf = (c: Codebook): Partial<Codebook> => Object.fromEntries(LISTS.map((k) => [k, c[k] ?? []])) as Partial<Codebook>;
const sameLists = (x: Codebook, y: Codebook) => LISTS.every((k) => JSON.stringify(x[k] ?? []) === JSON.stringify(y[k] ?? []));

/**
 * Makes sure both sides have categories and that they share the same lists. With none yet, Claude drafts one set from
 * posts of both sides (one call, recorded on side A); each side then adds its own product knowledge. If only one side
 * has categories, the other takes its lists. Returns whether a paid draft was made.
 */
export async function shareCategories(c: Comparison, retry = true): Promise<{ drafted: boolean }> {
  const [ca, cb] = await Promise.all([latestCodebook(c.a), latestCodebook(c.b)]);
  if (ca && cb) {
    if (!sameLists(ca.codebook, cb.codebook)) await saveCodebook(c.b, { ...cb.codebook, ...listsOf(ca.codebook) });
    return { drafted: false };
  }
  if (ca || cb) {
    const [from, toId] = ca ? [ca, c.b] : [cb!, c.a];
    if (!(await saveFirst(c, [[toId, { ...(await withKnowledge(toId)), ...listsOf(from.codebook) } as Codebook]])) && retry) return shareCategories(c, false);
    return { drafted: false };
  }
  const [planA, planB, sampleA, sampleB] = await Promise.all([loadPlan(c.a), loadPlan(c.b), sampleOf(c.a), sampleOf(c.b)]);
  if (!planA || !planB) throw new Error("A side of this comparison has no search settings.");
  const half = Math.max(1, Math.floor(Math.max(sampleA.length, sampleB.length) / 2));
  const sample = [...sampleA.slice(0, half), ...sampleB.slice(0, half)];
  if (sample.length === 0) throw new Error("Collect some posts first.");
  // One plan for both: the two subjects, so the lists fit either product.
  const plan = { ...planA.plan, subject: `${planA.plan.subject} and ${planB.plan.subject}` };
  let drafted;
  try {
    drafted = await draftCodebook(plan, sample);
  } catch (err) {
    if (err instanceof CodebookError && err.cost) await recordCost({ searchId: c.a, ...err.cost }).catch(() => undefined);
    throw err;
  }
  await recordCost({ searchId: c.a, ...drafted.cost });
  const lists = listsOf(drafted.codebook) as Codebook;
  const [ka, kb] = await Promise.all([storedFactsFor(c.a), storedFactsFor(c.b)]);
  const saved = await saveFirst(c, [
    [c.a, { ...lists, ...knowledgeFields(ka) }],
    [c.b, { ...lists, ...knowledgeFields(kb) }],
  ]);
  // Another request (the other side's page) drafted at the same moment and saved first: use its lists, so both
  // sides always read with one set. This draft's cost is recorded above.
  if (!saved) return retry ? shareCategories(c, false) : { drafted: false };
  return { drafted: true };
}

/**
 * Saves the first categories of the given sides, but only while neither side has any: under a lock per comparison
 * and in one statement, so two drafts at the same moment can't leave the sides with different lists.
 */
async function saveFirst(c: Comparison, rows: [number, Codebook][]): Promise<boolean> {
  const db = requireDb();
  const values = sql.join(
    rows.map(([id, cb]) => sql`(${id}::int, ${JSON.stringify(cb)}::jsonb)`),
    sql`, `,
  );
  const mine = sql.join(
    rows.map(([id]) => sql`${id}`),
    sql`, `,
  );
  const [, inserted] = await db.batch([
    db.execute(sql`select pg_advisory_xact_lock(hashtext('compare-categories'), ${c.id})`),
    db.execute(sql`
      insert into ${codebooks} (search_id, version, codebook, approved_at)
      select v.id, 1, v.cb, now() from (values ${values}) as v(id, cb)
      where not exists (select 1 from ${codebooks} where search_id in (${mine}))
      returning search_id`),
  ]);
  return inserted.rows.length === rows.length;
}

const knowledgeFields = (k: { productFacts: Codebook["productFacts"]; productNotes: string }) => ({
  ...(k.productFacts?.length ? { productFacts: k.productFacts } : {}),
  ...(k.productNotes ? { productNotes: k.productNotes } : {}),
});

async function withKnowledge(searchId: number): Promise<Partial<Codebook>> {
  return knowledgeFields(await storedFactsFor(searchId));
}

/**
 * After categories are saved on one side (edits, Improve rules), the other side takes the same lists as a new
 * version, keeping its own product knowledge, so the two stay comparable.
 */
export async function syncOtherSide(searchId: number): Promise<void> {
  const link = await comparisonOf(searchId);
  if (!link) return;
  const [mine, theirs] = await Promise.all([latestCodebook(searchId), latestCodebook(link.other)]);
  if (!mine) return;
  if (theirs && sameLists(mine.codebook, theirs.codebook)) return;
  const base = theirs ? theirs.codebook : await withKnowledge(link.other);
  await saveCodebook(link.other, { ...base, ...listsOf(mine.codebook) } as Codebook);
}
