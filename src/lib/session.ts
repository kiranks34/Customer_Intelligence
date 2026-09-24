import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "pulse_session";
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30;
/** Short passcodes are easy to guess online; refuse to run with one. */
export const MIN_PASSCODE_LENGTH = 12;

function sign(passcode: string, secret: string, issuedAt: number): string {
  return createHmac("sha256", secret).update(`pulse-session:${issuedAt}:${passcode}`).digest("hex");
}

/**
 * Cookie value `<issuedAtSeconds>.<hmac>`. It expires server-side after SESSION_MAX_AGE_S,
 * and changing the passcode or secret signs out every device.
 */
export function sessionToken(passcode: string, secret: string, nowMs: number = Date.now()): string {
  const issuedAt = Math.floor(nowMs / 1000);
  return `${issuedAt}.${sign(passcode, secret, issuedAt)}`;
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export interface AuthConfig {
  passcode: string;
  secret: string;
}

export function authConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig | null {
  const passcode = env.PULSE_PASSCODE;
  const secret = env.PULSE_SESSION_SECRET;
  if (!passcode || !secret || passcode.length < MIN_PASSCODE_LENGTH) return null;
  return { passcode, secret };
}

export function isValidSession(
  cookieValue: string | undefined,
  cfg: AuthConfig | null,
  nowMs: number = Date.now(),
): boolean {
  if (!cfg || !cookieValue) return false;
  const dot = cookieValue.indexOf(".");
  if (dot <= 0) return false;
  const issuedAtRaw = cookieValue.slice(0, dot);
  if (!/^\d+$/.test(issuedAtRaw)) return false;
  const issuedAt = Number(issuedAtRaw);
  const age = Math.floor(nowMs / 1000) - issuedAt;
  if (age < -60 || age > SESSION_MAX_AGE_S) return false;
  return safeEqual(cookieValue.slice(dot + 1), sign(cfg.passcode, cfg.secret, issuedAt));
}
