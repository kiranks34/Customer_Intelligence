import "server-only";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { requireDb } from "@/db/client";
import { jobs, searches } from "@/db/schema";

import { advanceAnalysis, analysisBusy, analysisState, analysisSummary, resultsVersion, resumeAnalysis, spotCheckAccuracy, startAnalysis, type AnalysisState } from "./analysis";
import { advance, progress, runFlags, type Progress, type RunFlags } from "./collect";
import { comparisonOf, getComparison, shareCategories } from "./compare";
import { paidWorkBlockedReason } from "./cost";
import { resumeWaiting } from "./searches";
import { headlineOf } from "./study-side";
import { saveHeadline, type Headline } from "./studies";

/**
 * Runs (D49): a study's work is driven by any open Pulse tab, not by its own page. A tab calls `runStep` for every
 * study with open work, so studies run side by side while you use the rest of Pulse. `driven_at` marks the last
 * step: when no Pulse tab has driven it for 90 seconds, the run is Paused and waits for Resume, so paid work never
 * starts again on its own. Stop sets `stopped_at`; the step under way finishes and nothing new starts.
 */

/** One step's working time, short so Stop and the other studies get their turn quickly. */
const STEP_MS = 10_000;

export interface RunState extends RunFlags {
  searchId: number;
  progress: Progress;
  analysis: AnalysisState;
  /** Something the step couldn't do (e.g. reading couldn't start). */
  message?: string | null;
}

export interface ActiveRun {
  searchId: number;
  label: string;
  comparison: { id: number; title: string } | null;
  stopped: boolean;
}

const collectionOpen = (id: unknown) =>
  sql`exists (select 1 from ${jobs} where search_id = ${id} and step <> 'analyze' and status in ('queued', 'running'))`;
const readingOpen = (id: unknown) => sql`exists (select 1 from ${jobs} where search_id = ${id} and step = 'analyze' and status in ('queued', 'running'))`;

export async function runStateOf(searchId: number): Promise<RunState> {
  const [flags, prog, analysis] = await Promise.all([runFlags(searchId), progress(searchId), analysisState(searchId)]);
  return { searchId, progress: prog, analysis, ...flags };
}

/** Studies a Pulse tab is working on (or that are finishing a stopped step), for the runner and the live status. */
export async function activeRuns(): Promise<ActiveRun[]> {
  const res = await requireDb().execute(sql`
    select s.id, coalesce((select plan->'target'->>'label' from plans where search_id = s.id order by version desc limit 1), s.query) as label,
      s.stopped_at is not null as stopped,
      (select json_build_object('id', c.id, 'title', c.title) from comparisons c
        where (c.search_a = s.id or c.search_b = s.id) and c.hidden_at is null) as comparison
    from ${searches} s
    where s.hidden_at is null and s.driven_at > now() - interval '90 seconds'
      and (
        (s.stopped_at is null and (${collectionOpen(sql`s.id`)} or ${readingOpen(sql`s.id`)} or (s.auto_read and not exists (
          select 1 from ${jobs} where search_id = s.id and step <> 'analyze' and status = 'waiting'))))
        or (s.stopped_at is not null and exists (
          select 1 from ${jobs} where search_id = s.id and status = 'running' and updated_at > now() - interval '2 minutes'))
      )
    order by s.id`);
  return (res.rows as { id: number; label: string; stopped: boolean; comparison: { id: number; title: string } | null }[]).map((r) => ({
    searchId: Number(r.id),
    label: r.label,
    comparison: r.comparison,
    stopped: r.stopped,
  }));
}

/**
 * One step of a study's run: collect for a while; once collecting is done, start reading the new posts (a comparison
 * side waits for the other side, so the categories both share are drafted from both); then read for a while.
 */
export async function runStep(searchId: number): Promise<RunState & { worked: boolean }> {
  const db = requireDb();
  const [s] = await db.select({ stoppedAt: searches.stoppedAt, autoRead: searches.autoRead }).from(searches).where(eq(searches.id, searchId));
  if (!s) throw new Error("That study is gone.");
  if (s.stoppedAt) return { ...(await runStateOf(searchId)), worked: false };

  let message: string | null = null;
  let worked = false;
  const [{ open, waiting }] = (
    await db.execute(sql`select
      (select count(*)::int from ${jobs} where search_id = ${searchId} and step <> 'analyze' and status in ('queued', 'running')) as open,
      (select count(*)::int from ${jobs} where search_id = ${searchId} and step <> 'analyze' and status = 'waiting') as waiting`)
  ).rows as { open: number; waiting: number }[];
  if (open > 0) {
    const p = await advance(searchId, STEP_MS);
    worked = p.claimed > 0;
    // Failed searches don't stop the run (the rest is read), but they must never pass silently.
    if (p.finished && p.jobs.failed > 0) message = `${p.jobs.failed} of the searches failed: ${p.lastErrors[0] ?? "no reason given"}`;
  } else if (s.autoRead && waiting === 0 && !(await waitForOtherSide(searchId))) {
    // Claimed in one statement, so two tabs or browsers can't both start reading.
    const claimed = await db
      .update(searches)
      .set({ autoRead: false })
      .where(and(eq(searches.id, searchId), eq(searches.autoRead, true)))
      .returning({ id: searches.id });
    if (claimed.length) {
      worked = true;
      const blocked = await paidWorkBlockedReason();
      if (blocked) message = `Reading didn't start: ${blocked}.`;
      else {
        const r = await startReading(searchId);
        const quiet = ["Every post", "Collect some posts", "Analysis is already running"];
        if (!r.started && !quiet.some((q) => r.reason.startsWith(q))) message = r.reason;
      }
    }
  } else if (await analysisBusy(searchId)) {
    const before = (await analysisState(searchId)).analyzed;
    const a = await advanceAnalysis(searchId, STEP_MS);
    worked = a.analyzed !== before || a.status !== "running";
  }
  return { ...(await runStateOf(searchId)), message, worked };
}

