import "server-only";

import { gte, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
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
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is not set");
  await db.insert(costEvents).values({
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
