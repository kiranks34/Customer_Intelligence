"use server";

import { revalidatePath } from "next/cache";

import { authed, budgetBlock, errorText, type ActionState } from "@/lib/action-guards";
import { activeRuns, finishedHeadline, keepDriven, resumeRuns, runStateOf, runStep, stopRuns, type ActiveRun, type RunState } from "@/lib/runs";
import type { Headline } from "@/lib/studies";

const validIds = (ids: unknown): ids is number[] =>
  Array.isArray(ids) && ids.length > 0 && ids.length <= 50 && ids.every((id) => Number.isInteger(id) && id > 0);

/** The studies being worked on, for the runner and the live status (D49). */
export async function activeRunsAction(): Promise<ActiveRun[] | ActionState> {
  const denied = await authed();
  if (denied) return denied;
  try {
    return await activeRuns();
  } catch (err) {
    return { ok: false, message: errorText(err) };
  }
}

/** One step of a study's run (the runner calls it for every study with open work). */
export async function runStepAction(searchId: number): Promise<(RunState & { worked: boolean }) | ActionState> {
  const denied = await authed();
  if (denied) return denied;
  if (!validIds([searchId])) return { ok: false, message: "Unknown study." };
  try {
    return await runStep(searchId);
  } catch (err) {
    return { ok: false, message: `Step failed: ${errorText(err)}` };
  }
}

/** The driving tab is still working on these (each pass, before stepping any). */
export async function keepDrivenAction(ids: number[]): Promise<void> {
  const denied = await authed();
  if (denied || !validIds(ids)) return;
  await keepDriven(ids).catch(() => undefined);
}

/** Where studies stand, without working on them (a tab that isn't the one driving, or a finished run). */
export async function runStatesAction(ids: number[]): Promise<RunState[] | ActionState> {
  const denied = await authed();
  if (denied) return denied;
  if (!validIds(ids)) return { ok: false, message: "Unknown study." };
  try {
    return await Promise.all(ids.map((id) => runStateOf(id)));
  } catch (err) {
    return { ok: false, message: errorText(err) };
  }
}

export async function stopRunsAction(ids: number[]): Promise<ActionState> {
  const denied = await authed();
  if (denied) return denied;
  if (!validIds(ids)) return { ok: false, message: "Unknown study." };
  try {
    await stopRuns(ids);
    return { ok: true, message: "Stopping." };
  } catch (err) {
    return { ok: false, message: `Couldn't stop: ${errorText(err)}` };
  }
}

export async function resumeRunsAction(ids: number[]): Promise<ActionState> {
  const denied = (await authed()) ?? (await budgetBlock());
  if (denied) return denied;
  if (!validIds(ids)) return { ok: false, message: "Unknown study." };
  try {
    await resumeRuns(ids);
    return { ok: true, message: "Resumed." };
  } catch (err) {
    return { ok: false, message: `Couldn't resume: ${errorText(err)}` };
  }
}

/** A run finished: its one-line result for the toast, and fresh pages. */
export async function runFinishedAction(searchId: number): Promise<Headline | null> {
  const denied = await authed();
  if (denied || !validIds([searchId])) return null;
  revalidatePath("/");
  return finishedHeadline(searchId).catch(() => null);
}
