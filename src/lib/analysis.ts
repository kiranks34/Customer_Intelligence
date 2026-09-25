import "server-only";

import { experimental_evaluate as evaluate } from "ai";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";

import { requireDb } from "@/db/client";
import * as youtube from "@/connectors/youtube";
import { catalogNodes, codebooks, decisions, jobs, postProducts, posts, reviews } from "@/db/schema";

import {
  ABOUT,
  COUNTED,
  estimateTokens,
  jevUsd,
  NOT_STATED,
  NO_BRAND,
  NOT_PRODUCT,
  NOT_SURE,
  OTHER_BRAND,
  QUESTION_SET,
  orderOf,
  Q,
  questionsFor,
  readAnswers,
  stateFor,
  themeQuestion,
  UNCERTAIN,
  type Codebook,
  type PostForJev,
} from "./codebook";
import { claudeModel, tokenCostUsd } from "./ai";
import { CodebookError, draftCodebook } from "./codebook-drafter";
import { loadPlan } from "./collect";
import { paidWorkBlockedReason, recordCost } from "./cost";
import { removeDuplicatePosts } from "./posts";

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
    select 1 from ${decisions} d where d.post_id = ${posts.id} and d.codebook_version = ${version}
      and d.question = ${Q.aboutProduct} and d.answer = ${QUESTION_SET})`;

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
  await prepare(searchId);
  let current = await latestCodebook(searchId);
  if (current && current.codebook.competitors !== undefined && (await pendingStats(searchId, current.version)).n === 0) {
    return { started: false, reason: "Every post is already analyzed with this codebook." };
  }

  // Taken before drafting, so a second click or tab can't draft (and pay) again or start a second run.
  const jobId = await reserve(searchId);
  if (jobId === null) return { started: false, reason: "Analysis is already running for this search." };
  let drafted = false;
  try {
    if (!current) {
      try {
        const { codebook, cost } = await draftCodebook(plan.plan, await sampleOf(searchId));
        await recordCost({ searchId, ...cost });
        current = { version: await saveCodebook(searchId, codebook), codebook };
        drafted = true;
      } catch (err) {
        if (err instanceof CodebookError && err.cost) await recordCost({ searchId, ...err.cost }).catch(() => undefined);
        throw err;
      }
    } else if (current.codebook.competitors === undefined) {
      // Drafted before competitors existed: add Claude's list from a sample, keep everything else as it is.
      try {
        const { codebook, cost } = await draftCodebook(plan.plan, await sampleOf(searchId));
        await recordCost({ searchId, ...cost });
        const merged = { ...current.codebook, competitors: codebook.competitors ?? [] };
        current = { version: await saveCodebook(searchId, merged), codebook: merged };
      } catch (err) {
        if (err instanceof CodebookError && err.cost) await recordCost({ searchId, ...err.cost }).catch(() => undefined);
        // Without a list the analysis still runs; competitor posts are grouped, just not by brand.
        const merged = { ...current.codebook, competitors: [] };
        current = { version: await saveCodebook(searchId, merged), codebook: merged };
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

/** A random sample of the search's posts for Claude to draft from. */
async function sampleOf(searchId: number): Promise<{ source: string; text: string }[]> {
  return requireDb()
    .select({ source: posts.source, text: posts.text })
    .from(posts)
    .where(eq(posts.searchId, searchId))
    .orderBy(sql`random()`)
    .limit(SAMPLE_SIZE);
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

/** The next posts to read, with their context: the video or thread title and the catalog products they name. */
async function pendingBatch(searchId: number, version: number): Promise<(PostForJev & { id: number })[]> {
  const res = await requireDb().execute(sql`
    select p.id, p.source, p.title, p.text, p.parent_source_id is not null as "isComment",
      coalesce(p.engagement->>'thread', parent.title) as thread,
      (select string_agg(distinct n.name, ', ') from ${postProducts} pp join ${catalogNodes} n on n.id = pp.node_id where pp.post_id = p.id) as names
    from ${posts} p
    left join ${posts} parent on parent.search_id = p.search_id and parent.source_id = p.parent_source_id and parent.title <> ''
    where p.search_id = ${searchId} and not exists (
      select 1 from ${decisions} d where d.post_id = p.id and d.codebook_version = ${version}
        and d.question = ${Q.aboutProduct} and d.answer = ${QUESTION_SET})
    order by p.id limit ${BATCH}`);
  return (res.rows as unknown as (PostForJev & { id: number })[]).map((r) => ({ ...r, id: Number(r.id) }));
}

/**
 * Before reading: removes duplicate posts, and looks up the titles of YouTube videos whose comments were stored
 * without one (free quota), so every comment is read with its context.
 */
async function prepare(searchId: number): Promise<void> {
  await removeDuplicatePosts(searchId);
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return;
  const db = requireDb();
  const missing = await db.execute(sql`
    select distinct parent_source_id as id from ${posts}
    where search_id = ${searchId} and source = 'youtube' and parent_source_id is not null and (engagement->>'thread') is null
    limit 200`);
  const ids = (missing.rows as { id: string }[]).map((r) => r.id);
  for (let i = 0; i < ids.length; i += 50) {
    try {
      const { titles, cost } = await youtube.videoTitles(key, ids.slice(i, i + 50));
      await recordCost({ searchId, ...cost });
      for (const [videoId, title] of Object.entries(titles)) {
        await db.execute(sql`
          update ${posts} set engagement = coalesce(engagement, '{}'::jsonb) || jsonb_build_object('thread', ${title.slice(0, 300)}::text)
          where search_id = ${searchId} and source = 'youtube' and parent_source_id = ${videoId}`);
      }
    } catch {
      // Without titles the comments are still read, only with less context.
    }
  }
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
  if ((cb.codebook as Codebook).competitors === undefined) {
    // A run queued or resumed on a codebook from before competitors: reading now would miss the competitor questions
    // and cost a second full read later. Analyze adds the list first (like an interrupted draft: back to "Analyze").
    await requireDb()
      .update(jobs)
      .set({ status: "failed", lastError: "The questions were updated. Press Analyze to continue.", cursor: { codebookVersion: 0 } satisfies Cursor })
      .where(eq(jobs.id, job.id));
    return analysisState(searchId);
  }
  const questions = questionsFor(cb.codebook as Codebook, plan.plan.subject);

  // Failures in a row; a batch that works resets it, so a long run isn't failed by scattered hiccups.
  let attempts = job.attempts;
  const heartbeat = (patch: Partial<typeof jobs.$inferInsert> = {}) => db.update(jobs).set({ updatedAt: new Date(), ...patch }).where(eq(jobs.id, job.id));
  try {
    while (Date.now() - started < budgetMs) {
      const batch = await pendingBatch(searchId, version);
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
                rows.push({ postId: post.id, codebookVersion: version, model: JEV_MODEL, question: Q.about, answer: "skipped", confidence: 0 });
                rows.push({ postId: post.id, codebookVersion: version, model: JEV_MODEL, question: Q.aboutProduct, answer: QUESTION_SET, confidence: 0 });
              }
            }),
          );
          read += settled.filter((r) => r.status === "fulfilled").length;
          failure = settled.find((r) => r.status === "rejected")?.reason ?? null;
          // After every pair (at most ~30 s), so a slow batch is never mistaken for an abandoned one.
          await heartbeat();
        }
      } finally {
        // Answers already paid for are saved even when another post failed or time ran out. A post read again
        // (e.g. with the new "about" question) replaces its older answers for this version, in one transaction.
        if (rows.length) {
          const answered = [...new Set(rows.map((r) => r.postId))];
          await db.batch([
            db.delete(decisions).where(and(inArray(decisions.postId, answered), eq(decisions.codebookVersion, version))),
            db.insert(decisions).values(rows).onConflictDoNothing(),
          ]);
        }
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
  /** Some posts were read with the older yes/no question and will be read again with the improved one. */
  improved: boolean;
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
    return { version: null, totalPosts, analyzed: 0, pending: totalPosts, estimateUsd: jev + draft, status: open ? "running" : "none", message: lastJob?.status === "failed" ? lastJob.lastError : null, costUsd, improved: false };
  }
  // A run in progress is measured against the codebook it is using, even if a newer one was saved meanwhile.
  const running = open && jobVersion > 0;
  const version = running ? jobVersion : current.version;
  const pending = await pendingStats(searchId, version);
  // A codebook from before competitors gets a list drafted first (one Claude call) and two more questions per post.
  const upgrading = current.codebook.competitors === undefined && !running;
  const planned: Codebook = upgrading
    ? { ...current.codebook, competitors: Array.from({ length: 5 }, (_, i) => ({ key: `brand_${i}`, label: "Brand name", definition: "Printers of this brand." })) }
    : current.codebook;
  const estimateUsd =
    jevUsd(pending.chars / 4 + estimateTokens(0, planned, "") * pending.n) + (upgrading ? tokenCostUsd(claudeModel(), DRAFT_TOKENS.input, DRAFT_TOKENS.output) : 0);
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
  const [legacy] = await db
    .select({ n: count() })
    .from(decisions)
    .innerJoin(posts, eq(posts.id, decisions.postId))
    .where(
      and(
        eq(posts.searchId, searchId),
        eq(decisions.codebookVersion, version),
        sql`(${decisions.question} = ${Q.relevant} or (${decisions.question} = ${Q.aboutProduct} and ${decisions.answer} <> ${QUESTION_SET}))`,
      ),
    );
  return { version, totalPosts, analyzed: totalPosts - pending.n, pending: pending.n, estimateUsd, status, message, costUsd, improved: (legacy?.n ?? 0) > 0 };
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
    where p.search_id = ${searchId} and d.question in (${Q.about}, ${Q.relevant})
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
  /** Every analyzed post falls in exactly one of these, so they add up to the posts collected. */
  relevance: { counted: number; competitors: number; chat: number; notRelevant: number; needsLook: number; skipped: number };
  /** Other brands the posts mainly talk about (competitor posts and product posts), with how writers feel about them. */
  competitors: { key: string; label: string; posts: number; positive: number; negative: number }[];
  sentiment: Tally[];
  stages: Tally[];
  segments: Tally[];
  themes: (Tally & { kind: string })[];
}

/**
 * The group of every analyzed post for one codebook version (docs/DECISIONS.md D38, D39):
 * - "product": Jev is ≥ 0.8 sure it's feedback about the subject, or you kept it. Only these get the journey.
 * - "competitor" / "chat" / "not": Jev picked that kind and leans away from product feedback (kind ≥ 0.5 and
 *   product < 0.5), or is ≥ 0.8 sure it isn't product feedback.
 * - "look": anything else, or "unclear": waits in "Needs a look". "skipped": Jev couldn't read it.
 * Your Keep/Drop wins (relevance doesn't depend on the codebook, so it applies to every version). Answers stored with
 * the older yes/no question are read the same way until the post is read again.
 */
const relevanceCte = (searchId: number, version: number) => sql`
  rel as (
    select d.post_id,
      case
        when r.human_answer = 'yes' then 'product'
        when r.human_answer = 'no' then 'not'
        when d.answer = 'skipped' then 'skipped'
        when d.question = ${Q.relevant} then
          case when d.answer = 'yes' and d.confidence >= ${COUNTED} then 'product'
               when d.answer = 'no' and d.confidence >= ${COUNTED} then 'not' else 'look' end
        when d.answer = ${ABOUT.unclear} then 'look'
        when pp.confidence >= ${COUNTED} then 'product'
        when d.answer <> ${ABOUT.product} and (pp.confidence <= ${NOT_PRODUCT} or (d.confidence >= 0.5 and pp.confidence < 0.5)) then
          case d.answer when ${ABOUT.competitor} then 'competitor' when ${ABOUT.otherBrands} then 'competitor' when ${ABOUT.chat} then 'chat' else 'not' end
        else 'look'
      end as grp
    from ${decisions} d
    join ${posts} p on p.id = d.post_id
    left join ${decisions} pp on pp.post_id = d.post_id and pp.codebook_version = d.codebook_version and pp.question = ${Q.aboutProduct}
    left join lateral (
      select human_answer from ${reviews}
      where post_id = d.post_id and question = ${Q.relevant} and kind = 'review_queue'
      order by created_at desc, id desc limit 1
    ) r on true
    where p.search_id = ${searchId} and d.codebook_version = ${version}
      and (d.question = ${Q.about} or (d.question = ${Q.relevant} and not exists (
        select 1 from ${decisions} x where x.post_id = d.post_id and x.codebook_version = d.codebook_version and x.question = ${Q.about})))
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
  const [relRes, ansRes, compRes] = await Promise.all([
    db.execute(sql`with ${relevanceCte(searchId, version)}
      select
        count(*) filter (where grp = 'product')::int as counted,
        count(*) filter (where grp = 'competitor')::int as competitors,
        count(*) filter (where grp = 'chat')::int as chat,
        count(*) filter (where grp = 'not')::int as "notRelevant",
        count(*) filter (where grp = 'look')::int as "needsLook",
        count(*) filter (where grp = 'skipped')::int as skipped
      from rel`),
    // Every other answer, only for posts that are surely about the subject.
    db.execute(sql`with ${relevanceCte(searchId, version)}
      select d.question, d.answer,
        count(*) filter (where d.confidence >= ${COUNTED})::int as counted,
        count(*) filter (where d.confidence >= ${UNCERTAIN} and d.confidence < ${COUNTED})::int as uncertain
      from ${decisions} d
      join rel on rel.post_id = d.post_id and rel.grp = 'product'
      where d.codebook_version = ${version} and d.question not in (${Q.relevant}, ${Q.about}, ${Q.aboutProduct}, ${Q.competitor}, ${Q.competitorFeeling})
      group by d.question, d.answer`),
    // Brands, from competitor posts and Smart Tank posts that compare; Jev sure (≥ 0.8) of the brand.
    db.execute(sql`with ${relevanceCte(searchId, version)}
      select b.answer as key, count(*)::int as posts,
        count(*) filter (where f.answer = 'positive' and f.confidence >= ${COUNTED})::int as positive,
        count(*) filter (where f.answer = 'negative' and f.confidence >= ${COUNTED})::int as negative
      from rel
      join ${decisions} b on b.post_id = rel.post_id and b.codebook_version = ${version} and b.question = ${Q.competitor} and b.confidence >= ${COUNTED}
      left join ${decisions} f on f.post_id = rel.post_id and f.codebook_version = ${version} and f.question = ${Q.competitorFeeling}
      where rel.grp in ('competitor', 'product') and b.answer <> ${NO_BRAND}
      group by b.answer`),
  ]);
  const relevance = relRes.rows[0] as AnalysisSummary["relevance"];
  const answers = ansRes.rows as { question: string; answer: string; counted: number; uncertain: number }[];
  const tally = (question: string, answer: string) => answers.find((a) => a.question === question && a.answer === answer) ?? { counted: 0, uncertain: 0 };
  /**
   * One answer per post, so the rows add up to the posts about the subject: each option with the posts Jev was
   * sure about, then "Not sure" for the rest (less sure answers, or none).
   */
  const oneOf = (question: string, codes: { key: string; label: string }[]): Tally[] => {
    const rows = codes.map((c) => ({ key: c.key, label: c.label, counted: tally(question, c.key).counted, uncertain: 0 }));
    const sure = rows.reduce((n, r) => n + r.counted, 0);
    return [...rows, { key: NOT_SURE, label: "Not sure", counted: Math.max(0, relevance.counted - sure), uncertain: 0 }];
  };

  const brandLabel = new Map([...(codebook.competitors ?? []).map((c) => [c.key, c.label] as const), [OTHER_BRAND, "Other brands"]]);
  const competitors = (compRes.rows as { key: string; posts: number; positive: number; negative: number }[])
    .filter((r) => brandLabel.has(r.key))
    .map((r) => ({ ...r, label: brandLabel.get(r.key)! }))
    .sort((a, b) => b.posts - a.posts);
  const stageOrder = orderOf(codebook.stages);
  const notStated = { key: NOT_STATED, label: "Not stated" };
  const hasSegments = codebook.segments.length > 0;
  return {
    version,
    codebook,
    relevance,
    competitors,
    sentiment: oneOf(Q.sentiment, SENTIMENTS),
    stages: oneOf(Q.stage, [...codebook.stages, notStated]).sort((a, b) => (stageOrder.get(a.key) ?? 99) - (stageOrder.get(b.key) ?? 99)),
    segments: hasSegments ? oneOf(Q.segment, [...[...codebook.segments].sort((a, b) => tally(Q.segment, b.key).counted - tally(Q.segment, a.key).counted), notStated]) : [],
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
  title: string;
  text: string;
  /** The video or thread it was posted under. */
  thread: string | null;
}

/** Posts Jev couldn't place (unclear, or 20–80% likely to be product feedback) that you haven't decided yet. */
export async function needsLook(searchId: number, version: number, limit = 200): Promise<LookPost[]> {
  const res = await requireDb().execute(sql`with ${relevanceCte(searchId, version)}
    select * from (
      -- The same author's same text (a repost or cross-post) is listed once; Keep/Drop applies to every copy.
      select distinct on (coalesce(p.author_hash, p.id::text), md5(p.text)) p.id, p.source, p.url, p.title, p.text,
        coalesce(p.engagement->>'thread', parent.title) as thread
      from rel join ${posts} p on p.id = rel.post_id
      left join ${posts} parent on parent.search_id = p.search_id and parent.source_id = p.parent_source_id and parent.title <> ''
      where rel.grp = 'look'
      order by coalesce(p.author_hash, p.id::text), md5(p.text), p.id
    ) t order by id limit ${limit}`);
  return res.rows as unknown as LookPost[];
}

/** Keep (about the subject) or Drop (not about it). Your answer replaces Jev's in every count. */
export async function saveReview(searchId: number, postId: number, version: number, keep: boolean): Promise<boolean> {
  const db = requireDb();
  const [own] = await db
    .select({ id: posts.id, authorHash: posts.authorHash, text: posts.text })
    .from(posts)
    .where(and(eq(posts.id, postId), eq(posts.searchId, searchId)));
  if (!own) return false;
  // Copies of the same post (same author, same text) get the same answer; posts without an author stay separate.
  const copies = own.authorHash
    ? (await db.select({ id: posts.id }).from(posts).where(and(eq(posts.searchId, searchId), eq(posts.authorHash, own.authorHash), eq(posts.text, own.text)))).map((r) => r.id)
    : [own.id];
  const answer = keep ? "yes" : "no";
  // Replace any earlier answer (one transaction). No ON CONFLICT, so it works whatever indexes the table has.
  await db.batch([
    db.delete(reviews).where(and(inArray(reviews.postId, copies), eq(reviews.question, Q.relevant), eq(reviews.kind, "review_queue"))),
    db.insert(reviews).values(copies.map((id) => ({ postId: id, codebookVersion: version, question: Q.relevant, humanAnswer: answer, kind: "review_queue" }))),
  ]);
  return true;
}
