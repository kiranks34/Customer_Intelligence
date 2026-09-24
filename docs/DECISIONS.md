# Decision log (ADRs) and open questions

## ADR-001: Python pipeline with pluggable stages
**Decision:** Python 3.11. Every stage (connector, enricher, verifier) sits
behind a small interface.
**Why:** The data/ML ecosystem is in Python. Interfaces let us swap scrapers
for licensed feeds, and the keyword baseline for the LLM, without touching
the rest.

## ADR-002: Aspect-based, evidence-backed extraction
**Decision:** The extractor returns sentiment per taxonomy aspect, with a
verbatim evidence quote for each label.
**Why:** Document-level sentiment hides mixed reviews. Evidence quotes make
labels auditable and make Jev's grounding checks deterministic.

## ADR-003: Jev as a tiered verifier gating metrics
**Decision:** Only Jev-accepted (or human-corrected) records feed metrics.
Deterministic checks run on 100% of records. The LLM judge runs on flagged,
ambiguous and sampled records.
**Why:** Trust at a sustainable cost. See JEV.md.

## ADR-004: Claude via structured outputs; keyword baseline as control
**Decision:** `ClaudeEnricher` uses the Anthropic SDK's structured outputs
with `claude-opus-5` and server-side refusal fallbacks. The Batch API is used
for backfills. `KeywordEnricher` is always run as the control.
**Why:** Schema-valid output removes parsing failures. The control makes the
value measurable.

## ADR-005: SQLite for MVE, Postgres for MVP
**Why:** Zero setup now. The schema is kept portable.

## ADR-006: Study-as-config
**Decision:** All product/brand/industry/region specifics live in
`studies/*.yaml`.
**Why:** Repeatability (PRD G2).

---

## Open questions

| # | Question | Owner | Needed by |
|---|---|---|---|
| Q1 | What exactly is Jev today (prompt / model / rules / classifier)? Can we get the code or prompt? | Kiran | Sprint 1 |
| Q2 | Which sources did the thermal-printer study use, and under what terms (API, scraper, vendor)? | Kiran | Sprint 1 |
| Q3 | Can we have the thermal-printer dataset + audit notes to seed the golden set? | Kiran | Sprint 1 |
| Q4 | Who are the 1–2 exec reviewers for the MVE report? | Kiran | Sprint 2 |
| Q5 | Target cost budget per 1k mentions / per month? | Kiran | Sprint 2 |
| Q6 | Preferred alert/digest channel (Slack, Teams, email)? | Kiran | Sprint 3 |
| Q7 | Hosting preference for MVP (your cloud, Netlify + managed DB, internal)? | Kiran | Sprint 3 |
| Q8 | Languages/regions in scope for the first live study? | Kiran | Sprint 3 |
