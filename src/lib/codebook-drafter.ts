import "server-only";

import { generateText, NoObjectGeneratedError, Output } from "ai";
import { z } from "zod";

import type { CallCost } from "@/connectors/types";

import { claudeErrorText, claudeModel, tokenCostUsd } from "./ai";
import { CODEBOOK_LIMITS, CodeSchema, productKnowledge, ThemeSchema, validateCodebook, type Codebook, type ProductFact } from "./codebook";
import { exampleFrom } from "./codebook-example";
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
- touchpoints: up to 10 channels and tools people deal with along the journey that appear in the sample: the
  maker's app, support (chat, phone, forum), website and downloads, retailer or store, subscription services,
  the packaging and manual, the product's own screen or buttons.

For every stage, segment, theme, competitor and touchpoint write:
- definition: one sentence saying what a post must mention to count.
- counts: the concrete signals that mean it counts (words, situations, time since purchase).
- excludes: the look-alikes that do NOT count, especially neighbouring stages or themes.
Stages are about the writer's situation (how long they've had it, whether it worked before), never about which
part or topic is mentioned: the same part can come up at setup and much later. Do not assume how the product works
beyond "How the product works" (if given) and what the posts say.
- example_post: the number of one post from the sample that clearly fits, and example_quote: a short phrase copied
  exactly from that post. Use null when no post fits.
Stages must not overlap: every post should fit exactly one, or none. Labels are short and plain. Never invent
people, numbers or quotes. Keys are snake_case.`;

const IMPROVE = `You are revising an existing codebook. Keep every key that still makes sense (answers already given
are stored under it), and change definitions, counts and excludes to fix the mistakes listed. A mistake means Jev's
answer differed from the checker's (a person, or Claude where no person answered); the checker is right. Add or split an item only when the mistakes
show it is needed.`;

// Claude points at a sample post for each example; the code copies the words from that post, so examples are real.
const EXAMPLE = {
  example_post: z.number().int().nullable().describe("Number of a sample post that fits, or null"),
  example_quote: z.string().max(200).nullable().describe("A short phrase copied exactly from that post, or null"),
};
const DraftCode = CodeSchema.omit({ example: true }).extend(EXAMPLE);
const DraftTheme = ThemeSchema.omit({ example: true }).extend(EXAMPLE);
const DraftSchema = z.object({
  stages: z.array(DraftCode).min(2).max(CODEBOOK_LIMITS.stages),
  segments: z.array(DraftCode).max(CODEBOOK_LIMITS.segments),
  themes: z.array(DraftTheme).min(3).max(CODEBOOK_LIMITS.themes),
  competitors: z.array(DraftCode).max(CODEBOOK_LIMITS.competitors),
  touchpoints: z.array(DraftCode).max(CODEBOOK_LIMITS.touchpoints),
});

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

/** Enough of each sample post to show the writer's situation (how long they've had it, what happened before). */
const SAMPLE_CHARS = 800;

function fromDraft(draft: z.infer<typeof DraftSchema>, sample: { text: string }[]): unknown {
  const convert = <T extends { example_post: number | null; example_quote: string | null }>({ example_post, example_quote, ...code }: T) => {
    const example = exampleFrom(example_post ? sample[example_post - 1]?.text : undefined, example_quote);
    return example ? { ...code, example } : code;
  };
  return {
    stages: draft.stages.map(convert),
    segments: draft.segments.map(convert),
    themes: draft.themes.map(convert),
    competitors: draft.competitors.map(convert),
    touchpoints: draft.touchpoints.map(convert),
  };
}

export interface Mistake {
  post: string;
  question: string;
  jev: string;
  person: string;
}

/**
 * Drafts the codebook for a search from a sample of its posts, or (with `improve`) revises the current one to fix
 * the mistakes a spot-check found. One Claude call; no post is labelled here.
 */
export async function draftCodebook(
  plan: Plan,
  sample: { source: string; text: string }[],
  improve?: { current: Codebook; mistakes: Mistake[] },
  /** The family's product knowledge before the first draft (D45); when improving, the codebook's own. */
  known?: { productFacts: ProductFact[]; productNotes: string },
): Promise<DraftResult> {
  const knowledge = productKnowledge(improve ? improve.current : (known ?? {}));
  if (!process.env.AI_GATEWAY_API_KEY) throw new Error("AI_GATEWAY_API_KEY is not set");
  const model = claudeModel();
  const posts = sample.map((p, i) => `${i + 1}. [${p.source}] ${p.text.replace(/\s+/g, " ").slice(0, SAMPLE_CHARS)}`).join("\n");
  let result;
  try {
    result = await generateText({
      model,
      system: improve ? `${SYSTEM}\n\n${IMPROVE}` : SYSTEM,
      prompt: [
        `Subject: ${plan.subject}`,
        plan.question ? `The user's question: ${plan.question}` : null,
        plan.focus.length ? `Focus: ${plan.focus.join(", ")}` : null,
        knowledge ? `How the product works (trust this over your own knowledge):\n${knowledge}` : null,
        improve ? `Current codebook (JSON):\n${JSON.stringify(improve.current)}` : null,
        improve?.mistakes.length
          ? `Mistakes found by the spot-check:\n${improve.mistakes
              .map((m, i) => `${i + 1}. Post: "${m.post.replace(/\s+/g, " ").slice(0, 250)}" · ${m.question}: Jev said ${m.jev}; correct is ${m.person}`)
              .join("\n")}`
          : null,
        `Sample of ${sample.length} posts:\n${posts}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
      output: Output.object({ schema: DraftSchema }),
      maxOutputTokens: 12000,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    // Output that didn't fit the schema was still generated and billed.
    const usage = NoObjectGeneratedError.isInstance(err) ? err.usage : undefined;
    throw new CodebookError(claudeErrorText(err, model), usage ? costOf(model, usage.inputTokens, usage.outputTokens) : null);
  }
  const cost = costOf(model, result.usage.inputTokens, result.usage.outputTokens);
  const checked = validateCodebook(fromDraft(result.output, sample));
  if (!checked.ok) throw new CodebookError(`Claude's codebook was invalid: ${checked.error}`, cost);
  return { codebook: checked.codebook, cost };
}
