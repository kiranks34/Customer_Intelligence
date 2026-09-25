import "server-only";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { requireDb } from "@/db/client";
import { jobs, plans, posts, searches } from "@/db/schema";

import type { Plan } from "./plan";

/** Creates the search and its first plan in one statement, so a search can never exist without a plan. */
export async function createSearch(query: string, plan: Plan, catalogId: number | null = null): Promise<number> {
  const res = await requireDb().execute(sql`
    with s as (
      insert into searches (query, kind, regions, catalog_id) values (${query}, ${plan.kind}, ${"{NA}"}, ${catalogId}) returning id
    )
    insert into plans (search_id, version, plan) select id, 1, ${JSON.stringify(plan)}::jsonb from s
    returning search_id`);
  return Number((res.rows[0] as { search_id: number }).search_id);
}

/**
 * Saves an edited plan as the next version in one statement. Two saves at once can collide on the
 * (search, version) unique index; the loser retries once with the next number.
 */
export async function savePlanVersion(searchId: number, plan: Plan): Promise<number> {
  const insert = () =>
    requireDb().execute(sql`
      insert into plans (search_id, version, plan)
      select ${searchId}, coalesce(max(version), 0) + 1, ${JSON.stringify(plan)}::jsonb from plans where search_id = ${searchId}
      returning version`);
  let res;
  try {
    res = await insert();
  } catch {
    res = await insert();
  }
  await requireDb().update(searches).set({ kind: plan.kind }).where(eq(searches.id, searchId));
  return Number((res.rows[0] as { version: number }).version);
}

export async function getSearch(id: number) {
  const [s] = await requireDb().select().from(searches).where(eq(searches.id, id));
  return s ?? null;
}

/** Searches still on the Recent list, newest first, with their latest plan and post count so each row is distinguishable. */
export async function recentSearches(limit = 50) {
  const rows = await requireDb()
    .select({
      id: searches.id,
      query: searches.query,
      createdAt: searches.createdAt,
      posts: sql<number>`(select count(*)::int from ${posts} where ${posts.searchId} = ${searches.id})`,
      plan: sql<Plan | null>`(select ${plans.plan} from ${plans} where ${plans.searchId} = ${searches.id} order by ${plans.version} desc limit 1)`,
    })
    .from(searches)
    .where(isNull(searches.hiddenAt))
    .orderBy(desc(searches.id))
    .limit(limit);
  return rows;
}

/** Clears searches from the Recent list. Nothing is deleted: posts, plans and costs stay for a later archive view. */
export async function hideSearches(ids: number[]): Promise<number> {
  const res = await requireDb()
    .update(searches)
    .set({ hiddenAt: sql`now()` })
    .where(and(isNull(searches.hiddenAt), inArray(searches.id, ids)))
    .returning({ id: searches.id });
  return res.length;
}

/**
 * Jobs paused by the budget guard go back to the queue (e.g. after the budget was raised or a new month began).
 * Pausing isn't a failed attempt, so attempts are not touched here (the pause already refunded its attempt).
 */
export async function resumeWaiting(searchId: number): Promise<void> {
  await requireDb()
    .update(jobs)
    .set({ status: "queued", lastError: null, runAfter: sql`now()` })
    .where(and(eq(jobs.searchId, searchId), eq(jobs.status, "waiting")));
}
