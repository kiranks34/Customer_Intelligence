import "server-only";

import { and, count, desc, eq, sql } from "drizzle-orm";

import * as reddit from "@/connectors/reddit";
import { ConnectorError, type CallCost, type RawPost } from "@/connectors/types";
import * as youtube from "@/connectors/youtube";
import { requireDb } from "@/db/client";
import { costEvents, jobs, plans, posts } from "@/db/schema";

import { paidWorkBlockedReason, recordCost } from "./cost";
import { toPostRow } from "./ingest";
import { inWindow, isExcluded, redditTimeframe, type Plan } from "./plan";
import { savePosts } from "./posts";

/**
 * Collection runs as small jobs in the `jobs` table (docs/ARCHITECTURE.md §7). The search page calls `advance`
 * repeatedly; each call works for a bounded time, so no request comes near Vercel Hobby limits, and a closed tab
 * simply pauses the run.
 */

type Step = "yt.search" | "yt.comments" | "rd.search" | "rd.comments";
interface JobCursor {
  planVersion: number;
  /** Identifies one press of "Run"; progress and the post cap are per run. */
  run: number;
  /** Posts the search already had when this run started; the cap allows `postCap` new ones on top. */
  baseline: number;
  query?: string;
  videoId?: string;
  url?: string;
}

const MAX_ATTEMPTS = 3;
const STALE_RUNNING_SECONDS = 120;
const PAID_STEPS = new Set<Step>(["rd.search", "rd.comments"]);
/** For time-bounded searches, only read videos published this long before the window (comments on old videos are rarely recent). */
const VIDEO_LOOKBACK_DAYS = 180;

export async function loadPlan(searchId: number, version?: number): Promise<{ version: number; plan: Plan } | null> {
  const where = version === undefined ? eq(plans.searchId, searchId) : and(eq(plans.searchId, searchId), eq(plans.version, version));
  const [row] = await requireDb().select().from(plans).where(where).orderBy(desc(plans.version)).limit(1);
  return row ? { version: row.version, plan: row.plan as Plan } : null;
}

async function postCount(searchId: number): Promise<number> {
  const [r] = await requireDb().select({ n: count() }).from(posts).where(eq(posts.searchId, searchId));
  return r?.n ?? 0;
}

/** Queues the first jobs for the latest plan. Refuses while a previous run still has open jobs. */
export async function startCollection(searchId: number): Promise<{ started: boolean; reason?: string }> {
  const db = requireDb();
  const latest = await loadPlan(searchId);
  if (!latest) return { started: false, reason: "No plan saved yet." };
  const [open] = await db
    .select({ n: count() })
    .from(jobs)
    .where(and(eq(jobs.searchId, searchId), sql`${jobs.status} in ('queued','running','waiting')`));
  if ((open?.n ?? 0) > 0) return { started: false, reason: "A collection is already running for this search." };

  const { plan, version } = latest;
  const base = { planVersion: version, run: Date.now(), baseline: await postCount(searchId) };
  const seeds = [
    ...(plan.youtube.enabled ? plan.youtube.queries : []).map((query) => ({ searchId, step: "yt.search", cursor: { ...base, query } })),
    ...(plan.reddit.enabled ? plan.reddit.queries : []).map((query) => ({ searchId, step: "rd.search", cursor: { ...base, query } })),
  ];
  if (seeds.length === 0) return { started: false, reason: "The plan has no enabled sources with queries." };
  await db.insert(jobs).values(seeds);
  return { started: true };
}

/** Atomically claim the next runnable job (single statement, so two tabs can't take the same job). */
async function claimJob(searchId: number) {
  const res = await requireDb().execute(sql`
    update ${jobs} set status = 'running', attempts = attempts + 1, updated_at = now()
    where id = (
      select id from ${jobs}
      where search_id = ${searchId} and status = 'queued' and run_after <= now()
      order by id limit 1
      for update skip locked
    )
    returning id, step, cursor, attempts`);
  const row = res.rows[0] as { id: number; step: Step; cursor: JobCursor; attempts: number } | undefined;
  return row ?? null;
}

/**
 * Close out a claimed job. `refundAttempt` is for outcomes that weren't a real try (budget pause, cap skip),
 * so they don't eat into the retry allowance.
 */
