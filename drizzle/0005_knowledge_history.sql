CREATE TABLE "knowledge_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"catalog_id" integer NOT NULL,
	"summary" jsonb NOT NULL,
	"changes" jsonb NOT NULL,
	"usd" numeric(10, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_headlines" (
	"search_id" integer PRIMARY KEY NOT NULL,
	"headline" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_runs" ADD CONSTRAINT "knowledge_runs_catalog_id_catalogs_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."catalogs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_headlines" ADD CONSTRAINT "study_headlines_search_id_searches_id_fk" FOREIGN KEY ("search_id") REFERENCES "public"."searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_runs_catalog" ON "knowledge_runs" USING btree ("catalog_id","created_at");