/**
 * Apify, via the official `apify-client`. Runs are started and then polled (never awaited inside one request),
 * so long scrapes fit Vercel Hobby limits. The Amazon mapping lands once the actor is confirmed
 * (docs/DECISIONS.md Q5); this module is actor-agnostic.
 */
import { ApifyClient } from "apify-client";

import { ConnectorError, type CallCost } from "./types";

function client(token: string | undefined): ApifyClient {
  if (!token) throw new ConnectorError("apify", "APIFY_TOKEN is not set");
  return new ApifyClient({ token, maxRetries: 2 });
}

export interface ApifyAccount {
  username: string;
  monthlyUsageUsd: number | null;
  monthlyLimitUsd: number | null;
  cycleEndsAt: string | null;
}

/** Validates the token and reports this month's Apify usage (free). */
export async function account(token: string | undefined): Promise<ApifyAccount> {
  const me = client(token).user("me");
  const [user, limits] = await Promise.all([me.get(), me.limits().catch(() => undefined)]);
  return {
    username: user.username,
    monthlyUsageUsd: limits?.current?.monthlyUsageUsd ?? null,
    monthlyLimitUsd: limits?.limits?.maxMonthlyUsageUsd ?? null,
    cycleEndsAt: limits?.monthlyUsageCycle?.endAt ? new Date(limits.monthlyUsageCycle.endAt).toISOString() : null,
  };
}

export interface ActorInfo {
  id: string;
  title: string;
  /** Top-level input fields from the actor's input schema, for checking what the actor expects. */
  inputFields: { name: string; type?: string; required: boolean; title?: string }[];
}

interface InputSchema {
  properties?: Record<string, { type?: string; title?: string }>;
  required?: string[];
}

export function parseInputSchema(schema: unknown): ActorInfo["inputFields"] {
  const s = (typeof schema === "string" ? JSON.parse(schema) : schema) as InputSchema | null;
  const required = new Set(s?.required ?? []);
  return Object.entries(s?.properties ?? {}).map(([name, p]) => ({ name, type: p.type, title: p.title, required: required.has(name) }));
}

/** Reads an actor's latest build input schema (free). */
export async function actorInfo(token: string | undefined, actorId: string): Promise<ActorInfo> {
  const c = client(token);
  const actor = await c.actor(actorId).get();
  if (!actor) throw new ConnectorError("apify", `actor ${actorId} not found`, 404);
  const buildId = actor.taggedBuilds?.latest?.buildId;
  const build = buildId ? await c.build(buildId).get() : undefined;
  const schema = build?.actorDefinition?.input ?? build?.inputSchema ?? null;
  return { id: actor.id, title: actor.title ?? actor.name, inputFields: schema ? parseInputSchema(schema) : [] };
}

export type RunStatus = "READY" | "RUNNING" | "SUCCEEDED" | "FAILED" | "ABORTING" | "ABORTED" | "TIMING-OUT" | "TIMED-OUT";

export interface RunState {
  runId: string;
  status: RunStatus;
  datasetId: string;
  usd: number;
  finished: boolean;
}

type ApifyRun = Awaited<ReturnType<ReturnType<ApifyClient["run"]>["get"]>> & object;

/**
 * Total charge for a run: platform usage plus the actor's own price, which usageTotalUsd does not include
 * for pay-per-event (charged events x event price) and pay-per-result (dataset items x unit price) actors.
 */
export function runChargeUsd(run: Pick<ApifyRun, "usageTotalUsd" | "pricingInfo" | "chargedEventCounts">, datasetItems = 0): number {
  let usd = run.usageTotalUsd ?? 0;
  const pricing = run.pricingInfo;
  if (pricing?.pricingModel === "PAY_PER_EVENT") {
    const events = pricing.pricingPerEvent.actorChargeEvents;
    for (const [name, count] of Object.entries(run.chargedEventCounts ?? {})) usd += count * (events[name]?.eventPriceUsd ?? 0);
  } else if (pricing?.pricingModel === "PRICE_PER_DATASET_ITEM") {
    usd += datasetItems * pricing.pricePerUnitUsd;
  }
  return usd;
}

function toState(run: ApifyRun, datasetItems = 0): RunState {
  return {
    runId: run.id,
    status: run.status as RunStatus,
    datasetId: run.defaultDatasetId,
    usd: runChargeUsd(run, datasetItems),
    finished: !["READY", "RUNNING", "ABORTING", "TIMING-OUT"].includes(run.status),
  };
}

/** Starts a run with hard caps on items and spend, and returns immediately. */
export async function startRun(
  token: string | undefined,
  actorId: string,
  input: unknown,
  caps: { maxItems: number; maxTotalChargeUsd: number; timeoutSecs?: number },
): Promise<RunState> {
  const run = await client(token)
    .actor(actorId)
    .start(input, { maxItems: caps.maxItems, maxTotalChargeUsd: caps.maxTotalChargeUsd, timeout: caps.timeoutSecs ?? 600 });
  return toState(run);
}

export async function getRun(token: string | undefined, runId: string): Promise<RunState> {
  const c = client(token);
  const run = await c.run(runId).get();
  if (!run) throw new ConnectorError("apify", `run ${runId} not found`, 404);
  const items =
    run.pricingInfo?.pricingModel === "PRICE_PER_DATASET_ITEM" ? ((await c.dataset(run.defaultDatasetId).get())?.itemCount ?? 0) : 0;
  return toState(run, items);
}

export async function listItems(
  token: string | undefined,
  datasetId: string,
  offset: number,
  limit: number,
): Promise<{ items: Record<string, unknown>[]; total: number }> {
  const res = await client(token).dataset(datasetId).listItems({ offset, limit, clean: true });
  return { items: res.items as Record<string, unknown>[], total: res.total };
}

export function runCost(state: RunState, actorId: string): CallCost {
  return { provider: "apify", operation: `run:${actorId}`, usd: state.usd, units: {} };
}
