import "server-only";

import { generateText, NoObjectGeneratedError, Output } from "ai";
import { z } from "zod";

import type { CallCost } from "@/connectors/types";

import { claudeErrorText, claudeModel, tokenCostUsd } from "./ai";
import { criterion, MAX_POST_CHARS, productKnowledge, NOT_STATED, OWNERSHIP, POST_TYPES, type Code, type Codebook } from "./codebook";

/**
 * Claude as a second reader for the accuracy check (D41): it answers the same questions as Jev for the 20 sample
 * posts, so agreement can be measured without you reading all 20. It never changes what is counted; you decide
 * where the two disagree.
 */

const SYSTEM = `You check a classifier's work on public posts about a product. For each numbered post, answer the
questions exactly as defined, using only what the post and its context say. Use "not_stated" when the post doesn't
say. Themes: list the keys of every theme the post clearly talks about (possibly none).`;

export interface CheckPost {
  id: number;
  source: string;
  title: string;
  text: string;
  thread: string | null;
  replyingTo: string | null;
  names: string | null;
}

export type CheckAnswers = Record<string, string>;

type ClaudeCost = CallCost & { provider: "anthropic" };

export class AutoCheckError extends Error {
  constructor(
    message: string,
    public readonly cost: ClaudeCost | null,
  ) {
    super(message);
    this.name = "AutoCheckError";
  }
}

const costOf = (model: string, inputTokens = 0, outputTokens = 0): ClaudeCost => ({
  provider: "anthropic",
  operation: "autocheck",
  usd: tokenCostUsd(model, inputTokens, outputTokens),
  units: { inputTokens, outputTokens },
});

/** The same text Jev reads (docs/JEV.md), so a disagreement is about judgement, not about who saw more. */
const oneLine = (t: string) => t.replace(/\s+/g, " ").trim();

const list = (codes: Code[]) => codes.map((c) => `  - ${c.key} (${c.label}): ${criterion(c)}`).join("\n");

/** Claude's answers per post, keyed like Jev's questions (sentiment, stage, segment, post_type, ownership, theme:<key>). */
export async function claudeCheck(subject: string, codebook: Codebook, posts: CheckPost[]): Promise<{ answers: Map<number, CheckAnswers>; cost: ClaudeCost }> {
  if (!process.env.AI_GATEWAY_API_KEY) throw new Error("AI_GATEWAY_API_KEY is not set");
  const model = claudeModel();
  const stageKeys: [string, ...string[]] = [NOT_STATED, ...codebook.stages.map((s) => s.key)];
  const segmentKeys: [string, ...string[]] = [NOT_STATED, ...codebook.segments.map((s) => s.key)];
  const themeKeys = codebook.themes.map((t) => t.key);
  const schema = z.object({
    posts: z.array(
      z.object({
        n: z.number().int(),
        sentiment: z.enum(["positive", "negative", "mixed", "neutral"]),
        stage: z.enum(stageKeys),
        segment: codebook.segments.length ? z.enum(segmentKeys) : z.null(),
        post_type: z.enum(["other", ...POST_TYPES.map((t) => t.key)] as [string, ...string[]]),
        ownership: z.enum([NOT_STATED, ...OWNERSHIP.map((o) => o.key)] as [string, ...string[]]),
        themes: z.array(z.string()),
      }),
    ),
  });
  const prompt = [
    `Product: ${subject}`,
    productKnowledge(codebook) ? `How the product works (trust this over your own assumptions):\n${productKnowledge(codebook)}` : null,
    `Sentiment toward ${subject}: positive, negative, mixed or neutral.`,
    `Journey stage (one):\n${list(codebook.stages)}\n  - not_stated: the post doesn't show where they are.`,
    codebook.segments.length ? `Who is posting (one):\n${list(codebook.segments)}\n  - not_stated` : "Who is posting: always null.",
    `What the post mainly does (one):\n${POST_TYPES.map((t) => `  - ${t.key}: ${t.definition}`).join("\n")}\n  - other`,
    `How long they have had it (one):\n${OWNERSHIP.map((o) => `  - ${o.key}: ${o.definition}`).join("\n")}\n  - not_stated`,
    `Themes (any):\n${list(codebook.themes)}`,
    `Posts:\n${posts
      .map((p, i) => [`${i + 1}. [${p.source}]${p.thread ? ` under “${p.thread}”` : ""}`, p.names ? `Products named: ${p.names}.` : "", p.replyingTo ? `Replying to: “${oneLine(p.replyingTo)}”` : "", p.title ? `Title: ${p.title}.` : "", `Post: ${oneLine(p.text).slice(0, MAX_POST_CHARS)}`].filter(Boolean).join(" "))
      .join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  let result;
  try {
    result = await generateText({
      model,
      system: SYSTEM,
      prompt,
      output: Output.object({ schema }),
      maxOutputTokens: 8000,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    const usage = NoObjectGeneratedError.isInstance(err) ? err.usage : undefined;
    throw new AutoCheckError(claudeErrorText(err, model), usage ? costOf(model, usage.inputTokens, usage.outputTokens) : null);
  }
  const answers = new Map<number, CheckAnswers>();
  for (const a of result.output.posts) {
    const post = posts[a.n - 1];
    if (!post || answers.has(post.id)) continue;
    const row: CheckAnswers = { sentiment: a.sentiment, stage: a.stage, post_type: a.post_type, ownership: a.ownership };
    if (a.segment) row.segment = a.segment;
    const picked = new Set(a.themes.filter((k) => themeKeys.includes(k)));
    for (const k of themeKeys) row[`theme:${k}`] = picked.has(k) ? "yes" : "no";
    answers.set(post.id, row);
  }
  return { answers, cost: costOf(model, result.usage.inputTokens, result.usage.outputTokens) };
}
