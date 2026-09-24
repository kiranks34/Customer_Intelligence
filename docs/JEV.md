# Jev in Pulse

## What Jev is

Jev (TypeSafe AI) is a classification-only model. You give it text and a
set of typed questions with fixed options. It returns one answer per question
plus a calibrated confidence. It cannot generate text. It is reached through
Vercel AI Gateway as `typesafe-ai/jev` and costs $0.042 per million input
tokens (from 2026-09-25). Keep concurrency at 2 to avoid 429 errors.

## What we already know (social-listening validation)

Every hand-labelled item from the earlier project was sent to Jev
(`jev_validate.py`, report in `scratchpad/jev_validation.md`):

- Confidence **≥ 0.8** → matched the human verdict **92–100%** of the time,
  across Reddit, Instagram, YouTube, buyer profiles, Chinese titles and
  paper worries.
- Confidence **< 0.5** → a coin flip.
- Jev was stricter than keywords, and closer to the real complaint rate
  (reassurances are not complaints). It also found real complaints that
  keywords missed.

## How Pulse uses it

Jev answers every per-post question. Claude never labels individual posts.

| Question | Options come from |
|---|---|
| Is this post about «search»? | yes / no / unclear |
| Overall sentiment toward «subject» | positive / negative / neutral / mixed |
| Journey stage | codebook stages + "not stated" |
| User segment | codebook segments + "not stated" |
| Themes present | codebook themes (one yes/no question per theme, or multi-select if supported) |
| Touchpoints | codebook touchpoints |

Claude writes the questions and option definitions once per search, when it
proposes the codebook. You approve them. They are versioned.

## Confidence policy

| Confidence | Treatment |
|---|---|
| ≥ 0.8 | Counted |
| 0.5 – 0.8 | Counted in an "uncertain" band, shown separately in charts |
| < 0.5 | Review queue. Not counted until you read it |

Thresholds are settings. We check them per new category with a spot-check
(EVALUATION.md), because the 92–100% figure comes from one category.

## To confirm in Phase 1

- Can one Jev call carry several questions? (That affects cost and speed.)
- Is multi-select supported, or one yes/no question per theme?
- Maximum input length per call (long Reddit threads, video transcripts).
- Reuse the question-wording lessons from the `Q_*` dicts in `jev_validate.py`.
