# PRD: Pulse, a Customer Intelligence Platform

| | |
|---|---|
| Status | Draft v0.1 (Sprint 0) |
| Owner | Kiran (Product) |
| Last updated | 2026-09-24 |
| Related | [ARCHITECTURE](ARCHITECTURE.md) · [JEV](JEV.md) · [EVALUATION](EVALUATION.md) · [ROADMAP](ROADMAP.md) · [DESIGN](DESIGN.md) · [DECISIONS](DECISIONS.md) |

---

## 1. Background

The thermal-printer social listening project showed that scraped reviews and
community posts contain a lot of signal. It also showed three problems:

1. **Keyword search misreads sentiment.** Examples: "not bad at all", sarcasm,
   mixed reviews ("print quality is great but the driver is a nightmare"),
   and a 5-star rating over a complaint. Audits caught data-quality issues,
   but we could not *prove* the sentiment labels were right.
2. **Jev fixed trust, but by hand.** Adding Jev as a decision model to check
   whether a sentiment "really made sense" raised confidence. It ran as a
   one-off step, not as part of the system.
3. **Everything was a project, not a product.** Each new study (device, brand,
   region) would mean rebuilding scrapers, prompts, audits and charts.

## 2. Vision

> An always-on, verified voice-of-customer platform. Any product, brand,
> industry or region can be onboarded as a *study*. Every new review or comment
> becomes a structured, evidence-backed insight within hours. Leadership sees
> the trend, and teams can drill into the exact review, the reason behind it,
> and who said it at which point in their journey.

Pulse **complements** ethnographic and market research; it does not replace
them. It gives research teams a continuous, quantified baseline, surfaces
hypotheses worth a deep-dive study, and supplies real customer quotes to
recruit against and cite.

## 3. Problem statement

Product, CX and leadership teams react to customer pain late, usually after
ratings, returns or support volume have already moved. The signal was in
public reviews and discussions weeks earlier, but it was unstructured, noisy,
unverified and spread across sources.

## 4. Personas

| Persona | Needs | Primary surface |
|---|---|---|
| **Executive sponsor** (VP/GM) | A weekly "are we getting better or worse, and why" in under 2 minutes; early warning | Leadership trend page, weekly digest email |
| **Product manager** | Which aspects drive detractors, by model/version; before/after a release | Aspect drivers, product compare, drill-down |
| **CX / Support lead** | Emerging issues, setup/onboarding pain, support touchpoint quality | Alerts, journey-stage view |
| **UX / Market researcher** | Segments, needs/wants, quotes, hypotheses to test in ethno studies | Explorer, export, evidence quotes |
| **Analyst / study admin** | Onboard a new study, tune taxonomy, review Jev-flagged items | Study config, review queue |

## 5. Goals and non-goals

### Goals
- G1. **Trustworthy labels.** Every insight is grounded in a verbatim quote and
  verified by Jev. Accuracy is measured against a human-labelled golden set.
- G2. **Repeatable.** A new study (product, brand, industry, region) can be
  onboarded with configuration only, no code changes, in under 1 day.
- G3. **Continuous.** New mentions are ingested, enriched, verified and
  reflected in trends automatically (daily in MVP, hourly later).
- G4. **Explainable.** Every chart value drills down to the individual mentions
  and quotes behind it.
- G5. **Proactive.** Anomalies such as a spike in an aspect's negative share
  raise alerts before they show up in ratings.

### Non-goals (for now)
- Replacing surveys, ethnography or NPS programs.
- Identifying real individuals. We keep pseudonymous author handles and
  public metadata only (see §10).
- Responding to or engaging with customers on social platforms.
- Building scrapers that break a site's Terms of Service. We prefer official
  APIs, licensed data providers and first-party data.

## 6. What we extract per mention

| Dimension | Example output | Why it matters |
|---|---|---|
| Overall sentiment + intensity | `negative, -0.7` | Headline trend |
| **Aspect-based sentiment** (from study taxonomy) | `print_quality: +`, `driver_software: −` | Mixed reviews stop cancelling out; the drivers become visible |
| **Evidence quote** per label | `"driver keeps crashing on macOS"` | Grounds the label; Jev checks it |
| Journey stage | pre-purchase / setup / early use (<1 mo) / established (1–6 mo) / long-term (>6 mo) / support / churn | "After how many months" question |
| Ownership duration | `4 months` (+ evidence) | Durability and failure curves |
| Segment signals | use case (shipping labels, receipts), persona (SMB, home, enterprise) | Segment understanding |
| Pain points, needs/wants | `"wants Bluetooth pairing without app"` | Opportunity backlog |
| Touchpoints | retailer, support, packaging, app, docs | End-to-end CX map |
| Intent | recommend, return, switch, repurchase | Churn and advocacy |
| Competitors mentioned | `Brand B` | Competitive intel |
| Trust flags | incentivized, suspected spam/bot, off-topic | Clean metrics |

## 7. User stories (MVP)

- US1. As an exec, I open one page and see net sentiment for my product over
  time, how it compares to competitors, and the top 3 drivers up or down.
- US2. As a PM, I click a spike and see the mentions behind it, with quotes,
  source links, date, rating and journey stage.
- US3. As a PM, I compare two products or models aspect by aspect.
- US4. As a CX lead, I get an alert when an aspect's negative share jumps
  well above its baseline, with evidence attached.
- US5. As a researcher, I filter by segment, stage and aspect and export
  quotes to CSV for a research readout.
