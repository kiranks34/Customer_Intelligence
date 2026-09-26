CREATE TABLE "comparisons" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"search_a" integer NOT NULL,
	"search_b" integer NOT NULL,
	"hidden_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comparisons" ADD CONSTRAINT "comparisons_search_a_searches_id_fk" FOREIGN KEY ("search_a") REFERENCES "public"."searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparisons" ADD CONSTRAINT "comparisons_search_b_searches_id_fk" FOREIGN KEY ("search_b") REFERENCES "public"."searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comparisons_search_a" ON "comparisons" USING btree ("search_a");--> statement-breakpoint
CREATE UNIQUE INDEX "comparisons_search_b" ON "comparisons" USING btree ("search_b");