import "server-only";

import { gateway, generateText, NoObjectGeneratedError, Output } from "ai";
import { z } from "zod";

import type { CallCost } from "@/connectors/types";

import { claudeErrorText, claudeModel, tokenCostUsd } from "./ai";
import type { ProductFact } from "./codebook";
import { pagesFrom, verifiedFacts } from "./product-facts";

/**
 * Claude reads the maker's official pages for how a product family works (D44): setup, everyday use, maintenance,
 * the maker's app, ink, support. The search runs through the AI Gateway (no other key) and is limited to the maker's
 * sites; every fact must quote its page, and `verifiedFacts` drops any that don't.
 */

/** Gateway search price per request (Perplexity Search list price, an estimate; the Gateway dashboard is exact). */
const SEARCH_USD = 0.005;
/**
 * Searches Claude is asked to stay within. The gateway runs the search loop itself (one step for the SDK), so this is
 * an instruction, not a hard stop; it is also the estimate charged when a call fails before reporting what it did.
 */
const MAX_SEARCHES = 4;

const SYSTEM = `You collect facts about how a product family works, for people who classify customer posts about it.
Search the maker's official pages (you can only reach those) and write short, plain facts that help tell apart the
stages of owning the product: what happens at setup (e.g. installing printheads, filling tanks, alignment,
connecting, creating an account), everyday use, maintenance and parts that can be replaced later, the maker's app and
what it is needed for, ink or supplies, subscriptions, warranty and support channels.
Rules: every fact comes from a page you found, with its exact address, and a short phrase copied word for word from
that page's text (quote). Never add facts from memory. Say which models a fact is limited to when the page does.
One sentence each, at most 20 facts, most useful first. Use at most ${MAX_SEARCHES} searches.`;

const FactsSchema = z.object({
  facts: z
    .array(
      z.object({
        text: z.string().max(300).describe("One plain sentence"),
        url: z.string().describe("The page's exact address from the search results"),
        quote: z.string().max(300).describe("A short phrase copied word for word from that page"),
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

export async function findProductFacts(family: string, domains: string[]): Promise<{ facts: ProductFact[]; cost: ClaudeCost }> {
  if (!process.env.AI_GATEWAY_API_KEY) throw new Error("AI_GATEWAY_API_KEY is not set");
  if (domains.length === 0) throw new Error(`Pulse doesn't know ${family}'s official website yet.`);
  const model = claudeModel();
  let result;
  try {
    result = await generateText({
      model,
      system: SYSTEM,
      prompt: `Product family: ${family}\nOfficial sites: ${domains.join(", ")}\nRegion: United States, English.`,
      tools: {
        search: gateway.tools.perplexitySearch({ searchDomainFilter: domains, maxResults: 8, maxTokensPerPage: 1024, country: "US", searchLanguageFilter: ["en"] }),
      },
      output: Output.object({ schema: FactsSchema }),
      maxOutputTokens: 6000,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(120_000),
    });
    const searches = result.steps.reduce((n, st) => n + st.toolCalls.length, 0);
    const cost = costOf(model, result.totalUsage.inputTokens, result.totalUsage.outputTokens, searches);
    let drafts;
    try {
      // Throws when the answer never came (e.g. the call ended on a search); what was spent is still recorded.
      drafts = result.output.facts;
    } catch (err) {
      throw new FactsError(claudeErrorText(err, model), cost);
    }
    // The gateway runs the search itself; its results are the step's tool-result parts.
    const pages = pagesFrom(result.steps.flatMap((st) => st.content.flatMap((c) => (c.type === "tool-result" ? [c.output] : []))));
    return { facts: verifiedFacts(drafts, pages, domains), cost };
  } catch (err) {
    if (err instanceof FactsError) throw err;
    // Nothing reported back (timeout, refusal, bad output): charge what it may have used, erring high.
    const usage = NoObjectGeneratedError.isInstance(err) ? err.usage : undefined;
    throw new FactsError(claudeErrorText(err, model), costOf(model, usage?.inputTokens ?? 0, usage?.outputTokens ?? 0, MAX_SEARCHES));
  }
}
