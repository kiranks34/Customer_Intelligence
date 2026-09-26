"use server";

import { revalidatePath } from "next/cache";

import { authed, budgetBlock, errorText, type ActionState } from "@/lib/action-guards";
import {
  advanceAnalysis,
  analysisBusy,
  analysisState,
  latestCodebook,
  proposeCodebook,
  resumeAnalysis,
  runAutoCheck,
  saveCodebook,
  saveReview,
  saveSpotCheck,
  startAnalysis,
  type AnalysisState,
} from "@/lib/analysis";
import { validateCodebook, type Codebook } from "@/lib/codebook";
import { comparisonOf, getComparison, shareCategories, syncOtherSide } from "@/lib/compare";
import { factsNotUsed, notesFor } from "@/lib/knowledge";
import { codebookKnowledge, knowledgeForSearch } from "@/lib/product-knowledge";

const validId = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0;

/** "Analyze N posts": drafts the codebook on first use (one Claude call), then queues Jev for every new post. */
export async function startAnalysisAction(searchId: number): Promise<ActionState> {
  const denied = (await authed()) ?? (await budgetBlock());
  if (denied) return denied;
  if (!validId(searchId)) return { ok: false, message: "Unknown search." };
  try {
    // A side of a comparison (D48) is read with the categories both sides share, drafted once from both.
    const link = await comparisonOf(searchId);
    const pair = link ? await getComparison(link.id) : null;
    // A side with no posts yet has nothing to read; the shared draft waits until it (or the other side) is read.
    const shared = pair && (await analysisState(searchId)).totalPosts > 0 ? await shareCategories(pair) : null;
    const r = await startAnalysis(searchId);
    if (!r.started) return { ok: false, message: r.reason };
    if (shared?.drafted) return { ok: true, message: "Drafted the categories both products share. Jev is reading the posts…" };
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
    // In a comparison the other side takes the same lists (D48), so it mustn't be mid-read either.
    const link = await comparisonOf(searchId);
    if ((await analysisBusy(searchId)) || (link && (await analysisBusy(link.other)))) return { ok: false, message: "Jev is still reading posts. Save your edits when it has finished." };
    const current = await latestCodebook(searchId);
    if (!current) return { ok: false, message: "Analyze the posts first; the codebook is drafted then." };
    if (JSON.stringify(current.codebook) === JSON.stringify(checked.codebook)) return { ok: true, message: "No changes." };
    const version = await saveCodebook(searchId, checked.codebook);
    // The other side of a comparison takes the same lists, so the two stay comparable (D48).
    if (link) {
      await syncOtherSide(searchId);
      revalidatePath(`/searches/${link.other}`);
      revalidatePath(`/compare/${link.id}`);
    }
    revalidatePath(`/searches/${searchId}`);
    const state = await analysisState(searchId);
    return { ok: true, message: `Saved as version ${version}. Re-analyze (top of the page) applies it to all ${state.totalPosts} posts.` };
  } catch (err) {
    return { ok: false, message: `Couldn't save: ${errorText(err)}` };
  }
}

/** Saves your answers for one spot-check post. */
export async function saveSpotCheckAction(searchId: number, version: number, postId: number, answers: Record<string, string>): Promise<ActionState> {
  const denied = await authed();
  if (denied) return denied;
  if (!validId(searchId) || !validId(version) || !validId(postId) || typeof answers !== "object" || answers === null) return { ok: false, message: "Unknown post." };
  try {
    const clean = Object.fromEntries(Object.entries(answers).filter(([k, v]) => typeof k === "string" && typeof v === "string").slice(0, 40));
    if (!(await saveSpotCheck(searchId, version, postId, clean))) return { ok: false, message: "That post isn't in this search." };
    revalidatePath(`/searches/${searchId}`);
    return { ok: true, message: "Saved." };
  } catch (err) {
    return { ok: false, message: `Couldn't save: ${errorText(err)}` };
  }
}

export type ProposalResult = (ActionState & { ok: true; codebook: Codebook }) | (ActionState & { ok: false });

/** "Improve rules": asks Claude for clearer rules (a few cents). Returns a proposal for the editor; nothing is saved. */
export async function proposeCodebookAction(searchId: number): Promise<ProposalResult> {
  const denied = (await authed()) ?? (await budgetBlock());
  if (denied) return { ok: false, message: denied.message };
  if (!validId(searchId)) return { ok: false, message: "Unknown search." };
  try {
    const { codebook, mistakes } = await proposeCodebook(searchId);
    return {
      ok: true,
      codebook,
      message: mistakes
        ? `Claude's proposal fixes ${mistakes} ${mistakes === 1 ? "mistake" : "mistakes"} found in Accuracy. Review it, then Save changes.`
        : "Claude's proposal adds clear rules and real examples. Review it, then Save changes.",
    };
  } catch (err) {
    return { ok: false, message: `Couldn't get a proposal: ${errorText(err)}` };
  }
}

/** Claude checks Jev on the 20 sample posts (a few cents); you then only look where they disagree. */
export async function autoCheckAction(searchId: number): Promise<ActionState> {
  const denied = (await authed()) ?? (await budgetBlock());
  if (denied) return denied;
  if (!validId(searchId)) return { ok: false, message: "Unknown search." };
  try {
    const { posts } = await runAutoCheck(searchId);
    revalidatePath(`/searches/${searchId}`);
    return { ok: true, message: `Claude checked ${posts} posts. Look at the ones where it disagrees with Jev.` };
  } catch (err) {
    return { ok: false, message: `Couldn't run the auto-check: ${errorText(err)}` };
  }
}

/**
 * "Re-analyze" from Product knowledge: the study's definitions take the family's latest knowledge (a new version, with
 * the same themes, stages and lists), then Jev reads the posts again with it.
 */
export async function reanalyzeWithKnowledgeAction(searchId: number): Promise<ActionState> {
  const denied = (await authed()) ?? (await budgetBlock());
  if (denied) return denied;
  if (!validId(searchId)) return { ok: false, message: "Unknown search." };
  try {
    if (await analysisBusy(searchId)) return { ok: false, message: "The analysis is running; wait for it to finish." };
    const current = await latestCodebook(searchId);
    const fam = await knowledgeForSearch(searchId);
    if (!current || !fam) return { ok: false, message: "Analyze the posts first." };
    // Nothing new to apply: never re-read (and pay for) every post again with the same knowledge.
    if (factsNotUsed(fam.knowledge, current.codebook) === 0) return { ok: false, message: "This study already uses the latest product knowledge." };
    const { productFacts, productNotes } = codebookKnowledge(fam.knowledge);
    // Notes typed into this study before knowledge moved to the family (D44) are kept after your family facts.
    const notes = notesFor(productNotes.split("\n"), current.codebook.productNotes ?? "");
    const next: Codebook = { ...current.codebook, productFacts, productNotes: notes || undefined };
    const checked = validateCodebook(next);
    if (!checked.ok) return { ok: false, message: checked.error };
    await saveCodebook(searchId, checked.codebook);
    const r = await startAnalysis(searchId);
    revalidatePath(`/searches/${searchId}`);
    return r.started ? { ok: true, message: "Reading the posts again with the latest product knowledge…" } : { ok: false, message: r.reason };
  } catch (err) {
    return { ok: false, message: `Couldn't re-analyze: ${errorText(err)}` };
  }
}
