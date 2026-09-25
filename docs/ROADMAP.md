# Roadmap

Each phase ends with a demo, a check against its gates, and a bug-fix pass.
We move on only if the gates pass.

## Phase 0: Plan ← we are here
- [x] Goal alignment
- [x] PRD, architecture, Jev role, evaluation, design (this folder)
- [x] Your review of these docs (PR #1 merged)
- [x] First search: HP Smart Tank printers
- [x] Phase 1 scope: North America only. Filters family → series. Price approach (DECISIONS D17–D20)

## Phase 1: Feasibility, "does it work on a few hundred posts?"
Rough web app, not polished. Proposed scope: **HP Smart Tank, North America**.
1. ✅ Project setup: Next.js on Vercel Hobby, Postgres schema, passcode, env vars, cost meter, CI
2. ✅ Connectors: YouTube (free) + Reddit via ScrapeCreators, with a test page. Amazon via Apify once credits are topped up (D23)
3. ✅ Search planner (Claude via AI Gateway): topic **or question** → editable plan (time window, focus, queries, caps) with cost estimate; collection from YouTube + Reddit with live progress
4. ✅ Product catalog: one per family, Claude drafts it from the model mentions in the posts, you review and approve it; posts are linked to the models they name (D29). Amazon listings and price observations join when Apify is on
5. Relevance gate + codebook discovery + classification (Jev), incl. model mapping
6. Test Jev on a few Spanish/Portuguese/Hindi posts (cheap check for Phase 2)
7. Review queue + 20-post spot-check screen
8. Basic report: summary, themes, segments, first journey map, filters by model/service, drill-down to posts, **answer card for question searches** (numbers from SQL + cited posts)
9. Integrity checks
10. Run the Smart Tank search → **gate review** (EVALUATION.md §2)

## Phase 2: MVP, "a tool I use every week"
- More regions: India → LATAM → China, each with its retail and social sources
- More NA retailers (Best Buy, Walmart, Target, Costco) + ScrapeCreators (TikTok, Instagram)
- Region and cross-region model comparison (same printer, different regional names)
- Model filter, price tiers per region, promotion calendar on trend charts
- Full journey map (emotion curve, moments of truth, segment filter, touchpoints)
- Saved searches with daily refresh, trends and "what changed"
- Filters: segment, source, region, time
- Polish and usability pass

## Phase 3: V1, "share and compare"
- Compare two products or segments (journey overlay)
- Read-only share link + one-page leadership export
- Conversational follow-up questions on a report
- Alerts on sudden changes

## Working rhythm
- Small pull requests, each reviewed with `/code-review` before merge
- Tests with every feature
- A short demo note after each step, with screenshots
