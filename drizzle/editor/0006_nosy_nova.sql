-- Pulse migration 0006_nosy_nova. Paste ALL of this into Neon > SQL Editor (branch: main, database: neondb) and click Run.
-- Safe to run more than once. If you also use the preview site, run it on the preview branch too. The last query lists the tables so you can confirm it worked.

-- Hides Postgres' harmless "already exists, skipping" notices on a second run.
SET client_min_messages = warning;

CREATE TABLE IF NOT EXISTS "comparisons" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"search_a" integer NOT NULL,
	"search_b" integer NOT NULL,
	"hidden_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
DO $$ BEGIN ALTER TABLE "comparisons" ADD CONSTRAINT "comparisons_search_a_searches_id_fk" FOREIGN KEY ("search_a") REFERENCES "public"."searches"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "comparisons" ADD CONSTRAINT "comparisons_search_b_searches_id_fk" FOREIGN KEY ("search_b") REFERENCES "public"."searches"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "comparisons_search_a" ON "comparisons" USING btree ("search_a");
CREATE UNIQUE INDEX IF NOT EXISTS "comparisons_search_b" ON "comparisons" USING btree ("search_b");

CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) SELECT '904a5f2fdc3f6b31aa72300d7047388cd21e60f34fd27ea042cb711ce383f8f7', 1790423026733 WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '904a5f2fdc3f6b31aa72300d7047388cd21e60f34fd27ea042cb711ce383f8f7');

SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
