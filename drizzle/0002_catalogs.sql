CREATE TYPE "public"."catalog_status" AS ENUM('draft', 'approved');--> statement-breakpoint
ALTER TYPE "public"."mapping_method" ADD VALUE 'alias';--> statement-breakpoint
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
--> statement-breakpoint
DROP INDEX "catalog_search_level";--> statement-breakpoint
ALTER TABLE "catalog_nodes" DROP COLUMN "search_id";--> statement-breakpoint
ALTER TABLE "catalog_nodes" ADD COLUMN "catalog_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_nodes" ADD COLUMN "verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_nodes" ADD COLUMN "sort" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "searches" ADD COLUMN "catalog_id" integer;--> statement-breakpoint
ALTER TABLE "catalog_nodes" ADD CONSTRAINT "catalog_nodes_catalog_id_catalogs_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."catalogs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "searches" ADD CONSTRAINT "searches_catalog_id_catalogs_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."catalogs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_nodes_catalog" ON "catalog_nodes" USING btree ("catalog_id","level");--> statement-breakpoint
CREATE INDEX "post_products_node" ON "post_products" USING btree ("node_id");