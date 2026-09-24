# Design

## Principles
1. **Answer first, evidence one click away.** Every number opens the posts behind it.
2. **Show how sure we are.** Post counts and the uncertain band are visible, and thin data is marked.
3. **Plain language.** Readable by anyone from working level to leadership.
4. **Works on a phone** for reading. Editing can be desktop-first.

## Screens (Phase 1–2)

| Screen | Content |
|---|---|
| **Home / Search** | One search box, examples ("HP Sprocket", "what Gen Z says about printers"), recent and saved searches, month-to-date spend |
| **Plan review** | How the search was interpreted: keywords, sources, post cap, cost estimate. Edit → Run |
| **Progress** | Steps with live counts (collected, relevant, classified). Cost so far |
| **Codebook review** | Proposed stages, segments, themes, touchpoints with definitions and example posts. Edit / merge / add → Classify |
| **Catalog review** | Proposed product tree (family → series → model → SKU) and services, with aliases and regions. Edit / merge |
| **Report** | Filter bar (product tree, service, region, retailer/source, segment, stage, time) · summary · journey map · segments · pains, delights and needs · model/region comparison · sources · methods and confidence |
| **Posts explorer** | Filtered list of posts with Jev answers and confidence, source link, date |
| **Review queue & spot-check** | One post at a time, keyboard shortcuts, right/wrong or correct answer |

## Journey map (the headline feature)

```
          Discover   Compare    Buy     Set up    Everyday   Problems   Stay / leave
             │          │        │        │        use        support       │
emotion  ────●──────────●────────●────────╲         ●──────────●╲           ●
curve                                      ●                      ●
posts      n=64       n=41     n=22     n=88      n=120       n=57        n=19
top pain   —        price vs   —       app      paper       support    switching
                    features           pairing  cost        wait       to phone
delight   cute      reviews   gift     easy     photo       —          memories
          designs   videos    bundle   print    quality
touch-    TikTok    YouTube   Amazon   HP app   store       chat       —
points
quote     "…"       "…"       "…"      "…"      "…"         "…"        "…"
```
*(Illustrative layout, not real data.)*

- **Stages** come from the codebook, so they fit the product type (hardware,
  app, subscription).
- **Emotion curve** = net sentiment (% positive − % negative) per stage.
  Confidence band from the uncertain posts.
- **Moments of truth:** the biggest drops are highlighted as research opportunities.
- **Segment switcher:** see the journey for "Gen Z", "small business",
  "parents", etc. Phase 3 overlays two.
- **Live:** saved searches show "since last week" changes per stage.
- **Thin data:** stages with < 20 posts are drawn faded, with the count shown.
- Click any cell → the posts behind it.

Charts follow the dataviz rules: colour-blind-safe palette, light and dark
mode, a table view for every chart, and status colours always paired with an
icon and label.
