import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";

import { requireDb } from "@/db/client";
import { searches, studyHeadlines } from "@/db/schema";

import { pendingPosts, resultsVersion } from "./analysis";
import { factsNotUsed, readKnowledge } from "./knowledge";
import type { Plan } from "./plan";

/**
 * A study as All studies shows it (home page): what it covers, its saved one-line result, and a status that says
 * what's happening and what to do. One SQL query for the whole list, so the page stays fast.
 */

/** Saved when a study's results are computed (study page), so the list doesn't recompute every study. */
export interface Headline {
  /** Posts about the product (counted). */
  counted: number;
  /** Share of those that are negative, 0–100. */
  negativePct: number;
  positivePct: number;
  /** The most-mentioned pain theme, if any. */
  topPain: string | null;
  /** Claude-vs-Jev disagreements waiting for you in Check accuracy. */
  toReview: number;
}

export type StudyStatus =
  | { kind: "ready" }
  | { kind: "review"; answers: number }
  | { kind: "collecting" }
  | { kind: "reading" }
  | { kind: "paused"; reason: string }
  | { kind: "waiting"; reason: string }
  | { kind: "stopped"; reason: string }
  | { kind: "not_analyzed" }
  | { kind: "update"; reason: string };

export interface StudyRow {
  id: number;
  title: string;
  createdAt: string;
  sources: string[];
  period: string;
  posts: number;
  headline: Headline | null;
  status: StudyStatus;
  /** For "same study already exists": the pick, sources and period it was started with. */
  target: { catalogId: number; nodeId: number | null } | null;
  periodKey: string;
  /** Started with a question (a question study is never "the same study" as another). */
  hasQuestion: boolean;
}

/** No step for this long while work is open means the page that drives it was closed. */
const STALE_SECONDS = 90;

interface Raw {
  id: number;
  query: string;
  created_at: string;
  plan: Plan | null;
  posts: number;
  coll_open: number;
  coll_waiting: number;
  coll_stale: boolean;
  wait_reason: string | null;
  coll_jobs: number;
  /** The latest analysis job; `version` 0 means its first draft of the categories never finished. */
  analysis: { status: string; stale: boolean; error: string | null; version?: number } | null;
  analyzed: boolean;
  headline: Headline | null;
  /** The latest categories: version, and the product knowledge they carry. */
  cb_latest: number | null;
  used: { productFacts: { text: string }[] | null; productNotes: string | null } | null;
  family: unknown;
  /** Set after the query: what the results don't use yet (the study page's "Update ready"), or null. */
  update?: string | null;
}

export async function studyRows(limit = 50): Promise<StudyRow[]> {
  const res = await requireDb().execute(sql`
    select s.id, s.query, s.created_at,
      (select plan from plans where search_id = s.id order by version desc limit 1) as plan,
      (select count(*)::int from posts where search_id = s.id) as posts,
      (select count(*)::int from jobs where search_id = s.id and step <> 'analyze' and status in ('queued', 'running')) as coll_open,
      (select count(*)::int from jobs where search_id = s.id and step <> 'analyze' and status = 'waiting') as coll_waiting,
      (select count(*)::int from jobs where search_id = s.id and step <> 'analyze') as coll_jobs,
      coalesce((select max(updated_at) < now() - make_interval(secs => ${STALE_SECONDS}) from jobs where search_id = s.id and step <> 'analyze' and status in ('queued', 'running')), false) as coll_stale,
      (select last_error from jobs where search_id = s.id and step <> 'analyze' and status = 'waiting' order by id desc limit 1) as wait_reason,
      (select json_build_object('status', status, 'stale', updated_at < now() - make_interval(secs => ${STALE_SECONDS}), 'error', last_error, 'version', coalesce((cursor->>'codebookVersion')::int, 0))
         from jobs where search_id = s.id and step = 'analyze' order by id desc limit 1) as analysis,
      exists (select 1 from decisions d join posts p on p.id = d.post_id where p.search_id = s.id) as analyzed,
      (select headline from study_headlines where search_id = s.id) as headline,
      (select max(version) from codebooks where search_id = s.id) as cb_latest,
      (select json_build_object('productFacts', c.codebook->'productFacts', 'productNotes', c.codebook->'productNotes')
         from codebooks c where c.search_id = s.id order by c.version desc limit 1) as used,
      (select product_facts from catalogs where id = s.catalog_id) as family
    from searches s
    where s.hidden_at is null
    order by s.id desc
    limit ${limit}`);
  const rows = res.rows as unknown as Raw[];
  // Analyzed studies with no open work: what their results don't use yet, worded as on the study page.
  await Promise.all(
    rows.map(async (r) => {
      const idle = r.analyzed && !r.coll_open && !r.coll_waiting && !(r.analysis && ["queued", "running", "waiting", "failed"].includes(r.analysis.status));
      if (!idle) return;
      r.update = await updateReason(Number(r.id), r).catch(() => null);
    }),
  );
  return rows.map(toRow);
}

