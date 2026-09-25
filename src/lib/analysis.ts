import "server-only";

import { experimental_evaluate as evaluate } from "ai";
import { and, count, desc, eq, sql } from "drizzle-orm";

import { requireDb } from "@/db/client";
import { codebooks, decisions, jobs, posts, reviews } from "@/db/schema";

import {
  COUNTED,
  estimateTokens,
  jevUsd,
  NOT_STATED,
  orderOf,
  Q,
  questionsFor,
  readAnswers,
  stateFor,
  themeQuestion,
  UNCERTAIN,
  type Codebook,
} from "./codebook";
import { claudeModel, tokenCostUsd } from "./ai";
import { CodebookError, draftCodebook } from "./codebook-drafter";
import { loadPlan } from "./collect";
import { paidWorkBlockedReason, recordCost } from "./cost";

/**
 * Step 5: Jev answers the codebook's questions for every post (docs/JEV.md). Like collection, it runs as a job
 * the search page advances ~20 s at a time, so it fits Vercel Hobby limits and a closed tab just pauses it.
 * Claude only drafts the codebook; it never labels a post. Every number shown is SQL over `decisions`.
 */

export const JEV_MODEL = "typesafe-ai/jev";
const STEP = "analyze";
const BATCH = 8;
/** Jev allows 2 calls at once through the gateway (docs/JEV.md). */
const CONCURRENCY = 2;
const MAX_ATTEMPTS = 3;
const STALE_RUNNING_SECONDS = 120;
const SAMPLE_SIZE = 60;
/** Tokens for drafting a codebook (60 posts × 300 characters plus instructions; the answer), rounded up. */
const DRAFT_TOKENS = { input: 8_000, output: 3_000 };

interface Cursor {
  codebookVersion: number;
}

export async function latestCodebook(searchId: number): Promise<{ version: number; codebook: Codebook } | null> {
  const [row] = await requireDb().select().from(codebooks).where(eq(codebooks.searchId, searchId)).orderBy(desc(codebooks.version)).limit(1);
  return row ? { version: row.version, codebook: row.codebook as Codebook } : null;
}

/** Saves a codebook as the next version (one statement, so two saves can't take the same number). */
export async function saveCodebook(searchId: number, codebook: Codebook): Promise<number> {
  const res = await requireDb().execute(sql`
    insert into ${codebooks} (search_id, version, codebook, approved_at)
    select ${searchId}, coalesce(max(version), 0) + 1, ${JSON.stringify(codebook)}::jsonb, now()
    from ${codebooks} where search_id = ${searchId}
    returning version`);
  return Number((res.rows[0] as { version: number }).version);
}

/** Posts of the search that have no answers yet for this codebook version. */
const pendingWhere = (searchId: number, version: number) =>
  sql`${posts.searchId} = ${searchId} and not exists (
    select 1 from ${decisions} d where d.post_id = ${posts.id} and d.codebook_version = ${version} and d.question = ${Q.relevant})`;

async function pendingStats(searchId: number, version: number): Promise<{ n: number; chars: number }> {
  const [row] = await requireDb()
    .select({ n: count(), chars: sql<string>`coalesce(sum(least(length(${posts.text}) + length(${posts.title}), 3000)), 0)` })
    .from(posts)
    .where(pendingWhere(searchId, version));
  return { n: row?.n ?? 0, chars: Number(row?.chars ?? 0) };
}

export type StartResult = { started: true; drafted: boolean } | { started: false; reason: string };

/**
 * Starts (or continues) analysis with the latest codebook, drafting one first if the search has none. Posts
 * already answered for that version are skipped, so it's also how new posts get analyzed.
 */
