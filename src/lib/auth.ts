import "server-only";

import { cookies } from "next/headers";

import { SESSION_COOKIE, authConfig, isValidSession } from "./session";

/**
 * Defence in depth for Server Functions and route handlers: the proxy already gates every page,
 * but each action that reads or spends should call this first.
 */
export async function requireSession(): Promise<void> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!isValidSession(value, authConfig())) throw new Error("unauthorized");
}
