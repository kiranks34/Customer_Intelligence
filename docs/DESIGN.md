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

### Channels: one journey per channel, plus a combined journey

Each channel sees a different slice of the journey and a different kind of
person:

| Channel | Mostly shows | Bias to keep in mind |
|---|---|---|
| Amazon / retail reviews | Buy, set up, early use, problems | Verified buyers. Extremes (1★/5★). Little pre-purchase |
| Reddit | Compare ("which should I buy?"), troubleshooting, long-term use | Enthusiasts and people with problems. Skews negative |
| YouTube | Discover, compare, unboxing/setup. Comments hold questions and problems | Reviewer-led. Comments react to the video |
| TikTok / Instagram (Phase 2) | Discover, aesthetics, hype | Skews positive and promotional |

So Pulse offers two views:

1. **Channel view** (filter = one channel). That channel's own journey and
   report, including channel-native metrics (Amazon: star distribution,
   verified purchase. YouTube: views/likes. Reddit: upvotes/thread depth).
   Stages with too little evidence are faded with their count, or hidden.
   If Reddit can't show a full journey, it doesn't.
2. **Combined journey** (default for a family or series). Built stage by
   stage, never by pooling everything into one average:
   - A stage appears only if it has enough evidence (≥ 20 posts) across channels.
   - Each stage shows its **channel mix** ("Compare: Reddit 60%, YouTube 35%, Amazon 5%").
   - Stage sentiment is shown **per channel** (one dot each) with the
     combined value. When channels disagree strongly, the stage is marked.
     That disagreement is often an insight in itself: happy Amazon buyers
     and frustrated Reddit posters may be different kinds of people.
   - A toggle chooses between volume-weighted (big channels count more) and
     channel-balanced (each channel with enough evidence counts equally).
     The default is channel-balanced, so Amazon's volume doesn't drown out the rest.
   - Absolute sentiment is not compared across channels as if the audiences
     were equal. Comparisons are within a channel, or of changes over time.

Charts follow the dataviz rules: colour-blind-safe palette, light and dark
mode, a table view for every chart, and status colours always paired with an
icon and label.