/**
 * A comparison side waits before reading (D48): while the other side still collects (unless you stopped it), and,
 * for side B, while side A is about to draft the categories both share, so they are drafted and paid for once.
 */
async function waitForOtherSide(searchId: number): Promise<boolean> {
  const link = await comparisonOf(searchId);
  if (!link) return false;
  const res = await requireDb().execute(sql`
    select
      (${collectionOpen(link.other)} and (select stopped_at is null from ${searches} where id = ${link.other})) as collecting,
      (not exists (select 1 from codebooks where search_id in (${searchId}, ${link.other}))
        and (select (auto_read and stopped_at is null) from ${searches} where id = ${link.other})
        or exists (select 1 from ${jobs} where search_id = ${link.other} and step = 'analyze' and status in ('queued', 'running')
          and coalesce((cursor->>'codebookVersion')::int, 0) = 0)) as drafting`);
  const r = res.rows[0] as { collecting: boolean; drafting: boolean };
  return !!r.collecting || (link.side === "b" && !!r.drafting);
}

/**
 * Starts reading a study's new posts (Analyze, and after collecting). A side of a comparison is read with the
 * categories both sides share, drafted once from both (D48). Marked as driven first, so drafting (which can take a
 * minute) never looks abandoned. `byYou`: a click (Analyze, Re-analyze) also lifts an earlier Stop; the runner's
 * own start never does, so a Stop pressed meanwhile holds.
 */
export async function startReading(
  searchId: number,
  byYou = false,
): Promise<{ started: true; drafted: boolean; shared: boolean } | { started: false; reason: string }> {
  await requireDb()
    .update(searches)
    .set({ drivenAt: sql`now()`, ...(byYou ? { stoppedAt: null, autoRead: false } : {}) })
    .where(eq(searches.id, searchId));
  const link = await comparisonOf(searchId);
  const pair = link ? await getComparison(link.id) : null;
  // A side with no posts yet has nothing to read; the shared draft waits until it (or the other side) is read.
  const shared = pair && (await analysisState(searchId)).totalPosts > 0 ? await shareCategories(pair) : null;
  const r = await startAnalysis(searchId);
  if (!r.started) return r;
  return { started: true, drafted: r.drafted, shared: !!shared?.drafted };
}

/**
 * The driving tab marks every run it works on as driven on each pass, not only those it steps this round, so a
 * study waiting its turn (many at once, or a slow step) never looks abandoned.
 */
export async function keepDriven(ids: number[]): Promise<void> {
  await requireDb()
    .update(searches)
    .set({ drivenAt: sql`now()` })
    .where(and(inArray(searches.id, ids), isNull(searches.stoppedAt)));
}

/** Stop: the search or batch under way finishes; nothing new starts until Resume. */
export async function stopRuns(ids: number[]): Promise<void> {
  await requireDb()
    .update(searches)
    .set({ stoppedAt: sql`now()` })
    .where(inArray(searches.id, ids));
}

/** Resume: carries on where the run stopped (a stop, a closed tab, or a budget pause), reading what's new after. */
export async function resumeRuns(ids: number[]): Promise<void> {
  const db = requireDb();
  for (const id of ids) {
    await resumeWaiting(id);
    const a = await analysisState(id);
    if (a.status === "paused" || a.status === "failed") await resumeAnalysis(id);
  }
  await db.update(searches).set({ drivenAt: sql`now()`, stoppedAt: null }).where(inArray(searches.id, ids));
}

/** The one-line result for the "ready" toast (and All studies), saved as the study's headline. */
export async function finishedHeadline(searchId: number): Promise<Headline | null> {
  const shown = await resultsVersion(searchId);
  if (!shown) return null;
  const [summary, accuracy] = await Promise.all([analysisSummary(searchId, shown), spotCheckAccuracy(searchId, shown)]);
  if (!summary) return null;
  const open = accuracy ? accuracy.questions.reduce((n, q) => n + q.open, 0) : 0;
  const headline = headlineOf(summary, open);
  await saveHeadline(searchId, headline).catch(() => undefined);
  return headline;
}