async function finishJob(
  id: number,
  status: "done" | "failed" | "waiting" | "queued",
  lastError: string | null,
  opts: { retryInSeconds?: number; refundAttempt?: boolean } = {},
) {
  await requireDb()
    .update(jobs)
    .set({
      status,
      lastError,
      runAfter: sql`now() + make_interval(secs => ${opts.retryInSeconds ?? 0})`,
      ...(opts.refundAttempt ? { attempts: sql`greatest(${jobs.attempts} - 1, 0)` } : {}),
    })
    .where(eq(jobs.id, id));
}

/** Filters to the plan (period, exclusions), normalizes, and stores at most `room` posts. */
async function store(searchId: number, plan: Plan, raw: RawPost[], room: number): Promise<number> {
  if (room <= 0) return 0;
  const salt = process.env.AUTHOR_HASH_SALT ?? "";
  const rows = raw
    .filter((p) => inWindow(plan, p.postedAt) && !isExcluded(plan, `${p.title ?? ""} ${p.text}`))
    .map((p) => toPostRow(p, searchId, salt))
    .filter((r) => r !== null)
    .slice(0, room);
  return savePosts(rows);
}

async function charge(searchId: number, cost: CallCost) {
  await recordCost({ searchId, provider: cost.provider, operation: cost.operation, units: cost.units, usd: cost.usd });
}

function publishedAfter(plan: Plan): Date | undefined {
  if (!plan.timeWindow.from) return undefined;
  return new Date(Date.parse(`${plan.timeWindow.from}T00:00:00Z`) - VIDEO_LOOKBACK_DAYS * 86_400_000);
}

/** Runs one job. Returns child jobs to queue. */
async function runJob(
  searchId: number,
  step: Step,
  cursor: JobCursor,
  plan: Plan,
  room: number,
): Promise<{ step: Step; cursor: JobCursor }[]> {
  const inherit = { planVersion: cursor.planVersion, run: cursor.run, baseline: cursor.baseline };
  if (step === "yt.search") {
    const page = await youtube.searchVideos(process.env.YOUTUBE_API_KEY, cursor.query!, {
      maxResults: plan.youtube.videosPerQuery,
      regionCode: "US",
      relevanceLanguage: "en",
      publishedAfter: publishedAfter(plan),
    });
    await charge(searchId, page.cost);
    return page.items.map((video) => ({ step: "yt.comments" as const, cursor: { ...inherit, videoId: video.videoId } }));
  }
  if (step === "yt.comments") {
    const page = await youtube.videoComments(process.env.YOUTUBE_API_KEY, cursor.videoId!, {
      maxResults: plan.youtube.commentsPerVideo,
      order: plan.timeWindow.from ? "time" : "relevance",
    });
    await charge(searchId, page.cost);
    await store(searchId, plan, page.items, room);
    return [];
  }
  if (step === "rd.search") {
    const page = await reddit.searchPosts(process.env.SCRAPECREATORS_API_KEY, cursor.query!, {
      sort: "relevance",
      timeframe: redditTimeframe(plan),
    });
    await charge(searchId, page.cost);
    await store(searchId, plan, page.items, room);
    const busiest = [...page.items]
      .filter((p) => p.url && inWindow(plan, p.postedAt))
      .sort((a, b) => Number(b.engagement?.comments ?? 0) - Number(a.engagement?.comments ?? 0))
      .slice(0, plan.reddit.commentThreadsPerQuery);
    return busiest.map((p) => ({ step: "rd.comments" as const, cursor: { ...inherit, url: p.url! } }));
  }
  const page = await reddit.postComments(process.env.SCRAPECREATORS_API_KEY, cursor.url!);
  await charge(searchId, page.cost);
  await store(searchId, plan, page.items, room);
  return [];
}

export interface Progress {
  /** Job counts for the latest run only. */
  jobs: { queued: number; running: number; waiting: number; done: number; failed: number };
  postsBySource: Record<string, number>;
  /** All posts stored for this search, across every run. */
  totalPosts: number;
  /** Posts stored by the latest run (each run adds at most postCap new posts). */
  runPosts: number;
  postCap: number;
  costUsd: number;
  finished: boolean;
  lastErrors: string[];
}

