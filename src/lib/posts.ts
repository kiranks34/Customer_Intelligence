import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { requireDb } from "@/db/client";
import { posts, reviews } from "@/db/schema";

import type { PostRow } from "./ingest";

/**
 * The same text this long is one post whoever wrote it: a repost, a cross-post, or one comment returned twice
 * (Reddit often gives no author, so the author + text index can't catch these). Shorter texts ("Great printer!")
 * can honestly come from different people and are kept (docs/DECISIONS.md D38).
 */
export const DEDUPE_MIN_CHARS = 40;
const isLong = (r: { text: string }) => r.text.length >= DEDUPE_MIN_CHARS;

/**
 * Insert posts, skipping duplicates: same source id or same author + text (unique indexes), and the same long
 * text already stored for the search or earlier in this batch. Returns how many rows were actually new.
 */
export async function savePosts(input: PostRow[]): Promise<number> {
  if (input.length === 0) return 0;
  const db = requireDb();
  const searchId = input[0].searchId;
  const longHashes = [...new Set(input.filter(isLong).map((r) => r.textHash))];
  const stored = longHashes.length
    ? new Set(
        (await db.select({ h: posts.textHash }).from(posts).where(and(eq(posts.searchId, searchId), inArray(posts.textHash, longHashes)))).map((r) => r.h),
      )
    : new Set<string>();
  const rows = input.filter((r) => {
    if (!isLong(r)) return true;
    if (stored.has(r.textHash)) return false;
    stored.add(r.textHash);
    return true;
  });
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const result = await db
      .insert(posts)
      .values(rows.slice(i, i + 100))
      .onConflictDoNothing()
      .returning({ id: posts.id });
    inserted += result.length;
  }
  return inserted;
}

/**
 * Removes copies stored before the rule above, keeping the first. Your Keep/Drop on a removed copy moves to the one
 * kept (unless it has its own); its Jev answers and links go with it (cascade). Returns how many were removed.
 */
export async function removeDuplicatePosts(searchId: number): Promise<number> {
  const db = requireDb();
  const copies = sql`
    select p.id as dupe, min(q.id) as keep from ${posts} p
    join ${posts} q on q.search_id = p.search_id and q.text_hash = p.text_hash and q.id < p.id
    where p.search_id = ${searchId} and length(p.text) >= ${DEDUPE_MIN_CHARS}
    group by p.id`;
  const [, removed] = await db.batch([
    db.execute(sql`
      insert into ${reviews} (post_id, codebook_version, question, human_answer, kind)
      select distinct on (c.keep, r.question, r.kind) c.keep, r.codebook_version, r.question, r.human_answer, r.kind
      from (${copies}) c join ${reviews} r on r.post_id = c.dupe
      where not exists (select 1 from ${reviews} k where k.post_id = c.keep and k.question = r.question and k.kind = r.kind)
      order by c.keep, r.question, r.kind, r.created_at desc, r.id desc`),
    db.execute(sql`delete from ${posts} p using (${copies}) c where p.id = c.dupe returning p.id`),
  ]);
  return removed.rows.length;
}
