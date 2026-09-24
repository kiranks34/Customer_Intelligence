# Jev: verification and decision layer

> **Assumption to confirm:** in the thermal-printer project, Jev acted as a
> *decision model* that judged whether an assigned sentiment "made sense".
> This document turns that role into a permanent, measurable pipeline stage.
> If Jev has a specific implementation (prompt, model, rules or a trained
> classifier), it plugs in behind the `Verifier` interface
> (`src/pulse/jev/base.py`) and the design below still holds.

## Why a separate verification layer

An LLM extractor is fluent and usually right. When it is wrong, the output
still *looks* confident. Keyword search is wrong in predictable ways. Neither
can grade itself. Jev's job is to make each label **earn its way into the
metrics**:

1. **Grounding.** Is the claim supported by the customer's own words?
2. **Consistency.** Do the labels agree with each other and with metadata
   such as the star rating?
3. **Judgment.** For hard cases (sarcasm, mixed, negation, comparisons),
   would an independent reviewer reach the same label?

## Tiered design

| Tier | Runs on | Cost | Checks |
|---|---|---|---|
| **T1: deterministic** | 100% of records | ~0 | `evidence_grounded`: every evidence quote appears (normalized) in title+text · `taxonomy_valid`: aspects exist in the study taxonomy · `rating_consistency`: 4–5★ with negative overall (or 1–2★ with positive) is flagged · `ownership_grounded`: an ownership duration needs an evidence quote that is found in the text · `coverage`: a long text with zero aspects is suspicious · `ambiguity_cues`: sarcasm/negation/contrast markers ("not bad", "yeah right", "but") |
| **T2: LLM judge** | T1 failures + ambiguity cues + a random audit sample (default 10%) | 1 LLM call | An independent re-read. Returns `agree`/`disagree` per field, a corrected overall sentiment if needed, and a rationale |
| **T3: human** | `review` decisions | analyst time | Accept / correct. Corrections go to the golden set |

## Decision policy

```
if any hard failure (e.g. ungrounded evidence, invalid aspect)   -> review (or reject if the judge also disagrees)
elif soft failure or ambiguity cue                               -> T2 judge
     judge agrees                                                -> accept (confidence adjusted)
     judge disagrees                                             -> review
else                                                             -> accept
```

- `confidence` starts at 1.0 and loses a weighted penalty for each failed
  check. The judge's agreement restores part of it.
- Thresholds are in the study config. Starting values: accept ≥ 0.7.
- `reject` is reserved for off-topic, spam, or unreadable input. Rejected
  records are kept for audit but excluded from metrics.

## How we measure Jev itself

Jev is a model too, so it gets its own metrics (see EVALUATION.md):

- **Flag precision:** of the records Jev sent to review, how many were
  actually wrong? A low value means we are wasting analyst time.
- **Miss rate:** of the records that are wrong in the golden set, how many
  did Jev accept? A high value means untrustworthy dashboards.
- **Auto-accept rate:** the ops load. Target ≥ 85%.

We tune the thresholds to trade these off. For leadership metrics we prefer a
low miss rate over a high auto-accept rate.

## Suggested improvements over the one-off Jev step

1. **Evidence-first extraction.** The extractor *must* quote the text for
   every label, which makes T1 grounding checks possible for free.
2. **Aspect-level verification**, not just overall sentiment. Mixed reviews
   are where keyword approaches fail most.
3. **Independent judge prompt.** The judge does not see the extractor's
   reasoning, only its labels, so it cannot simply agree with them.
4. **Closed learning loop.** Human corrections become golden-set items and
   few-shot examples. Every prompt change must pass the golden-set gate.
5. **Show the verification.** Each chart shows "verified coverage %" so
   leadership knows how much of the data backs the number.
