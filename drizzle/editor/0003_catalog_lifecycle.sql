-- Pulse migration 0003_catalog_lifecycle. Paste ALL of this into Neon > SQL Editor (branch: main, database: neondb) and click Run.
-- Safe to run more than once. If you also use the preview site, run it on the preview branch too. The last query lists the tables so you can confirm it worked.

ALTER TABLE "catalog_nodes" ADD COLUMN IF NOT EXISTS "retired_at" timestamp with time zone;
ALTER TABLE "catalog_nodes" ADD COLUMN IF NOT EXISTS "proposed_at" timestamp with time zone;
ALTER TABLE "catalog_nodes" ADD COLUMN IF NOT EXISTS "evidence" jsonb;

CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) SELECT '7535603ce9f6d13af2bf9ef4a6dba6c61ff15e48a7245031fb93936d6f169b63', 1790329696540 WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '7535603ce9f6d13af2bf9ef4a6dba6c61ff15e48a7245031fb93936d6f169b63');

SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
