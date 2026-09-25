import "server-only";

import { generateText, NoObjectGeneratedError, Output } from "ai";

import type { CallCost } from "@/connectors/types";

import { claudeModel, tokenCostUsd } from "./ai";
import { CodebookSchema, validateCodebook, type Codebook } from "./codebook";
import type { Plan } from "./plan";

const SYSTEM = `You design the codebook for Pulse, a customer-intelligence tool. Jev, a classifier, will answer typed
questions about every public post (YouTube comments, Reddit posts) using your codebook, so each definition must be
checkable from one post alone.

Produce:
- stages: the customer journey, in order. Start from: discover, compare/research, buy, set up, everyday use,
  problems/support, stay or leave (repurchase, recommend, switch). Merge or rename only if the posts clearly need it.
- segments: up to 6 kinds of people, from what writers say about themselves or how they use it (e.g. home office,
  parents/students, small business, heavy printing). Only segments you see in the sample.
- themes: 6-12 pains, delights, needs and topics that actually appear in the sample, specific enough to act on
  (e.g. "Wi-Fi setup and connection drops", not "problems"). Always include one value-for-money theme.
- competitors: up to 8 other brands or product lines people in the sample compare with, own, recommend or switch to
  (e.g. "Epson EcoTank", "Canon MegaTank"). Only ones that appear in the sample.
Labels are short and plain. Definitions are one sentence saying what a post must mention to count.
Never invent people, numbers or quotes. Keys are snake_case.`;

type ClaudeCost = CallCost & { provider: "anthropic" };

export interface DraftResult {
  codebook: Codebook;
  cost: ClaudeCost;
}

/** A drafting failure that still consumed (and must record) tokens. */
export class CodebookError extends Error {
  constructor(
    message: string,
    public readonly cost: ClaudeCost | null,
  ) {
    super(message);
    this.name = "CodebookError";
  }
}

const costOf = (model: string, inputTokens = 0, outputTokens = 0): ClaudeCost => ({
  provider: "anthropic",
  operation: "codebook",
  usd: tokenCostUsd(model, inputTokens, outputTokens),
  units: { inputTokens, outputTokens },
});

const SAMPLE_CHARS = 300;

/** Drafts the codebook for a search from a sample of its posts. One Claude call; no post is labelled here. */
export async function draftCodebook(plan: Plan, sample: { source: string; text: string }[]): Promise<DraftResult> {
  if (!process.env.AI_GATEWAY_API_KEY) throw new Error("AI_GATEWAY_API_KEY is not set");
  const model = claudeModel();
  const posts = sample.map((p, i) => `${i + 1}. [${p.source}] ${p.text.replace(/\s+/g, " ").slice(0, SAMPLE_CHARS)}`).join("\n");
  let result;
  try {
    result = await generateText({
      model,
      system: SYSTEM,
      prompt: [
        `Subject: ${plan.subject}`,
        plan.question ? `The user's question: ${plan.question}` : null,
        plan.focus.length ? `Focus: ${plan.focus.join(", ")}` : null,
        `Sample of ${sample.length} collected posts:\n${posts}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      output: Output.object({ schema: CodebookSchema }),
      maxOutputTokens: 6000,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(90_000),
    });
  } catch (err) {
    // Output that didn't fit the schema was still generated and billed.
    const usage = NoObjectGeneratedError.isInstance(err) ? err.usage : undefined;
    throw new CodebookError(err instanceof Error ? err.message.slice(0, 300) : "unknown error", usage ? costOf(model, usage.inputTokens, usage.outputTokens) : null);
  }
  const cost = costOf(model, result.usage.inputTokens, result.usage.outputTokens);
  const checked = validateCodebook(result.output);
  if (!checked.ok) throw new CodebookError(`Claude's codebook was invalid: ${checked.error}`, cost);
  return { codebook: checked.codebook, cost };
}
