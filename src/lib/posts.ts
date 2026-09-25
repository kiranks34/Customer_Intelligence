import "server-only";

import { getDb } from "@/db/client";
import { posts } from "@/db/schema";

import type { PostRow } from "./ingest";

/**
 * Insert posts, skipping duplicates (same source id, or same author + text) via the unique indexes.
 * Returns how many rows were actually new.
 */
export async function savePosts(rows: PostRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is not set");
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
