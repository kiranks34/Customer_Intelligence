import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { fetchJson, parseErrorBody, redactUrl } from "./http";
import { parseInputSchema, runChargeUsd } from "./apify";
import { flattenComments, postComments, searchPosts, usdPerCredit } from "./reddit";
import { ConnectorError } from "./types";
import { searchVideos, videoComments } from "./youtube";

const fixture = (name: string) => readFileSync(join(__dirname, "__fixtures__", name), "utf8");
const respond = (body: string, status = 200) =>
  vi.fn<typeof fetch>(async () => new Response(body, { status }));
const noSleep = async () => {};
const calledUrl = (f: ReturnType<typeof respond>) => new URL(String(f.mock.calls[0][0]));

describe("fetchJson", () => {
  it("retries 429/5xx and then succeeds", async () => {
    const f = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response("{\"ok\":1}", { status: 200 }));
    await expect(fetchJson("https://x.test/a", { provider: "p", fetchImpl: f, sleep: noSleep })).resolves.toEqual({ ok: 1 });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("does not retry 4xx and reports the API's message", async () => {
    const f = respond(JSON.stringify({ error: { message: "API key not valid" } }), 400);
    const err = await fetchJson<never>("https://x.test/a?key=SECRET", { provider: "p", fetchImpl: f, sleep: noSleep }).catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(ConnectorError);
    expect(err.message).toContain("API key not valid");
    expect(err.message).not.toContain("SECRET");
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("never puts credentials in network error messages", async () => {
    const f = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed");
    });
    const err = await fetchJson<never>("https://x.test/a?key=SECRET&token=T2", { provider: "p", fetchImpl: f, sleep: noSleep, retries: 0 }).catch((e: unknown) => e as Error);
    expect(err.message).not.toContain("SECRET");
    expect(err.message).not.toContain("T2");
  });
  it("for paid calls, does not retry timeouts or 5xx (they may already be billed), only 429", async () => {
    const timeout = vi.fn<typeof fetch>(async () => {
      throw new DOMException("timed out", "TimeoutError");
    });
    await expect(fetchJson("https://x.test/a", { provider: "p", fetchImpl: timeout, sleep: noSleep, retryOn: "rateLimitOnly" })).rejects.toThrow();
    expect(timeout).toHaveBeenCalledTimes(1);
    const busy = respond("busy", 503);
    await expect(fetchJson("https://x.test/a", { provider: "p", fetchImpl: busy, sleep: noSleep, retryOn: "rateLimitOnly" })).rejects.toThrow();
    expect(busy).toHaveBeenCalledTimes(1);
    const limited = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("slow down", { status: 429 })).mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await expect(fetchJson("https://x.test/a", { provider: "p", fetchImpl: limited, sleep: noSleep, retryOn: "rateLimitOnly" })).resolves.toEqual({});
  });
  it("wraps failures while reading the body as a ConnectorError", async () => {
    const f = vi.fn<typeof fetch>(async () => ({ ok: true, status: 200, text: async () => Promise.reject(new TypeError("terminated")) }) as unknown as Response);
    const err = await fetchJson<never>("https://x.test/a", { provider: "p", fetchImpl: f, sleep: noSleep, retries: 1 }).catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(ConnectorError);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("redacts key-like query params and summarizes error bodies", () => {
    expect(redactUrl("https://a.test/?q=1&key=abc")).toBe("https://a.test/?q=1&key=REDACTED");
    expect(parseErrorBody("{\"message\":\"nope\"}")).toEqual({ message: "nope", reason: undefined });
    expect(parseErrorBody("plain text")).toEqual({ message: "plain text" });
  });
});

describe("youtube", () => {
  it("maps search results to videos and skips non-video items", async () => {
    const f = respond(fixture("youtube-search.json"));
    const page = await searchVideos("K", "HP Smart Tank", { maxResults: 99, regionCode: "US" }, { fetchImpl: f });
    expect(page.items).toEqual([{ videoId: "vid00000001", title: "HP Smart Tank 5101 review after 6 months", channelTitle: "Printer Guy", publishedAt: "2026-05-01T12:00:00Z" }]);
    expect(page.next).toBe("CAIQAA");
    expect(page.cost.units.quota).toBe(100);
    const url = calledUrl(f);
    expect(url.searchParams.get("maxResults")).toBe("50");
    expect(url.searchParams.get("type")).toBe("video");
    expect(url.searchParams.get("regionCode")).toBe("US");
  });
  it("maps comments, drops blank ones, links to the comment", async () => {
    const page = await videoComments("K", "vid00000001", {}, { fetchImpl: respond(fixture("youtube-comments.json")) });
    expect(page.items).toHaveLength(1);
    const c = page.items[0];
    expect(c).toMatchObject({ source: "youtube", sourceId: "Ugz1", parentSourceId: "vid00000001", author: "@tankfan" });
    expect(c.url).toBe("https://www.youtube.com/watch?v=vid00000001&lc=Ugz1");
    expect(c.postedAt?.toISOString()).toBe("2026-05-03T09:30:00.000Z");
    expect(c.engagement).toEqual({ likes: 12, replies: 3 });
  });
  it("treats disabled comments as an empty page", async () => {
    const body = JSON.stringify({ error: { code: 403, message: "Comments are turned off.", errors: [{ message: "Comments are turned off.", reason: "commentsDisabled" }] } });
    const page = await videoComments("K", "v", {}, { fetchImpl: respond(body, 403), sleep: noSleep });
    expect(page.items).toEqual([]);
  });
  it("still surfaces other 403s (e.g. quota)", async () => {
    const body = JSON.stringify({ error: { code: 403, message: "quota exceeded", errors: [{ reason: "quotaExceeded" }] } });
    await expect(videoComments("K", "v", {}, { fetchImpl: respond(body, 403), sleep: noSleep })).rejects.toThrow("quota exceeded");
  });
  it("fails clearly without a key", async () => {
    await expect(searchVideos(undefined, "q")).rejects.toThrow("YOUTUBE_API_KEY is not set");
  });
});

describe("reddit via scrapecreators", () => {
  it("maps search posts with fullname ids and permalinks; sends the key as a header", async () => {
    const f = respond(fixture("scrapecreators-reddit-search.json"));
    const page = await searchPosts("SC", "HP Smart Tank", {}, { fetchImpl: f });
    expect(page.items[0]).toMatchObject({
      source: "reddit",
      sourceId: "t3_1flgwup",
      url: "https://www.reddit.com/r/webscraping/comments/1flgwup/after_2_months_learning_scraping_im_sharing_what/",
      author: "Sea_Cardiologist_212",
      title: "After 2 months learning scraping, I'm sharing what I learned!",
    });
    expect(page.items[0].postedAt?.toISOString()).toBe("2024-09-20T16:59:51.000Z");
    expect(page.next).toBe("t3_1ihh437");
    expect(page.cost.units.credits).toBe(1);
    const init = f.mock.calls[0][1]!;
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("SC");
    expect(calledUrl(f).searchParams.has("x-api-key")).toBe(false);
  });
  it("flattens nested comments and returns the top-level cursor", async () => {
    const page = await postComments("SC", "https://www.reddit.com/r/AskReddit/comments/ablzuq/x/", {}, { fetchImpl: respond(fixture("scrapecreators-reddit-comments.json")) });
    expect(page.items).toHaveLength(4);
    expect(page.items[0]).toMatchObject({ sourceId: "t1_ed1czme", parentSourceId: "t3_ablzuq", author: "sweatybeard" });
    expect(new Set(page.items.map((p) => p.sourceId)).size).toBe(4);
    expect(page.next).toBe("opaque_cursor_returned_by_previous_response");
  });
  it("tolerates empty-string replies and a missing parent post", () => {
    const [c] = flattenComments([{ id: "a", body: "hi", replies: "" }], undefined);
    expect(c.parentSourceId).toBeUndefined();
  });
  it("keeps which comment a reply answers, not for top-level comments", () => {
    const [top, reply] = flattenComments(
      [{ id: "a", body: "Canon is better", parent_id: "t3_x", replies: { items: [{ id: "b", body: "I print a lot", parent_id: "t1_a" }] } }],
      "t3_x",
    );
    expect(top.engagement).not.toHaveProperty("replyTo");
    expect(reply.engagement).toMatchObject({ replyTo: "t1_a" });
  });
  it("maps deleted accounts to no author", () => {
    const [c] = flattenComments([{ id: "a", body: "Same here", author: "[deleted]" }], "t3_x");
    expect(c.author).toBeNull();
  });
  it("prices credits from the env, with a default", () => {
    expect(usdPerCredit(undefined)).toBe(0.002);
    expect(usdPerCredit("0.001")).toBe(0.001);
    expect(usdPerCredit("nope")).toBe(0.002);
  });
  it("fails clearly without a key", async () => {
    await expect(searchPosts(undefined, "q")).rejects.toThrow("SCRAPECREATORS_API_KEY is not set");
  });
});

describe("apify", () => {
  it("adds pay-per-event and pay-per-result charges to platform usage", () => {
    const common = { apifyMarginPercentage: 0.2, createdAt: new Date(), startedAt: new Date() };
    expect(
      runChargeUsd({
        usageTotalUsd: 0.01,
        chargedEventCounts: { review: 500, "actor-start": 1 },
        pricingInfo: { ...common, pricingModel: "PAY_PER_EVENT", pricingPerEvent: { actorChargeEvents: { review: { eventPriceUsd: 0.0005, eventTitle: "r" }, "actor-start": { eventPriceUsd: 0.02, eventTitle: "s" } } } },
      }),
    ).toBeCloseTo(0.01 + 0.25 + 0.02);
    expect(runChargeUsd({ usageTotalUsd: 0.01, pricingInfo: { ...common, pricingModel: "PRICE_PER_DATASET_ITEM", pricePerUnitUsd: 0.0005 } }, 500)).toBeCloseTo(0.26);
    expect(runChargeUsd({ usageTotalUsd: 0.05 })).toBe(0.05);
  });
  it("parses input schemas given as string or object", () => {
    const schema = { properties: { productUrls: { type: "array", title: "Product URLs" }, maxReviews: { type: "integer" } }, required: ["productUrls"] };
    const expected = [
      { name: "productUrls", type: "array", title: "Product URLs", required: true },
      { name: "maxReviews", type: "integer", title: undefined, required: false },
    ];
    expect(parseInputSchema(schema)).toEqual(expected);
    expect(parseInputSchema(JSON.stringify(schema))).toEqual(expected);
    expect(parseInputSchema(null)).toEqual([]);
  });
});
