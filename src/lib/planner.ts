import "server-only";

import { generateText, NoObjectGeneratedError, Output } from "ai";

import type { CallCost } from "@/connectors/types";

import { claudeModel, tokenCostUsd } from "./ai";
import { normalizePlan, PlanSchema, type Plan } from "./plan";

const SYSTEM = `You plan data collection for Pulse, a customer-intelligence tool that reads public posts (YouTube comments and Reddit posts/comments) about products.

The user types either a topic ("HP Smart Tank printers", "what Gen Z says about printers") or a question
("How did Smart Tank 5000 series perform last month?", "How many users talked about connectivity issues last week?").

Produce a plan:
- intent: "question" if they ask something specific (a metric, a time period, an issue); otherwise "topic".
- subject and kind: what is being researched. A product line with many models (e.g. HP Smart Tank) is a "family".
- question: for questions, restate it precisely; else null. focus: the themes a question is about (e.g. connectivity, wifi, bluetooth).
- timeWindow: convert relative periods to exact ISO dates using today's date. "last week" / "past 7 days" =
  from today minus 6 days to today; "last month" = the previous calendar month (first to last day). No period mentioned: from and to null, label "all time".
- aliases: model numbers, series and regional names, common misspellings people really use.
- youtube.queries / reddit.queries: 2-4 short search strings each that real people would type or title videos with.
  Cover the family name plus its most discussed models or series. For a focus, include it in some queries
  (e.g. "Smart Tank wifi problem"). No boolean operators.
- Defaults unless the question needs otherwise: youtube.videosPerQuery 5, commentsPerVideo 50, reddit.commentThreadsPerQuery 3, postCap 300.
- exclusions: words that indicate a different product with a similar name.
- notes: 1-2 plain sentences on what will be collected and any limitation (e.g. public posts only, so counts are
  "people who posted", not all customers).`;

export interface PlannerResult {
  plan: Plan;
  cost: CallCost & { provider: "anthropic" };
}

/** A planning failure that still consumed (and must record) tokens. */
export class PlannerError extends Error {
  constructor(
    message: string,
    public readonly cost: (CallCost & { provider: "anthropic" }) | null,
  ) {
    super(message);
    this.name = "PlannerError";
  }
}

function costOf(model: string, inputTokens = 0, outputTokens = 0): CallCost & { provider: "anthropic" } {
  return { provider: "anthropic", operation: "plan", usd: tokenCostUsd(model, inputTokens, outputTokens), units: { inputTokens, outputTokens } };
}

export async function draftPlan(input: string, today = new Date()): Promise<PlannerResult> {
  if (!process.env.AI_GATEWAY_API_KEY) throw new Error("AI_GATEWAY_API_KEY is not set");
  const model = claudeModel();
  try {
    const result = await generateText({
      model,
      system: SYSTEM,
      prompt: `Today's date: ${today.toISOString().slice(0, 10)}\nRegion: North America (English)\n\nUser input: ${input}`,
      output: Output.object({ schema: PlanSchema }),
      maxOutputTokens: 8000,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(90_000),
    });
    return { plan: normalizePlan(result.output), cost: costOf(model, result.usage.inputTokens, result.usage.outputTokens) };
  } catch (err) {
    // Output that didn't fit the schema was still generated and billed.
    const usage = NoObjectGeneratedError.isInstance(err) ? err.usage : undefined;
    const cost = usage ? costOf(model, usage.inputTokens, usage.outputTokens) : null;
    throw new PlannerError(err instanceof Error ? err.message.slice(0, 300) : "unknown error", cost);
  }
}
