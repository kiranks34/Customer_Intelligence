import "server-only";

import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";

import * as schema from "./schema";

let db: NeonHttpDatabase<typeof schema> | null = null;

/** Returns null when DATABASE_URL is not configured, so pages can show a setup hint instead of crashing. */
export function getDb(): NeonHttpDatabase<typeof schema> | null {
  if (db) return db;
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  db = drizzle(neon(url), { schema });
  return db;
}
