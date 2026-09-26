"use server";

import { revalidatePath } from "next/cache";

import { usdPerCredit } from "@/connectors/reddit";
import { authed, budgetBlock, errorText, type ActionState } from "@/lib/action-guards";
import { claudeModel } from "@/lib/ai";
import { scopeFor, type TreeNode } from "@/lib/catalog";
import { getCatalog } from "@/lib/catalogs";
import { startCollection } from "@/lib/collect";
import { compareConflict, type FamilyShape, type Pick } from "@/lib/compare-rules";
import { createComparison, hideComparison, renameComparison } from "@/lib/compare";
import { monthToDate, recordCost } from "@/lib/cost";
import { draftPlan, PlannerError } from "@/lib/planner";
import { createSearch, hideSearches } from "@/lib/searches";
import { applyChoices, choicesProblem, estimateStudy, type SourceId, type StudyChoices } from "@/lib/study-setup";

export interface StartComparisonInput {
  a: Pick;
  b: Pick;
  choices: StudyChoices;
}

export type StartComparisonResult =
  | { ok: true; id: number }
  | { ok: false; kind: "budget"; needed: number; left: number; message: string }
  | { ok: false; kind: "claude" | "other"; message: string };

const validPick = (p: unknown): p is Pick => {
  const x = p as Pick;
  return !!x && Number.isInteger(x.catalogId) && x.catalogId > 0 && (x.nodeId === null || (Number.isInteger(x.nodeId) && x.nodeId > 0));
};

const shape = (id: number, tree: TreeNode): FamilyShape => ({
  id,
  series: tree.children.filter((s) => s.id !== null).map((s) => ({ id: s.id!, models: s.children.filter((m) => m.id !== null).map((m) => ({ id: m.id! })) })),
});

/**
 * "Start comparison" (D48): two studies with the same sources, period, depth and question, one per product, run
 * side by side. Claude plans each side's searches for exactly its product; nothing starts unless both plans are made
 * and the budget covers both.
 */
