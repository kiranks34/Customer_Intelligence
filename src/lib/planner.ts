import "server-only";

import { generateText, NoObjectGeneratedError, Output } from "ai";

import type { CallCost } from "@/connectors/types";

import { claudeModel, tokenCostUsd } from "./ai";
import type { Scope } from "./catalog";
import { DraftPlanSchema, normalizePlan, type Plan } from "./plan";

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
- Defaults unless the question needs otherwise: youtube.videosPerQuery 5, commentsPerVideo 50, reddit.commentThreadsPerQuery 3, postCap 300 (per channel).
- exclusions: only words for UNRELATED things that share a word with the subject (e.g. "fish tank", "propane tank").
  Never exclude competitors or other brands: comparisons ("vs EcoTank") are valuable evidence. Usually 0-3 terms.
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

/**
 * Drafts a plan for a typed input. With a scope (a family, series or model picked from the catalog), the plan is
 * about exactly that product: its subject, kind and names come from the catalog, and searches must name it.
 */
export async function draftPlan(input: string, today = new Date(), scope?: Scope): Promise<PlannerResult> {
  if (!process.env.AI_GATEWAY_API_KEY) throw new Error("AI_GATEWAY_API_KEY is not set");
  const model = claudeModel();
  try {
    const result = await generateText({
      model,
      system: SYSTEM,
      prompt: [
        `Today's date: ${today.toISOString().slice(0, 10)}`,
        "Region: North America (English)",
        scope
          ? [
              `The user picked this product from the catalog: ${scope.label} (${scope.level}). Plan for exactly it.`,
              `Every search string must contain one of these full names: ${scope.searchNames.join(", ")}. Never a bare model number on its own.`,
              scope.modelNumbers.length ? `Its models: ${scope.modelNumbers.join(", ")} (you may name one with the family, e.g. "Smart Tank ${scope.modelNumbers[0]}").` : "",
            ].join(" ")
          : null,
        `User input: ${input}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      output: Output.object({ schema: DraftPlanSchema }),
      maxOutputTokens: 8000,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(90_000),
    });
    const drafted = normalizePlan(result.output);
    // The pick decides what the search is about, whatever the model wrote.
    const plan = scope
      ? normalizePlan({
          ...drafted,
          subject: scope.label,
          kind: scope.level === "model" ? "product" : "family",
          // The pick's names first, then Claude's (misspellings, regional names); the catalog already matches numbers.
          aliases: [...scope.searchNames.slice(0, 4), ...drafted.aliases],
          target: { catalogId: scope.catalogId, nodeId: scope.nodeId, label: scope.label },
        })
      : drafted;
    return { plan, cost: costOf(model, result.usage.inputTokens, result.usage.outputTokens) };
  } catch (err) {
    // Output that didn't fit the schema was still generated and billed.
    const usage = NoObjectGeneratedError.isInstance(err) ? err.usage : undefined;
    const cost = usage ? costOf(model, usage.inputTokens, usage.outputTokens) : null;
    throw new PlannerError(err instanceof Error ? err.message.slice(0, 300) : "unknown error", cost);
  }
}
