import "server-only";

import { generateText, NoObjectGeneratedError, Output } from "ai";

import type { CallCost } from "@/connectors/types";

import { claudeModel, tokenCostUsd } from "./ai";
import { CatalogDraftSchema, type CatalogDraft, type Mention } from "./catalog";

const SYSTEM = `You draft a product catalog for Pulse, a customer-intelligence tool that reads public posts about products.

Given a product family and the model mentions found in real posts (with how many posts mention each), return
the family's structure: family → series → models, for North America.

Rules:
- Include the models people actually mention, grouped into their real series. Add other well-known current
  models of the family only if you are confident they exist.
- Mention counts come from simple pattern matching and can include typos or other products; use them as hints,
  not facts. Never invent counts.
- aliases: how people really write a model in posts: the bare number ("7301"), shortened forms ("ST 7301"),
  the name without spaces ("SmartTank 7301"), and regional names of the same model. No other models' names.
- verified: true only when you are confident the series or model exists under that name. Unsure → false; a
  person will check it.
- Keep series and model names as the maker writes them.
- notes: one or two sentences on what is uncertain.`;

export interface DraftResult {
  draft: CatalogDraft;
  cost: CallCost & { provider: "anthropic" };
}

/** A drafting failure that still consumed (and must record) tokens. */
export class CatalogDraftError extends Error {
  constructor(
    message: string,
    public readonly cost: (CallCost & { provider: "anthropic" }) | null,
  ) {
    super(message);
    this.name = "CatalogDraftError";
  }
}

function costOf(model: string, inputTokens = 0, outputTokens = 0): CallCost & { provider: "anthropic" } {
  return { provider: "anthropic", operation: "catalog", usd: tokenCostUsd(model, inputTokens, outputTokens), units: { inputTokens, outputTokens } };
}

export async function draftCatalog(input: { family: string; knownNames: string[]; mentions: Mention[]; postCount: number }): Promise<DraftResult> {
  if (!process.env.AI_GATEWAY_API_KEY) throw new Error("AI_GATEWAY_API_KEY is not set");
  const model = claudeModel();
  const mentions = input.mentions.length ? input.mentions.map((m) => `- ${m.text}: ${m.posts} posts`).join("\n") : "(none found)";
  const prompt = [
    `Product family: ${input.family}`,
    `Names from the search plan: ${input.knownNames.join(", ") || "(none)"}`,
    `Posts read: ${input.postCount}`,
    `Model mentions found in those posts:\n${mentions}`,
  ].join("\n\n");
  try {
    const result = await generateText({
      model,
      system: SYSTEM,
      prompt,
      output: Output.object({ schema: CatalogDraftSchema }),
      maxOutputTokens: 8000,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(90_000),
    });
    return { draft: result.output, cost: costOf(model, result.usage.inputTokens, result.usage.outputTokens) };
  } catch (err) {
    const usage = NoObjectGeneratedError.isInstance(err) ? err.usage : undefined;
    const cost = usage ? costOf(model, usage.inputTokens, usage.outputTokens) : null;
    throw new CatalogDraftError(err instanceof Error ? err.message.slice(0, 300) : "unknown error", cost);
  }
}
