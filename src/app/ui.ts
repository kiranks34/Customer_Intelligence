/**
 * Shared class names so every page uses the same buttons, links, cards and spacing (UX audit: one pattern per
 * element). Buttons have a fill and an outline; text links are blue and underlined, with → for pages in Pulse and ↗
 * for outside sites.
 */
export const ui = {
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
