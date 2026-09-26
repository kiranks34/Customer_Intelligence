import "server-only";

import { gateway, generateText, NoObjectGeneratedError, Output } from "ai";
import { z } from "zod";

import type { CallCost } from "@/connectors/types";

import { claudeErrorText, claudeModel, tokenCostUsd } from "./ai";
import { TOPICS, TOPIC_KEYS, type CheckedFact, type KnowledgeFact, type NewFact, type TopicKey } from "./knowledge";
import { pagesFrom, type SearchPage } from "./product-facts";

/**
 * One step of a product knowledge update (D45): Claude searches only the maker's sites (through the AI Gateway's
 * search tool, no other key) for a fixed set of topics, checks each earlier fact of those topics again, and adds new
 * ones. Every fact must quote its page; `applyUpdate` drops anything whose quote isn't on a page the search returned.
 */

/** Gateway search price per request (Perplexity Search list price, an estimate; the Gateway dashboard is exact). */
const SEARCH_USD = 0.005;
/** Searches Claude is asked to stay within per step (the gateway runs the search loop itself). */
const MAX_SEARCHES = 4;

const SYSTEM = `You keep a knowledge base about how a product family works, for people who classify customer posts
about it. Search the maker's official pages (you can only reach those) for the topics given.
For each earlier fact listed, say whether the pages still say it ("same"), say it differently ("changed", with the new
wording), or you couldn't find it ("not_found"). For "same" and "changed" give the page's exact address and a short
phrase copied word for word from it (quote).
Then add new facts for the topics: short, plain, one sentence each, most useful first, each with its exact page address
and a word-for-word quote. Say which models a fact is limited to when the page does ("models"). Never add facts from
memory, never repeat an earlier fact. Use at most ${MAX_SEARCHES} searches.`;

const StepSchema = z.object({
  checked: z
    .array(
      z.object({
        id: z.string(),
        status: z.enum(["same", "changed", "not_found"]),
        text: z.string().max(300).nullable().describe("New wording, for changed"),
        url: z.string().nullable(),
        quote: z.string().max(300).nullable(),
      }),
    )
    .max(60),
  found: z
    .array(
      z.object({
        topic: z.enum(TOPIC_KEYS),
        text: z.string().max(300),
        url: z.string(),
        quote: z.string().max(300),
        models: z.string().max(80).nullable().describe("Models or series it is limited to, or null for the whole family"),
      }),
    )
    .max(30),
});

type ClaudeCost = CallCost & { provider: "anthropic" };

/** A failure that may still have cost something (tokens and searches), which must be recorded. */
export class FactsError extends Error {
  constructor(
    message: string,
    public readonly cost: ClaudeCost | null,
  ) {
    super(message);
    this.name = "FactsError";
  }
}

const costOf = (model: string, inputTokens = 0, outputTokens = 0, searches = 0): ClaudeCost => ({
  provider: "anthropic",
  operation: "facts",
  usd: tokenCostUsd(model, inputTokens, outputTokens) + searches * SEARCH_USD,
  units: { inputTokens, outputTokens, searches },
});

export interface StepResult {
  checked: CheckedFact[];
  found: NewFact[];
  pages: SearchPage[];
  cost: ClaudeCost;
}

export async function knowledgeStep(family: string, domains: string[], topics: readonly TopicKey[], earlier: KnowledgeFact[]): Promise<StepResult> {
  if (!process.env.AI_GATEWAY_API_KEY) throw new Error("AI_GATEWAY_API_KEY is not set");
  if (domains.length === 0) throw new Error(`Pulse doesn't know ${family}'s official website yet.`);
  const model = claudeModel();
  const asks = TOPICS.filter((t) => topics.includes(t.key)).map((t) => `- ${t.key}: ${t.ask}`).join("\n");
  const prior = earlier.map((f) => `- ${f.id} [${f.topic}] ${f.text}${f.url ? ` (${f.url})` : ""}`).join("\n");
  let result;
  try {
    result = await generateText({
      model,
      system: SYSTEM,
      prompt: [
        `Product family: ${family}`,
        `Official sites: ${domains.join(", ")}`,
        "Region: United States, English.",
        `Topics:\n${asks}`,
        prior ? `Earlier facts to check again:\n${prior}` : "No earlier facts for these topics.",
      ].join("\n\n"),
      tools: {
        search: gateway.tools.perplexitySearch({ searchDomainFilter: domains, maxResults: 8, maxTokensPerPage: 1024, country: "US", searchLanguageFilter: ["en"] }),
      },
      output: Output.object({ schema: StepSchema }),
      maxOutputTokens: 8000,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(55_000),
    });
    const searches = result.steps.reduce((n, st) => n + st.toolCalls.length, 0);
    const cost = costOf(model, result.totalUsage.inputTokens, result.totalUsage.outputTokens, searches);
    let output;
    try {
      // Throws when the answer never came (e.g. the call ended on a search); what was spent is still recorded.
      output = result.output;
    } catch (err) {
      throw new FactsError(claudeErrorText(err, model), cost);
    }
    // The gateway runs the search itself; its results are the step's tool-result parts.
    const pages = pagesFrom(result.steps.flatMap((st) => st.content.flatMap((c) => (c.type === "tool-result" ? [c.output] : []))));
    return { checked: output.checked, found: output.found.map((f) => ({ ...f, models: f.models ?? undefined })), pages, cost };
  } catch (err) {
    if (err instanceof FactsError) throw err;
    // Nothing reported back (timeout, refusal, bad output): charge what it may have used, erring high.
    const usage = NoObjectGeneratedError.isInstance(err) ? err.usage : undefined;
    throw new FactsError(claudeErrorText(err, model), costOf(model, usage?.inputTokens ?? 0, usage?.outputTokens ?? 0, MAX_SEARCHES));
  }
}
