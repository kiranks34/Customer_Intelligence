/**
 * A search plan: how a typed search or question is turned into collection work (docs/ARCHITECTURE.md §1, step 1).
 * Claude drafts it; you can edit it; collection only ever follows a saved plan. Pure module (no DB, no network).
 */
import { z } from "zod";

import { QUOTA_UNITS } from "@/connectors/youtube";

export const PlanSchema = z.object({
  intent: z.enum(["topic", "question"]).describe("topic = research a product/audience; question = answer a specific question"),
  subject: z.string().describe("The product, family, category or audience being researched, e.g. 'HP Smart Tank printers'"),
  kind: z.enum(["product", "family", "category", "audience"]),
  question: z.string().nullable().describe("For intent=question: the question restated clearly; otherwise null"),
  focus: z.array(z.string()).describe("Themes the question is about, e.g. ['connectivity', 'wifi']; empty for a broad topic"),
  timeWindow: z.object({
    from: z.string().nullable().describe("ISO date YYYY-MM-DD, or null for no lower bound"),
    to: z.string().nullable().describe("ISO date YYYY-MM-DD, or null for up to today"),
    label: z.string().describe("Human label, e.g. 'last 7 days' or 'all time'"),
  }),
  aliases: z.array(z.string()).describe("Other names people use: model numbers, series names, regional names, common misspellings"),
  youtube: z.object({
    enabled: z.boolean(),
    queries: z.array(z.string()),
    videosPerQuery: z.number(),
    commentsPerVideo: z.number(),
  }),
  reddit: z.object({
    enabled: z.boolean(),
    queries: z.array(z.string()),
    commentThreadsPerQuery: z.number().describe("How many of the most-discussed posts per query to read comments from"),
  }),
  exclusions: z.array(z.string()).describe("Terms that signal off-topic results, e.g. other brands' 'Smart Tank' products"),
  postCap: z.number().describe("Stop collecting after this many posts"),
  notes: z.string().describe("One or two sentences explaining the plan and any caveats about the question"),
});

export type Plan = z.infer<typeof PlanSchema>;

const clampInt = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number.isFinite(n) ? n : lo)));
const cleanList = (xs: string[], max: number) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))].slice(0, max);
/** YYYY-MM-DD that exists on the calendar (Date.parse alone accepts 2026-02-31 and rolls it over). */
export function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
const isoDate = (s: string | null) => (s && isRealDate(s) ? s : null);

export const LIMITS = {
  queries: 5,
  videosPerQuery: { min: 1, max: 25 },
  commentsPerVideo: { min: 1, max: 100 },
  commentThreadsPerQuery: { min: 0, max: 10 },
  postCap: { min: 50, max: 1000 },
} as const;

/** Enforce hard limits whatever Claude (or an edit) proposes, so a plan can never run away with quota or budget. */
export function normalizePlan(p: Plan): Plan {
  let from = isoDate(p.timeWindow.from);
  let to = isoDate(p.timeWindow.to);
  if (from && to && from > to) [from, to] = [to, from];
  return {
    ...p,
    subject: p.subject.trim().slice(0, 200),
    question: p.intent === "question" ? (p.question?.trim() || null) : null,
    focus: cleanList(p.focus, 10),
    timeWindow: { from, to, label: p.timeWindow.label.trim() || (from || to ? "custom" : "all time") },
    aliases: cleanList(p.aliases, 20),
    youtube: {
      enabled: p.youtube.enabled,
      queries: cleanList(p.youtube.queries, LIMITS.queries),
      videosPerQuery: clampInt(p.youtube.videosPerQuery, LIMITS.videosPerQuery.min, LIMITS.videosPerQuery.max),
      commentsPerVideo: clampInt(p.youtube.commentsPerVideo, LIMITS.commentsPerVideo.min, LIMITS.commentsPerVideo.max),
    },
    reddit: {
      enabled: p.reddit.enabled,
      queries: cleanList(p.reddit.queries, LIMITS.queries),
      commentThreadsPerQuery: clampInt(p.reddit.commentThreadsPerQuery, LIMITS.commentThreadsPerQuery.min, LIMITS.commentThreadsPerQuery.max),
    },
    exclusions: cleanList(p.exclusions, 20),
    postCap: clampInt(p.postCap, LIMITS.postCap.min, LIMITS.postCap.max),
    notes: p.notes.trim().slice(0, 600),
  };
}

export interface Estimate {
  youtubeQuotaUnits: number;
  redditCredits: number;
  usd: number;
  maxPosts: number;
}

/** Upper-bound cost of running a plan: each Reddit search and comment page is one ScrapeCreators credit. */
export function estimatePlan(p: Plan, usdPerCredit: number): Estimate {
  const yt = p.youtube.enabled ? p.youtube.queries.length : 0;
  const rd = p.reddit.enabled ? p.reddit.queries.length : 0;
  const youtubeQuotaUnits = yt * QUOTA_UNITS.search + yt * p.youtube.videosPerQuery * QUOTA_UNITS.commentThreads;
  const redditCredits = rd + rd * p.reddit.commentThreadsPerQuery;
  const ytPosts = yt * p.youtube.videosPerQuery * p.youtube.commentsPerVideo;
  // A Reddit search page returns up to ~25 posts; a comment page up to ~100 comments.
  const rdPosts = rd * 25 + rd * p.reddit.commentThreadsPerQuery * 100;
  return {
    youtubeQuotaUnits,
    redditCredits,
    usd: redditCredits * usdPerCredit,
    maxPosts: Math.min(p.postCap, ytPosts + rdPosts),
  };
}

/** Maps the plan's time window to ScrapeCreators' Reddit timeframe (the smallest one that covers it). */
export function redditTimeframe(p: Plan, today = new Date()): "day" | "week" | "month" | "year" | "all" {
  if (!p.timeWindow.from) return "all";
  const days = (today.getTime() - Date.parse(p.timeWindow.from)) / 86_400_000;
  if (days <= 1) return "day";
  if (days <= 7) return "week";
  if (days <= 31) return "month";
  if (days <= 365) return "year";
  return "all";
}

/** True when a post date falls inside the plan's window (undated posts are kept; they can be filtered later). */
export function inWindow(p: Plan, postedAt: Date | null | undefined): boolean {
  if (!postedAt) return true;
  const t = postedAt.getTime();
  if (p.timeWindow.from && t < Date.parse(`${p.timeWindow.from}T00:00:00Z`)) return false;
  if (p.timeWindow.to && t > Date.parse(`${p.timeWindow.to}T23:59:59.999Z`)) return false;
  return true;
}

/** True when a post mentions an excluded term (whole-word, case-insensitive), e.g. another brand's similarly named product. */
export function isExcluded(p: Plan, text: string): boolean {
  if (p.exclusions.length === 0) return false;
  const lower = text.toLowerCase();
  return p.exclusions.some((term) => {
    const t = term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\p{L}\\p{N}])${t}($|[^\\p{L}\\p{N}])`, "u").test(lower);
  });
}
