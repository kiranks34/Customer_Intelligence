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

Claude drafts the codebook (stages, segments, themes) once per search from a
sample of up to 60 posts. It is used straight away, with no approval step; you
can edit it on the search page, and every edit is a new version
(docs/DECISIONS.md D37). Touchpoints come later with the journey map.

### How it's called (confirmed from the AI SDK, `experimental_evaluate`)

- **One call per post carries every question**: the kind of post (choice: product
  feedback / other brands / chat / unclear, D38), sentiment
  (choice), stage and segment (choice, plus "not stated"), and one yes/no per
  theme, so a post can have several themes. Code: `src/lib/codebook.ts`.
- A yes/no answer returns P(yes). We store "yes"/"no" with confidence
  max(p, 1 − p). A choice returns the chosen option and, when available, the
  probability of each option; we store the chosen option's probability (0.5
  if none is given, so it's never counted as sure).
- Each post is sent with its context: channel, the video or Reddit thread title
  it was posted under, and the catalog products it names (D38).
- Posts are cut at 3,000 characters. A post Jev rejects as bad input is stored
  as "skipped" and never counted.

## Confidence policy

| Confidence | Treatment |
|---|---|
| ≥ 0.8 | Counted |
| 0.5 – 0.8 | Counted in an "uncertain" band, shown separately in charts |
| < 0.5 | Review queue. Not counted until you read it |

**Relevance** (D37, D38): a post counts when Jev is ≥ 0.8 sure it is product
feedback; ≤ 0.2 goes to its group (other brands, chat, not about it); in between
or "unclear" goes to Needs a look. Originally (D37): a yes/no confidence is never below 0.5, so a
post is counted only when Jev is sure (≥ 0.8) it is about the subject, or you
kept it. Less sure posts go to the optional "Needs a look" list (Keep / Drop)
and are not counted meanwhile. The bands above apply to the other answers,
within counted posts.

Thresholds are settings. We check them per new category with a spot-check
(EVALUATION.md), because the 92–100% figure comes from one category.

## Still to confirm

- The real cost per 100 posts on a live run (the first run is the measurement).
- Maximum input length per call (we cut at 3,000 characters meanwhile).
- Reuse the question-wording lessons from the `Q_*` dicts in `jev_validate.py`.
