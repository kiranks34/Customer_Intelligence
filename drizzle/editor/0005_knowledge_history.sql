-- Pulse migration 0005_knowledge_history. Paste ALL of this into Neon > SQL Editor (branch: main, database: neondb) and click Run.
-- Safe to run more than once. If you also use the preview site, run it on the preview branch too. The last query lists the tables so you can confirm it worked.

CREATE TABLE IF NOT EXISTS "knowledge_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"catalog_id" integer NOT NULL,
	"summary" jsonb NOT NULL,
	"changes" jsonb NOT NULL,
	"usd" numeric(10, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS "study_headlines" (
	"search_id" integer PRIMARY KEY NOT NULL,
	"headline" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
DO $$ BEGIN ALTER TABLE "knowledge_runs" ADD CONSTRAINT "knowledge_runs_catalog_id_catalogs_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."catalogs"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "study_headlines" ADD CONSTRAINT "study_headlines_search_id_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."searches"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "knowledge_runs_catalog" ON "knowledge_runs" USING btree ("catalog_id","created_at");

CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) SELECT '5c9d7dec3c9fdf38381b0b526006d032d670dca07a89ec18365a5ac7fc5c3dd4', 1790412924764 WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '5c9d7dec3c9fdf38381b0b526006d032d670dca07a89ec18365a5ac7fc5c3dd4');

SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
