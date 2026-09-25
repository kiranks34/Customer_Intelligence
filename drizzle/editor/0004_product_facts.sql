-- Pulse migration 0004_product_facts. Paste ALL of this into Neon > SQL Editor (branch: main, database: neondb) and click Run.
-- Safe to run more than once. If you also use the preview site, run it on the preview branch too. The last query lists the tables so you can confirm it worked.

ALTER TABLE "catalogs" ADD COLUMN IF NOT EXISTS "product_facts" jsonb;

CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) SELECT '81959689bbcc523995bc6c826c59391005fd0e457d47e2d2948be6dc455d7329', 1790375836184 WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '81959689bbcc523995bc6c826c59391005fd0e457d47e2d2948be6dc455d7329');

SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
