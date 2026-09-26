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
  MAX_POST_CHARS,
  NOT_STATED,
  NO_BRAND,
  NOT_PRODUCT,
  NOT_SURE,
  OTHER_BRAND,
  OWNERSHIP,
  POST_TYPES,
  QUESTION_SET,
  orderOf,
  productKnowledge,
  Q,
  questionsFor,
  readAnswers,
  stateFor,
  themeQuestion,
  touchpointQuestion,
  UNCERTAIN,
  type Codebook,
  type PostForJev,
} from "./codebook";
import { claudeModel, tokenCostUsd } from "./ai";
import { AutoCheckError, claudeCheck } from "./auto-check";
import { CodebookError, draftCodebook, type Mistake } from "./codebook-drafter";
import { loadPlan } from "./collect";
import { paidWorkBlockedReason, recordCost } from "./cost";
import { removeDuplicatePosts } from "./posts";
import { storedFactsFor } from "./product-knowledge";

/**
 * Step 5: Jev answers the codebook's questions for every post (docs/JEV.md). Like collection, it runs as a job
 * the search page advances ~20 s at a time, so it fits Vercel Hobby limits and a closed tab just pauses it.
 * Claude only drafts the codebook; it never labels a post. Every number shown is SQL over `decisions`.
 */

export const JEV_MODEL = "typesafe-ai/jev";
const STEP = "analyze";
const BATCH = 8;
/** Posts read at once. The gateway answers 429 when busy; each call retries with back-off (maxRetries). */
const CONCURRENCY = 4;
const MAX_ATTEMPTS = 3;
const STALE_RUNNING_SECONDS = 120;
const SAMPLE_SIZE = 60;
/** How much of the comment or post a reply answers is read with it. */
const REPLY_CHARS = 600;
/** Tokens for drafting a codebook (60 posts × 800 characters plus instructions; the answer), rounded up. */
const DRAFT_TOKENS = { input: 16_000, output: 3_000 };

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

/** Posts (`p`) of the search that have no answers yet for this codebook version. */
const pendingWhere = (searchId: number, version: number) =>
  sql`p.search_id = ${searchId} and not exists (
    select 1 from ${decisions} d where d.post_id = p.id and d.codebook_version = ${version}
      and d.question = ${Q.aboutProduct} and d.answer = ${QUESTION_SET})`;

