/**
 * Helpers behind the plan screen: validating an edited plan, one-click period and depth presets,
 * conflict warnings and the one-line summary. Pure (no DB, no network), so the browser can use them for live updates.
 */
import { isExcluded, isRealDate, normalizePlan, PlanSchema, type Estimate, type Plan } from "./plan";

/** Checks an edited plan (from the browser, so untrusted) and applies the hard limits. */
export function validatePlan(candidate: unknown): { ok: true; plan: Plan } | { ok: false; error: string } {
  const parsed = PlanSchema.safeParse(candidate);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first.path.join(".");
    return { ok: false, error: /number/i.test(first.message) ? `"${where}" needs a number.` : `Check "${where}": ${first.message}` };
  }
  const p = parsed.data;
  if (!p.subject.trim()) return { ok: false, error: "Subject can't be empty." };
  for (const [v, name] of [[p.timeWindow.from, "From"], [p.timeWindow.to, "To"]] as const) {
    if (v && !isRealDate(v)) return { ok: false, error: `"${name}" must be a real date.` };
  }
  if (!p.youtube.enabled && !p.reddit.enabled) return { ok: false, error: "Turn on at least one source." };
  return { ok: true, plan: normalizePlan(p) };
}

/** The calendar date in the user's own time zone (not UTC), as YYYY-MM-DD. */
const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysBefore = (today: Date, n: number) => day(new Date(today.getFullYear(), today.getMonth(), today.getDate() - n));

export const PERIODS = [
  { id: "all", label: "All time", days: null },
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "90d", label: "Last 3 months", days: 90 },
  { id: "365d", label: "Last 12 months", days: 365 },
] as const;
export type PeriodId = (typeof PERIODS)[number]["id"] | "custom";

/** Sets the time window to a preset ending today (a 7-day window is today and the 6 days before it). */
export function applyPeriod(p: Plan, id: Exclude<PeriodId, "custom">, today = new Date()): Plan {
  const preset = PERIODS.find((x) => x.id === id)!;
  const timeWindow =
    preset.days === null
      ? { from: null, to: null, label: "all time" }
      : { from: daysBefore(today, preset.days - 1), to: day(today), label: preset.label.toLowerCase() };
  return { ...p, timeWindow };
}

/**
 * Which preset a plan's window matches; anything else (including the planner's "last month") is custom.
 * A preset only counts while it still ends today: a "last 7 days" saved weeks ago is custom, so the old dates show.
 */
export function activePeriod(p: Plan, today = new Date()): PeriodId {
  const { from, to, label } = p.timeWindow;
  if (!from && !to) return "all";
  const match = PERIODS.find((x) => x.days !== null && x.label.toLowerCase() === label.trim().toLowerCase());
  if (match && from && to === day(today)) {
    const span = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
    if (span === match.days) return match.id;
  }
  return "custom";
}

export const DEPTHS = [
  { id: "quick", label: "Quick", hint: "~100 posts", videosPerQuery: 3, commentsPerVideo: 30, commentThreadsPerQuery: 1, postCap: 100 },
  { id: "standard", label: "Standard", hint: "~300 posts", videosPerQuery: 5, commentsPerVideo: 50, commentThreadsPerQuery: 3, postCap: 300 },
  { id: "deep", label: "Deep", hint: "~1,000 posts", videosPerQuery: 10, commentsPerVideo: 100, commentThreadsPerQuery: 5, postCap: 1000 },
] as const;
export type DepthId = (typeof DEPTHS)[number]["id"] | "custom";

export function applyDepth(p: Plan, id: Exclude<DepthId, "custom">): Plan {
  const d = DEPTHS.find((x) => x.id === id)!;
  return {
    ...p,
    youtube: { ...p.youtube, videosPerQuery: d.videosPerQuery, commentsPerVideo: d.commentsPerVideo },
    reddit: { ...p.reddit, commentThreadsPerQuery: d.commentThreadsPerQuery },
    postCap: d.postCap,
  };
}

export function activeDepth(p: Plan): DepthId {
  const d = DEPTHS.find(
    (x) =>
      x.videosPerQuery === p.youtube.videosPerQuery &&
      x.commentsPerVideo === p.youtube.commentsPerVideo &&
      x.commentThreadsPerQuery === p.reddit.commentThreadsPerQuery &&
      x.postCap === p.postCap,
  );
  return d?.id ?? "custom";
}

const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * Problems worth a look before running; none of them block the run. An exclusion conflicts with a search when the
 * search contains the exclusion's distinctive words (those not in the subject or its other names): excluding
 * "Epson EcoTank" would drop the comments under "HP Smart Tank vs EcoTank", while "fish tank" is fine.
 */
export function planWarnings(p: Plan): string[] {
  const out: string[] = [];
  const queries = [...(p.youtube.enabled ? p.youtube.queries : []), ...(p.reddit.enabled ? p.reddit.queries : [])];
  const own = new Set(words([p.subject, ...p.aliases].join(" ")));
  for (const term of p.exclusions) {
    const distinctive = words(term).filter((w) => !own.has(w));
    const hit = queries.find((q) => {
      const qw = new Set(words(q));
      return distinctive.length ? distinctive.some((w) => qw.has(w)) : isExcluded({ ...p, exclusions: [term] }, q);
    });
    if (hit) out.push(`Dropping posts that mention “${term}” would throw away results from the search “${hit}”.`);
  }
  if (p.youtube.enabled && p.youtube.queries.length === 0) out.push("YouTube is on but has no searches.");
  if (p.reddit.enabled && p.reddit.queries.length === 0) out.push("Reddit is on but has no searches.");
  return out;
}

const SOURCE_NAMES = { youtube: "YouTube", reddit: "Reddit" } as const;

/** One plain sentence describing what a run will do, e.g. for the top of the search page. */
export function planSummary(p: Plan, est: Estimate): string {
  const sources = (["youtube", "reddit"] as const).filter((s) => p[s].enabled && p[s].queries.length).map((s) => SOURCE_NAMES[s]);
  const from = sources.length ? sources.join(" and ") : "no sources";
  const cost = est.usd > 0 ? `up to $${est.usd.toFixed(3)}` : "free";
  return `Up to ${est.maxPosts.toLocaleString("en-US")} posts from ${from} about ${p.subject}, ${p.timeWindow.label}. Cost: ${cost}.`;
}
