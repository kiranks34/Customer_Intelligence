import "server-only";

import { usdPerCredit } from "@/connectors/reddit";

import { analysisState, analysisSummary, journeyQuotes, latestCodebook, resultsVersion, spotCheckAccuracy, type AnalysisState, type AnalysisSummary, type CellQuote } from "./analysis";
import { jevUsd } from "./codebook";
import { loadPlan, progress, runFlags, type Progress, type RunFlags } from "./collect";
import { factsNotUsed } from "./knowledge";
import { estimatePlan, type Plan } from "./plan";
import { knowledgeForSearch } from "./product-knowledge";
import { getSearch } from "./searches";
import { saveHeadline, type Headline } from "./studies";

/** Jev's input per post, typical (post, context and questions), for the Collect new posts estimate. */
const JEV_TOKENS_PER_POST = 1_400;

/** What a study's bar needs about one side (D47; a comparison has two, D48). */
export interface SideFacts {
  searchId: number;
  /** The product's name, used to say which side a status is about. */
  label: string;
  progress: Progress;
  analysis: AnalysisState;
  /** Results exist (some codebook version has read the posts). */
  hasResults: boolean;
  /** The categories were saved after the results were computed (a newer version isn't read yet). */
  newerCategories: number | null;
  /** Family facts the side's categories don't carry yet (D45). */
  factsNotUsed: number;
  /** Claude-vs-Jev disagreements waiting in Accuracy. */
  openAnswers: number;
  /** Cost of Collect new posts: the searches plus reading what they find, at most. */
  collectUsd: number;
  /** Where its run stands (D49): stopped, driven by a Pulse tab, finishing a stopped step. */
  run: RunFlags;
}

export interface Side {
  search: NonNullable<Awaited<ReturnType<typeof getSearch>>>;
  plan: Plan;
  version: number;
  /** Results version (the codebook version that has read the most posts), null before the first analysis. */
  shown: number | null;
  summary: AnalysisSummary | null;
  quotes: CellQuote[];
  facts: SideFacts;
}

/** One side's data for its bar and results; null when the study is gone. Saves its All studies headline too. */
export async function loadSide(searchId: number): Promise<Side | null> {
  const search = await getSearch(searchId);
  if (!search) return null;
  const latest = await loadPlan(searchId);
  if (!latest) return null;
  const { plan, version } = latest;
  const [prog, analysis, shown, codebook, knowledge, run] = await Promise.all([progress(searchId), analysisState(searchId), resultsVersion(searchId), latestCodebook(searchId), knowledgeForSearch(searchId), runFlags(searchId)]);
  const [summary, accuracy, quotes] = shown ? await Promise.all([analysisSummary(searchId, shown), spotCheckAccuracy(searchId, shown), journeyQuotes(searchId, shown)]) : [null, null, []];
  const open = accuracy ? accuracy.questions.reduce((n, q) => n + q.open, 0) : 0;
  if (summary) await saveHeadline(searchId, headlineOf(summary, open)).catch(() => undefined);
  const est = estimatePlan(plan, usdPerCredit());
  return {
    search,
    plan,
    version,
    shown,
    summary,
    quotes,
    facts: {
      searchId,
      label: plan.target?.label ?? search.query,
      progress: prog,
      analysis,
      hasResults: shown !== null,
      newerCategories: shown !== null && analysis.version !== null && analysis.version > shown ? analysis.version : null,
      factsNotUsed: knowledge && codebook ? factsNotUsed(knowledge.knowledge, codebook.codebook) : 0,
      openAnswers: open,
      collectUsd: est.usd + jevUsd(est.maxPosts * JEV_TOKENS_PER_POST),
      run,
    },
  };
}

/** The one-line result All studies shows (counted base, never all collected posts). */
export function headlineOf(s: AnalysisSummary, toReview: number): Headline {
  const counted = s.relevance.counted;
  const n = (key: string) => s.sentiment.find((t) => t.key === key)?.counted ?? 0;
  const pain = [...s.themes].filter((t) => t.kind === "pain" && t.counted > 0).sort((a, b) => b.counted - a.counted)[0];
  return {
    counted,
    negativePct: counted ? Math.round((n("negative") / counted) * 100) : 0,
    positivePct: counted ? Math.round((n("positive") / counted) * 100) : 0,
    topPain: pain ? pain.label : null,
    toReview,
  };
}
