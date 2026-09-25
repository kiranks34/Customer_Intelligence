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

/**
 * A Claude call's failure in plain words. The Gateway's own messages ("GatewayRateLimitError: No access to this
 * model at this time") don't say what to do.
 */
export function claudeErrorText(err: unknown, model: string): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/no access to this model|model.*not (found|available)/i.test(message)) {
    return `Vercel AI Gateway won't run ${model} right now. Try again in a minute. If it keeps happening, check your Gateway credits and that PULSE_CLAUDE_MODEL names a model your Gateway allows.`;
  }
  if (/insufficient|credits?\b.*(exhausted|run out|remaining)|payment required|\b402\b/i.test(message)) {
    return "Your Vercel AI Gateway credits have run out. Top up in Vercel → AI Gateway, then try again.";
  }
  if (/rate.?limit|too many requests|\b429\b/i.test(message)) return "Vercel AI Gateway is busy. Try again in a minute.";
  return message.slice(0, 300);
}
