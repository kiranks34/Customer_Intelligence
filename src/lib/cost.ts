import "server-only";

import { gte, sql } from "drizzle-orm";

import { getDb, requireDb } from "@/db/client";
import { costEvents } from "@/db/schema";

import { budgetStatus, monthlyBudgetUsd, monthStartUtc, type BudgetStatus } from "./budget";

export interface CostEventInput {
  searchId?: number;
  provider: string;
  operation: string;
  units?: Record<string, number>;
  usd: number;
}

export async function recordCost(e: CostEventInput): Promise<void> {
  await requireDb().insert(costEvents).values({
    searchId: e.searchId,
    provider: e.provider,
    operation: e.operation,
    units: e.units,
    usd: e.usd.toFixed(6),
  });
}

export type SpendResult =
  | { state: "ok"; status: BudgetStatus }
  | { state: "unconfigured" }
  | { state: "error"; message: string };

/** Month-to-date spend across all providers. Errors are reported, never shown as "not connected". */
export async function monthToDate(now: Date = new Date()): Promise<SpendResult> {
  const db = getDb();
  if (!db) return { state: "unconfigured" };
  try {
    const [row] = await db
      .select({ total: sql<string>`coalesce(sum(${costEvents.usd}), 0)` })
      .from(costEvents)
      .where(gte(costEvents.createdAt, monthStartUtc(now)));
    return { state: "ok", status: budgetStatus(Number(row?.total ?? 0), monthlyBudgetUsd()) };
  } catch (err) {
    console.error("monthToDate failed", err);
    return { state: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The one rule for starting paid work. It fails closed: if spend can't be read, it can't be checked against
 * the budget or recorded, so the answer is no.
 */
export async function paidWorkBlockedReason(): Promise<string | null> {
  const spend = await monthToDate();
  if (spend.state !== "ok") return "the spend meter can't read the database";
  if (spend.status.level === "over") return "the monthly budget has been reached";
  return null;
}
