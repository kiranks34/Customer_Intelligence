# Evaluation, test and validation plan

## 1. The golden set

The golden set is the source of truth for "is the sentiment represented
accurately?".

- **Composition:** 300–500 mentions per study, stratified by source,
  product, star rating and length. **Over-sample hard cases**: mixed,
  sarcasm, negation, comparisons, non-English, very short.
- **Labelling:** two annotators label independently with the same guideline
  (`eval/LABELING_GUIDE.md`, to be written in Sprint 1). Disagreements are
  adjudicated. We report **Cohen's κ**. If κ < 0.7, the guideline is fixed
  before any model is judged.
- **Format:** `eval/golden_*.jsonl`. Each line holds a `mention_id`,
  `overall_sentiment`, `aspects: {aspect: sentiment}`, `journey_stage` and,
  optionally, `ownership_months`.
- **Split:** `dev` (used for prompt iteration) / `test` (touched only for
  release gates). The test split is never used for prompt tuning.
- **Growth:** Jev review-queue corrections are appended to `dev` weekly.

The repo ships a small **synthetic** golden file
(`eval/golden_sample.jsonl`) that exercises the tooling. It is not a
benchmark.

## 2. Metrics

| Metric | Definition |
|---|---|
| Overall sentiment accuracy / macro-F1 | Over {positive, negative, neutral, mixed} |
| Aspect detection P/R/F1 | Aspect present vs. golden aspect set |
| Aspect-sentiment F1 | (aspect, sentiment) pairs |
| Journey-stage accuracy | Where golden has a stage |
| Evidence grounding rate | % of evidence quotes found in source text |
| Jev flag precision / miss rate / auto-accept | See JEV.md |
| Cost per 1k mentions, p95 latency | From run logs |

## 3. Experiments and gates

| Gate | When | Pass criteria |
|---|---|---|
| **MVE gate** | End of Sprint 2 | Claude+Jev macro-F1 ≥ 0.85 **and** ≥ +10 pts over the keyword baseline on the `test` split. Grounding ≥ 98%. Cost per 1k mentions within the agreed budget |
| **Regression gate** | Every PR that changes a prompt, model, taxonomy or Jev threshold | No metric drops > 2 pts on `dev`. CI runs `pulse eval` |
| **Release gate** | Before each MVP/V1 release | MVE gate criteria on `test`, plus UI acceptance tests |
| **Drift check** | Weekly in production | Random 1% human audit. Alert if agreement drops > 5 pts |

Run it:
```bash
pulse eval --study studies/thermal_printers.yaml \
           --input data/samples/thermal_printer_reviews.jsonl \
           --golden eval/golden_sample.jsonl --enricher keyword
# and with the LLM (needs ANTHROPIC_API_KEY):
pulse eval ... --enricher claude
```

## 4. Software test strategy

| Level | Scope | Tooling |
|---|---|---|
| Unit | Schema validation, normalization, dedupe, each Jev check, metrics math | pytest |
| Contract | `ClaudeEnricher` against a fake client (no network): request shape, refusal handling, parse errors | pytest |
| Integration | Full pipeline on sample data with `KeywordEnricher` → store → metrics → report | pytest |
| Evaluation | Golden-set scoring (above) | `pulse eval` |
| UI (MVP) | Leadership view renders, drill-down links, a11y, mobile | Playwright |
| Data quality | Row counts, null rates, duplicate rate, freshness per run | run checks + alerts |

## 5. Bug triage

- **Sev 1:** wrong numbers on the leadership view, or data leaking across
  studies. Fix before the next digest.
- **Sev 2:** a mislabel pattern affecting a whole aspect or source. Add
  failing cases to the golden `dev` set, fix the prompt/Jev rule, re-run the
  gate.
- **Sev 3:** cosmetic or single-record issues.

Every model-quality bug becomes a golden-set test case, so it cannot regress
silently.
