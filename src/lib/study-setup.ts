/**
 * "New study" on the home page (D46): the choices you make (sources, period, question) and how they shape the plan
 * Claude drafts, plus the cost and time shown before you start. Your choices always win over the plan's own.
 * Pure (no DB, no network), so the browser can update the estimate as you choose.
 */
import { tokenCostUsd } from "./ai";
import { jevUsd } from "./codebook";
import { applyDepth } from "./plan-edit";
import { isRealDate, type Plan } from "./plan";

export const PERIOD_CHOICES = [
  { id: "3m", label: "3 months", days: 91 },
  { id: "6m", label: "6 months", days: 182 },
  { id: "1y", label: "1 year", days: 365 },
  { id: "2y", label: "2 years", days: 730 },
] as const;
export type PeriodChoice = (typeof PERIOD_CHOICES)[number]["id"] | "custom";
export const SOURCES = [
  { id: "youtube", label: "YouTube" },
  { id: "reddit", label: "Reddit" },
] as const;
export type SourceId = (typeof SOURCES)[number]["id"];

export interface StudyChoices {
  sources: SourceId[];
  period: PeriodChoice;
  /** Custom range (YYYY-MM-DD); `to` empty means today. */
  from?: string;
  to?: string;
  question: string;
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The plan's time window for a choice, ending today (a preset of N days is today and the N-1 days before). */
export function windowFor(c: Pick<StudyChoices, "period" | "from" | "to">, today = new Date()): Plan["timeWindow"] | null {
  if (c.period === "custom") {
    const to = c.to || iso(today);
    if (!c.from || !isRealDate(c.from) || !isRealDate(to) || c.from > to || to > iso(today)) return null;
    return { from: c.from, to: c.to || null, label: "custom" };
  }
  const p = PERIOD_CHOICES.find((x) => x.id === c.period);
  if (!p) return null;
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (p.days - 1));
  // Open-ended, so "Collect new posts" still finds posts from after the study started.
  return { from: iso(from), to: null, label: p.label };
}

/** Why the choices can't start yet, or null. */
export function choicesProblem(c: StudyChoices, today = new Date()): string | null {
  if (c.sources.length === 0) return "Pick at least one source.";
  if (c.period === "custom" && !c.from) return "Pick a start date.";
  if (!windowFor(c, today)) return c.period === "custom" ? "Pick a start date on or before the end date (not in the future)." : "Pick a period.";
  if (c.question.length > 300) return "Keep the question under 300 characters.";
  return null;
}

/**
 * Applies your choices to the plan Claude drafted: only the sources you picked, your period, and the standard depth.
 * A picked source the plan has no searches for gets one search for the product's own name.
 */
export function applyChoices(plan: Plan, c: StudyChoices, productName: string, today = new Date()): Plan {
  const on = new Set(c.sources);
  const withDepth = applyDepth(plan, "standard");
  const fallback = (qs: string[]) => (qs.length ? qs : [productName]);
  return {
    ...withDepth,
    timeWindow: windowFor(c, today) ?? plan.timeWindow,
    youtube: { ...withDepth.youtube, enabled: on.has("youtube"), queries: on.has("youtube") ? fallback(withDepth.youtube.queries) : withDepth.youtube.queries },
    reddit: { ...withDepth.reddit, enabled: on.has("reddit"), queries: on.has("reddit") ? fallback(withDepth.reddit.queries) : withDepth.reddit.queries },
  };
}

/** Typical plan shape, for estimating before the plan exists: searches per source, and the standard depth. */
const TYPICAL = { queries: 3, redditThreads: 3, postCap: 300, jevTokensPerPost: 1_400 };
/** Claude calls in a study: the plan and the first definitions (tokens in, out). */
const CLAUDE_CALLS = { plan: { input: 3_000, output: 2_000 }, definitions: { input: 16_000, output: 3_000 } };

export interface StudyEstimate {
  usd: number;
  minutes: number;
}

/** Upper-bound cost and rough time of a study with these sources, before its plan exists. */
export function estimateStudy(sources: SourceId[], usdPerCredit: number, claudeModel: string): StudyEstimate {
  const reddit = sources.includes("reddit") ? TYPICAL.queries * (1 + TYPICAL.redditThreads) * usdPerCredit : 0;
  const posts = sources.length * TYPICAL.postCap;
  const claude =
    tokenCostUsd(claudeModel, CLAUDE_CALLS.plan.input, CLAUDE_CALLS.plan.output) + tokenCostUsd(claudeModel, CLAUDE_CALLS.definitions.input, CLAUDE_CALLS.definitions.output);
  const usd = reddit + claude + jevUsd(posts * TYPICAL.jevTokensPerPost);
  // Collecting takes about a minute per 100 posts per source; reading about a minute per 150 posts.
  const minutes = Math.max(3, Math.round(posts / 100 + posts / 150 + 1));
  return { usd, minutes };
}
