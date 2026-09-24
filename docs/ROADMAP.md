# Roadmap

Each phase ends with a demo, a check against its gates, and a bug-fix pass.
We move on only if the gates pass.

## Phase 0: Plan ← we are here
- [x] Goal alignment
- [x] PRD, architecture, Jev role, evaluation, design (this folder)
- [ ] Your review of these docs
- [ ] Pick the two feasibility searches

## Phase 1: Feasibility, "does it work on a few hundred posts?"
Rough web app, not polished.
1. Project setup: Next.js on Vercel, Postgres, passcode, env vars, cost meter
2. Connectors: YouTube + Reddit (free)
3. Search planner (Claude) with an editable plan
4. Relevance gate + codebook discovery + classification (Jev)
5. Review queue + 20-post spot-check screen
6. Basic report: summary, themes, segments, a first journey map, drill-down to posts
7. Integrity checks
8. Run the two feasibility searches → **gate review** (EVALUATION.md §2)

## Phase 2: MVP, "a tool I use every week"
- ScrapeCreators (TikTok, Instagram) + Apify (Amazon/retail reviews)
- Full journey map (emotion curve, moments of truth, segment filter, touchpoints)
- Saved searches with daily refresh, trends and "what changed"
- Filters: segment, source, region, time
- Polish and usability pass

## Phase 3: V1, "share and compare"
- Compare two products or segments (journey overlay)
- Read-only share link + one-page leadership export
- Ask-a-question with cited posts
- Alerts on sudden changes

## Working rhythm
- Small pull requests, each reviewed with `/code-review` before merge
- Tests with every feature
- A short demo note after each step, with screenshots
