import "server-only";

import { requireSession } from "./auth";
import { paidWorkBlockedReason } from "./cost";

/** Result of a server action, shown to the user as a short message. */
export interface ActionState {
  ok: boolean;
  message: string;
}

/** Null when signed in; otherwise the message to show. Every server action checks this first. */
export async function authed(): Promise<ActionState | null> {
  try {
    await requireSession();
    return null;
  } catch {
    return { ok: false, message: "Your session has expired. Reload the page and sign in again." };
  }
}

/** Null when paid work may run; otherwise why not (budget reached, spend unknown). Fails closed. */
export async function budgetBlock(): Promise<ActionState | null> {
  const reason = await paidWorkBlockedReason();
  return reason ? { ok: false, message: `Blocked: ${reason}.` } : null;
}

export const errorText = (err: unknown) => (err instanceof Error ? err.message.slice(0, 300) : "unknown error");