export async function startAnalysis(searchId: number): Promise<StartResult> {
  const db = requireDb();
  const plan = await loadPlan(searchId);
  if (!plan) return { started: false, reason: "No plan saved yet." };
  const [{ n: total } = { n: 0 }] = await db.select({ n: count() }).from(posts).where(eq(posts.searchId, searchId));
  if (total === 0) return { started: false, reason: "Collect some posts first." };
  let current = await latestCodebook(searchId);
  if (current && (await pendingStats(searchId, current.version)).n === 0) {
    return { started: false, reason: "Every post is already analyzed with this codebook." };
  }

  // Taken before drafting, so a second click or tab can't draft (and pay) again or start a second run.
  const jobId = await reserve(searchId);
  if (jobId === null) return { started: false, reason: "Analysis is already running for this search." };
  let drafted = false;
  try {
    if (!current) {
      const sample = await db
        .select({ source: posts.source, text: posts.text })
        .from(posts)
        .where(eq(posts.searchId, searchId))
        .orderBy(sql`random()`)
        .limit(SAMPLE_SIZE);
      try {
        const { codebook, cost } = await draftCodebook(plan.plan, sample);
        await recordCost({ searchId, ...cost });
        current = { version: await saveCodebook(searchId, codebook), codebook };
        drafted = true;
      } catch (err) {
        if (err instanceof CodebookError && err.cost) await recordCost({ searchId, ...err.cost }).catch(() => undefined);
        throw err;
      }
    }
    await db
      .update(jobs)
      .set({ status: "queued", cursor: { codebookVersion: current.version } satisfies Cursor, runAfter: sql`now()` })
      .where(eq(jobs.id, jobId));
  } catch (err) {
    await finish(jobId, "failed", err instanceof Error ? err.message.slice(0, 300) : "Couldn't draft the codebook.");
    throw err;
  }
  return { started: true, drafted };
}

/**
 * Reserves the search's one analysis run under an advisory lock, so two requests at the same moment can't both pass
 * the "nothing open" check. The job stays "running" (unclaimable) until drafting is done.
 */
async function reserve(searchId: number): Promise<number | null> {
  const db = requireDb();
  // One transaction: the lock is taken first, so the check below runs in a snapshot that already sees any run
  // another request reserved while we waited for the lock.
  const [, inserted] = await db.batch([
    db.execute(sql`select pg_advisory_xact_lock(hashtext(${STEP}), ${searchId})`),
    db.execute(sql`
      insert into ${jobs} (search_id, step, status, cursor)
      select ${searchId}, ${STEP}, 'running', ${JSON.stringify({ codebookVersion: 0 } satisfies Cursor)}::jsonb
      where not exists (select 1 from ${jobs} where search_id = ${searchId} and step = ${STEP} and status in ('queued', 'running', 'waiting'))
      returning id`),
  ]);
  const row = inserted.rows[0] as { id: number } | undefined;
  return row ? Number(row.id) : null;
}

/** Claims the search's analysis job (one statement, so two tabs can't both run it). */
async function claim(searchId: number) {
  const res = await requireDb().execute(sql`
    update ${jobs} set status = 'running', attempts = attempts + 1, updated_at = now()
    where id = (
      select id from ${jobs}
      where search_id = ${searchId} and step = ${STEP} and status = 'queued' and run_after <= now()
      order by id limit 1
      for update skip locked
    )
    returning id, cursor, attempts`);
  return (res.rows[0] as { id: number; cursor: Cursor; attempts: number } | undefined) ?? null;
}

async function finish(id: number, status: "done" | "failed" | "waiting" | "queued", lastError: string | null, retryInSeconds = 0, refundAttempt = false) {
  await requireDb()
    .update(jobs)
    .set({
      status,
      lastError,
      runAfter: sql`now() + make_interval(secs => ${retryInSeconds})`,
      ...(refundAttempt ? { attempts: sql`greatest(${jobs.attempts} - 1, 0)` } : {}),
    })
    .where(eq(jobs.id, id));
}

/** Jev refused this particular post (bad or oversized input): skip it instead of retrying forever. */
function rejectedPost(err: unknown): boolean {
  const e = (err as { lastError?: unknown })?.lastError ?? err;
  const status = (e as { statusCode?: number })?.statusCode;
  const name = (e as { name?: string })?.name;
  return name === "GatewayInvalidRequestError" || status === 400 || status === 413 || status === 422;
}

