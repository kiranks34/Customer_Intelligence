/** Monthly API budget (PRD §7): all providers combined. */
export const DEFAULT_MONTHLY_BUDGET_USD = 20;

export type BudgetLevel = "ok" | "warning" | "over";

export interface BudgetStatus {
  spentUsd: number;
  budgetUsd: number;
  remainingUsd: number;
  fraction: number;
  level: BudgetLevel;
}

export function monthlyBudgetUsd(env: string | undefined = process.env.PULSE_MONTHLY_BUDGET_USD): number {
  const n = env === undefined || env === "" ? DEFAULT_MONTHLY_BUDGET_USD : Number(env);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MONTHLY_BUDGET_USD;
}

export function budgetStatus(spentUsd: number, budgetUsd: number): BudgetStatus {
  const fraction = budgetUsd > 0 ? spentUsd / budgetUsd : 1;
  return {
    spentUsd,
    budgetUsd,
    remainingUsd: Math.max(0, budgetUsd - spentUsd),
    fraction,
    level: fraction >= 1 ? "over" : fraction >= 0.8 ? "warning" : "ok",
  };
}

/** Start of the current calendar month in UTC. */
export function monthStartUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
