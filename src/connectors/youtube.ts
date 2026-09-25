/**
 * YouTube Data API v3: search for videos, then read their comment threads.
 * Free within the daily quota (10,000 units): search.list = 100 units, commentThreads.list = 1 unit.
 */
import { fetchJson, type FetchJsonOptions } from "./http";
import { ConnectorError, type Page, type RawPost } from "./types";

const BASE = "https://www.googleapis.com/youtube/v3";
export const QUOTA_UNITS = { search: 100, commentThreads: 1, videos: 1 } as const;

export interface YoutubeVideo {
  videoId: string;
  title: string;
  channelTitle: string;
  publishedAt: string;
}

export interface SearchOptions {
  pageToken?: string;
  maxResults?: number; // 1-50
  regionCode?: string; // ISO 3166-1 alpha-2, e.g. "US"
  relevanceLanguage?: string; // ISO 639-1, e.g. "en"
  publishedAfter?: Date;
}

interface SearchResponse {
  nextPageToken?: string;
  items?: { id?: { kind?: string; videoId?: string }; snippet?: { title?: string; channelTitle?: string; publishedAt?: string } }[];
}

interface CommentThreadsResponse {
  nextPageToken?: string;
  items?: {
    id: string;
    snippet?: {
      videoId?: string;
      totalReplyCount?: number;
      topLevelComment?: {
        id: string;
        snippet?: {
          textOriginal?: string;
          textDisplay?: string;
          authorDisplayName?: string;
          likeCount?: number;
          publishedAt?: string;
        };
      };
    };
  }[];
}

type Http = Pick<FetchJsonOptions, "fetchImpl" | "sleep">;

function requireKey(apiKey: string | undefined): string {
  if (!apiKey) throw new ConnectorError("youtube", "YOUTUBE_API_KEY is not set");
  return apiKey;
}

export async function searchVideos(
  apiKey: string | undefined,
  query: string,
  opts: SearchOptions = {},
  http: Http = {},
): Promise<Page<YoutubeVideo>> {
  const url = new URL(`${BASE}/search`);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", String(Math.min(50, Math.max(1, opts.maxResults ?? 25))));
  if (opts.pageToken) url.searchParams.set("pageToken", opts.pageToken);
  if (opts.regionCode) url.searchParams.set("regionCode", opts.regionCode);
  if (opts.relevanceLanguage) url.searchParams.set("relevanceLanguage", opts.relevanceLanguage);
  if (opts.publishedAfter) url.searchParams.set("publishedAfter", opts.publishedAfter.toISOString());
  url.searchParams.set("key", requireKey(apiKey));

  const res = await fetchJson<SearchResponse>(url.toString(), { provider: "youtube", ...http });
  const items: YoutubeVideo[] = (res.items ?? [])
    .filter((i) => i.id?.videoId)
    .map((i) => ({
      videoId: i.id!.videoId!,
      title: i.snippet?.title ?? "",
      channelTitle: i.snippet?.channelTitle ?? "",
      publishedAt: i.snippet?.publishedAt ?? "",
    }));
  return {
    items,
    next: res.nextPageToken,
    cost: { provider: "youtube", operation: "search.list", usd: 0, units: { quota: QUOTA_UNITS.search } },
  };
}

/** Titles of up to 50 videos in one call (1 quota unit), for giving comments their context. */
export async function videoTitles(apiKey: string | undefined, videoIds: string[], http: Http = {}): Promise<{ titles: Record<string, string>; cost: Page<never>["cost"] }> {
  const url = new URL(`${BASE}/videos`);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("id", videoIds.slice(0, 50).join(","));
  url.searchParams.set("key", requireKey(apiKey));
  const res = await fetchJson<{ items?: { id?: string; snippet?: { title?: string } }[] }>(url.toString(), { provider: "youtube", ...http });
  const titles = Object.fromEntries((res.items ?? []).filter((i) => i.id && i.snippet?.title).map((i) => [i.id!, i.snippet!.title!]));
  return { titles, cost: { provider: "youtube", operation: "videos.list", usd: 0, units: { quota: QUOTA_UNITS.videos } } };
}

/**
 * Top-level comments for one video. Videos with comments disabled return an empty page, not an error,
 * so one video can't fail a whole search.
 */
export async function videoComments(
  apiKey: string | undefined,
  videoId: string,
  opts: { pageToken?: string; maxResults?: number; order?: "relevance" | "time" } = {},
  http: Http = {},
): Promise<Page<RawPost>> {
  const url = new URL(`${BASE}/commentThreads`);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("videoId", videoId);
  url.searchParams.set("textFormat", "plainText");
  url.searchParams.set("order", opts.order ?? "relevance");
  url.searchParams.set("maxResults", String(Math.min(100, Math.max(1, opts.maxResults ?? 100))));
  if (opts.pageToken) url.searchParams.set("pageToken", opts.pageToken);
  url.searchParams.set("key", requireKey(apiKey));

  const cost = { provider: "youtube" as const, operation: "commentThreads.list", usd: 0, units: { quota: QUOTA_UNITS.commentThreads } };
  let res: CommentThreadsResponse;
  try {
    res = await fetchJson<CommentThreadsResponse>(url.toString(), { provider: "youtube", ...http });
  } catch (err) {
    if (err instanceof ConnectorError && err.reason === "commentsDisabled") {
      return { items: [], cost };
    }
    throw err;
  }

  const items: RawPost[] = [];
  for (const thread of res.items ?? []) {
    const top = thread.snippet?.topLevelComment;
    const s = top?.snippet;
    const text = s?.textOriginal ?? s?.textDisplay ?? "";
    if (!top || !text.trim()) continue;
    items.push({
      source: "youtube",
      sourceId: top.id,
      parentSourceId: videoId,
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&lc=${encodeURIComponent(top.id)}`,
      author: s?.authorDisplayName ?? null,
      postedAt: s?.publishedAt ? new Date(s.publishedAt) : null,
      text,
      engagement: { likes: s?.likeCount ?? 0, replies: thread.snippet?.totalReplyCount ?? 0 },
    });
  }
  return { items, next: res.nextPageToken, cost };
}
