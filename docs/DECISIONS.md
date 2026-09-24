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

## Open questions

| # | Question | Needed by |
|---|---|---|
| Q1 | Which two searches for the Phase 1 feasibility test (one product, one audience)? | Phase 1 start |
| Q2 | Which Claude model for planning, codebook and narrative? Proposed: Claude Opus 5 (~$0.5–1 per search at this volume); Sonnet 5 as a cheaper option if needed | Phase 1 |
| Q3 | Jev: several questions per call? multi-select? input length limit? (We'll test) | Phase 1 |
| Q4 | Default region(s) and languages for searches | Phase 1 |
| Q5 | Vercel plan (Hobby vs Pro) affects background-job limits | Phase 1 setup |
