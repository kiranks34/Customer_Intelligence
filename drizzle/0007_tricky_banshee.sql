ALTER TABLE "searches" ADD COLUMN "driven_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "searches" ADD COLUMN "stopped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "searches" ADD COLUMN "auto_read" boolean DEFAULT false NOT NULL;