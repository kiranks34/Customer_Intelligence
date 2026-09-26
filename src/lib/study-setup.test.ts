import { describe, expect, it } from "vitest";

import { applyChoices, choicesProblem, estimateStudy, windowFor } from "./study-setup";
import type { Plan } from "./plan";

const today = new Date(2026, 8, 26);
const plan = {
  intent: "topic",
  subject: "HP Smart Tank 7602",
  kind: "product",
  question: null,
  focus: [],
  timeWindow: { from: null, to: null, label: "all time" },
  aliases: [],
  youtube: { enabled: true, queries: ["HP Smart Tank 7602 review"], videosPerQuery: 3, commentsPerVideo: 30 },
  reddit: { enabled: true, queries: [], commentThreadsPerQuery: 1 },
  exclusions: [],
  postCap: 100,
  notes: "",
} as Plan;

describe("windowFor", () => {
  it("presets start back from today and stay open-ended", () => {
    expect(windowFor({ period: "3m" }, today)).toEqual({ from: "2026-06-28", to: null, label: "3 months" });
    expect(windowFor({ period: "1y" }, today)).toEqual({ from: "2025-09-27", to: null, label: "1 year" });
  });
  it("custom needs a real start on or before the end, not in the future", () => {
    expect(windowFor({ period: "custom", from: "2026-01-01" }, today)).toEqual({ from: "2026-01-01", to: null, label: "custom" });
    expect(windowFor({ period: "custom", from: "2026-09-01", to: "2026-08-01" }, today)).toBeNull();
    expect(windowFor({ period: "custom", from: "2026-02-31" }, today)).toBeNull();
    expect(windowFor({ period: "custom", from: "2026-01-01", to: "2026-12-01" }, today)).toBeNull();
    expect(windowFor({ period: "custom" }, today)).toBeNull();
  });
});

describe("choicesProblem", () => {
  it("names what's missing", () => {
    expect(choicesProblem({ sources: [], period: "1y", question: "" }, today)).toMatch(/source/);
    expect(choicesProblem({ sources: ["reddit"], period: "custom", question: "" }, today)).toMatch(/start date/);
    expect(choicesProblem({ sources: ["reddit"], period: "1y", question: "x".repeat(301) }, today)).toMatch(/300/);
    expect(choicesProblem({ sources: ["reddit"], period: "1y", question: "" }, today)).toBeNull();
  });
});

describe("applyChoices", () => {
  it("uses only the picked sources, the period and the standard depth; a source without searches gets the product name", () => {
    const p = applyChoices(plan, { sources: ["reddit"], period: "6m", question: "" }, "HP Smart Tank 7602", today);
    expect(p.youtube.enabled).toBe(false);
    expect(p.reddit).toMatchObject({ enabled: true, queries: ["HP Smart Tank 7602"], commentThreadsPerQuery: 3 });
    expect(p.timeWindow.label).toBe("6 months");
    expect(p.postCap).toBe(300);
  });
});

describe("estimateStudy", () => {
  it("costs more with more sources, and Reddit costs credits", () => {
    const one = estimateStudy(["youtube"], 0.002, "anthropic/claude-sonnet-5");
    const two = estimateStudy(["youtube", "reddit"], 0.002, "anthropic/claude-sonnet-5");
    expect(two.usd).toBeGreaterThan(one.usd);
    expect(two.usd - one.usd).toBeGreaterThanOrEqual(12 * 0.002);
    expect(one.minutes).toBeGreaterThanOrEqual(3);
  });
});