export async function progress(searchId: number): Promise<Progress> {
  const d = requireDb();
  const latestRun = sql`(select max((cursor->>'run')::bigint) from ${jobs} where search_id = ${searchId})`;
  const inLatestRun = and(eq(jobs.searchId, searchId), sql`(${jobs.cursor}->>'run')::bigint = ${latestRun}`);
  const [jobRows, openRows, postRows, [costRow], latest, errs, [runRow]] = await Promise.all([
    d.select({ status: jobs.status, n: count() }).from(jobs).where(inLatestRun).groupBy(jobs.status),
    d
      .select({ n: count() })
      .from(jobs)
      .where(and(eq(jobs.searchId, searchId), sql`${jobs.status} in ('queued','running')`)),
    d.select({ source: posts.source, n: count() }).from(posts).where(eq(posts.searchId, searchId)).groupBy(posts.source),
    d.select({ usd: sql<string>`coalesce(sum(${costEvents.usd}), 0)` }).from(costEvents).where(eq(costEvents.searchId, searchId)),
    loadPlan(searchId),
    d
      .selectDistinct({ e: jobs.lastError })
      .from(jobs)
      .where(and(inLatestRun, sql`${jobs.lastError} is not null and ${jobs.status} in ('failed','waiting')`))
      .limit(3),
    d.select({ baseline: sql<string | null>`${jobs.cursor}->>'baseline'` }).from(jobs).where(inLatestRun).limit(1),
  ]);
  const j = { queued: 0, running: 0, waiting: 0, done: 0, failed: 0 };
  for (const r of jobRows) j[r.status] = r.n;
  const postsBySource = Object.fromEntries(postRows.map((r) => [r.source, r.n]));
  const totalPosts = postRows.reduce((s, r) => s + r.n, 0);
  return {
    jobs: j,
    postsBySource,
    totalPosts,
    runPosts: runRow ? Math.max(0, totalPosts - Number(runRow.baseline ?? 0)) : 0,
    postCap: latest?.plan.postCap ?? 0,
    costUsd: Number(costRow?.usd ?? 0),
    finished: (openRows[0]?.n ?? 0) === 0,
    lastErrors: errs.map((e) => e.e!).filter(Boolean),
  };
}

/** Work through queued jobs for up to `budgetMs`, then report progress. */
export async function advance(searchId: number, budgetMs = 20_000): Promise<Progress> {
  const d = requireDb();
  const started = Date.now();
  // Jobs left "running" by a killed request go back to the queue (that attempt still counts).
  await d
    .update(jobs)
    .set({ status: "queued" })
    .where(and(eq(jobs.searchId, searchId), eq(jobs.status, "running"), sql`${jobs.updatedAt} < now() - make_interval(secs => ${STALE_RUNNING_SECONDS})`));

  const plansByVersion = new Map<number, Plan>();
  // One budget check per call: a single ~20 s cycle can't move spend meaningfully.
  let paidBlocked: string | null | undefined;
  let count = await postCount(searchId);

  while (Date.now() - started < budgetMs) {
    const job = await claimJob(searchId);
    if (!job) break;

    let plan = plansByVersion.get(job.cursor.planVersion);
    if (!plan) {
      const loaded = await loadPlan(searchId, job.cursor.planVersion);
      if (!loaded) {
        await finishJob(job.id, "failed", "Plan version not found.");
        continue;
      }
      plan = loaded.plan;
      plansByVersion.set(loaded.version, plan);
    }

    const room = (job.cursor.baseline ?? 0) + plan.postCap - count;
    if (room <= 0) {
      await finishJob(job.id, "done", "Skipped: post cap reached for this run.", { refundAttempt: true });
      continue;
    }
    if (PAID_STEPS.has(job.step)) {
      if (paidBlocked === undefined) paidBlocked = await paidWorkBlockedReason();
      if (paidBlocked) {
        await finishJob(job.id, "waiting", `Paused: ${paidBlocked}.`, { refundAttempt: true });
        continue;
      }
    }

    try {
      const children = await runJob(searchId, job.step, job.cursor, plan, room);
      if (children.length) await d.insert(jobs).values(children.map((c) => ({ searchId, ...c })));
      await finishJob(job.id, "done", null);
    } catch (err) {
      const message = err instanceof Error ? err.message.slice(0, 300) : "Unknown error";
      // Only network/rate-limit errors are worth retrying. Anything else (bad config, DB, a bug) would fail
      // again and, for paid steps, could pay again after the API call already succeeded.
      const retryable = err instanceof ConnectorError && err.retryable;
      if (retryable && job.attempts < MAX_ATTEMPTS) await finishJob(job.id, "queued", message, { retryInSeconds: 30 * job.attempts });
      else await finishJob(job.id, "failed", message);
    }
    count = await postCount(searchId);
  }
  return progress(searchId);
}
