"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireSession } from "@/lib/auth";
import { advance, progress, startCollection, type Progress } from "@/lib/collect";
import { paidWorkBlockedReason, recordCost } from "@/lib/cost";
import type { Plan } from "@/lib/plan";
import { validatePlan } from "@/lib/plan-edit";
import { draftPlan, PlannerError } from "@/lib/planner";
import { createSearch, resumeWaiting, savePlanVersion } from "@/lib/searches";

export interface ActionState {
  ok: boolean;
  message: string;
}

async function authed(): Promise<ActionState | null> {
  try {
    await requireSession();
    return null;
  } catch {
    return { ok: false, message: "Your session has expired. Reload the page and sign in again." };
  }
}

async function budgetBlock(): Promise<ActionState | null> {
  const reason = await paidWorkBlockedReason();
  return reason ? { ok: false, message: `Blocked: ${reason}.` } : null;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message.slice(0, 300) : "unknown error");

export async function createSearchAction(_prev: ActionState | null, form: FormData): Promise<ActionState> {
  const denied = (await authed()) ?? (await budgetBlock());
  if (denied) return denied;
  const q = String(form.get("q") ?? "").trim();
  if (q.length < 3) return { ok: false, message: "Type at least 3 characters." };
  if (q.length > 300) return { ok: false, message: "Keep it under 300 characters." };

  let drafted;
  try {
    drafted = await draftPlan(q);
  } catch (err) {
    if (err instanceof PlannerError && err.cost) await recordCost({ ...err.cost }).catch(() => undefined);
    return { ok: false, message: `Couldn't draft a plan: ${errorText(err)}` };
  }
  const { plan, cost } = drafted;
  let id: number | undefined;
  try {
    id = await createSearch(q, plan);
  } catch (err) {
    return { ok: false, message: `Couldn't save the search: ${errorText(err)}` };
  } finally {
    // The tokens were spent either way; attach them to the search when it exists.
    await recordCost({ searchId: id, provider: cost.provider, operation: cost.operation, units: cost.units, usd: cost.usd }).catch(() => undefined);
  }
  redirect(`/searches/${id}`);
}

export type SavePlanResult = { ok: true; message: string; version: number; plan: Plan } | { ok: false; message: string };

/** Saves an edited plan as a new version. The plan comes from the browser, so it is validated and limited here. */
export async function savePlanAction(searchId: number, candidate: unknown): Promise<SavePlanResult> {
  const denied = await authed();
  if (denied) return { ok: false, message: denied.message };
  const parsed = validatePlan(candidate);
  if (!parsed.ok) return { ok: false, message: parsed.error };
  try {
    const version = await savePlanVersion(searchId, parsed.plan);
    revalidatePath(`/searches/${searchId}`);
    return { ok: true, message: `Saved as plan version ${version}.`, version, plan: parsed.plan };
  } catch (err) {
    return { ok: false, message: `Couldn't save the plan: ${errorText(err)}` };
  }
}

export async function startCollectionAction(searchId: number): Promise<ActionState> {
  const denied = (await authed()) ?? (await budgetBlock());
  if (denied) return denied;
  try {
    const r = await startCollection(searchId);
    return r.started ? { ok: true, message: "Collection started." } : { ok: false, message: r.reason ?? "Couldn't start." };
  } catch (err) {
    return { ok: false, message: `Couldn't start: ${errorText(err)}` };
  }
}

export async function resumeAction(searchId: number): Promise<ActionState> {
  const denied = (await authed()) ?? (await budgetBlock());
  if (denied) return denied;
  try {
    await resumeWaiting(searchId);
    return { ok: true, message: "Resumed." };
  } catch (err) {
    return { ok: false, message: `Couldn't resume: ${errorText(err)}` };
  }
}

export async function advanceAction(searchId: number): Promise<Progress | ActionState> {
  const denied = await authed();
  if (denied) return denied;
  try {
    return await advance(searchId);
  } catch (err) {
    return { ok: false, message: `Collection step failed: ${errorText(err)}` };
  }
}

export async function progressAction(searchId: number): Promise<Progress | ActionState> {
  const denied = await authed();
  if (denied) return denied;
  return progress(searchId);
}
