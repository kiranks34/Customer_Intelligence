import { describe, expect, it } from "vitest";

import { tokenCostUsd } from "./ai";
import { estimatePlan, inWindow, isExcluded, isRealDate, normalizePlan, redditTimeframe, type Plan } from "./plan";
import { planFromForm } from "./plan-form";

const base: Plan = {
  intent: "question",
  subject: "HP Smart Tank 5000 series",
  kind: "family",
  question: "How many people talked about connectivity issues last week?",
  focus: ["connectivity", "wifi"],
  timeWindow: { from: "2026-09-18", to: "2026-09-25", label: "last 7 days" },
  aliases: ["Smart Tank 5101", "Smart Tank 5101"],
  youtube: { enabled: true, queries: ["HP Smart Tank wifi", "Smart Tank 5101 review"], videosPerQuery: 5, commentsPerVideo: 50 },
  reddit: { enabled: true, queries: ["Smart Tank wifi"], commentThreadsPerQuery: 3 },
  exclusions: [],
  postCap: 300,
  notes: "Public posts only.",
};

describe("normalizePlan", () => {
  it("clamps runaway numbers and dedupes lists", () => {
    const p = normalizePlan({
      ...base,
      youtube: { ...base.youtube, queries: Array.from({ length: 9 }, (_, i) => `q${i}`), videosPerQuery: 500, commentsPerVideo: -3 },
      reddit: { ...base.reddit, commentThreadsPerQuery: 99 },
      postCap: 1e9,
    });
    expect(p.youtube.queries).toHaveLength(5);
    expect(p.youtube.videosPerQuery).toBe(25);
    expect(p.youtube.commentsPerVideo).toBe(1);
    expect(p.reddit.commentThreadsPerQuery).toBe(10);
    expect(p.postCap).toBe(1000);
    expect(p.aliases).toEqual(["Smart Tank 5101"]);
  });
  it("drops bad dates, swaps reversed windows, and clears the question for topics", () => {
    expect(normalizePlan({ ...base, timeWindow: { from: "last week", to: null, label: "" } }).timeWindow).toEqual({ from: null, to: null, label: "all time" });
    expect(normalizePlan({ ...base, timeWindow: { from: "2026-09-25", to: "2026-09-01", label: "x" } }).timeWindow.from).toBe("2026-09-01");
    expect(normalizePlan({ ...base, intent: "topic" }).question).toBeNull();
    expect(normalizePlan({ ...base, postCap: Number.NaN }).postCap).toBe(50);
  });
});

describe("estimatePlan", () => {
  it("counts YouTube quota and Reddit credits as upper bounds", () => {
    const e = estimatePlan(base, 0.002);
    expect(e.youtubeQuotaUnits).toBe(2 * 100 + 2 * 5 * 1);
    expect(e.redditCredits).toBe(1 + 3);
    expect(e.usd).toBeCloseTo(0.008);
    expect(e.maxPosts).toBe(300);
  });
  it("ignores disabled sources", () => {
    const e = estimatePlan({ ...base, reddit: { ...base.reddit, enabled: false } }, 0.002);
    expect(e.redditCredits).toBe(0);
    expect(e.usd).toBe(0);
  });
});

describe("time window", () => {
  const today = new Date("2026-09-25T12:00:00Z");
  it("picks the smallest Reddit timeframe that covers the window", () => {
    // "Last 7 days" ending today starts 6 days back; one day more no longer fits Reddit's "week".
    expect(redditTimeframe({ ...base, timeWindow: { from: "2026-09-19", to: null, label: "" } }, today)).toBe("week");
    expect(redditTimeframe(base, today)).toBe("month");
    expect(redditTimeframe({ ...base, timeWindow: { from: "2026-08-01", to: "2026-08-31", label: "" } }, today)).toBe("year");
    expect(redditTimeframe({ ...base, timeWindow: { from: null, to: null, label: "" } }, today)).toBe("all");
  });
  it("keeps posts inside the window (inclusive days) and undated posts", () => {
    expect(inWindow(base, new Date("2026-09-18T00:00:00Z"))).toBe(true);
    expect(inWindow(base, new Date("2026-09-25T23:59:00Z"))).toBe(true);
    expect(inWindow(base, new Date("2026-09-17T23:59:59Z"))).toBe(false);
    expect(inWindow(base, new Date("2026-09-26T00:00:01Z"))).toBe(false);
    expect(inWindow(base, null)).toBe(true);
  });
});

