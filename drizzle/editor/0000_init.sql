-- Pulse migration 0000_init. Paste ALL of this into Neon > SQL Editor (branch: main, database: neondb) and click Run.
-- Run each file once, in order. The last query lists the tables so you can confirm it worked.

CREATE TYPE "public"."catalog_level" AS ENUM('category', 'family', 'series', 'model', 'sku', 'service');
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'waiting', 'done', 'failed');
CREATE TYPE "public"."mapping_method" AS ENUM('listing', 'jev', 'review');
CREATE TYPE "public"."search_kind" AS ENUM('product', 'family', 'category', 'audience');
CREATE TABLE "catalog_nodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"search_id" integer NOT NULL,
	"level" "catalog_level" NOT NULL,
	"parent_id" integer,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"region" text,
	"retailer_ids" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "codebooks" (
	"id" serial PRIMARY KEY NOT NULL,
	"search_id" integer NOT NULL,
	"version" integer NOT NULL,
	"codebook" jsonb NOT NULL,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "cost_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"search_id" integer,
	"provider" text NOT NULL,
	"operation" text NOT NULL,
	"units" jsonb,
	"usd" numeric(10, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" integer NOT NULL,
	"codebook_version" integer NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"confidence" double precision NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"search_id" integer,
	"step" text NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"cursor" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"search_id" integer NOT NULL,
	"version" integer NOT NULL,
	"plan" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "post_products" (
	"post_id" integer NOT NULL,
	"node_id" integer NOT NULL,
	"method" "mapping_method" NOT NULL,
	"confidence" double precision
);

CREATE TABLE "posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"search_id" integer NOT NULL,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"parent_source_id" text,
	"url" text,
	"author_hash" text,
	"posted_at" timestamp with time zone,
	"title" text DEFAULT '' NOT NULL,
	"text" text NOT NULL,
	"text_hash" text NOT NULL,
	"rating" double precision,
	"verified_purchase" boolean,
	"lang" text,
	"country" text,
	"engagement" jsonb,
	"listing_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "price_observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"node_id" integer,
	"listing_id" text NOT NULL,
	"retailer" text NOT NULL,
	"country" text NOT NULL,
	"currency" text NOT NULL,
	"list_price" numeric(12, 2),
	"current_price" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"search_id" integer NOT NULL,
	"codebook_version" integer NOT NULL,
	"numbers" jsonb NOT NULL,
	"narrative" jsonb,
	"integrity_passed" boolean DEFAULT false NOT NULL,
	"cost_usd" numeric(10, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" integer NOT NULL,
	"codebook_version" integer NOT NULL,
	"question" text NOT NULL,
	"human_answer" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "searches" (
	"id" serial PRIMARY KEY NOT NULL,
	"query" text NOT NULL,
	"kind" "search_kind" NOT NULL,
	"regions" text[] NOT NULL,
	"saved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "catalog_nodes" ADD CONSTRAINT "catalog_nodes_search_id_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."searches"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "catalog_nodes" ADD CONSTRAINT "catalog_nodes_parent_id_catalog_nodes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."catalog_nodes"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "codebooks" ADD CONSTRAINT "codebooks_search_id_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."searches"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "cost_events" ADD CONSTRAINT "cost_events_search_id_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."searches"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_search_id_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."searches"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "plans" ADD CONSTRAINT "plans_search_id_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."searches"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "post_products" ADD CONSTRAINT "post_products_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "post_products" ADD CONSTRAINT "post_products_node_id_catalog_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."catalog_nodes"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "posts" ADD CONSTRAINT "posts_search_id_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."searches"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_node_id_catalog_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."catalog_nodes"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "reports" ADD CONSTRAINT "reports_search_id_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."searches"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "catalog_search_level" ON "catalog_nodes" USING btree ("search_id","level");
CREATE UNIQUE INDEX "codebooks_search_version" ON "codebooks" USING btree ("search_id","version");
CREATE INDEX "cost_events_created" ON "cost_events" USING btree ("created_at");
CREATE UNIQUE INDEX "decisions_unique" ON "decisions" USING btree ("post_id","codebook_version","question");
CREATE INDEX "jobs_status_run_after" ON "jobs" USING btree ("status","run_after");
CREATE UNIQUE INDEX "plans_search_version" ON "plans" USING btree ("search_id","version");
CREATE UNIQUE INDEX "post_products_unique" ON "post_products" USING btree ("post_id","node_id");
CREATE UNIQUE INDEX "posts_source_unique" ON "posts" USING btree ("search_id","source","source_id");
CREATE UNIQUE INDEX "posts_author_text_unique" ON "posts" USING btree ("search_id","author_hash","text_hash");
CREATE INDEX "posts_search_source" ON "posts" USING btree ("search_id","source");
CREATE UNIQUE INDEX "reviews_unique" ON "reviews" USING btree ("post_id","codebook_version","question","kind");

CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('69d80afef75ba13af182d7b15fe75b364c2489edddad143da6deba10223fff02', 1790263757068);

SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