/** Works through the analysis for about `budgetMs`, then returns where it stands. */
export async function advanceAnalysis(searchId: number, budgetMs = 20_000): Promise<AnalysisState> {
  const db = requireDb();
  const started = Date.now();
  // A job left "running" by a killed request goes back to the queue.
  await db
    .update(jobs)
    .set({ status: "queued" })
    .where(and(eq(jobs.searchId, searchId), eq(jobs.step, STEP), eq(jobs.status, "running"), sql`${jobs.updatedAt} < now() - make_interval(secs => ${STALE_RUNNING_SECONDS})`));

  const job = await claim(searchId);
  if (!job) return analysisState(searchId);

  const blocked = await paidWorkBlockedReason();
  if (blocked) {
    await finish(job.id, "waiting", `Paused: ${blocked}.`, 0, true);
    return analysisState(searchId);
  }
  const version = job.cursor.codebookVersion;
  if (!version) {
    // Reserved but drafting never finished (the request was cut off).
    await finish(job.id, "failed", "Drafting the themes was interrupted. Press Analyze again.");
    return analysisState(searchId);
  }
  const [cb] = await db.select().from(codebooks).where(and(eq(codebooks.searchId, searchId), eq(codebooks.version, version)));
  const plan = await loadPlan(searchId);
  if (!cb || !plan) {
    await finish(job.id, "failed", "Codebook or plan not found.");
    return analysisState(searchId);
  }
  const questions = questionsFor(cb.codebook as Codebook, plan.plan.subject);

  // Failures in a row; a batch that works resets it, so a long run isn't failed by scattered hiccups.
  let attempts = job.attempts;
  const heartbeat = (patch: Partial<typeof jobs.$inferInsert> = {}) => db.update(jobs).set({ updatedAt: new Date(), ...patch }).where(eq(jobs.id, job.id));
  try {
    while (Date.now() - started < budgetMs) {
      const batch = await db
        .select({ id: posts.id, source: posts.source, title: posts.title, text: posts.text })
        .from(posts)
        .where(pendingWhere(searchId, version))
        .orderBy(posts.id)
        .limit(BATCH);
      if (batch.length === 0) {
        await finish(job.id, "done", null);
        return analysisState(searchId);
      }
      let inputTokens = 0;
      let read = 0;
      const rows: (typeof decisions.$inferInsert)[] = [];
      let failure: unknown = null;
      try {
        for (let i = 0; i < batch.length && !failure && Date.now() - started < budgetMs; i += CONCURRENCY) {
          const pair = batch.slice(i, i + CONCURRENCY);
          const settled = await Promise.allSettled(
            pair.map(async (post) => {
              try {
                const result = await evaluate({ model: JEV_MODEL, state: stateFor(post), questions, maxRetries: 3, abortSignal: AbortSignal.timeout(30_000) });
                inputTokens += result.usage.inputTokens ?? estimateTokens(post.text.length + post.title.length, cb.codebook as Codebook, plan.plan.subject);
                for (const r of readAnswers(result.answers)) rows.push({ postId: post.id, codebookVersion: version, model: JEV_MODEL, ...r });
              } catch (err) {
                if (!rejectedPost(err)) throw err;
                // Stored so the post isn't retried; it never counts and is listed as skipped.
                rows.push({ postId: post.id, codebookVersion: version, model: JEV_MODEL, question: Q.relevant, answer: "skipped", confidence: 0 });
              }
            }),
          );
          read += settled.filter((r) => r.status === "fulfilled").length;
          failure = settled.find((r) => r.status === "rejected")?.reason ?? null;
          // After every pair (at most ~30 s), so a slow batch is never mistaken for an abandoned one.
          await heartbeat();
        }
      } finally {
        // Answers already paid for are saved even when another post failed or time ran out.
        if (rows.length) await db.insert(decisions).values(rows).onConflictDoNothing();
        if (inputTokens > 0) await recordCost({ searchId, provider: "jev", operation: "classify", units: { inputTokens, posts: read }, usd: jevUsd(inputTokens) });
      }
      if (failure) throw failure;
      attempts = 1;
      await heartbeat({ attempts });
    }
    await finish(job.id, "queued", null, 0, true);
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 300) : "Unknown error";
    if (attempts < MAX_ATTEMPTS) await finish(job.id, "queued", message, 20 * attempts);
    else await finish(job.id, "failed", message);
  }
  return analysisState(searchId);
}

