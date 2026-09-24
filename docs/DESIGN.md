# Design requirements (UI/UX)

## Principles
1. **Answer first, then evidence.** Every screen opens with the conclusion
   (e.g. "Net sentiment down 8 pts, driven by driver software"). Every
   number is one click away from the quotes behind it.
2. **Show how much to trust it.** Sample size and "verified coverage %" sit
   next to every metric. Low-volume points are visibly de-emphasized.
3. **Preempt, don't report.** Alerts and "what changed" come before static
   totals.
4. **Shareable.** Any view can be shared as a link or exported (PNG/PDF/CSV)
   for leadership decks.
5. **Study-agnostic.** No printer-specific UI. Everything comes from the
   study config.

## Information architecture (MVP)

| Screen | Purpose | Key components |
|---|---|---|
| **Leadership view** | 2-minute weekly read | KPI tiles (NSS, volume, verified %, open alerts) · NSS trend by product · top 3 drivers up/down with a quote each · alerts list |
| **Explorer** | Slice and drill | Filters (study, product, source, date, aspect, stage, segment, sentiment, rating) · mention list with highlighted evidence · mention detail (full text, labels, Jev checks, source link) |
| **Aspects** | What drives sentiment | Aspect × product heatmap (NSS) · aspect trend small multiples · driver waterfall between two periods |
| **Journey** | When in the lifecycle | NSS by journey stage · ownership-months curve (sentiment vs. months owned) · touchpoint map |
| **Compare** | Product vs. product / brand vs. brand | Side-by-side aspect NSS · share of voice · distinct pain points |
| **Review queue** | Jev human-in-the-loop | Record + failed checks + judge rationale · accept/correct shortcuts · throughput stats |
| **Study admin** | Onboard / tune | Products, competitors, sources, taxonomy editor, thresholds, run history |

## Interaction rules
- Filters live in one row at the top and persist in the URL (so links are shareable).
- Charts have hover tooltips (value, n, verified %). Clicking a point
  filters the Explorer to that slice.
- Every chart has a table view (accessibility + export).
- Light and dark themes. Colour-blind-safe palette. Status colours
  (critical/warning) always come with an icon and label.
- Mobile: the leadership view must work on a phone (execs read it there).

## Leadership report (MVE)
`pulse report` generates a single static HTML page that previews the
leadership view: KPI tiles, NSS trend, aspect table, journey-stage table,
alerts and evidence quotes. It is the prototype we put in front of execs in
Sprint 2 before building the web app.
