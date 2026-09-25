"use server";

import { revalidatePath } from "next/cache";

import { authed, budgetBlock, errorText, type ActionState } from "@/lib/action-guards";
import { advanceAnalysis, analysisBusy, analysisState, latestCodebook, resumeAnalysis, saveCodebook, saveReview, startAnalysis, type AnalysisState } from "@/lib/analysis";
import { validateCodebook } from "@/lib/codebook";

const validId = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0;

/** "Analyze N posts": drafts the codebook on first use (one Claude call), then queues Jev for every new post. */
export async function startAnalysisAction(searchId: number): Promise<ActionState> {
  const denied = (await authed()) ?? (await budgetBlock());
  if (denied) return denied;
  if (!validId(searchId)) return { ok: false, message: "Unknown search." };
  try {
    const r = await startAnalysis(searchId);
    if (!r.started) return { ok: false, message: r.reason };
    return { ok: true, message: r.drafted ? "Drafted the themes and stages from a sample. Jev is reading the posts…" : "Jev is reading the posts…" };
  } catch (err) {
    return { ok: false, message: `Couldn't start the analysis: ${errorText(err)}` };
  }
}

export async function advanceAnalysisAction(searchId: number): Promise<AnalysisState | ActionState> {
  const denied = await authed();
  if (denied) return denied;
  if (!validId(searchId)) return { ok: false, message: "Unknown search." };
  try {
    return await advanceAnalysis(searchId);
  } catch (err) {
    return { ok: false, message: `Analysis step failed: ${errorText(err)}` };
  }
}

export async function resumeAnalysisAction(searchId: number): Promise<ActionState> {
  const denied = (await authed()) ?? (await budgetBlock());
  if (denied) return denied;
  if (!validId(searchId)) return { ok: false, message: "Unknown search." };
  try {
    await resumeAnalysis(searchId);
    return { ok: true, message: "Resumed." };
  } catch (err) {
    return { ok: false, message: `Couldn't resume: ${errorText(err)}` };
  }
}

/** Keep or Drop a post Jev was unsure about. */
export async function reviewAction(searchId: number, postId: number, version: number, keep: boolean): Promise<ActionState> {
  const denied = await authed();
  if (denied) return denied;
  if (!validId(searchId) || !validId(postId) || !validId(version)) return { ok: false, message: "Unknown post." };
  try {
    const saved = await saveReview(searchId, postId, version, keep === true);
    if (!saved) return { ok: false, message: "That post isn't in this search." };
    revalidatePath(`/searches/${searchId}`);
    return { ok: true, message: keep ? "Kept." : "Dropped." };
  } catch (err) {
    return { ok: false, message: `Couldn't save: ${errorText(err)}` };
  }
}

/** Saves edited themes, stages and segments as a new codebook version. Posts are re-read with it when you press Analyze. */
export async function saveCodebookAction(searchId: number, candidate: unknown): Promise<ActionState> {
  const denied = await authed();
  if (denied) return denied;
  if (!validId(searchId)) return { ok: false, message: "Unknown search." };
  const checked = validateCodebook(candidate);
  if (!checked.ok) return { ok: false, message: checked.error };
  try {
    if (await analysisBusy(searchId)) return { ok: false, message: "Jev is still reading posts. Save your edits when it has finished." };
    const current = await latestCodebook(searchId);
    if (!current) return { ok: false, message: "Analyze the posts first; the codebook is drafted then." };
    if (JSON.stringify(current.codebook) === JSON.stringify(checked.codebook)) return { ok: true, message: "No changes." };
    const version = await saveCodebook(searchId, checked.codebook);
    revalidatePath(`/searches/${searchId}`);
    const state = await analysisState(searchId);
    return { ok: true, message: `Saved as version ${version}. Re-analyze ${state.pending} posts to apply it.` };
  } catch (err) {
    return { ok: false, message: `Couldn't save: ${errorText(err)}` };
  }
}
