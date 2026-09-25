ALTER TABLE "catalog_nodes" ADD COLUMN "retired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "catalog_nodes" ADD COLUMN "proposed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "catalog_nodes" ADD COLUMN "evidence" jsonb;