/**
 * Claude through Vercel AI Gateway (docs/DECISIONS.md D4, D15). The gateway reads AI_GATEWAY_API_KEY itself.
 * Costs are estimated from token usage; the gateway dashboard remains the exact record.
 */
export const DEFAULT_CLAUDE_MODEL = "anthropic/claude-opus-5";

export function claudeModel(env: string | undefined = process.env.PULSE_CLAUDE_MODEL): string {
  return env?.trim() || DEFAULT_CLAUDE_MODEL;
}

/** USD per million tokens (list prices). Unknown models fall back to the most expensive known price, so estimates err high. */
const PRICES: Record<string, { input: number; output: number }> = {
  "anthropic/claude-opus-5": { input: 5, output: 25 },
  "anthropic/claude-sonnet-5": { input: 2, output: 10 },
  "anthropic/claude-haiku-4.5": { input: 1, output: 5 },
};
const FALLBACK = { input: 10, output: 50 };

export function tokenCostUsd(model: string, inputTokens = 0, outputTokens = 0): number {
  const p = PRICES[model] ?? FALLBACK;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
