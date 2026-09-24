# PRD: Pulse, search-driven customer intelligence

| | |
|---|---|
| Status | Draft v0.2, for review |
| Owner | Kiran (personal hobby project, sole user and maintainer) |
| Last updated | 2026-09-24 |
| Related | [ARCHITECTURE](ARCHITECTURE.md) · [JEV](JEV.md) · [EVALUATION](EVALUATION.md) · [ROADMAP](ROADMAP.md) · [DESIGN](DESIGN.md) · [DECISIONS](DECISIONS.md) |

---

## 1. Background: what the social-listening project taught us

The earlier category-research project (consumer thermal printers) produced
decks and an evidence workbook from about 17,000 public posts, comments and
reviews. It worked, but:

- **It was a project, not a product.** Scrapers, keyword patterns, hand
  verdicts and deck scripts were all written for one category.
- **Keyword counts were not evidence.** Every keyword hit that became a
  number had to be read by hand. Keywords missed real complaints (Jev found
  213 paper-worry comments the patterns missed) and counted reassurances as
  complaints ("paper isn't expensive").
- **Jev worked.** When Jev's confidence was ≥ 0.8, it matched the human
  verdict 92–100% of the time across sources. Below 0.5 it was a coin flip.
  Jev was validated but never became part of the pipeline.
- **No LLM was in the pipeline.** All judgment was regex or a human reading.

Pulse turns those lessons into a reusable system.

## 2. Vision

> Type any product, category or audience question, for example
> "HP Sprocket" or "what Gen Z says about printers". Get an evidence-backed
> customer-intelligence report and a **live customer journey map** built
> from what real people post publicly. Save the search, and it keeps
> updating as new posts appear.

Pulse complements market, design and ethnographic research. It shows where
to look and gives real quotes. Deeper studies decide why.

## 3. Users

The only user for now is Kiran. Reports are designed so that anyone from
working level to leadership can read them and ask for a deeper study.

| Reader | What they get |
|---|---|
| Working level (PM, designer, researcher) | Themes, segments, pain points, needs, the posts behind each number |
| Leadership | One-page summary, journey map, what changed, where to invest in research |

## 4. Core use cases

| # | As a user I want to… | Phase |
|---|---|---|
| U1 | Type a search (product, category or audience) and get a report | 1 |
| U2 | See and edit how the search was interpreted: keywords, sources, and the discovered themes, segments and journey stages | 1 |
| U3 | See a **customer journey map**: stages, emotion curve, pains, delights, touchpoints, quotes | 1 (basic) → 2 |
| U4 | Filter the report and journey by segment, source, region, time | 2 |
| U5 | Click any number and read the exact posts behind it, with source link and date | 1 |
| U6 | Review the posts Jev was unsure about, quickly | 1 |
| U7 | Save a search so it refreshes daily and shows trends and "what changed" | 2 |
| U8 | Compare two products, or two segments, side by side (journey overlay) | 3 |
| U9 | Share a read-only link or export a summary for leadership | 3 |
| U10 | Ask a question about a report and get an answer that cites posts | 3 |

## 4a. Products, services and regions as filters

A search like **"HP Smart Tank printers"** is a *family*, not one product.
It spans series, models and region-specific SKUs, and the same printer can
sell under different names in different regions. Pulse builds a **product
catalog** for each search, and every report can be filtered by it:

```
Category        Ink tank printers
└─ Family       HP Smart Tank
   └─ Series    e.g. Smart Tank 5100 series, 7000 series
      └─ Model  e.g. Smart Tank 5101
         └─ SKU region-specific product numbers / retailer listings (ASIN etc.)
Services        e.g. Instant Ink, All-In Plan (print as a service), HP+, warranty/Care Pack
```

- **Claude proposes the catalog** from retailer listings: model names,
  aliases, regional names and SKUs. You edit it.
- **Retail reviews** are mapped to a model/SKU from the listing they were
  posted on (reliable). Amazon shares reviews across variants, so we
  deduplicate by text.
- **Social posts** are mapped by Jev ("which model is discussed?", options
  from the catalog + "family only / not stated").
- **Filters on every report:** category · family · series · model · SKU ·
  service · region/country · retailer/source · segment · journey stage ·
  sentiment · rating · time.

