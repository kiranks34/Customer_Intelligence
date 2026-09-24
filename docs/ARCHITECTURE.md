# Architecture

## 1. The pipeline for one search

```mermaid
flowchart TD
  S[You type a search] --> P[1. Plan<br/>Claude: keywords, sources,<br/>product vs audience search]
  P -->|you can edit| C[2. Collect<br/>YouTube, Reddit → later ScrapeCreators, Apify]
  C --> D[Deduplicate by text,<br/>pseudonymize authors]
  D --> R[3. Relevance gate<br/>Jev: is this about the search?]
  R --> K[4. Discover codebook<br/>Claude reads a sample:<br/>themes, segments, stages, touchpoints]
  K -->|you can edit| J[5. Classify every post<br/>Jev: typed answers + confidence]
  J -->|conf ≥ 0.8| DB[(Counted)]
  J -->|0.5 – 0.8| U[(Uncertain band)]
  J -->|< 0.5| Q[Review queue<br/>you read]
  Q --> DB
  DB --> A[6. Aggregate<br/>SQL: counts, sentiment,<br/>journey, segments]
  A --> W[7. Write report<br/>Claude: narrative that cites post IDs]
  W --> V[Check: every cited ID exists,<br/>every number came from SQL]
  V --> UI[Report + journey map]
```

**Division of labour**

| Tool | Does | Why |
|---|---|---|
| **Claude** (via Vercel AI Gateway) | Plans the search, proposes the codebook, writes the narrative | Needs language generation. Runs a few times per search, not per post |
| **Jev** (`typesafe-ai/jev` via Vercel AI Gateway) | Every per-post decision: relevance, sentiment, stage, segment, themes, touchpoints | Typed answers + calibrated confidence. $0.042 per million input tokens, so it's cheap enough to run on every post |
| **SQL** | Every number | Numbers must be reproducible |
| **You** | Edit the plan and codebook, clear the review queue, spot-check | Same role as the hand-verdict files, much less volume |

## 2. Saved searches (the "live" part)

A saved search re-runs daily with the **same codebook version**:
collect new posts only → relevance → classify → aggregate. The narrative is
rewritten only when something changes significantly (to save Claude cost).
Changing the codebook creates a new version, and the report says the base
moved.

## 3. Tech stack

| Concern | Choice | Why |
|---|---|---|
| App | Next.js (App Router, TypeScript) on Vercel | One codebase for UI and backend. You already use Vercel |
| AI | Vercel AI SDK + AI Gateway (`AI_GATEWAY_API_KEY`) | One key and one bill for Claude and Jev. Spend is visible in the gateway |
| Database | Postgres (Neon free tier via Vercel) + Drizzle ORM | Free at this scale. SQL for every number |
| Background jobs | Job table + resumable steps (Vercel Workflow, or cron + queue) | Scraping and Jev runs take minutes, longer than one request |
| Jev rate limit | A queue with concurrency 2 and retry on 429 | Gateway returns 429 above 2 |
| Access | Single passcode (env var) in middleware | Only you use it for now |
| Charts | SVG/React components following the dataviz rules | Journey map is custom |
| Tests | Vitest (unit), Playwright (UI) | |

Environment variables (names reused from the earlier project):
`AI_GATEWAY_API_KEY`, `YOUTUBE_API_KEY`, `REDDIT_CLIENT_ID`,
`REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT`, `SCRAPECREATORS_API_KEY`,
`APIFY_TOKEN`, `DATABASE_URL`, `PULSE_PASSCODE`, `AUTHOR_HASH_SALT`.

## 4. Data model (first cut)

```
search(id, query, kind[product|family|category|audience], regions[], created_at)
plan(search_id, version, keywords, sources, exclusions)
post(id, source, source_id, url, author_hash, posted_at, title, text,
     text_hash, rating, lang, region, collected_at, search_id)
codebook(search_id, version, stages[], segments[], themes[], touchpoints[],
         each with {key, label, definition, examples})
decision(post_id, codebook_version, question, answer, confidence,
         model, created_at)               -- one row per Jev answer
review(post_id, question, human_answer, reviewed_at)
report(search_id, codebook_version, snapshot_at, narrative_json,
       numbers_json, cost_usd)
cost_event(search_id, provider, units, usd, created_at)
```

## 5. Connectors

A connector has one interface: `collect(plan, since, budget) → Post[]`.
Retail connectors also return **listings** (title, model, SKU/ASIN,
country), which feed the product catalog.

| Phase | Source | Region | Via | Cost |
|---|---|---|---|---|
| 1 | YouTube videos + comments | all | YouTube Data API | Free quota |
| 1 | Reddit posts + comment threads | NA, India | Reddit OAuth API | Free |
| 1 | Amazon.com listings + reviews | NA | Apify actor | Free monthly credit (resets on the 27th) |
| 2 | Best Buy, Walmart, Target, Costco reviews | NA | Apify actors (to verify per retailer) | Credits |
| 2 | Amazon.in, Flipkart | India | Apify actors | Credits |
| 2 | Mercado Libre, Amazon MX/BR | LATAM | Apify actors | Credits |
| 2 | TikTok, Instagram | NA, LATAM, India | ScrapeCreators | Credits |
| 3 | JD.com, Tmall, Xiaohongshu, Bilibili | China | Apify actors (proxy needed, as in the earlier project) | Credits |

Each connector reports its cost estimate *before* a run, and the search
stops at the per-search cap. One source failing never fails the search.

## 6. Product catalog

```
catalog_node(id, search_id, level[category|family|series|model|sku|service],
             parent_id, name, aliases[], region, retailer_ids[])
post_product(post_id, node_id, method[listing|jev|review], confidence)
```

- Built by Claude from retailer listings + a sample of posts. You edit it.
- Retail review → model/SKU via its listing (method `listing`).
- Social post → model via Jev with the catalog as options (method `jev`).
- Regional names for the same model are aliases of one node, so
  cross-region comparison works.

## 7. Running on Vercel Hobby

Hobby limits function run time and allows daily cron jobs only. Pulse is
designed to fit:
- The pipeline runs as **small resumable steps**. Each step handles one batch
  (e.g. 20 posts through Jev) and saves progress, so no single call runs long.
- Daily refresh of saved searches fits the Hobby daily cron.
- Apify runs are started, then polled. We never wait inside one request.

If a limit still blocks us (for example step chaining or run time), the
options are Vercel Pro, or GitHub Actions as a free background worker. We
decide when that happens.
