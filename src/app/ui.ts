/**
 * Pulse's design system in code (docs/DESIGN-SYSTEM.md; every piece is shown at /design). Pages use these names, not
 * their own classes, so the same element always looks the same. `src/app/design-system.test.ts` fails the build on
 * the usual drift: raw colours, home-made buttons or links, font sizes off the scale.
 */
export const ui = {
  /** Page title (one per page), under the breadcrumb. */
  pageTitle: "text-[26px] leading-tight font-bold tracking-tight",
  /** Section title outside a card, e.g. "Improve these results". */
  sectionTitle: "text-lg font-bold",
  /** Small caps label over a group of rows or a table column. */
  eyebrow: "text-[11px] font-bold tracking-wider text-muted uppercase",
  /** Main action: blue fill. 44px tall. */
  primary: "inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] bg-accent px-5 text-sm font-bold text-white hover:brightness-110 disabled:opacity-45 disabled:hover:brightness-100",
  /** Second action: tinted fill, blue outline. */
  secondary: "inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border border-accent bg-accent/15 px-5 text-sm font-bold text-accent hover:bg-accent/25 disabled:opacity-45",
  /** Neutral action: grey fill and outline. */
  plain: "inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border border-faint/60 bg-surface-2 px-5 text-sm font-bold hover:border-foreground/50 disabled:opacity-45",
  /** Small versions (32px) for rows and notices. */
  primarySm: "inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-accent px-3 text-[13px] font-bold text-white hover:brightness-110 disabled:opacity-45",
  secondarySm: "inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-accent bg-accent/15 px-3 text-[13px] font-bold text-accent hover:bg-accent/25 disabled:opacity-45",
  plainSm: "inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-faint/60 bg-surface-2 px-3 text-[13px] font-bold hover:border-foreground/50 disabled:opacity-45",
  /** Text link. */
  link: "font-semibold text-accent underline underline-offset-[3px] hover:brightness-125",
  /** Icon-only button (at least 32×32, labelled with aria-label). */
  icon: "inline-grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-foreground",
  /** Page section: a card with a header row and a body. */
  card: "rounded-2xl border border-border bg-surface",
  cardHead: "flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-4 sm:px-6",
  cardTitle: "text-lg font-bold",
  cardBody: "flex flex-col gap-4 px-4 py-5 sm:px-6",
  /** Small grey text: meta, hints. */
  meta: "text-xs text-muted",
  /** Detail line under a title (sources, dates): 13px grey. */
  detail: "text-[13px] text-muted",
  /** Source name (YouTube, Reddit). */
  sourceBadge: "inline-flex h-[22px] items-center rounded-md border border-border bg-surface-2 px-1.5 text-[11px] font-bold text-muted",
  /** State badges: verified, needs attention. */
  badgeGood: "inline-flex h-[22px] items-center rounded-full border border-good/60 px-2 text-xs font-semibold text-good",
  badgeWarn: "inline-flex h-[22px] items-center rounded-full border border-warning/60 px-2 text-xs font-semibold text-warning",
  /** "← Back to …" when you arrived from the other section (D47). */
  back: "inline-flex h-[30px] items-center gap-2 self-start rounded-full border border-accent/40 bg-accent/10 px-3 text-[13px] font-semibold text-accent hover:bg-accent/15",
  /** Tabs inside a page or card: the selected one is underlined in blue. */
  tab: "-mb-px border-b-2 border-transparent px-3.5 py-3 text-sm font-semibold text-muted hover:text-foreground",
  tabOn: "-mb-px border-b-2 border-accent px-3.5 py-3 text-sm font-semibold text-foreground",
  /** Pill choice (period, sources): selected is filled. */
  chip: "inline-flex h-[34px] items-center gap-1.5 rounded-full border border-border px-3.5 text-sm hover:border-foreground/50",
  chipOn: "inline-flex h-[34px] items-center gap-1.5 rounded-full border border-foreground bg-foreground px-3.5 text-sm font-semibold text-background",
  input: "h-10 w-full rounded-[10px] border border-border bg-background px-3 text-sm placeholder:text-faint",
  /** Notices inside a card. */
  noticeWarn: "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[10px] border border-warning/50 bg-warning/10 px-4 py-3 text-sm",
  noticeBad: "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[10px] border border-critical/50 bg-critical/10 px-4 py-3 text-sm",
  noticeInfo: "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[10px] border border-accent/50 bg-accent/10 px-4 py-3 text-sm",
} as const;

export type Tone = "good" | "warn" | "bad" | "info" | "muted";
export const dot: Record<Tone, string> = { good: "bg-good", warn: "bg-warning", bad: "bg-critical", info: "bg-accent", muted: "bg-faint" };
