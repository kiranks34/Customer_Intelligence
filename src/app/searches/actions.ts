"use server";

import { revalidatePath } from "next/cache";

import { authed, budgetBlock, errorText, type ActionState } from "@/lib/action-guards";
import { startCollection } from "@/lib/collect";
import { claudeModel } from "@/lib/ai";
import { monthToDate, recordCost } from "@/lib/cost";
import { usdPerCredit } from "@/connectors/reddit";
import type { Plan } from "@/lib/plan";
import { validatePlan } from "@/lib/plan-edit";
import { draftPlan, PlannerError } from "@/lib/planner";
import { scopeFor } from "@/lib/catalog";
import { getCatalog } from "@/lib/catalogs";
import { createSearch, hideSearches, savePlanVersion } from "@/lib/searches";
import { renameSearch, studyRows } from "@/lib/studies";
import { applyChoices, choicesProblem, estimateStudy, windowFor, type SourceId, type StudyChoices } from "@/lib/study-setup";

export type { ActionState };

export interface StartStudyInput {
  catalogId: number;
  /** A series or model in the family, or null for the whole family. */
  nodeId: number | null;
  choices: StudyChoices;
  /** Start even though the same study exists (you chose "Start a new one"). */
  force?: boolean;
}

export type StartStudyResult =
  | { ok: true; id: number }
  | { ok: false; kind: "duplicate"; id: number; date: string; message: string }
  | { ok: false; kind: "budget"; needed: number; left: number; message: string }
  | { ok: false; kind: "claude" | "other"; message: string };

/**
 * "Start study" (D46): Claude drafts the plan for exactly the pick, your choices (sources, period) replace the plan's,
 * and collection starts at once. The study page then collects and reads the posts while it's open. Before anything
 * is spent it checks the budget and whether the same study already exists.
 */
export async function startStudyAction(input: StartStudyInput): Promise<StartStudyResult> {
  const denied = (await authed()) ?? (await budgetBlock());
  if (denied) return { ok: false, kind: "other", message: denied.message };
  const catalogId = Number(input?.catalogId);
  const nodeId = input?.nodeId === null ? null : Number(input?.nodeId);
  const raw = input?.choices;
  if (!Number.isInteger(catalogId) || catalogId <= 0 || (nodeId !== null && (!Number.isInteger(nodeId) || nodeId <= 0)) || !raw) {
    return { ok: false, kind: "other", message: "Pick a product first." };
  }
  const choices: StudyChoices = {
    sources: Array.isArray(raw.sources) ? raw.sources.filter((x): x is SourceId => x === "youtube" || x === "reddit") : [],
    period: raw.period,
    from: typeof raw.from === "string" ? raw.from : undefined,
    to: typeof raw.to === "string" ? raw.to : undefined,
    question: String(raw.question ?? "").trim(),
  };
  const problem = choicesProblem(choices);
  if (problem) return { ok: false, kind: "other", message: problem };

  const found = await getCatalog(catalogId).catch(() => null);
  const scope = found ? scopeFor(catalogId, found.tree, nodeId) : null;
  if (!scope) return { ok: false, kind: "other", message: "That product isn't in Products any more. Reload the page and pick again." };

  const window = windowFor(choices);
  // Only overview studies repeat each other; a question makes its own study.
  if (!input.force && !choices.question) {
    const same = (await studyRows(100).catch(() => [])).find(
      (r) => r.target?.catalogId === catalogId && r.target.nodeId === nodeId && r.periodKey === window?.label && window?.label !== "custom" && sameSources(r.sources, choices.sources) && !r.hasQuestion,
    );
    if (same) return { ok: false, kind: "duplicate", id: same.id, date: same.createdAt, message: "You already ran this study." };
  }

  const estimate = estimateStudy(choices.sources, usdPerCredit(), claudeModel());
  const spend = await monthToDate();
  if (spend.state === "ok") {
    const left = Math.max(0, spend.status.budgetUsd - spend.status.spentUsd);
    if (estimate.usd > left) return { ok: false, kind: "budget", needed: estimate.usd, left, message: "Not enough budget left this month." };
  }

  let drafted;
  try {
    drafted = await draftPlan(choices.question || `General overview of ${scope.label}`, new Date(), scope);
  } catch (err) {
    if (err instanceof PlannerError && err.cost) await recordCost({ ...err.cost }).catch(() => undefined);
    return { ok: false, kind: "claude", message: errorText(err) };
  }
  const plan = applyChoices(drafted.plan, choices, scope.label);
  const title = choices.question ? `${scope.label} · ${choices.question}` : scope.label;
  let id: number | undefined;
  try {
    id = await createSearch(title.slice(0, 300), plan, catalogId);
    const started = await startCollection(id);
    if (!started.started) return { ok: false, kind: "other", message: started.reason ?? "Couldn't start collecting." };
  } catch (err) {
    return { ok: false, kind: "other", message: `Couldn't start the study: ${errorText(err)}` };
  } finally {
    await recordCost({ searchId: id, ...drafted.cost }).catch(() => undefined);
  }
  revalidatePath("/");
  return { ok: true, id };
}

const sameSources = (labels: string[], ids: SourceId[]) =>
  labels.length === ids.length && ids.every((id) => labels.includes(id === "youtube" ? "YouTube" : "Reddit"));

/** ⋯ › Rename. */
export async function renameStudyAction(id: number, title: string): Promise<ActionState> {
  const denied = await authed();
  if (denied) return denied;
  const clean = String(title ?? "").trim().replace(/\s+/g, " ");
  if (!Number.isInteger(id) || id <= 0 || clean.length < 2 || clean.length > 120) return { ok: false, message: "Give it a name of 2 to 120 characters." };
  try {
    const ok = await renameSearch(id, clean);
    revalidatePath("/");
    return ok ? { ok: true, message: "Renamed." } : { ok: false, message: "That study is gone." };
  } catch (err) {
    return { ok: false, message: `Couldn't rename: ${errorText(err)}` };
  }
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

/** ⋯ › Remove: takes studies off All studies. Their posts and costs are kept (for an archive view later). */
export async function clearSearchesAction(ids: number[]): Promise<ActionState> {
  const denied = await authed();
  if (denied) return denied;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200 || !ids.every((id) => Number.isInteger(id) && id > 0)) {
    return { ok: false, message: "Unknown search." };
  }
  try {
    const n = await hideSearches(ids);
    revalidatePath("/");
    return { ok: true, message: n === 1 ? "Removed 1 study." : `Removed ${n} studies.` };
  } catch (err) {
    return { ok: false, message: `Couldn't remove: ${errorText(err)}` };
  }
}
