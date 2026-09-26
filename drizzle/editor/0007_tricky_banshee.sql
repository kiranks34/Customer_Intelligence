-- Pulse migration 0007_tricky_banshee. Paste ALL of this into Neon > SQL Editor (branch: main, database: neondb) and click Run.
-- Safe to run more than once. If you also use the preview site, run it on the preview branch too. The last query lists the tables so you can confirm it worked.

-- Hides Postgres' harmless "already exists, skipping" notices on a second run.
SET client_min_messages = warning;

ALTER TABLE "searches" ADD COLUMN IF NOT EXISTS "driven_at" timestamp with time zone;
ALTER TABLE "searches" ADD COLUMN IF NOT EXISTS "stopped_at" timestamp with time zone;
ALTER TABLE "searches" ADD COLUMN IF NOT EXISTS "auto_read" boolean DEFAULT false NOT NULL;

CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) SELECT 'c2b1dd2d743d0b936ba4de919256206992026b936d7a69c6f0a006d2a6b624ef', 1790430722780 WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = 'c2b1dd2d743d0b936ba4de919256206992026b936d7a69c6f0a006d2a6b624ef');

SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