export async function startComparisonAction(input: StartComparisonInput): Promise<StartComparisonResult> {
  const denied = (await authed()) ?? (await budgetBlock());
  if (denied) return { ok: false, kind: "other", message: denied.message };
  const raw = input?.choices;
  if (!validPick(input?.a) || !validPick(input?.b) || !raw) return { ok: false, kind: "other", message: "Pick two products first." };
  const choices: StudyChoices = {
    sources: Array.isArray(raw.sources) ? raw.sources.filter((x): x is SourceId => x === "youtube" || x === "reddit") : [],
    period: raw.period,
    from: typeof raw.from === "string" ? raw.from : undefined,
    to: typeof raw.to === "string" ? raw.to : undefined,
    question: String(raw.question ?? "").trim(),
  };
  const problem = choicesProblem(choices);
  if (problem) return { ok: false, kind: "other", message: problem };

  const [fa, fb] = await Promise.all([getCatalog(input.a.catalogId).catch(() => null), getCatalog(input.b.catalogId).catch(() => null)]);
  const sa = fa ? scopeFor(input.a.catalogId, fa.tree, input.a.nodeId) : null;
  const sb = fb ? scopeFor(input.b.catalogId, fb.tree, input.b.nodeId) : null;
  if (!fa || !fb || !sa || !sb) return { ok: false, kind: "other", message: "A product isn't in Products any more. Reload the page and pick again." };
  const conflict = compareConflict([shape(input.a.catalogId, fa.tree), shape(input.b.catalogId, fb.tree)], input.a, input.b);
  if (conflict) return { ok: false, kind: "other", message: `These two can't be compared (${conflict.toLowerCase()}). Pick two different products.` };

  const one = estimateStudy(choices.sources, usdPerCredit(), claudeModel()).usd;
  const needed = one * 2;
  const spend = await monthToDate();
  if (spend.state === "ok") {
    const left = Math.max(0, spend.status.budgetUsd - spend.status.spentUsd);
    if (needed > left) return { ok: false, kind: "budget", needed, left, message: "Not enough budget left this month." };
  }

  const topic = (label: string) => choices.question || `General overview of ${label}`;
  const drafts = await Promise.allSettled([draftPlan(topic(sa.label), new Date(), sa), draftPlan(topic(sb.label), new Date(), sb)]);
  const failed = drafts.find((d): d is PromiseRejectedResult => d.status === "rejected");
  if (failed) {
    // What was spent is recorded even though nothing starts.
    for (const d of drafts) {
      if (d.status === "fulfilled") await recordCost({ ...d.value.cost }).catch(() => undefined);
      else if (d.reason instanceof PlannerError && d.reason.cost) await recordCost({ ...d.reason.cost }).catch(() => undefined);
    }
    return { ok: false, kind: "claude", message: errorText(failed.reason) };
  }
  const [da, db] = drafts.map((d) => (d as PromiseFulfilledResult<Awaited<ReturnType<typeof draftPlan>>>).value);
  const planA = applyChoices(da.plan, choices, sa.label);
  const planB = applyChoices(db.plan, choices, sb.label);
  // The same depth for both sides, whatever each plan proposed: the fairness rule is same rules for both.
  planB.postCap = planA.postCap = Math.max(planA.postCap, planB.postCap);

  const title = `${sa.label} vs ${sb.label}${choices.question ? ` · ${choices.question}` : ""}`;
  let a: number | undefined;
  let b: number | undefined;
  let id: number | undefined;
  try {
    a = await createSearch(sa.label.slice(0, 300), planA, input.a.catalogId);
    b = await createSearch(sb.label.slice(0, 300), planB, input.b.catalogId);
    id = await createComparison(title, a, b);
    // Once the comparison exists it is the result: a side that didn't start shows on its page with Collect again,
    // rather than a second Start making a second comparison.
    await Promise.allSettled([startCollection(a), startCollection(b)]);
    revalidatePath("/");
    return { ok: true, id };
  } catch (err) {
    // Half made: nothing is left behind as a stray study (posts and costs are kept, as for any removed study).
    if (id === undefined) await hideSearches([a, b].filter((x): x is number => x !== undefined)).catch(() => undefined);
    else {
      revalidatePath("/");
      return { ok: true, id };
    }
    return { ok: false, kind: "other", message: `Couldn't start the comparison: ${errorText(err)}` };
  } finally {
    await recordCost({ searchId: a, ...da.cost }).catch(() => undefined);
    await recordCost({ searchId: b, ...db.cost }).catch(() => undefined);
  }
}

export async function renameComparisonAction(id: number, title: string): Promise<ActionState> {
  const denied = await authed();
  if (denied) return denied;
  const clean = String(title ?? "").trim().replace(/\s+/g, " ");
  if (!Number.isInteger(id) || id <= 0 || clean.length < 2 || clean.length > 160) return { ok: false, message: "Give it a name of 2 to 160 characters." };
  try {
    const ok = await renameComparison(id, clean);
    revalidatePath("/");
    revalidatePath(`/compare/${id}`);
    return ok ? { ok: true, message: "Renamed." } : { ok: false, message: "That comparison is gone." };
  } catch (err) {
    return { ok: false, message: `Couldn't rename: ${errorText(err)}` };
  }
}

export async function removeComparisonAction(id: number): Promise<ActionState> {
  const denied = await authed();
  if (denied) return denied;
  if (!Number.isInteger(id) || id <= 0) return { ok: false, message: "Unknown comparison." };
  try {
    const ok = await hideComparison(id);
    revalidatePath("/");
    return ok ? { ok: true, message: "Removed the comparison." } : { ok: false, message: "That comparison is gone." };
  } catch (err) {
    return { ok: false, message: `Couldn't remove: ${errorText(err)}` };
  }
}
