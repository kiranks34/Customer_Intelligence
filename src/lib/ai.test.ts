import { describe, expect, it } from "vitest";

import { claudeErrorText, claudeModel } from "./ai";

describe("claudeModel", () => {
  it("uses the setting when there is one", () => {
    expect(claudeModel(" anthropic/claude-sonnet-5 ")).toBe("anthropic/claude-sonnet-5");
    expect(claudeModel("")).toBe("anthropic/claude-opus-5");
    expect(claudeModel(undefined)).toBe("anthropic/claude-opus-5");
  });
});

describe("claudeErrorText", () => {
  const m = "anthropic/claude-sonnet-5";
  it("says what to do when the Gateway refuses the model", () => {
    const text = claudeErrorText(new Error("Failed after 2 attempts. Last error: GatewayRateLimitError: No access to this model at this time."), m);
    expect(text).toContain("won't run anthropic/claude-sonnet-5");
    expect(text).toContain("PULSE_CLAUDE_MODEL");
  });
  it("names busy and out-of-credit cases", () => {
    expect(claudeErrorText(new Error("429 Too Many Requests"), m)).toContain("busy");
    expect(claudeErrorText(new Error("Insufficient funds"), m)).toContain("credits have run out");
  });
  it("keeps other messages, cut short", () => {
    expect(claudeErrorText(new Error("x".repeat(500)), m)).toHaveLength(300);
    expect(claudeErrorText("plain", m)).toBe("plain");
  });
});
