# Decisions and open questions

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Pulse is a search-driven platform. Any product, category or audience | Goal alignment 2026-09-24. Thermal printers were a past project, not the product |
| D2 | Public data only. No company data | Hobby project. Company data can't be used |
| D3 | Web app: Next.js + TypeScript on Vercel, Postgres | One codebase you can maintain alone. You already have Vercel |
| D4 | All AI through Vercel AI Gateway (Claude + Jev) | You already have the key. One bill, spend visible |
| D5 | Jev makes every per-post decision. Claude only plans, proposes the codebook and writes narrative | Jev is validated (≥ 0.8 → 92–100% match) and cheap enough to run on every post. Claude is used where text generation is needed |
| D6 | Numbers from SQL, quotes from the database, Claude cites post IDs | Carries over "every number traces to posts" |
| D7 | Budget ≤ $20/month for all APIs. Prove feasibility on a few hundred posts before scaling | Your constraint |
| D8 | Free sources first (YouTube, Reddit), then ScrapeCreators and Apify | Cost and phasing |
| D9 | Single user, passcode access | Only you use it for now |
| D10 | Headline feature: live customer journey map from real posts | Your "wow factor" |
| D11 | The Python draft from the kickoff is discarded | Replaced by D3 |
| D12 | First search: **HP Smart Tank printers** (a product family) | Your choice, 2026-09-24 |
| D13 | Product catalog (category → family → series → model → SKU, plus services) is a first-class filter | Families span many models and regional SKUs |
| D14 | Regions: North America, China, LATAM, India | Your choice |
| D15 | Claude for planning, codebook, catalog and narrative: Sonnet 5 while testing (`PULSE_CLAUDE_MODEL=anthropic/claude-sonnet-5`), stepping up to Opus 5 only where quality needs it. Jev does the per-post work | Your choice (updated): cheaper models for testing. Per-task model settings come with steps 5 and 8 |
| D16 | Vercel Hobby. Pipeline built as small resumable steps. Upgrade to Pro only if needed | Your choice |
| D17 | Phase 1 scope: Smart Tank, North America only (Amazon.com, YouTube, Reddit) | Your choice. Other regions in Phase 2 |
| D18 | Audience-type searches wait until the product search passes Phase 1 | Your choice |
| D19 | Filters: family → series in Phase 1; model/SKU stored from day one, model filter in Phase 2 | Your choice. Storing early avoids re-scraping |
| D20 | Price: store price observations per listing; price tier *within region*; promo detection via Jev; no exact price per post | Prices vary by region, promotion and date, and reviews rarely state price paid |
| D21 | Per-channel journey and report views, plus a combined journey built stage by stage with channel mix, per-channel sentiment and evidence thresholds. Default is channel-balanced | Channels see different stages and people. Show only what the evidence supports |
| D22 | Reddit is collected through ScrapeCreators, not Reddit's API | Reddit refused API access in the earlier project; ScrapeCreators worked there |
| D23 | Phase 1 feasibility runs on YouTube + Reddit only; Amazon (Apify) follows when credits are topped up | Apify free credits are used up. Trade-off: fewer buy/setup-stage posts, so the journey gate is judged on social data first |
| D24 | Database changes ship as paste-ready SQL for Neon's SQL Editor (`drizzle/editor/`) | The command-line migration needs a local setup; the editor path is what worked |
| D25 | The search box accepts a topic or a question. Questions become a focused, time-bounded collection; the answer card (step 8) gives numbers from SQL and cites posts, and says when evidence is thin | Your request. "How many users" means "how many people posted publicly on the sources read" |
| D26 | Collection is driven by the open search page calling small steps (no background worker yet); closing the page pauses safely | Fits Vercel Hobby without Pro or extra services. Daily refresh of saved searches (cron) comes in Phase 2 |
| D27 | The search page shows a one-line summary with one-click period, depth (Quick ~100 / Standard ~300 / Deep ~1,000 posts) and source choices; searches are removable chips; everything else sits under "More options". Run saves edits, and exclusions that would drop a search's own results are flagged | Less typing and fewer decisions per search |

## Open questions

| # | Question | Needed by |
|---|---|---|
| Q3 | Jev: several questions per call? multi-select? input length? Spanish, Portuguese and Hindi quality? (We'll test; Chinese was validated earlier) | Phase 1 |
| Q5 | Which Apify actor did the earlier project use for Amazon reviews (its ID is in `amazon_reviews.py`)? | Before Amazon is switched on |
| Q4 | Which retailers are reachable via Apify at acceptable cost (Best Buy, Costco, Target, Walmart, Flipkart, Mercado Libre, JD)? | Phase 2 |