/** Resumes a paused (budget) or failed analysis. */
export async function resumeAnalysis(searchId: number): Promise<void> {
  // Only the latest run, and always with the latest codebook (it may have been edited while paused).
  await requireDb().execute(sql`
    update ${jobs} set status = 'queued', attempts = 0, last_error = null, run_after = now(),
      cursor = jsonb_build_object('codebookVersion', (select max(version) from ${codebooks} where search_id = ${searchId}))
    where id = (select max(id) from ${jobs} where search_id = ${searchId} and step = ${STEP})
      and status in ('waiting', 'failed')
      and exists (select 1 from ${codebooks} where search_id = ${searchId})`);
}

/** True while an analysis is queued or running (edits to the codebook wait until it's done or paused). */
export async function analysisBusy(searchId: number): Promise<boolean> {
  const [row] = await requireDb()
    .select({ n: count() })
    .from(jobs)
    .where(and(eq(jobs.searchId, searchId), eq(jobs.step, STEP), sql`${jobs.status} in ('queued', 'running')`));
  return (row?.n ?? 0) > 0;
}

export interface AnalysisState {
  version: number | null;
  totalPosts: number;
  analyzed: number;
  pending: number;
  /** Cost to analyze the pending posts: Jev, from their length, plus drafting the codebook when there is none yet. */
  estimateUsd: number;
  status: "none" | "running" | "paused" | "failed" | "done";
  message: string | null;
  /** Spent on this search's analysis so far (codebook + Jev). */
  costUsd: number;
}

export async function analysisState(searchId: number): Promise<AnalysisState> {
  const db = requireDb();
  const [current, [{ n: totalPosts } = { n: 0 }], [lastJob], spent] = await Promise.all([
    latestCodebook(searchId),
    db.select({ n: count() }).from(posts).where(eq(posts.searchId, searchId)),
    db
      .select({ status: jobs.status, lastError: jobs.lastError, cursor: jobs.cursor })
      .from(jobs)
      .where(and(eq(jobs.searchId, searchId), eq(jobs.step, STEP)))
      .orderBy(desc(jobs.id))
      .limit(1),
    db.execute(sql`select coalesce(sum(usd), 0) as usd from cost_events where search_id = ${searchId} and operation in ('codebook', 'classify')`),
  ]);
  const costUsd = Number((spent?.rows?.[0] as { usd?: string } | undefined)?.usd ?? 0);
  const jobVersion = Number((lastJob?.cursor as Cursor | null)?.codebookVersion ?? 0);
  const open = lastJob?.status === "queued" || lastJob?.status === "running";
  if (!current) {
    const [{ chars } = { chars: "0" }] = await db
      .select({ chars: sql<string>`coalesce(sum(least(length(${posts.text}) + length(${posts.title}), 3000)), 0)` })
      .from(posts)
      .where(eq(posts.searchId, searchId));
    // Questions are unknown until the codebook exists; a typical one adds about 900 tokens per post.
    const jev = jevUsd(Number(chars) / 4 + 900 * totalPosts);
    const draft = tokenCostUsd(claudeModel(), DRAFT_TOKENS.input, DRAFT_TOKENS.output);
    return { version: null, totalPosts, analyzed: 0, pending: totalPosts, estimateUsd: jev + draft, status: open ? "running" : "none", message: lastJob?.status === "failed" ? lastJob.lastError : null, costUsd };
  }
  // A run in progress is measured against the codebook it is using, even if a newer one was saved meanwhile.
  const running = open && jobVersion > 0;
  const version = running ? jobVersion : current.version;
  const pending = await pendingStats(searchId, version);
  const estimateUsd = jevUsd(pending.chars / 4 + estimateTokens(0, current.codebook, "") * pending.n);
  const status = open
    ? "running"
    : lastJob?.status === "waiting"
      ? "paused"
      : lastJob?.status === "failed" && jobVersion > 0
        ? "failed"
        : pending.n === 0
          ? "done"
          : "none";
  // A failed first draft leaves no run to resume: show why, with Analyze to try again.
  const message = lastJob?.status === "failed" || lastJob?.status === "waiting" ? lastJob.lastError : null;
  return { version, totalPosts, analyzed: totalPosts - pending.n, pending: pending.n, estimateUsd, status, message, costUsd };
}

