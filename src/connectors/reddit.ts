/**
 * Reddit via ScrapeCreators (Reddit's own API access was refused; see docs/DECISIONS.md D22).
 * Endpoints and response shapes follow the official @scrapecreators/cli API config:
 *   GET /v1/reddit/search?query&sort&timeframe&after&trim       -> { posts[], after, credits_charged }
 *   GET /v1/reddit/post/comments?url&cursor&trim                -> { post, comments[], more, credits_charged }
 * Auth: `x-api-key` header.
 */
import { fetchJson, type FetchJsonOptions } from "./http";
import { ConnectorError, type Page, type RawPost } from "./types";

const BASE = "https://api.scrapecreators.com";
/** Estimate used when SCRAPECREATORS_USD_PER_CREDIT isn't set (pay-as-you-go packs are about $0.002/credit). */
export const DEFAULT_USD_PER_CREDIT = 0.002;

export function usdPerCredit(env: string | undefined = process.env.SCRAPECREATORS_USD_PER_CREDIT): number {
  const n = env ? Number(env) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_USD_PER_CREDIT;
}

interface RedditPost {
  id: string;
  name?: string;
  title?: string;
  selftext?: string;
  author?: string;
  created_utc?: number;
  url?: string;
  permalink?: string;
  subreddit?: string;
  score?: number;
  num_comments?: number;
}

interface RedditComment {
  id: string;
  author?: string;
  body?: string;
  created_utc?: number;
  url?: string;
  permalink?: string;
  parent_id?: string;
  link_id?: string;
  score?: number;
  depth?: number;
  subreddit?: string;
  replies?: { items?: RedditComment[]; more?: { has_more?: boolean; cursor?: string | null } } | "";
}

interface SearchResponse {
  success?: boolean;
  credits_charged?: number;
  posts?: RedditPost[];
  after?: string | null;
}

interface CommentsResponse {
  success?: boolean;
  credits_charged?: number;
  post?: RedditPost;
  comments?: RedditComment[];
  more?: { has_more?: boolean; cursor?: string | null };
}

type Http = Pick<FetchJsonOptions, "fetchImpl" | "sleep">;

async function call<T extends { credits_charged?: number; success?: boolean }>(
  apiKey: string | undefined,
  path: string,
  params: Record<string, string | undefined>,
  http: Http,
): Promise<{ data: T; credits: number }> {
  if (!apiKey) throw new ConnectorError("scrapecreators", "SCRAPECREATORS_API_KEY is not set");
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  const data = await fetchJson<T>(url.toString(), {
    provider: "scrapecreators",
    init: { headers: { "x-api-key": apiKey, accept: "application/json" } },
    timeoutMs: 45_000,
    // Paid: a timed-out request may still be billed, so only rate limits are retried.
    retryOn: "rateLimitOnly",
    retries: 1,
    ...http,
  });
  if (data.success === false) throw new ConnectorError("scrapecreators", `request to ${path} was not successful`);
  return { data, credits: data.credits_charged ?? 1 };
}

function redditUrl(p: { url?: string; permalink?: string }): string | undefined {
  if (p.permalink) return `https://www.reddit.com${p.permalink}`;
  return p.url;
}

/** Reddit shows deleted accounts as "[deleted]"; treat that as no author so different people aren't merged. */
function authorOf(name: string | undefined): string | null {
  return name && name !== "[deleted]" ? name : null;
}

function toDate(epochSeconds: number | undefined): Date | null {
  return typeof epochSeconds === "number" ? new Date(epochSeconds * 1000) : null;
}

export function mapPost(p: RedditPost): RawPost {
  return {
    source: "reddit",
    sourceId: p.name ?? `t3_${p.id}`,
    url: redditUrl(p),
    author: authorOf(p.author),
    postedAt: toDate(p.created_utc),
    title: p.title ?? "",
    text: p.selftext ?? "",
    engagement: { score: p.score ?? null, comments: p.num_comments ?? null, subreddit: p.subreddit ?? null },
  };
}

/** Depth-first flatten of the nested comment tree, including loaded replies. */
export function flattenComments(comments: RedditComment[], postName: string | undefined): RawPost[] {
  const out: RawPost[] = [];
  const visit = (c: RedditComment) => {
    if (c.body !== undefined) {
      out.push({
        source: "reddit",
        sourceId: `t1_${c.id}`,
        parentSourceId: postName,
        url: redditUrl(c),
        author: authorOf(c.author),
        postedAt: toDate(c.created_utc),
        text: c.body,
        engagement: { score: c.score ?? null, depth: c.depth ?? null, subreddit: c.subreddit ?? null },
      });
    }
    if (c.replies && typeof c.replies === "object") for (const r of c.replies.items ?? []) visit(r);
  };
  comments.forEach(visit);
  return out;
}

export async function searchPosts(
  apiKey: string | undefined,
  query: string,
  opts: { after?: string; sort?: "relevance" | "new" | "top" | "comment_count"; timeframe?: "all" | "day" | "week" | "month" | "year" } = {},
  http: Http = {},
): Promise<Page<RawPost>> {
  const { data, credits } = await call<SearchResponse>(
    apiKey,
    "/v1/reddit/search",
    { query, sort: opts.sort ?? "relevance", timeframe: opts.timeframe ?? "all", after: opts.after, trim: "true" },
    http,
  );
  return {
    items: (data.posts ?? []).map(mapPost),
    next: data.after ?? undefined,
    cost: { provider: "scrapecreators", operation: "reddit.search", usd: credits * usdPerCredit(), units: { credits } },
  };
}

/** Comments for one post. `next` is the opaque cursor for more top-level comments. */
export async function postComments(
  apiKey: string | undefined,
  postUrl: string,
  opts: { cursor?: string } = {},
  http: Http = {},
): Promise<Page<RawPost>> {
  const { data, credits } = await call<CommentsResponse>(
    apiKey,
    "/v1/reddit/post/comments",
    { url: postUrl, cursor: opts.cursor, trim: "true" },
    http,
  );
  const postName = data.post?.name ?? (data.post?.id ? `t3_${data.post.id}` : undefined);
  return {
    items: flattenComments(data.comments ?? [], postName),
    next: data.more?.has_more && data.more.cursor ? data.more.cursor : undefined,
    cost: { provider: "scrapecreators", operation: "reddit.post.comments", usd: credits * usdPerCredit(), units: { credits } },
  };
}
