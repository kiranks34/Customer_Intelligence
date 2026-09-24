# How we know Pulse is right

## 1. Spot-check (the only manual step)

After each new search, Pulse shows you **20 randomly chosen posts that were
counted automatically**, with Jev's answers. You tick right or wrong. It
takes about 10 minutes. This is the same idea as the hand-verdict files,
just smaller and built into the app.

- ≥ 18 of 20 right → the report is trustworthy for this search.
- Fewer → we look at what went wrong (question wording, codebook
  definitions, threshold) before trusting the report.

The review queue (posts under 0.5 confidence) is separate. Reading those
adds them to the counts.

## 2. Feasibility gates (Phase 1)

Run on two real searches: one product search and one audience search.

| Gate | Pass if |
|---|---|
| Data | ≥ 300 relevant posts collected from free sources |
| Accuracy | Spot-check ≥ 18/20 on sentiment and on journey stage |
| Coverage | ≥ 70% of relevant posts counted automatically (Jev ≥ 0.8) |
| Journey | ≥ 4 stages with ≥ 20 posts each (product search) |
| Cost | ≤ $1.50 per search, all APIs |
| Speed | ≤ 15 minutes from search to report |
| Value | You find ≥ 3 insights worth acting on |

If a gate fails, we fix and re-run before building more. If accuracy or
journey coverage can't pass, we rethink the approach before Phase 2.

## 3. Report integrity checks (automatic, every report)

Same idea as the earlier `verify_*.py` scripts:

- Every number in the report equals the SQL query it came from.
- Every quote exists verbatim in the `post` table.
- Every post ID Claude cites exists and belongs to this search.
- Post counts per section add up to the base shown.

A failed check blocks the report from being marked "ready".

## 4. Software tests

| Level | What |
|---|---|
| Unit | Dedup, pseudonymization, confidence banding, aggregation math, cost meter |
| Contract | Jev and Claude calls against recorded responses (no network) |
| Integration | A full search on a fixture dataset → report |
| UI | Search flow, journey map renders, drill-down to posts (Playwright) |

Every change gets `/code-review` before merge.