// ---- Results (all SQL) -----------------------------------------------------------------------------------------

/**
 * The codebook version to show results for: the one that has read the most posts (the newer one on a tie). After
 * you edit the codebook, results stay on the previous version until the re-analysis has caught up with it.
 */
export async function resultsVersion(searchId: number): Promise<number | null> {
  const res = await requireDb().execute(sql`
    select d.codebook_version as version, count(*) as n
    from ${decisions} d join ${posts} p on p.id = d.post_id
    where p.search_id = ${searchId} and d.question = ${Q.relevant}
    group by d.codebook_version
    order by n desc, version desc
    limit 1`);
  const row = res.rows[0] as { version: number } | undefined;
  return row ? Number(row.version) : null;
}

export interface Tally {
  key: string;
  label: string;
  counted: number;
  uncertain: number;
}

export interface AnalysisSummary {
  version: number;
  codebook: Codebook;
  relevance: { counted: number; notRelevant: number; needsLook: number; skipped: number };
  sentiment: Tally[];
  stages: Tally[];
  segments: Tally[];
  themes: (Tally & { kind: string })[];
}

/**
 * Relevance per post for one codebook version: your Keep/Drop wins over Jev (and counts as sure). A yes/no answer's
 * confidence is never below 0.5, so relevance is strict (docs/DECISIONS.md D37): a post is in only when Jev is sure
 * (0.8 or more) or you kept it; anything less sure waits in "Needs a look" and isn't counted.
 */
const relevanceCte = (searchId: number, version: number) => sql`
  rel as (
    select d.post_id,
      coalesce(r.human_answer, d.answer) as answer,
      case when r.human_answer is not null then 1.0 else d.confidence end as conf
    from ${decisions} d
    join ${posts} p on p.id = d.post_id
    left join lateral (
      -- Relevance doesn't depend on the codebook, so your latest Keep/Drop applies to every version.
      select human_answer from ${reviews}
      where post_id = d.post_id and question = ${Q.relevant} and kind = 'review_queue'
      order by created_at desc, id desc limit 1
    ) r on true
    where p.search_id = ${searchId} and d.codebook_version = ${version} and d.question = ${Q.relevant}
  )`;

const SENTIMENTS = [
  { key: "positive", label: "Positive" },
  { key: "negative", label: "Negative" },
  { key: "mixed", label: "Mixed" },
  { key: "neutral", label: "Neutral" },
];

