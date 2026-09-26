import { describe, expect, it } from "vitest";

import { periodText, statusOf } from "./studies";
import type { Plan } from "./plan";

const base = { posts: 100, coll_open: 0, coll_waiting: 0, coll_stale: false, wait_reason: null, coll_jobs: 5, analysis: null, analyzed: true, headline: null };

describe("statusOf", () => {
  it("names what's happening and what to do", () => {
    expect(statusOf({ ...base, coll_open: 3 })).toEqual({ kind: "collecting" });
    expect(statusOf({ ...base, coll_open: 3, coll_stale: true })).toEqual({ kind: "paused", what: "collecting" });
    expect(statusOf({ ...base, coll_waiting: 1, wait_reason: "Paused: monthly budget reached." })).toEqual({ kind: "waiting", reason: "monthly budget reached" });
    expect(statusOf({ ...base, analysis: { status: "running", stale: false, error: null } })).toEqual({ kind: "reading" });
    expect(statusOf({ ...base, analysis: { status: "queued", stale: true, error: null } })).toEqual({ kind: "paused", what: "reading" });
    expect(statusOf({ ...base, analysis: { status: "failed", stale: false, error: "Jev failed 3 times" } })).toEqual({ kind: "stopped", reason: "Jev failed 3 times" });
    expect(statusOf({ ...base, posts: 0, analyzed: false })).toEqual({ kind: "stopped", reason: "No posts found" });
    expect(statusOf({ ...base, analyzed: false })).toEqual({ kind: "not_analyzed" });
    expect(statusOf({ ...base, headline: { counted: 1, negativePct: 0, positivePct: 0, topPain: null, toReview: 2 } })).toEqual({ kind: "review", answers: 2 });
    expect(statusOf(base)).toEqual({ kind: "ready" });
  });
});

describe("periodText", () => {
  const plan = (from: string | null, to: string | null, label: string) => ({ timeWindow: { from, to, label } }) as Plan;
  it("shows presets as chips name them, and custom ranges as dates", () => {
    expect(periodText(plan("2025-09-27", "2026-09-26", "last 12 months"))).toBe("1 year");
    expect(periodText(plan("2026-03-27", "2026-09-26", "6 months"))).toBe("6 months");
    expect(periodText(plan(null, null, "all time"))).toBe("All time");
    expect(periodText(plan("2026-01-01", "2026-09-26", "custom"))).toBe("Jan 1 – Sep 26, 2026");
  });
});
