-- Pulse migration 0002_catalogs. Paste ALL of this into Neon > SQL Editor (branch: main, database: neondb) and click Run.
-- Run each file once, in order. The last query lists the tables so you can confirm it worked.

CREATE TYPE "public"."catalog_status" AS ENUM('draft', 'approved');
ALTER TYPE "public"."mapping_method" ADD VALUE 'alias';
CREATE TABLE "catalogs" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"status" "catalog_status" DEFAULT 'draft' NOT NULL,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogs_key_unique" UNIQUE("key")
);

DROP INDEX "catalog_search_level";
ALTER TABLE "catalog_nodes" DROP COLUMN "search_id";
ALTER TABLE "catalog_nodes" ADD COLUMN "catalog_id" integer NOT NULL;
ALTER TABLE "catalog_nodes" ADD COLUMN "verified" boolean DEFAULT false NOT NULL;
ALTER TABLE "catalog_nodes" ADD COLUMN "sort" integer DEFAULT 0 NOT NULL;
ALTER TABLE "searches" ADD COLUMN "catalog_id" integer;
ALTER TABLE "catalog_nodes" ADD CONSTRAINT "catalog_nodes_catalog_id_catalogs_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."catalogs"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "searches" ADD CONSTRAINT "searches_catalog_id_catalogs_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."catalogs"("id") ON DELETE set null ON UPDATE no action;
CREATE INDEX "catalog_nodes_catalog" ON "catalog_nodes" USING btree ("catalog_id","level");
CREATE INDEX "post_products_node" ON "post_products" USING btree ("node_id");

CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('6b08d4f56bfd0320afa7ea72e0da61c2bc03bf96e854a0fbb9ac568a0b2286c1', 1790315890036);

SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