export async function analysisSummary(searchId: number, version: number): Promise<AnalysisSummary | null> {
  const db = requireDb();
  const [cb] = await db.select().from(codebooks).where(and(eq(codebooks.searchId, searchId), eq(codebooks.version, version)));
  if (!cb) return null;
  const codebook = cb.codebook as Codebook;
  const [relRes, ansRes] = await Promise.all([
    db.execute(sql`with ${relevanceCte(searchId, version)}
      select
        count(*) filter (where answer = 'yes' and conf >= ${COUNTED})::int as counted,
        count(*) filter (where answer = 'no' and conf >= ${COUNTED})::int as "notRelevant",
        count(*) filter (where answer in ('yes', 'no') and conf < ${COUNTED})::int as "needsLook",
        count(*) filter (where answer = 'skipped')::int as skipped
      from rel`),
    // Every other answer, only for posts that are surely about the subject.
    db.execute(sql`with ${relevanceCte(searchId, version)}
      select d.question, d.answer,
        count(*) filter (where d.confidence >= ${COUNTED})::int as counted,
        count(*) filter (where d.confidence >= ${UNCERTAIN} and d.confidence < ${COUNTED})::int as uncertain
      from ${decisions} d
      join rel on rel.post_id = d.post_id and rel.answer = 'yes' and rel.conf >= ${COUNTED}
      where d.codebook_version = ${version} and d.question <> ${Q.relevant}
      group by d.question, d.answer`),
  ]);
  const relevance = relRes.rows[0] as AnalysisSummary["relevance"];
  const answers = ansRes.rows as { question: string; answer: string; counted: number; uncertain: number }[];
  const tally = (question: string, answer: string) => answers.find((a) => a.question === question && a.answer === answer) ?? { counted: 0, uncertain: 0 };
  const list = (question: string, codes: { key: string; label: string }[]) =>
    codes.map((c) => ({ key: c.key, label: c.label, counted: tally(question, c.key).counted, uncertain: tally(question, c.key).uncertain }));

  const stageOrder = orderOf(codebook.stages);
  return {
    version,
    codebook,
    relevance,
    sentiment: list(Q.sentiment, SENTIMENTS),
    stages: list(Q.stage, codebook.stages).sort((a, b) => (stageOrder.get(a.key) ?? 0) - (stageOrder.get(b.key) ?? 0)),
    segments: list(Q.segment, codebook.segments)
      .filter((s) => s.key !== NOT_STATED)
      .sort((a, b) => b.counted - a.counted),
    themes: codebook.themes
      .map((t) => ({ key: t.key, label: t.label, kind: t.kind, ...pick(tally(themeQuestion(t.key), "yes")) }))
      .sort((a, b) => b.counted - a.counted || b.uncertain - a.uncertain),
  };
}
const pick = (t: { counted: number; uncertain: number }) => ({ counted: t.counted, uncertain: t.uncertain });

// ---- Needs a look ----------------------------------------------------------------------------------------------

export interface LookPost {
  id: number;
  source: string;
  url: string | null;
  text: string;
  /** Jev's leaning and how sure it was. */
  answer: string;
  confidence: number;
}

/** Posts Jev wasn't sure are about the subject (confidence under 0.8) that you haven't decided yet. */
export async function needsLook(searchId: number, version: number, limit = 20): Promise<LookPost[]> {
  const res = await requireDb().execute(sql`
    select p.id, p.source, p.url, p.text, d.answer, d.confidence
    from ${decisions} d join ${posts} p on p.id = d.post_id
    where p.search_id = ${searchId} and d.codebook_version = ${version} and d.question = ${Q.relevant}
      and d.answer in ('yes', 'no') and d.confidence < ${COUNTED}
      and not exists (select 1 from ${reviews} r where r.post_id = d.post_id and r.question = ${Q.relevant} and r.kind = 'review_queue')
    order by p.id limit ${limit}`);
  return res.rows as unknown as LookPost[];
}

/** Keep (about the subject) or Drop (not about it). Your answer replaces Jev's in every count. */
export async function saveReview(searchId: number, postId: number, version: number, keep: boolean): Promise<boolean> {
  const db = requireDb();
  const [own] = await db.select({ id: posts.id }).from(posts).where(and(eq(posts.id, postId), eq(posts.searchId, searchId)));
  if (!own) return false;
  await db
    .insert(reviews)
    .values({ postId, codebookVersion: version, question: Q.relevant, humanAnswer: keep ? "yes" : "no", kind: "review_queue" })
    .onConflictDoUpdate({ target: [reviews.postId, reviews.codebookVersion, reviews.question, reviews.kind], set: { humanAnswer: keep ? "yes" : "no", reviewedAt: new Date() } });
  return true;
}
