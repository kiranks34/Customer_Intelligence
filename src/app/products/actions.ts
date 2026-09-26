"use server";

import { revalidatePath } from "next/cache";

import { authed, budgetBlock, errorText, type ActionState } from "@/lib/action-guards";
import { addUserFact, removeFact, runUpdateStep, UPDATE_STEPS } from "@/lib/product-knowledge";

const validId = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0;

export type StepResult = (ActionState & { ok: true; runId: number; done: boolean }) | (ActionState & { ok: false });

/**
 * One step of "Update from <maker site>" (D45). The page calls step 0, then step 1 with the run id step 0 returned, so
 * each fits one server call and the page can show progress between them.
 */
export async function updateKnowledgeStepAction(catalogId: number, step: number, runId: number | null): Promise<StepResult> {
  const denied = (await authed()) ?? (await budgetBlock());
  if (denied) return { ok: false, message: denied.message };
  if (!validId(catalogId) || !Number.isInteger(step) || step < 0 || step >= UPDATE_STEPS.length || (runId !== null && !validId(runId))) {
    return { ok: false, message: "Unknown update." };
  }
  try {
    const r = await runUpdateStep(catalogId, step, runId);
    if (r.done) revalidatePath(`/products/${catalogId}`);
    return { ok: true, ...r, message: r.done ? "Updated." : `Checked ${UPDATE_STEPS[0].length} of ${UPDATE_STEPS.flat().length} topics…` };
  } catch (err) {
    return { ok: false, message: `Couldn't update: ${errorText(err)}` };
  }
}

export async function addFactAction(catalogId: number, text: string): Promise<ActionState> {
  const denied = await authed();
  if (denied) return denied;
  if (!validId(catalogId) || typeof text !== "string") return { ok: false, message: "Unknown product family." };
  try {
    const ok = await addUserFact(catalogId, text);
    if (ok) revalidatePath(`/products/${catalogId}`);
    return ok ? { ok: true, message: "Added." } : { ok: false, message: "Write a fact of 3 to 300 characters (up to 20 of your own)." };
  } catch (err) {
    return { ok: false, message: `Couldn't add: ${errorText(err)}` };
  }
}

export async function removeFactAction(catalogId: number, factId: string): Promise<ActionState> {
  const denied = await authed();
  if (denied) return denied;
  if (!validId(catalogId) || typeof factId !== "string" || factId.length > 40) return { ok: false, message: "Unknown fact." };
  try {
    const ok = await removeFact(catalogId, factId);
    if (ok) revalidatePath(`/products/${catalogId}`);
    return ok ? { ok: true, message: "Removed." } : { ok: false, message: "That fact is already gone." };
  } catch (err) {
    return { ok: false, message: `Couldn't remove: ${errorText(err)}` };
  }
}