**Regions in scope:** North America, China, LATAM, India. Languages follow:
English, Spanish, Portuguese, Chinese, Hindi/Hinglish.

| Region | Retail | Social / community |
|---|---|---|
| North America | Amazon.com, Best Buy, Costco, Target, Walmart | Reddit, YouTube, TikTok, Instagram |
| India | Amazon.in, Flipkart | YouTube, Reddit, Instagram |
| LATAM | Mercado Libre, Amazon.com.mx / .com.br | YouTube, TikTok, Instagram |
| China | JD.com, Tmall | Xiaohongshu (RED), Bilibili, Douyin, Zhihu |

Which of these can actually be reached, and at what cost, is checked source
by source (ARCHITECTURE.md §5).

## 5. What Pulse extracts

| Dimension | How | Notes |
|---|---|---|
| Relevance | Jev | Is this post really about the search? |
| Sentiment | Jev | positive / negative / neutral / mixed |
| Journey stage | Jev, stages from the codebook | e.g. discover, compare, buy, set up, everyday use, problems/support, stay or leave |
| User segment | Jev, segments from the codebook | Built from what people say about themselves: who they are, what they use it for |
| Themes (pains, delights, needs) | Jev, themes from the codebook | Multi-label |
| Touchpoints | Jev, from the codebook | store, app, support, subscription, packaging… |
| Codebook (the themes, segments, stages and touchpoints for this search) | Claude, from a sample of posts; Kiran edits | The typed questions Jev answers |
| Narrative, "why", summaries | Claude, from counted posts; must cite post IDs | Numbers come from the database, never from the LLM |
| Quotes | Pulled verbatim from the database by post ID | Never generated |

## 6. Principles (carried over from the social-listening rules)

1. **Every number traces to posts.** Counts come from database queries.
   Claude writes words, never numbers.
2. **Confidence decides what counts.** Jev ≥ 0.8 counts automatically.
   0.5–0.8 is shown as "uncertain". < 0.5 goes to the review queue and is
   not counted until read.
3. **Bases don't move silently.** A report is a frozen snapshot with a
   version. If the codebook or the data changes, the report says so.
4. **Deduplicate by text.** The same review appears across product variants
   and retailers.
5. **Keys live in the environment.** Never in code, logs or the database.
6. **Public data only.** Author handles are pseudonymized. We never try to
   identify or contact people.

## 7. Non-functional requirements

| Area | Requirement |
|---|---|
| Budget | ≤ $20/month for **all** APIs (LLMs + scraping). A cost meter in the app. Hard cap per search |
| Freshness | Saved searches refresh daily |
| Speed | A 300-post search completes in ≤ 15 min (Jev concurrency limit is 2) |
| Maintainability | One TypeScript codebase, one deploy target, no servers to manage |
| Reliability | Jobs are resumable. A failed step retries without re-paying for completed steps |
| Privacy | Only you can open the app (passcode). Pseudonymized authors |

## 8. Success metrics

| Metric | Target |
|---|---|
| Sentiment and stage agreement with your spot-check | ≥ 90% |
| Posts auto-counted (Jev ≥ 0.8) | ≥ 70% (keeps the review queue small) |
| Journey stages with ≥ 20 posts, for a product search | ≥ 4 |
| Cost per 300-post search | ≤ $1.50 |
| Your judgment: new, actionable insights per report | ≥ 3 |
| Time from typing a search to a report | ≤ 15 min |

## 9. Out of scope (for now)

Multi-user and login beyond a passcode. Company or first-party data.
Contacting authors. Paid social APIs beyond ScrapeCreators and Apify.
Forecasting.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Too few posts reveal their journey stage, so the map is thin | Show post counts per stage, mark thin stages, and merge stages when needed |
| The codebook misses a theme that matters | Claude proposes it from a sample. You edit it. An "other" bucket is sampled for new themes |
| Jev's calibration differs on new categories | Spot-check 20 counted posts per new search (EVALUATION.md) |
| Scraping credits exceed the budget | Free sources first, a per-search credit cap, cost shown before each run |
| Source terms change or an actor breaks | Connector interface, one source failing doesn't fail the search |
| Side project using employer-brand data | Check HP's policy before sharing results or using the HP name |