const plural = (k: number, one: string) => `${k} ${k === 1 ? one : `${one}s`}`;

async function updateReason(id: number, r: Raw): Promise<string | null> {
  const notUsed = r.family && r.used ? factsNotUsed(readKnowledge(r.family), { productFacts: r.used.productFacts ?? [], productNotes: r.used.productNotes ?? "" }) : 0;
  if (notUsed > 0) return `${plural(notUsed, "new product fact")} not used yet`;
  const latest = r.cb_latest === null ? null : Number(r.cb_latest);
  if (latest === null) return null;
  const pending = await pendingPosts(id, latest);
  if (pending === 0) return null;
  const shown = await resultsVersion(id);
  return shown !== null && latest > shown ? `Categories version ${latest} not used yet` : `${plural(pending, "new post")} not read yet`;
}

function toRow(r: Raw): StudyRow {
  const plan = r.plan;
  const sources = plan ? [plan.youtube.enabled && "YouTube", plan.reddit.enabled && "Reddit"].filter((x): x is string => !!x) : [];
  return {
    id: Number(r.id),
    title: r.query,
    createdAt: new Date(r.created_at).toISOString(),
    sources,
    period: plan ? periodText(plan) : "",
    posts: Number(r.posts),
    headline: r.headline,
    status: statusOf(r),
    target: plan?.target ? { catalogId: plan.target.catalogId, nodeId: plan.target.nodeId } : null,
    periodKey: plan ? `${plan.timeWindow.label}` : "",
    hasQuestion: plan?.intent === "question",
  };
}

export function statusOf(r: Pick<Raw, "posts" | "coll_open" | "coll_waiting" | "coll_stale" | "wait_reason" | "coll_jobs" | "analysis" | "analyzed" | "headline" | "update">): StudyStatus {
  const a = r.analysis;
  if (r.coll_waiting > 0) return { kind: "waiting", reason: (r.wait_reason ?? "Paused").replace(/^Paused:\s*/, "").replace(/\.$/, "") };
  const closed = "You stopped it, or the page was closed";
  if (r.coll_open > 0) return r.coll_stale ? { kind: "paused", reason: closed } : { kind: "collecting" };
  if (a && (a.status === "queued" || a.status === "running")) return a.stale ? { kind: "paused", reason: closed } : { kind: "reading" };
  // Same words as the study bar (study-control.tsx statusOf): a paused or failed reading run is Paused (Resume); a
  // first draft that failed leaves nothing to resume, so the study is Not analyzed.
  if (a?.status === "waiting") return { kind: "paused", reason: a.error ?? "Reading stopped before the end" };
  if (a?.status === "failed" && a.version) return { kind: "paused", reason: a.error ?? "Reading stopped before the end" };
  if (r.coll_jobs > 0 && r.posts === 0) return { kind: "stopped", reason: "No posts found" };
  if (!r.analyzed) return r.posts > 0 ? { kind: "not_analyzed" } : { kind: "stopped", reason: "Nothing collected yet" };
  if (r.update) return { kind: "update", reason: r.update };
  if (r.headline && r.headline.toReview > 0) return { kind: "review", answers: r.headline.toReview };
  return { kind: "ready" };
}

/** "3 months", "1 year", "Jan 1 – Sep 26, 2026". */
export function periodText(plan: Plan): string {
  const { from, to, label } = plan.timeWindow;
  const preset = label.trim().toLowerCase().replace(/^last /, "");
  if (["3 months", "6 months", "1 year", "2 years", "12 months", "30 days", "7 days"].includes(preset)) return preset === "12 months" ? "1 year" : preset;
  if (!from && !to) return "All time";
  const fmt = (d: string, year: boolean) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}) });
  return `${from ? fmt(from, false) : "Start"} – ${to ? fmt(to, true) : "today"}`;
}

export async function saveHeadline(searchId: number, headline: Headline): Promise<void> {
  await requireDb()
    .insert(studyHeadlines)
    .values({ searchId, headline })
    .onConflictDoUpdate({ target: studyHeadlines.searchId, set: { headline, updatedAt: sql`now()` } });
}

export async function renameSearch(id: number, title: string): Promise<boolean> {
  const res = await requireDb()
    .update(searches)
    .set({ query: title })
    .where(and(eq(searches.id, id), isNull(searches.hiddenAt)))
    .returning({ id: searches.id });
  return res.length > 0;
}
