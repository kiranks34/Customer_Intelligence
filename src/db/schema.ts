/**
 * Database schema. Mirrors docs/ARCHITECTURE.md §4 and §6.
 * Every number in a report must be computable from these tables.
 */
import {
  type AnyPgColumn,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const searchKind = pgEnum("search_kind", ["product", "family", "category", "audience"]);
export const catalogLevel = pgEnum("catalog_level", ["category", "family", "series", "model", "sku", "service"]);
export const mappingMethod = pgEnum("mapping_method", ["listing", "jev", "review"]);
export const jobStatus = pgEnum("job_status", ["queued", "running", "waiting", "done", "failed"]);

export const searches = pgTable("searches", {
  id: serial("id").primaryKey(),
  query: text("query").notNull(),
  kind: searchKind("kind").notNull(),
  regions: text("regions").array().notNull(),
  saved: boolean("saved").notNull().default(false),
  createdAt: createdAt(),
});

/** How a search was interpreted: keywords, sources, caps. Versioned; you can edit it. */
export const plans = pgTable(
  "plans",
  {
    id: serial("id").primaryKey(),
    searchId: integer("search_id").notNull().references(() => searches.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    plan: jsonb("plan").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("plans_search_version").on(t.searchId, t.version)],
);

export const posts = pgTable(
  "posts",
  {
    id: serial("id").primaryKey(),
    searchId: integer("search_id").notNull().references(() => searches.id, { onDelete: "cascade" }),
    source: text("source").notNull(), // e.g. amazon_us, reddit, youtube
    sourceId: text("source_id").notNull(),
    parentSourceId: text("parent_source_id"), // comment -> video/thread
    url: text("url"),
    authorHash: text("author_hash"), // pseudonymized, never the raw handle
    postedAt: timestamp("posted_at", { withTimezone: true }),
    title: text("title").notNull().default(""),
    text: text("text").notNull(),
    textHash: text("text_hash").notNull(),
    rating: doublePrecision("rating"),
    verifiedPurchase: boolean("verified_purchase"),
    lang: text("lang"),
    country: text("country"),
    engagement: jsonb("engagement"), // channel-native metrics: likes, upvotes, helpful votes
    listingId: text("listing_id"), // retail: the listing (ASIN etc.) the review was posted on
    collectedAt: createdAt(),
  },
  (t) => [
    uniqueIndex("posts_source_unique").on(t.searchId, t.source, t.sourceId),
    // Same author + same text across variants/retailers is one post (PRD principle 4).
    // Different people writing the same short text ("Great printer!") stay separate.
    // Posts without an author are not text-deduplicated (NULLs are distinct).
    uniqueIndex("posts_author_text_unique").on(t.searchId, t.authorHash, t.textHash),
    index("posts_search_source").on(t.searchId, t.source),
  ],
);

/** Themes, segments, journey stages, touchpoints: the typed questions Jev answers. Versioned. */
export const codebooks = pgTable(
  "codebooks",
  {
    id: serial("id").primaryKey(),
    searchId: integer("search_id").notNull().references(() => searches.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    codebook: jsonb("codebook").notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("codebooks_search_version").on(t.searchId, t.version)],
);

export const catalogNodes = pgTable(
  "catalog_nodes",
  {
    id: serial("id").primaryKey(),
    searchId: integer("search_id").notNull().references(() => searches.id, { onDelete: "cascade" }),
    level: catalogLevel("level").notNull(),
    parentId: integer("parent_id").references((): AnyPgColumn => catalogNodes.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    aliases: text("aliases").array().notNull().default([]),
    region: text("region"),
    retailerIds: text("retailer_ids").array().notNull().default([]), // ASINs etc.
    createdAt: createdAt(),
  },
  (t) => [index("catalog_search_level").on(t.searchId, t.level)],
);

export const postProducts = pgTable(
  "post_products",
  {
    postId: integer("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    nodeId: integer("node_id").notNull().references(() => catalogNodes.id, { onDelete: "cascade" }),
    method: mappingMethod("method").notNull(),
    confidence: doublePrecision("confidence"),
  },
  (t) => [uniqueIndex("post_products_unique").on(t.postId, t.nodeId)],
);

export const priceObservations = pgTable("price_observations", {
  id: serial("id").primaryKey(),
  nodeId: integer("node_id").references(() => catalogNodes.id, { onDelete: "set null" }),
  listingId: text("listing_id").notNull(),
  retailer: text("retailer").notNull(),
  country: text("country").notNull(),
  currency: text("currency").notNull(),
  listPrice: numeric("list_price", { precision: 12, scale: 2 }),
  currentPrice: numeric("current_price", { precision: 12, scale: 2 }),
  observedAt: createdAt(),
});

/** One row per Jev answer. Question keys come from the codebook version. */
export const decisions = pgTable(
  "decisions",
  {
    id: serial("id").primaryKey(),
    postId: integer("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    codebookVersion: integer("codebook_version").notNull(),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    model: text("model").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("decisions_unique").on(t.postId, t.codebookVersion, t.question)],
);

/** Your reads: review-queue answers and spot-check verdicts. */
export const reviews = pgTable(
  "reviews",
  {
    id: serial("id").primaryKey(),
    postId: integer("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    codebookVersion: integer("codebook_version").notNull(),
    question: text("question").notNull(),
    humanAnswer: text("human_answer").notNull(),
    kind: text("kind").notNull(), // review_queue | spot_check
    reviewedAt: createdAt(),
  },
  (t) => [uniqueIndex("reviews_unique").on(t.postId, t.codebookVersion, t.question, t.kind)],
);

/** A frozen report snapshot. Numbers come from SQL; narrative cites post IDs. */
export const reports = pgTable("reports", {
  id: serial("id").primaryKey(),
  searchId: integer("search_id").notNull().references(() => searches.id, { onDelete: "cascade" }),
  codebookVersion: integer("codebook_version").notNull(),
  numbers: jsonb("numbers").notNull(),
  narrative: jsonb("narrative"),
  integrityPassed: boolean("integrity_passed").notNull().default(false),
  costUsd: numeric("cost_usd", { precision: 10, scale: 4 }),
  snapshotAt: createdAt(),
});

/** Every paid call is logged here; the cost meter sums this table. */
export const costEvents = pgTable(
  "cost_events",
  {
    id: serial("id").primaryKey(),
    // Spend history outlives deleted searches.
    searchId: integer("search_id").references(() => searches.id, { onDelete: "set null" }),
    provider: text("provider").notNull(), // anthropic, jev, apify, scrapecreators
    operation: text("operation").notNull(),
    units: jsonb("units"), // tokens, actor compute units, requests
    usd: numeric("usd", { precision: 10, scale: 6 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("cost_events_created").on(t.createdAt)],
);

/** Resumable pipeline steps (fits Vercel Hobby limits: each step handles one small batch). */
export const jobs = pgTable(
  "jobs",
  {
    id: serial("id").primaryKey(),
    searchId: integer("search_id").references(() => searches.id, { onDelete: "cascade" }),
    step: text("step").notNull(),
    status: jobStatus("status").notNull().default("queued"),
    cursor: jsonb("cursor"), // where to resume
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("jobs_status_run_after").on(t.status, t.runAfter)],
);
