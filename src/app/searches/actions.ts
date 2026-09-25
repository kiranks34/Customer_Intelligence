"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { authed, budgetBlock, errorText, type ActionState } from "@/lib/action-guards";
import { advance, progress, startCollection, type Progress } from "@/lib/collect";
import { recordCost } from "@/lib/cost";
import type { Plan } from "@/lib/plan";
import { validatePlan } from "@/lib/plan-edit";
import { draftPlan, PlannerError } from "@/lib/planner";
import { scopeFor, type Scope } from "@/lib/catalog";
import { ensureCatalogForSearch, getCatalog } from "@/lib/catalogs";
import { createSearch, hideSearches, resumeWaiting, savePlanVersion } from "@/lib/searches";

export type { ActionState };

export async function createSearchAction(_prev: ActionState | null, form: FormData): Promise<ActionState> {
  const denied = (await authed()) ?? (await budgetBlock());
  if (denied) return denied;
  const q = String(form.get("q") ?? "").trim();
  if (q.length > 300) return { ok: false, message: "Keep it under 300 characters." };

  // A family/series/model picked from the catalog, or free text ("Anything else").
  const catalogId = Number(form.get("catalogId") ?? 0);
  let scope: Scope | null = null;
  if (catalogId) {
    const rawNode = String(form.get("nodeId") ?? "");
    const found = await getCatalog(catalogId).catch(() => null);
    scope = found ? scopeFor(catalogId, found.tree, rawNode ? Number(rawNode) : null) : null;
    if (!scope) return { ok: false, message: "That product isn't in the catalog any more. Reload the page and pick again." };
  } else if (q.length < 3) {
    return { ok: false, message: "Type at least 3 characters." };
  }
  const input = q || `General overview of ${scope!.label}`;
  const query = scope ? `${scope.label}${q ? ` · ${q}` : ""}` : q;

  let drafted;
  try {
    drafted = await draftPlan(input, new Date(), scope ?? undefined);
  } catch (err) {
    if (err instanceof PlannerError && err.cost) await recordCost({ ...err.cost }).catch(() => undefined);
    return { ok: false, message: `Couldn't draft a plan: ${errorText(err)}` };
  }
  const { plan, cost } = drafted;
  let id: number | undefined;
  try {
    // A picked product's search uses its family's catalog straight away (saved in the same statement); a typed
    // topic of a known family (e.g. "hp smart tank printers") is linked to that family's catalog right after.
    id = await createSearch(query, plan, scope?.catalogId ?? null);
    if (!scope) await ensureCatalogForSearch(id, plan.subject).catch(() => null);
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

/**
 * Clears searches from the Recent list by id (the ones on screen, so "Clear all" never hides a search the
 * user hasn't seen, e.g. one just started in another tab). Nothing is deleted.
 */
export async function clearSearchesAction(ids: number[]): Promise<ActionState> {
  const denied = await authed();
  if (denied) return denied;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200 || !ids.every((id) => Number.isInteger(id) && id > 0)) {
    return { ok: false, message: "Unknown search." };
  }
  try {
    const n = await hideSearches(ids);
    revalidatePath("/");
    return { ok: true, message: n === 1 ? "Cleared 1 search." : `Cleared ${n} searches.` };
  } catch (err) {
    return { ok: false, message: `Couldn't clear: ${errorText(err)}` };
  }
}
