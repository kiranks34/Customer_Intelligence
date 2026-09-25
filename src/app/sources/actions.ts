"use server";

import * as apify from "@/connectors/apify";
import * as reddit from "@/connectors/reddit";
import { ConnectorError, type CallCost } from "@/connectors/types";
import * as youtube from "@/connectors/youtube";
import { requireSession } from "@/lib/auth";
import { monthToDate, recordCost } from "@/lib/cost";

import { DEFAULT_QUERY } from "./constants";

export type SourceKey = "youtube" | "reddit" | "apify";

export interface Sample {
  text: string;
  url?: string;
  postedAt?: string;
}

export interface TestResult {
  ok: boolean;
  message: string;
  details?: string[];
  samples?: Sample[];
  costUsd?: number;
}

async function record(costs: CallCost[]): Promise<{ usd: number; note?: string }> {
  const usd = costs.reduce((s, c) => s + c.usd, 0);
  try {
    for (const c of costs) await recordCost({ provider: c.provider, operation: `test:${c.operation}`, units: c.units, usd: c.usd });
    return { usd };
  } catch {
    return { usd, note: "Cost could not be recorded (database error)." };
  }
}

function describe(err: unknown): string {
  if (err instanceof ConnectorError) return err.message;
  if (err instanceof Error) return `${err.name}: ${err.message}`.slice(0, 300);
  return "Unknown error";
}

const clip = (s: string, n = 220) => (s.length > n ? `${s.slice(0, n)}…` : s);

async function testYoutube(query: string): Promise<TestResult> {
  const key = process.env.YOUTUBE_API_KEY;
  const search = await youtube.searchVideos(key, query, { maxResults: 3, regionCode: "US", relevanceLanguage: "en" });
  const costs = [search.cost];
  const video = search.items[0];
  if (!video) {
    const { usd, note } = await record(costs);
    return { ok: true, message: "Key works, but the search returned no videos. Try another query.", costUsd: usd, details: note ? [note] : [] };
  }
  const comments = await youtube.videoComments(key, video.videoId, { maxResults: 5 });
  costs.push(comments.cost);
  const { usd, note } = await record(costs);
  const quota = costs.reduce((s, c) => s + (c.units.quota ?? 0), 0);
  return {
    ok: true,
    message: `Found ${search.items.length} videos; read ${comments.items.length} comments from “${clip(video.title, 80)}”.`,
    details: [`Used ${quota} of your 10,000 free daily quota units.`, ...(note ? [note] : [])],
    samples: comments.items.slice(0, 3).map((p) => ({ text: clip(p.text), url: p.url, postedAt: p.postedAt?.toISOString() })),
    costUsd: usd,
  };
}

async function testReddit(query: string): Promise<TestResult> {
  // Paid call: fail closed. If spend can't be read, it can't be checked against the budget or recorded either.
  const spend = await monthToDate();
  if (spend.state !== "ok") {
    return { ok: false, message: "Paid test blocked: the spend meter can't read the database, so this cost couldn't be checked or recorded." };
  }
  if (spend.status.level === "over") {
    return { ok: false, message: "Monthly budget reached; paid tests are paused." };
  }
  const page = await reddit.searchPosts(process.env.SCRAPECREATORS_API_KEY, query, { sort: "relevance", timeframe: "year" });
  const { usd, note } = await record([page.cost]);
  return {
    ok: true,
    message: `Found ${page.items.length} Reddit posts from the past year.`,
    details: [`Charged ${page.cost.units.credits} ScrapeCreators credit(s), about $${usd.toFixed(4)}.`, ...(note ? [note] : [])],
    samples: page.items.slice(0, 3).map((p) => ({ text: clip(p.title ? `${p.title}: ${p.text}` : p.text), url: p.url, postedAt: p.postedAt?.toISOString() })),
    costUsd: usd,
  };
}

async function testApify(): Promise<TestResult> {
  const token = process.env.APIFY_TOKEN;
  const acct = await apify.account(token);
  const details = [
    acct.monthlyUsageUsd !== null && acct.monthlyLimitUsd !== null
      ? `This month's Apify usage: $${acct.monthlyUsageUsd.toFixed(2)} of $${acct.monthlyLimitUsd.toFixed(2)}${acct.cycleEndsAt ? ` (resets ${acct.cycleEndsAt.slice(0, 10)})` : ""}.`
      : "Usage figures not available for this account.",
  ];
  const actorId = process.env.APIFY_AMAZON_ACTOR;
  if (actorId) {
    const info = await apify.actorInfo(token, actorId);
    details.push(
      `Amazon actor “${info.title}” found. Input fields: ${info.inputFields.map((f) => `${f.name}${f.required ? "*" : ""}`).join(", ") || "(none listed)"}.`,
    );
  } else {
    details.push("APIFY_AMAZON_ACTOR is not set yet, so the Amazon actor wasn't checked.");
  }
  return { ok: true, message: `Token works for Apify user “${acct.username}”. No runs were started (free check).`, details, costUsd: 0 };
}

export async function runSourceTest(source: SourceKey, _prev: TestResult | null, form: FormData): Promise<TestResult> {
  try {
    await requireSession();
  } catch {
    return { ok: false, message: "Your session has expired. Reload the page and sign in again." };
  }
  const raw = form.get("query");
  const query = typeof raw === "string" && raw.trim() ? raw.trim().slice(0, 120) : DEFAULT_QUERY;
  try {
    if (source === "youtube") return await testYoutube(query);
    if (source === "reddit") return await testReddit(query);
    return await testApify();
  } catch (err) {
    return { ok: false, message: describe(err) };
  }
}