describe("planFromForm", () => {
  const form = (entries: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(entries)) f.set(k, v);
    return f;
  };
  const good = {
    intent: "topic",
    subject: "HP Smart Tank printers",
    kind: "family",
    question: "",
    focus: "setup, ink",
    from: "",
    to: "",
    label: "all time",
    aliases: "Smart Tank 5101\nSmart Tank 7301",
    yt_enabled: "on",
    yt_queries: "HP Smart Tank review\n\nSmart Tank 7301",
    yt_videos: "5",
    yt_comments: "50",
    rd_queries: "HP Smart Tank",
    rd_threads: "3",
    exclusions: "",
    postCap: "300",
    notes: "",
  };
  it("parses lines, commas and checkboxes (unchecked = off)", () => {
    const r = planFromForm(form(good));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.focus).toEqual(["setup", "ink"]);
    expect(r.plan.youtube.queries).toEqual(["HP Smart Tank review", "Smart Tank 7301"]);
    expect(r.plan.youtube.enabled).toBe(true);
    expect(r.plan.reddit.enabled).toBe(false);
    expect(r.plan.question).toBeNull();
  });
  it("rejects empty number fields and impossible dates instead of guessing", () => {
    expect(planFromForm(form({ ...good, rd_threads: "" }))).toEqual({ ok: false, error: '"Comment threads read per query" needs a number.' });
    expect(planFromForm(form({ ...good, postCap: "lots" }))).toMatchObject({ ok: false });
    expect(planFromForm(form({ ...good, from: "2026-02-31" }))).toEqual({ ok: false, error: '"From" must be a real date as YYYY-MM-DD.' });
  });
  it("rejects an invalid kind or empty subject with a readable message", () => {
    expect(planFromForm(form({ ...good, kind: "planet" }))).toMatchObject({ ok: false });
    expect(planFromForm(form({ ...good, subject: "  " }))).toEqual({ ok: false, error: "Subject can't be empty." });
  });
});

describe("tokenCostUsd", () => {
  it("prices known models and errs high for unknown ones", () => {
    expect(tokenCostUsd("anthropic/claude-opus-5", 2000, 1000)).toBeCloseTo(0.01 + 0.025);
    expect(tokenCostUsd("someone/unknown", 1_000_000, 0)).toBe(10);
  });
});

describe("isExcluded", () => {
  const p = { ...base, exclusions: ["Epson", "C++ tank"] };
  it("matches whole words case-insensitively and escapes regex characters", () => {
    expect(isExcluded(p, "My EPSON EcoTank is better")).toBe(true);
    expect(isExcluded(p, "compiled a c++ tank game")).toBe(true);
    expect(isExcluded(p, "Epsonite paint")).toBe(false);
    expect(isExcluded(base, "anything")).toBe(false);
  });
});

describe("isRealDate", () => {
  it("accepts calendar dates and rejects rolled-over or malformed ones", () => {
    expect(isRealDate("2028-02-29")).toBe(true);
    expect(isRealDate("2026-02-29")).toBe(false);
    expect(isRealDate("2026-02-31")).toBe(false);
    expect(isRealDate("2026-9-1")).toBe(false);
  });
  it("normalizePlan drops impossible dates from Claude too", () => {
    expect(normalizePlan({ ...base, timeWindow: { from: "2026-02-31", to: null, label: "x" } }).timeWindow.from).toBeNull();
  });
});
