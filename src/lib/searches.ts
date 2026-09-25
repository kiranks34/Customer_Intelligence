import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";

import { requireDb } from "@/db/client";
import { jobs, searches } from "@/db/schema";

import type { Plan } from "./plan";

/** Creates the search and its first plan in one statement, so a search can never exist without a plan. */
export async function createSearch(query: string, plan: Plan): Promise<number> {
  const res = await requireDb().execute(sql`
    with s as (
      insert into searches (query, kind, regions) values (${query}, ${plan.kind}, ${"{NA}"}) returning id
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

export async function recentSearches(limit = 10) {
  return requireDb()
    .select({ id: searches.id, query: searches.query, createdAt: searches.createdAt })
    .from(searches)
    .orderBy(desc(searches.id))
    .limit(limit);
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
