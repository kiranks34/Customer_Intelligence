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

/**
 * A short, readable error. Database errors wrap the real reason in `cause` behind a long "Failed query: …" text,
 * so the reason is shown instead of the query.
 */
export function errorText(err: unknown): string {
  if (!(err instanceof Error)) return "unknown error";
  const cause = err.cause instanceof Error ? err.cause.message : null;
  const message = cause && err.message.startsWith("Failed query") ? `database error: ${cause}` : err.message;
  return message.slice(0, 300);
}
