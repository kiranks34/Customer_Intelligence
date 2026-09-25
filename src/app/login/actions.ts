"use server";

import { setTimeout as sleep } from "node:timers/promises";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { safeNext } from "@/lib/redirect";
import {
  MIN_PASSCODE_LENGTH,
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
  authConfig,
  safeEqual,
  sessionToken,
} from "@/lib/session";

/** Slows down online guessing. Combined with the minimum passcode length this makes brute force impractical. */
const FAILED_LOGIN_DELAY_MS = 1500;

export async function login(_prev: { error?: string } | undefined, form: FormData): Promise<{ error?: string }> {
  const cfg = authConfig();
  if (!cfg) {
    return {
      error: `Pulse is not configured: set PULSE_SESSION_SECRET and a PULSE_PASSCODE of at least ${MIN_PASSCODE_LENGTH} characters.`,
    };
  }

  const passcode = form.get("passcode");
  if (typeof passcode !== "string" || !safeEqual(passcode, cfg.passcode)) {
    await sleep(FAILED_LOGIN_DELAY_MS);
    return { error: "Wrong passcode." };
  }

  (await cookies()).set(SESSION_COOKIE, sessionToken(cfg.passcode, cfg.secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
  redirect(safeNext(form.get("next")));
}