- US6. As an analyst, I create a new study from a YAML/UI template
  (products, competitors, sources, taxonomy, regions) and run a backfill.
- US7. As an analyst, I work through the Jev review queue. My corrections
  feed the golden set.
- US8. As an exec, I receive a weekly digest (email/Slack) with the trend
  chart and the 3 things that changed.

## 8. Functional requirements

| ID | Requirement | Phase |
|---|---|---|
| FR1 | Pluggable connectors: file upload (CSV/JSONL), then official APIs / licensed feeds (e.g. retailer review feeds, Reddit API, YouTube Data API, app stores) | MVE: files · MVP: 2–3 sources |
| FR2 | Canonical `Mention` schema; normalization, language detection, dedupe (incl. cross-retailer syndicated reviews) | MVE |
| FR3 | Study config: products, brands, competitors, regions, languages, aspect taxonomy, journey rules | MVE |
| FR4 | LLM enrichment to structured output with evidence quotes; prompt + model versioned per record | MVE |
| FR5 | Jev verification: deterministic grounding checks + LLM judge; accept / review / reject | MVE |
| FR6 | Human review queue; corrections stored and promoted to golden set | MVP |
| FR7 | Metrics: volume, Net Sentiment Score (NSS), aspect NSS, stage NSS, share of voice, rating vs. text divergence | MVE (batch) · MVP (live) |
| FR8 | Anomaly detection and alerts (email/Slack/Teams) | MVP |
| FR9 | Web app: leadership view, explorer/drill-down, compare, review queue, study admin | MVP |
| FR10 | Weekly digest + shareable leadership link | MVP |
| FR11 | Ask-the-data: natural-language questions answered with cited mentions | V1 |
| FR12 | Closed loop: push an insight to Jira/Linear/ServiceNow; track resolution vs. sentiment | V1 |
| FR13 | Blend first-party data (support tickets, NPS verbatims, returns) with public data | V1 |
| FR14 | Multi-tenant, SSO, role-based access | V2 |

## 9. Non-functional requirements

- **Accuracy:** gates in [EVALUATION.md](EVALUATION.md); dashboards only count
  Jev-accepted records.
- **Freshness:** ≤ 24h from post to dashboard (MVP), ≤ 1h (V1).
- **Cost:** tracked per 1,000 mentions. Backfills use the Batch API (50%
  discount). Prompt caching on the study system prompt.
- **Traceability:** every enriched record stores source URL, raw text hash,
  model, prompt version, Jev verdict and timestamps. Results are reproducible.
- **Idempotency:** re-running ingestion never duplicates or re-bills
  already-processed mentions.
- **Portability:** SQLite locally, Postgres in production. No lock-in on the
  LLM provider interface (the Claude extractor is one implementation).

## 10. Privacy, legal and ethics

- Collect public content only, from sources whose ToS/API terms permit it.
  A source register records the legal basis for each connector.
- Author handles are **pseudonymized** (salted hash) at ingestion. Public
  profile metadata we keep: verified purchase, reviewer rank. Contacting or
  identifying individuals is out of scope.
- Retention policy per study. Deletion requests propagate by source ID.
- Quotes in leadership materials are trimmed to what is necessary.
- GDPR/CCPA review before any EU/CA-region study goes live.

## 11. Success metrics

| Layer | Metric | Target |
|---|---|---|
| Model quality | Overall sentiment macro-F1 vs. golden set | ≥ 0.85 and ≥ +10 pts over keyword baseline |
| Model quality | Aspect-sentiment F1 | ≥ 0.75 |
| Trust | Evidence grounding rate (quote found verbatim) | ≥ 98% |
| Trust | Jev precision on flags (flagged items truly wrong) | ≥ 0.6 |
| Ops | Share of mentions auto-accepted by Jev | ≥ 85% |
| Adoption | Weekly active leadership viewers | 5+ within 1 month of MVP |
| Impact | Issues surfaced by Pulse before a ratings/returns move | ≥ 2 per quarter, logged |
| Impact | Time from new issue to leadership awareness | from weeks to < 3 days |
| Repeatability | Time to onboard a new study | < 1 day |

## 12. Scope by phase

See [ROADMAP.md](ROADMAP.md) for detail.

- **MVE (Minimum Viable Experiment).** Answers one question: *does LLM + Jev
  label customer sentiment measurably better than the keyword approach, at an
  acceptable cost?* Offline pipeline, one study (thermal printers), golden
  set, static leadership report.
- **MVP.** One study live daily. Web app with leadership view + drill-down +
  compare + review queue. Alerts. Weekly digest.
- **V1.** Multi-study, self-serve onboarding, ask-the-data, closed loop,
  first-party data.
- **V2.** Multi-tenant SaaS hardening, SSO, forecasting.

## 13. Risks

| Risk | Mitigation |
|---|---|
| Source access blocked / ToS change | Connector abstraction; licensed providers; source register |
| LLM label drift after a model or prompt change | Versioned prompts; golden-set regression gate in CI |
| Fake/incentivized reviews skew trends | Trust flags + excluded-from-metrics toggle |
| Syndicated reviews double-counted | Cross-source near-duplicate detection |
| Small volumes create noisy trends | Minimum-volume thresholds, confidence bands, rolling windows |
| Cost at scale | Batch API, caching, only send ambiguous items to the LLM judge |
| Stakeholders over-trust a chart | "Verified coverage %" and sample size shown next to every metric |

## 14. Open questions

Tracked in [DECISIONS.md § Open questions](DECISIONS.md#open-questions).
