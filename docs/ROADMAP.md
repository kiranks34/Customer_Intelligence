# Roadmap and delivery process

## Delivery process

We run Pulse as an AI product with two kinds of "done": the **software works**
and the **model is measurably right**.

```
Discover → Define (PRD) → Design → Build (sprint) → Evaluate (golden set) → Review → Ship → Monitor
                 ↑                                                                        │
                 └──────────────────── learnings, golden-set growth ──────────────────────┘
```

- **Sprints:** 2 weeks. Each ends with a demo and an eval report (metrics
  vs. the last sprint).
- **Definition of Done:** code reviewed, unit and integration tests green,
  golden-set regression gate passing, docs and ADR updated, demoable.
- **Artifacts:** PRD (living), ADRs in `DECISIONS.md`, eval reports in
  `eval/reports/`, changelog.

## Phase 0: Kickoff (this sprint) ✅ in progress
- [x] PRD v0.1, architecture, Jev design, evaluation plan, design requirements
- [x] Repo scaffold: canonical schema, study config, ingest, keyword baseline,
      Claude extractor, Jev T1+T2, SQLite store, metrics, static report, eval CLI
- [x] Synthetic sample study + tests
- [ ] **You:** confirm open questions in DECISIONS.md, share the Jev details,
      share the thermal-printer dataset (or a sample)

## Phase 1: MVE, "prove verified LLM sentiment beats keywords" (Sprints 1–2)
- Load the real thermal-printer data through the pipeline
- Write the labelling guide. Build a golden set of ~300 items with 2 annotators (κ)
- Run keyword vs. Claude vs. Claude+Jev. Tune prompt, effort and thresholds on `dev`
- Measure cost per 1k mentions (Batch API for the backfill)
- **Exit:** MVE gate (EVALUATION.md §3). Leadership report v1 reviewed with 1–2 execs
- **Kill/pivot criterion:** if the gate fails after 2 prompt iterations,
  review the taxonomy/guideline before spending on UI

## Phase 2: MVP, "one study, live daily" (Sprints 3–6)
- 2–3 compliant live sources + scheduler (daily incremental)
- Postgres. FastAPI read API
- Web app: leadership view, explorer/drill-down, compare, Jev review queue
  (see DESIGN.md)
- Alerts (Slack/Teams/email) + weekly digest
- Observability: run health, cost, Jev accept rate
- Usability test with 5 target users. Fix top issues
- **Exit:** 4 consecutive weeks live without Sev-1. Leadership using it weekly

## Phase 3: V1, "any product, any brand" (Sprints 7–10)
- Study onboarding UI + LLM-drafted taxonomy templates
- Multi-study compare (brands/regions)
- Ask-the-data with citations
- First-party data blending (support tickets, NPS verbatims, returns)
- Closed loop to Jira/Linear. Issue → fix → sentiment recovery tracking
- Hourly freshness

## Phase 4: V2, "platform"
- Multi-tenant, SSO/RBAC, audit logs
- Forecasting (predict rating/return movement from early signals)
- Research integrations: recruit ethno participants from signal segments

## Sprint 1 backlog (proposed)
1. Import the thermal-printer dataset → `data/` (private, gitignored if sensitive)
2. Finalize the thermal-printer taxonomy with you (current draft in `studies/thermal_printers.yaml`)
3. Write the labelling guide + label the first 100 golden items
4. First real eval run: keyword vs. Claude. Publish `eval/reports/sprint1.md`
5. Plug the existing Jev logic into the `Verifier` interface. Compare against T1+T2
6. Leadership report review with one exec. Capture feedback into DESIGN.md