/** Posts still to read, and the characters Jev will get for them (post and title, plus what a reply answers). */
async function pendingStats(searchId: number, version: number): Promise<{ n: number; chars: number }> {
  const res = await requireDb().execute(sql`
    select count(*)::int as n, coalesce(sum(least(length(t.text) + length(t.title), ${MAX_POST_CHARS}) + coalesce(length(t."replyingTo"), 0)), 0) as chars
    from (select p.text, p.title, ${contextColumns} from ${posts} p ${contextJoins} where ${pendingWhere(searchId, version)}) t`);
  const row = res.rows[0] as { n: number; chars: string } | undefined;
  return { n: Number(row?.n ?? 0), chars: Number(row?.chars ?? 0) };
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
  if (current && !missingLists(current.codebook) && (await pendingStats(searchId, current.version)).n === 0) {
    return { started: false, reason: "Every post is already analyzed with this codebook." };
  }

  // Taken before drafting, so a second click or tab can't draft (and pay) again or start a second run.
  const jobId = await reserve(searchId);
  if (jobId === null) return { started: false, reason: "Analysis is already running for this search." };
  let drafted = false;
  try {
    if (!current) {
      try {
        // The family's product knowledge (D45) shapes the draft and goes with every post.
        const { productFacts, productNotes } = await storedFactsFor(searchId);
        const { codebook: draft, cost } = await draftCodebook(plan.plan, await sampleOf(searchId), undefined, { productFacts, productNotes });
        await recordCost({ searchId, ...cost });
        const codebook = { ...draft, ...(productFacts.length ? { productFacts } : {}), ...(productNotes ? { productNotes } : {}) };
        current = { version: await saveCodebook(searchId, codebook), codebook };
        drafted = true;
      } catch (err) {
        if (err instanceof CodebookError && err.cost) await recordCost({ searchId, ...err.cost }).catch(() => undefined);
        throw err;
      }
    } else if (missingLists(current.codebook)) {
      // Drafted before competitors (D39) or touchpoints (D42) existed: add Claude's lists from a sample, keep
      // everything else as it is (lists you already have are never replaced).
      const keep = current.codebook;
      try {
        const { codebook, cost } = await draftCodebook(plan.plan, await sampleOf(searchId));
        await recordCost({ searchId, ...cost });
        const merged = { ...keep, competitors: keep.competitors ?? codebook.competitors ?? [], touchpoints: keep.touchpoints ?? codebook.touchpoints ?? [] };
        current = { version: await saveCodebook(searchId, merged), codebook: merged };
      } catch (err) {
        if (err instanceof CodebookError && err.cost) await recordCost({ searchId, ...err.cost }).catch(() => undefined);
        // Without the lists the analysis still runs; competitor posts are grouped, just not by brand.
        const merged = { ...keep, competitors: keep.competitors ?? [], touchpoints: keep.touchpoints ?? [] };
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

/** A codebook saved before competitors (D39) or touchpoints (D42) existed gets those lists drafted first. */
const missingLists = (c: Codebook) => c.competitors === undefined || c.touchpoints === undefined;

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

/** What a comment is read with: the video or thread it's under, and what it answers (see `contextColumns`). */
const contextJoins = sql`
  left join ${posts} parent on parent.search_id = p.search_id and parent.source = p.source and parent.source_id = p.parent_source_id
  left join ${posts} answered on answered.search_id = p.search_id and answered.source = p.source and answered.source_id = p.engagement->>'replyTo'`;

/**
 * `thread`: the video or thread title. `names`: the catalog products the post names. `replyingTo`: the comment a reply answers, or for a top-level Reddit comment
 * the post it answers (cut short). Replies collected before replies were linked (no `replyTo`, depth above 0) get
 * none rather than the wrong one.
 */
const contextColumns = sql`coalesce(p.engagement->>'thread', nullif(parent.title, '')) as thread,
  left(case when p.engagement ? 'replyTo' then answered.text when p.engagement->>'depth' = '0' then nullif(parent.text, '') end, ${REPLY_CHARS}) as "replyingTo",
  (select string_agg(distinct n.name, ', ') from ${postProducts} pp join ${catalogNodes} n on n.id = pp.node_id where pp.post_id = p.id) as names`;

/** The next posts to read, with their context: the video or thread, what they reply to, and the catalog products they name. */
async function pendingBatch(searchId: number, version: number): Promise<(PostForJev & { id: number })[]> {
  const res = await requireDb().execute(sql`
    select p.id, p.source, p.title, p.text, p.parent_source_id is not null as "isComment",
      ${contextColumns}
    from ${posts} p
    ${contextJoins}
    where ${pendingWhere(searchId, version)}
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
  if (missingLists(cb.codebook as Codebook)) {
    // A run queued or resumed on a codebook from before competitors: reading now would miss the competitor questions
    // and cost a second full read later. Analyze adds the list first (like an interrupted draft: back to "Analyze").
    await requireDb()
      .update(jobs)
      .set({ status: "failed", lastError: "The questions were updated. Press Analyze to continue.", cursor: { codebookVersion: 0 } satisfies Cursor })
      .where(eq(jobs.id, job.id));
    return analysisState(searchId);
  }
  const questions = questionsFor(cb.codebook as Codebook, plan.plan.subject);
  const productNotes = productKnowledge(cb.codebook as Codebook) || null;

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
                const result = await evaluate({ model: JEV_MODEL, state: stateFor({ ...post, productNotes }), questions, maxRetries: 3, abortSignal: AbortSignal.timeout(30_000) });
                inputTokens += result.usage.inputTokens ?? estimateTokens(post.text.length + post.title.length + (post.replyingTo?.length ?? 0), cb.codebook as Codebook, plan.plan.subject);
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
    // Questions are unknown until the codebook exists; a typical one adds about 900 tokens per post, plus the
    // family's product knowledge, which the first codebook starts with (D45).
    const facts = productKnowledge(await storedFactsFor(searchId).catch(() => ({}))).length / 4;
    const jev = jevUsd(Number(chars) / 4 + (900 + facts) * totalPosts);
    const draft = tokenCostUsd(claudeModel(), DRAFT_TOKENS.input, DRAFT_TOKENS.output);
    return { version: null, totalPosts, analyzed: 0, pending: totalPosts, estimateUsd: jev + draft, status: open ? "running" : "none", message: lastJob?.status === "failed" ? lastJob.lastError : null, costUsd, improved: false };
  }
  // A run in progress is measured against the codebook it is using, even if a newer one was saved meanwhile.
  const running = open && jobVersion > 0;
  const version = running ? jobVersion : current.version;
  const pending = await pendingStats(searchId, version);
  // A codebook from before competitors gets a list drafted first (one Claude call) and two more questions per post.
  const upgrading = missingLists(current.codebook) && !running;
  const placeholder = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `item_${i}`, label: "Item name", definition: "What a post must mention." }));
  const planned: Codebook = upgrading
    ? { ...current.codebook, competitors: current.codebook.competitors ?? placeholder(5), touchpoints: current.codebook.touchpoints ?? placeholder(6) }
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

/**
 * The catalog products whose mention makes a post count (D41): the search's pick (a model, or a series and its
 * models); any product in the catalog for a family-wide or typed search (null).
 */
async function namedNodeIds(searchId: number): Promise<number[] | null> {
  const plan = await loadPlan(searchId);
  const nodeId = plan?.plan.target?.nodeId ?? null;
  if (!nodeId) return null;
  const rows = await requireDb()
    .select({ id: catalogNodes.id })
    .from(catalogNodes)
    .where(sql`${catalogNodes.id} = ${nodeId} or ${catalogNodes.parentId} = ${nodeId}`);
  return rows.map((r) => r.id);
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
  /** Each theme with how serious its problems are on average (severity 0–4, from posts sure to mention it). */
  themes: (Tally & { kind: string; severity: number | null })[];
  /** Touchpoints (D42): posts that use or deal with each, and how many of those are complaints. */
  touchpoints: (Tally & { complaints: number })[];
  /** D41 journey anchors; empty when the results were read before these questions existed. */
  postTypes: Tally[];
  ownership: Tally[];
  /** Posts about the subject that Jev is sure describe the writer's own experience, and sure that they don't. */
  firstHand: { yes: number; no: number };
  /** Would-recommend, from the 0–4 score: against (< 1.5), no clear view, for (> 2.5). */
  recommend: { against: number; neutral: number; for: number } | null;
  /** The journey map: posts per stage × post type (both answers sure). */
  grid: { stage: string; type: string; n: number }[];
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
const relevanceCte = (searchId: number, version: number, named: number[] | null) => sql`
  rel as (
    select d.post_id,
      case
        when r.human_answer = 'yes' then 'product'
        when r.human_answer = 'no' then 'not'
        when d.answer = 'skipped' then 'skipped'
        -- D41: a post that names the product (catalog match in its title or text) is about it, unless Jev is sure
        -- it's only chat or off-topic.
        when pp.answer = ${QUESTION_SET}
          and exists (select 1 from ${postProducts} named where named.post_id = d.post_id${
            // The pick was removed from the catalog: nothing counts as "named" (never an empty "in ()").
            named ? (named.length ? sql` and named.node_id in (${sql.join(named.map((id) => sql`${id}`), sql`, `)})` : sql` and false`) : sql``
          })
          and not (d.answer in (${ABOUT.chat}, ${ABOUT.offTopic}) and d.confidence >= ${COUNTED}) then 'product'
        when d.question = ${Q.relevant} then
          case when d.answer = 'yes' and d.confidence >= ${COUNTED} then 'product'
               when d.answer = 'no' and d.confidence >= ${COUNTED} then 'not' else 'look' end
        when d.answer = ${ABOUT.unclear} then 'look'
        when pp.confidence >= ${COUNTED} then 'product'
        when d.answer <> ${ABOUT.product} and (pp.confidence <= ${NOT_PRODUCT} or (d.confidence >= 0.5 and pp.confidence < ${LEANS_AWAY})) then
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

/** Below this likelihood of being about the subject, a post Jev placed in another group goes there without a look. */
const LEANS_AWAY = 0.35;

const SENTIMENTS = [
  { key: "positive", label: "Positive" },
  { key: "negative", label: "Negative" },
  { key: "mixed", label: "Mixed" },
  { key: "neutral", label: "Neutral" },
];

export async function analysisSummary(searchId: number, version: number): Promise<AnalysisSummary | null> {
  const db = requireDb();
  const named = await namedNodeIds(searchId);
  const [cb] = await db.select().from(codebooks).where(and(eq(codebooks.searchId, searchId), eq(codebooks.version, version)));
  if (!cb) return null;
  const codebook = cb.codebook as Codebook;
  const [relRes, ansRes, compRes, gridRes, sevRes, recRes, touchRes] = await Promise.all([
    db.execute(sql`with ${relevanceCte(searchId, version, named)}
      select
        count(*) filter (where grp = 'product')::int as counted,
        count(*) filter (where grp = 'competitor')::int as competitors,
        count(*) filter (where grp = 'chat')::int as chat,
        count(*) filter (where grp = 'not')::int as "notRelevant",
        count(*) filter (where grp = 'look')::int as "needsLook",
        count(*) filter (where grp = 'skipped')::int as skipped
      from rel`),
    // Every other answer, only for posts that are surely about the subject.
    db.execute(sql`with ${relevanceCte(searchId, version, named)}
      select d.question, d.answer,
        count(*) filter (where d.confidence >= ${COUNTED})::int as counted,
        count(*) filter (where d.confidence >= ${UNCERTAIN} and d.confidence < ${COUNTED})::int as uncertain
      from ${decisions} d
      join rel on rel.post_id = d.post_id and rel.grp = 'product'
      where d.codebook_version = ${version}
        and d.question not in (${Q.relevant}, ${Q.about}, ${Q.aboutProduct}, ${Q.competitor}, ${Q.competitorFeeling}, ${Q.severity}, ${Q.recommend})
      group by d.question, d.answer`),
    // Brands, from competitor posts and Smart Tank posts that compare; Jev sure (≥ 0.8) of the brand.
    db.execute(sql`with ${relevanceCte(searchId, version, named)}
      select b.answer as key, count(*)::int as posts,
        count(*) filter (where f.answer = 'positive' and f.confidence >= ${COUNTED})::int as positive,
        count(*) filter (where f.answer = 'negative' and f.confidence >= ${COUNTED})::int as negative
      from rel
      join ${decisions} b on b.post_id = rel.post_id and b.codebook_version = ${version} and b.question = ${Q.competitor} and b.confidence >= ${COUNTED}
      left join ${decisions} f on f.post_id = rel.post_id and f.codebook_version = ${version} and f.question = ${Q.competitorFeeling}
      where rel.grp in ('competitor', 'product') and b.answer <> ${NO_BRAND}
      group by b.answer`),
    // The journey map: stage × post type, both sure.
    db.execute(sql`with ${relevanceCte(searchId, version, named)}
      select s.answer as stage, t.answer as type, count(*)::int as n
      from rel
      join ${decisions} s on s.post_id = rel.post_id and s.codebook_version = ${version} and s.question = ${Q.stage} and s.confidence >= ${COUNTED}
      join ${decisions} t on t.post_id = rel.post_id and t.codebook_version = ${version} and t.question = ${Q.postType} and t.confidence >= ${COUNTED}
      where rel.grp = 'product'
      group by 1, 2`),
    // Average severity per theme, over posts sure to mention it.
    db.execute(sql`with ${relevanceCte(searchId, version, named)}
      select th.question, round(avg(sv.answer::numeric), 2)::float as severity
      from rel
      join ${decisions} th on th.post_id = rel.post_id and th.codebook_version = ${version} and th.question like 'theme:%' and th.answer = 'yes' and th.confidence >= ${COUNTED}
      join ${decisions} sv on sv.post_id = rel.post_id and sv.codebook_version = ${version} and sv.question = ${Q.severity}
      where rel.grp = 'product'
      group by th.question`),
    db.execute(sql`with ${relevanceCte(searchId, version, named)}
      select count(*) filter (where r.answer::numeric < 1.5)::int as against,
        count(*) filter (where r.answer::numeric between 1.5 and 2.5)::int as neutral,
        count(*) filter (where r.answer::numeric > 2.5)::int as "for"
      from rel join ${decisions} r on r.post_id = rel.post_id and r.codebook_version = ${version} and r.question = ${Q.recommend}
      where rel.grp = 'product'`),
    // Complaints per touchpoint: posts sure to mention it that are complaints (both sure).
    db.execute(sql`with ${relevanceCte(searchId, version, named)}
      select tp.question, count(*)::int as complaints
      from rel
      join ${decisions} tp on tp.post_id = rel.post_id and tp.codebook_version = ${version} and tp.question like 'touch:%' and tp.answer = 'yes' and tp.confidence >= ${COUNTED}
      join ${decisions} ty on ty.post_id = rel.post_id and ty.codebook_version = ${version} and ty.question = ${Q.postType} and ty.answer = 'complaint' and ty.confidence >= ${COUNTED}
      where rel.grp = 'product'
      group by tp.question`),
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
  const severity = new Map((sevRes.rows as { question: string; severity: number }[]).map((r) => [r.question, Number(r.severity)]));
  const asked = (question: string) => answers.some((a) => a.question === question);
  const recommendation = recRes.rows[0] as { against: number; neutral: number; for: number };
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
      .map((t) => ({ key: t.key, label: t.label, kind: t.kind, ...pick(tally(themeQuestion(t.key), "yes")), severity: severity.get(themeQuestion(t.key)) ?? null }))
      .sort((a, b) => b.counted - a.counted || b.uncertain - a.uncertain),
    touchpoints: (codebook.touchpoints ?? [])
      .map((t) => ({
        key: t.key,
        label: t.label,
        ...pick(tally(touchpointQuestion(t.key), "yes")),
        complaints: Number((touchRes.rows as { question: string; complaints: number }[]).find((r) => r.question === touchpointQuestion(t.key))?.complaints ?? 0),
      }))
      .sort((a, b) => b.counted - a.counted || b.uncertain - a.uncertain),
    postTypes: asked(Q.postType) ? oneOf(Q.postType, [...POST_TYPES, { key: "other", label: "Other" }]) : [],
    ownership: asked(Q.ownership) ? oneOf(Q.ownership, [...OWNERSHIP, notStated]) : [],
    firstHand: { yes: tally(Q.firstHand, "yes").counted, no: tally(Q.firstHand, "no").counted },
    // Scores aren't in `answers` (they're read above), so "asked" is whether any post has one.
    recommend: recommendation.against + recommendation.neutral + recommendation.for > 0 ? recommendation : null,
    grid: gridRes.rows as { stage: string; type: string; n: number }[],
  };
}
const pick = (t: { counted: number; uncertain: number }) => ({ counted: t.counted, uncertain: t.uncertain });

/** A post quoted in a journey cell: word for word, with where it's from and how many people liked it. */
export interface CellQuote {
  stage: string;
  type: string;
  id: number;
  text: string;
  source: string;
  url: string | null;
  likes: number;
  postedAt: string | null;
}

/**
 * The most-liked posts of each journey cell (stage × post type, both answers sure, posts about the subject), up to
 * `perCell` each, quoted verbatim by post id (never rewritten).
 */
export async function journeyQuotes(searchId: number, version: number, perCell = 3): Promise<CellQuote[]> {
  const named = await namedNodeIds(searchId);
  const res = await requireDb().execute(sql`with ${relevanceCte(searchId, version, named)},
    cells as (
      select s.answer as stage, t.answer as type, p.id, p.text, p.source, p.url, p.posted_at,
        coalesce((p.engagement->>'likes')::int, (p.engagement->>'score')::int, 0) as likes,
        row_number() over (partition by s.answer, t.answer
          order by coalesce((p.engagement->>'likes')::int, (p.engagement->>'score')::int, 0) desc, p.id) as rank
      from rel
      join ${posts} p on p.id = rel.post_id
      join ${decisions} s on s.post_id = rel.post_id and s.codebook_version = ${version} and s.question = ${Q.stage} and s.confidence >= ${COUNTED}
      join ${decisions} t on t.post_id = rel.post_id and t.codebook_version = ${version} and t.question = ${Q.postType} and t.confidence >= ${COUNTED}
      where rel.grp = 'product'
    )
    select stage, type, id, text, source, url, posted_at as "postedAt", likes from cells where rank <= ${perCell}
    order by stage, type, rank`);
  return (res.rows as unknown as CellQuote[]).map((q) => ({
    ...q,
    id: Number(q.id),
    likes: Number(q.likes),
    postedAt: q.postedAt ? new Date(q.postedAt).toISOString() : null,
  }));
}

// ---- Needs a look ----------------------------------------------------------------------------------------------

export interface LookPost {
  id: number;
  source: string;
  url: string | null;
  title: string;
  text: string;
  /** The video or thread it was posted under. */
  thread: string | null;
  /** What it answers, when it's a reply. */
  replyingTo: string | null;
  /** Catalog products it names. */
  names: string | null;
}

/** Posts Jev couldn't place (unclear, or 20–80% likely to be product feedback) that you haven't decided yet. */
export async function needsLook(searchId: number, version: number, limit = 200): Promise<LookPost[]> {
  const named = await namedNodeIds(searchId);
  const res = await requireDb().execute(sql`with ${relevanceCte(searchId, version, named)}
    select * from (
      -- The same author's same text (a repost or cross-post) is listed once; Keep/Drop applies to every copy.
      select distinct on (coalesce(p.author_hash, p.id::text), md5(p.text)) p.id, p.source, p.url, p.title, p.text,
        ${contextColumns}
      from rel join ${posts} p on p.id = rel.post_id
      ${contextJoins}
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

// ---- Spot-check: how right is Jev? (docs/EVALUATION.md §1, D40) -------------------------------------------------

export const SPOT_CHECK_SIZE = 20;
/** Claude's answers in the reviews table (kind), next to yours ("spot_check"). */
const CLAUDE_CHECK = "claude_check";
/** The questions the check covers besides themes. */
const CHECKED = [Q.sentiment, Q.stage, Q.segment, Q.postType, Q.ownership];

export interface CheckAnswer {
  answer: string;
  confidence: number;
}

export interface CheckItem {
  id: number;
  source: string;
  url: string | null;
  title: string;
  text: string;
  thread: string | null;
  replyingTo: string | null;
  names: string | null;
  /** Jev's answers: sentiment, stage, segment, and per theme yes/no. */
  jev: Record<string, CheckAnswer>;
  /** Your answers when this post has been checked. */
  person: Record<string, string> | null;
  /** Claude's answers when the auto-check ran. */
  claude: Record<string, string> | null;
}

/**
 * The same 20 posts about the subject every time for a codebook version (a stable random order), with Jev's answers
 * and yours. Only counted posts: the spot-check measures what the report is built on.
 */
export async function spotCheckItems(searchId: number, version: number): Promise<CheckItem[]> {
  const db = requireDb();
  const named = await namedNodeIds(searchId);
  const res = await db.execute(sql`with ${relevanceCte(searchId, version, named)}
    select p.id, p.source, p.url, p.title, p.text, ${contextColumns}
    from rel join ${posts} p on p.id = rel.post_id
    ${contextJoins}
    where rel.grp = 'product'
    order by md5(p.id::text || '-' || ${version}::text)
    limit ${SPOT_CHECK_SIZE}`);
  const rows = res.rows as unknown as Omit<CheckItem, "jev" | "person">[];
  if (rows.length === 0) return [];
  const ids = rows.map((r) => Number(r.id));
  const [answers, checks] = await Promise.all([
    db
      .select({ postId: decisions.postId, question: decisions.question, answer: decisions.answer, confidence: decisions.confidence })
      .from(decisions)
      .where(and(inArray(decisions.postId, ids), eq(decisions.codebookVersion, version))),
    db
      .select({ postId: reviews.postId, question: reviews.question, answer: reviews.humanAnswer, kind: reviews.kind })
      .from(reviews)
      .where(and(inArray(reviews.postId, ids), eq(reviews.codebookVersion, version), inArray(reviews.kind, ["spot_check", CLAUDE_CHECK]))),
  ]);
  const checkedQuestions = new Set<string>(CHECKED);
  return rows.map((r) => {
    const id = Number(r.id);
    const jev = Object.fromEntries(
      answers
        .filter((a) => a.postId === id && (checkedQuestions.has(a.question) || a.question.startsWith("theme:")))
        .map((a) => [a.question, { answer: a.answer, confidence: a.confidence }]),
    );
    const by = (kind: string) => {
      const rows = checks.filter((c) => c.postId === id && c.kind === kind);
      return rows.length ? Object.fromEntries(rows.map((c) => [c.question, c.answer])) : null;
    };
    return { ...r, id, jev, person: by("spot_check"), claude: by(CLAUDE_CHECK) };
  });
}

/** Saves your answers for one spot-check post (replacing earlier ones). Only questions the codebook asks are kept. */
export async function saveSpotCheck(searchId: number, version: number, postId: number, answers: Record<string, string>): Promise<boolean> {
  const db = requireDb();
  const [[own], [cb]] = await Promise.all([
    db.select({ id: posts.id }).from(posts).where(and(eq(posts.id, postId), eq(posts.searchId, searchId))),
    db.select().from(codebooks).where(and(eq(codebooks.searchId, searchId), eq(codebooks.version, version))),
  ]);
  if (!own || !cb) return false;
  const codebook = cb.codebook as Codebook;
  const allowed: Record<string, string[]> = {
    [Q.sentiment]: ["positive", "negative", "mixed", "neutral"],
    [Q.stage]: [...codebook.stages.map((s) => s.key), NOT_STATED],
    ...(codebook.segments.length ? { [Q.segment]: [...codebook.segments.map((s) => s.key), NOT_STATED] } : {}),
    [Q.postType]: [...POST_TYPES.map((t) => t.key), "other"],
    [Q.ownership]: [...OWNERSHIP.map((o) => o.key), NOT_STATED],
    ...Object.fromEntries(codebook.themes.map((t) => [themeQuestion(t.key), ["yes", "no"]])),
  };
  const rows = Object.entries(answers)
    .filter(([q, a]) => allowed[q]?.includes(a))
    .map(([question, humanAnswer]) => ({ postId, codebookVersion: version, question, humanAnswer, kind: "spot_check" }));
  await db.batch([
    db.delete(reviews).where(and(eq(reviews.postId, postId), eq(reviews.codebookVersion, version), eq(reviews.kind, "spot_check"))),
    ...(rows.length ? [db.insert(reviews).values(rows)] : []),
  ]);
  return true;
}

export interface Accuracy {
  /** Posts checked by you or by Claude. */
  checked: number;
  /** Posts you checked yourself. */
  byYou: number;
  /**
   * Per question: of Jev's sure answers (≥ 0.8) that were checked, how many the judge agreed with (you where you
   * answered, Claude otherwise); the less sure ones; and Claude-vs-Jev disagreements still waiting for you.
   */
  questions: { key: string; label: string; sure: number; right: number; notSure: number; open: number }[];
}

/** The judge per post and question: your answer when you gave one, otherwise Claude's. */
const judgeCte = (searchId: number, version: number, sample: number[]) => sql`
  judge as (
    select distinct on (r.post_id, r.question) r.post_id, r.question, r.human_answer, r.kind
    from ${reviews} r join ${posts} p on p.id = r.post_id
    where p.search_id = ${searchId} and r.codebook_version = ${version} and r.kind in ('spot_check', ${CLAUDE_CHECK})
      and r.post_id in (${sql.join([0, ...sample].map((id) => sql`${id}`), sql`, `)})
    order by r.post_id, r.question, (r.kind = 'spot_check') desc
  )`;

/** Agreement between Jev's answers and the judge's, per question (themes pooled: every yes/no call counts). */
export async function spotCheckAccuracy(searchId: number, version: number): Promise<Accuracy> {
  // Only the current sample: posts that left it (new posts, a Keep or Drop) no longer count.
  const sample = (await spotCheckItems(searchId, version)).map((i) => i.id);
  const res = await requireDb().execute(sql`with ${judgeCte(searchId, version, sample)}
    select case when j.question like 'theme:%' then 'themes' else j.question end as key,
      count(*) filter (where d.confidence >= ${COUNTED})::int as sure,
      count(*) filter (where d.confidence >= ${COUNTED} and d.answer = j.human_answer)::int as "right",
      count(*) filter (where d.confidence < ${COUNTED})::int as "notSure",
      count(*) filter (where j.kind = ${CLAUDE_CHECK} and d.confidence >= ${COUNTED} and d.answer <> j.human_answer)::int as open,
      count(distinct j.post_id)::int as posts,
      count(distinct j.post_id) filter (where j.kind = 'spot_check')::int as "byYou"
    from judge j
    join ${decisions} d on d.post_id = j.post_id and d.codebook_version = ${version} and d.question = j.question
    group by 1`);
  const rows = res.rows as { key: string; sure: number; right: number; notSure: number; open: number; posts: number; byYou: number }[];
  const labels: Record<string, string> = {
    stage: "Journey stage",
    sentiment: "Sentiment",
    post_type: "What people do",
    ownership: "How long they've had it",
    segment: "Who is posting",
    themes: "Themes (each yes/no)",
  };
  return {
    checked: Math.max(0, ...rows.map((r) => r.posts)),
    byYou: Math.max(0, ...rows.map((r) => r.byYou)),
    questions: ["stage", "sentiment", "post_type", "ownership", "themes", "segment"]
      .map((key) => rows.find((r) => r.key === key))
      .filter((r) => r !== undefined)
      .map((r) => ({ key: r.key, label: labels[r.key], sure: r.sure, right: r.right, notSure: r.notSure, open: r.open })),
  };
}

/** Runs Claude's check on the 20 sample posts (a few cents) and stores its answers next to yours. */
export async function runAutoCheck(searchId: number): Promise<{ posts: number }> {
  const db = requireDb();
  const version = await resultsVersion(searchId);
  const plan = await loadPlan(searchId);
  if (!version || !plan) throw new Error("Analyze the posts first.");
  const [cb] = await db.select().from(codebooks).where(and(eq(codebooks.searchId, searchId), eq(codebooks.version, version)));
  const items = await spotCheckItems(searchId, version);
  if (!cb || items.length === 0) throw new Error("No posts about the subject to check yet.");
  let result;
  try {
    result = await claudeCheck(plan.plan.subject, cb.codebook as Codebook, items);
  } catch (err) {
    if (err instanceof AutoCheckError && err.cost) await recordCost({ searchId, ...err.cost }).catch(() => undefined);
    throw err;
  }
  await recordCost({ searchId, ...result.cost });
  const rows = [...result.answers].flatMap(([postId, answers]) =>
    Object.entries(answers).map(([question, humanAnswer]) => ({ postId, codebookVersion: version, question, humanAnswer, kind: CLAUDE_CHECK })),
  );
  await db.batch([
    db.delete(reviews).where(and(inArray(reviews.postId, items.map((i) => i.id)), eq(reviews.codebookVersion, version), eq(reviews.kind, CLAUDE_CHECK))),
    ...(rows.length ? [db.insert(reviews).values(rows)] : []),
  ]);
  return { posts: result.answers.size };
}

/** Where Jev and you disagree, in words, for Claude to improve the definitions. */
export async function spotCheckMistakes(searchId: number, version: number, codebook: Codebook): Promise<Mistake[]> {
  const sample = (await spotCheckItems(searchId, version)).map((i) => i.id);
  const res = await requireDb().execute(sql`with ${judgeCte(searchId, version, sample)}
    select p.text, j.question, d.answer as jev, j.human_answer as person
    from judge j
    join ${posts} p on p.id = j.post_id
    join ${decisions} d on d.post_id = j.post_id and d.codebook_version = ${version} and d.question = j.question
    where d.answer <> j.human_answer
    limit 60`);
  const name = new Map<string, string>([
    ...[...codebook.stages, ...codebook.segments, ...codebook.themes].map((c) => [c.key, c.label] as const),
    [NOT_STATED, "not stated"],
  ]);
  const question = (q: string) =>
    q === Q.stage
      ? "journey stage"
      : q === Q.segment
        ? "who is posting"
        : q === Q.sentiment
          ? "sentiment"
          : q === Q.postType
            ? "what the post does"
            : q === Q.ownership
              ? "how long they've had it"
              : `theme “${name.get(q.slice(6)) ?? q.slice(6)}”`;
  return (res.rows as { text: string; question: string; jev: string; person: string }[]).map((m) => ({
    post: m.text,
    question: question(m.question),
    jev: name.get(m.jev) ?? m.jev,
    person: name.get(m.person) ?? m.person,
  }));
}

/**
 * Claude's revised codebook: sharper definitions with "counts when / not when" and real examples, drafted from posts
 * about the subject and fixing the spot-check's mistakes. Returned as a proposal; nothing changes until you save it.
 */
export async function proposeCodebook(searchId: number): Promise<{ codebook: Codebook; mistakes: number }> {
  const db = requireDb();
  const version = await resultsVersion(searchId);
  const current = await latestCodebook(searchId);
  const plan = await loadPlan(searchId);
  if (!current || !plan) throw new Error("Analyze the posts first.");
  // Mistakes are named with the codebook they were made with (results may still be on an older version).
  const [checked] = version ? await db.select().from(codebooks).where(and(eq(codebooks.searchId, searchId), eq(codebooks.version, version))) : [];
  const mistakes = version && checked ? await spotCheckMistakes(searchId, version, checked.codebook as Codebook) : [];
  const named = await namedNodeIds(searchId);
  // Posts about the subject when there are enough; otherwise any posts.
  const about = version
    ? await db.execute(sql`with ${relevanceCte(searchId, version, named)}
        select p.source, p.text from rel join ${posts} p on p.id = rel.post_id where rel.grp = 'product' order by random() limit ${SAMPLE_SIZE}`)
    : null;
  const sample = about && about.rows.length >= 20 ? (about.rows as { source: string; text: string }[]) : await sampleOf(searchId);
  try {
    const { codebook, cost } = await draftCodebook(plan.plan, sample, { current: current.codebook, mistakes });
    await recordCost({ searchId, ...cost });
    // Your notes and the official facts are kept as they are: Claude reads them but never rewrites or drops them.
    const { productNotes, productFacts } = current.codebook;
    return { codebook: { ...codebook, ...(productNotes ? { productNotes } : {}), ...(productFacts?.length ? { productFacts } : {}) }, mistakes: mistakes.length };
  } catch (err) {
    if (err instanceof CodebookError && err.cost) await recordCost({ searchId, ...err.cost }).catch(() => undefined);
    throw err;
  }
}
