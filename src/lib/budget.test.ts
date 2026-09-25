import { describe, expect, it } from "vitest";

import { budgetStatus, monthlyBudgetUsd, monthStartUtc } from "./budget";

describe("budgetStatus", () => {
  it("reports levels at 80% and 100%", () => {
    expect(budgetStatus(5, 20).level).toBe("ok");
    expect(budgetStatus(16, 20).level).toBe("warning");
    expect(budgetStatus(20, 20).level).toBe("over");
    expect(budgetStatus(25, 20).remainingUsd).toBe(0);
  });
});

describe("monthlyBudgetUsd", () => {
  it("defaults to $20 and ignores invalid values", () => {
    expect(monthlyBudgetUsd(undefined)).toBe(20);
    expect(monthlyBudgetUsd("")).toBe(20);
    expect(monthlyBudgetUsd("abc")).toBe(20);
    expect(monthlyBudgetUsd("-5")).toBe(20);
    expect(monthlyBudgetUsd("35")).toBe(35);
  });
});

describe("monthStartUtc", () => {
  it("returns the first instant of the UTC month", () => {
    expect(monthStartUtc(new Date("2026-09-24T15:00:00Z")).toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });
});
