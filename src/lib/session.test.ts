import { describe, expect, it } from "vitest";

import { SESSION_MAX_AGE_S, authConfig, isValidSession, sessionToken } from "./session";

const cfg = { passcode: "open-sesame-123", secret: "s3cret" };
const NOW = Date.UTC(2026, 8, 24);

describe("session", () => {
  it("accepts a fresh token and rejects forgeries", () => {
    expect(isValidSession(sessionToken(cfg.passcode, cfg.secret, NOW), cfg, NOW)).toBe(true);
    expect(isValidSession("forged", cfg, NOW)).toBe(false);
    expect(isValidSession("123.abc", cfg, NOW)).toBe(false);
    expect(isValidSession(undefined, cfg, NOW)).toBe(false);
  });
  it("rejects a tampered issue time", () => {
    const [, mac] = sessionToken(cfg.passcode, cfg.secret, NOW).split(".");
    expect(isValidSession(`${Math.floor(NOW / 1000) + 5}.${mac}`, cfg, NOW)).toBe(false);
  });
  it("expires server-side after the max age", () => {
    const token = sessionToken(cfg.passcode, cfg.secret, NOW);
    expect(isValidSession(token, cfg, NOW + (SESSION_MAX_AGE_S - 1) * 1000)).toBe(true);
    expect(isValidSession(token, cfg, NOW + (SESSION_MAX_AGE_S + 1) * 1000)).toBe(false);
  });
  it("invalidates sessions when the passcode or secret changes", () => {
    const token = sessionToken(cfg.passcode, cfg.secret, NOW);
    expect(isValidSession(token, { ...cfg, passcode: "another-passcode" }, NOW)).toBe(false);
    expect(isValidSession(token, { ...cfg, secret: "rotated" }, NOW)).toBe(false);
  });
  it("denies everything when not configured or the passcode is too short", () => {
    const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;
    expect(authConfig(env({ PULSE_PASSCODE: "open-sesame-123" }))).toBeNull();
    expect(authConfig(env({ PULSE_PASSCODE: "short", PULSE_SESSION_SECRET: "s" }))).toBeNull();
    expect(authConfig(env({ PULSE_PASSCODE: "open-sesame-123", PULSE_SESSION_SECRET: "s" }))).not.toBeNull();
    expect(isValidSession(sessionToken("", "", NOW), null, NOW)).toBe(false);
  });
});
