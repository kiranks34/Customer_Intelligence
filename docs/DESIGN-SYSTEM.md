# Design system

Pulse's visual rules. Every piece lives in code in `src/app/ui.ts` (class names) and `src/app/globals.css` (colour
tokens). The page **/design** in the app shows all of them in the current theme. `src/app/design-system.test.ts` runs
with `npm test` and fails on the usual drift (raw colours, home-made buttons or links, font sizes off the scale).

Rule of thumb: **a page never invents a style.** If something new is needed, it is added to `ui` (and to /design)
first, then used.

## Foundations

### Colour (tokens, light and dark)

| Token | Use |
|---|---|
| background, surface, surface-2 | page, cards, raised areas inside cards |
| border | lines and outlines |
| foreground, muted, faint | text: main, secondary, disabled or placeholder |
| accent (blue) | actions and links only |
| good (green) | positive, done, verified |
| warning (amber) | needs you: Update ready, To review, budget |
| critical (red) | negative sentiment, errors, Stopped, Remove |
| violet | competitors; side B of a comparison |
| slate | neutral sentiment |

**Comparisons:** side A is always blue (accent) and side B always violet, in pickers, bars, journey cells and names
(`SideName`), so a side is recognised by colour and name together.

No hex values in components. Colour never carries meaning alone: a status always has its word, a bar has its number.

### Type scale

| Style | Size | `ui` name |
|---|---|---|
| Page title (one per page) | 26px bold | `pageTitle` |
| Section and card titles | 18px bold | `sectionTitle`, `cardTitle` |
| Picker, emphasis | 15px semibold | |
| Body | 14px | |
| Detail line under a title | 13px grey | `detail` |
| Meta, hints | 12px grey | `meta` |
| Group label, table heads | 11px bold caps | `eyebrow` |

### Spacing and shape

- Page: max width as `AppShell`; 16px side gutter on a phone; 24px between sections.
- Cards (`card`, `cardHead`, `cardBody`): 16px side padding on a phone, 24px from tablet up; 16px between items.
- Radius: cards 16px; buttons, inputs and notices 10px (small buttons 8px); pills and badges fully round.
- Heights: large buttons 44px, small buttons 32px, inputs 40px, chips 34px, badges 22px. Touch targets are at least
  32×32.

## Components

### Buttons

| Kind | Looks | When |
|---|---|---|
| `primary` / `primarySm` | blue fill | the one main action of the area |
| `secondary` / `secondarySm` | blue outline, tint | opens something in place (with ▾ / ▴), or a second action |
| `plain` / `plainSm` | grey | neutral choices next to a main one: Edit myself, Cancel, Undo |
| `icon` | no frame | ⋯ menus; always has an `aria-label` |

At most one filled button per area. Labels are short verbs that say what happens ("Collect new posts", not "Run").

**Cost of paid actions:** never in the button label (it makes buttons long). It sits in a grey meta line right under
the button ("about $0.17"), or at the end of the sentence the button belongs to ("… (about $0.15); nothing changes
until you save."). In a menu, it opens the item's second line ("about $0.04 · searches again, then reads what's new").

### Links

`ui.link`: blue, underlined. The arrow says where it goes: **→** another page in Pulse, **↗** another website (opens
a new tab), **↓** further down this page.

### Navigation (D47)

- Top bar: Studies, Products. The Pulse logo goes to Studies.
- Every page below them starts with the **breadcrumb** (`Crumbs`): `Studies › study`, `Products › family`. Parts are
  links, the last part is the page you are on, names match the top bar.
- A page reached from the other section shows **"← Back to study"** (`ui.back`; the study's name on hover) or "← Back
  to New study". Labels stay short; long names never go in a button.
- Tabs (`tab`, `tabOn`) switch views inside one page and keep the way back.

### Page header

Every page starts the same way:

1. Breadcrumb (pages below Studies or Products), with "← Back to …" above it when you came from the other section.
2. One row: the **page title on the left** (with its detail lines under it), and on the **right, level with the
   title**, the page's status and main action: the status word (never a line under it), the button (its cost under
   it), then ⋯. Pages
   without a status put their main action there alone (Products: "+ Add a product family"; a family: "Check for new
   models", "Start a study →").
3. Anything else (a question, tabs, the study bar) comes below that row, never between the title and its action.

On a phone the right side wraps under the title, still right-aligned. A study's bar (sticky, with the jump links)
takes over the status and action only once the title has scrolled out of view, so they never show twice.

### Status

One short word, the same in All studies and in a study's header: Collecting, Reading posts, Stopping… (blue); Paused,
Not started, Not analyzed (grey); Waiting, Update ready, To review (amber); Ready (green); Stopped (red). A study's
one next step sits next to its status, the only place that starts paid work.

- **Header: the word only.** The reason is shown once, where it belongs: in Progress (Not started, No posts found,
  Paused: you stopped it) or in the Improve row it comes from (new product facts, answers to check). A problem (a
  step that failed) is the one line shown under the word, in red.
- **All studies** keeps the short reason under each status: a list has no Progress card to carry it.
- **Stopping…** replaces both the word and the button while a stopped step finishes; nothing to click.
- A cost sits under a paid button only when the click starts new paid work (not under Resume).

### Toasts and "running"

Work runs in any open Pulse tab (D49). The top bar shows "● 2 running" (`running`) while studies are worked on; it
opens All studies. When one is done, a toast (`toastStack`, `toast`) says "X is ready", one line of result, and
"Open results →"; it closes by itself after a few seconds or with ×. Toasts are for news from elsewhere only, never
for the result of a click on the same page (that shows where you clicked).

### Other pieces

Badges (`badgeGood`, `badgeWarn`, `sourceBadge`), choice pills (`chip`, `chipOn`), inputs (`input`), notices inside a
card (`noticeInfo`, `noticeWarn`, `noticeBad`: a bold first sentence, then one action at most), menus (floating, never
pushing the page down; Escape closes and returns focus).

## Words

- Plain words for what the person does and sees. No internal names (codebook, plan version) in labels.
- The same thing has one name everywhere: Studies, Products, Categories, Product knowledge, Needs a look, Accuracy.
- No explanatory text where the label can say it. Hints only for costs, limits and consequences.

## Checks before every UI change

1. `npm test` (includes the design-system check).
2. Look at the change at /design and on the real pages in light and dark, desktop and phone: no sideways scroll,
   aligned edges, one filled button per area, the path and the way back visible.
