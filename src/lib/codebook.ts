import { z } from "zod";

import { DEFAULT_THRESHOLDS } from "./confidence";

/**
 * The codebook: the journey stages, user segments and themes Jev answers about for one search (docs/JEV.md).
 * Claude drafts it from a sample of posts; you can edit it; every edit is a new version. Pure: no I/O here.
 */

const KEY = /^[a-z][a-z0-9_]{1,39}$/;

export const CodeSchema = z.object({
  key: z.string().regex(KEY).describe("snake_case id, e.g. wifi_setup"),
  label: z.string().min(2).max(60).describe("Short plain name, e.g. 'Wi-Fi setup'"),
  definition: z.string().min(5).max(240).describe("One sentence: what a post must say to count"),
});

export const ThemeSchema = CodeSchema.extend({
  kind: z.enum(["pain", "delight", "need", "topic"]).describe("pain = problem or complaint; delight = praise; need = wish or unmet need; topic = neutral subject"),
});

export const CODEBOOK_LIMITS = { stages: 8, segments: 6, themes: 12, competitors: 8 } as const;

export const CodebookSchema = z.object({
  stages: z.array(CodeSchema).min(2).max(CODEBOOK_LIMITS.stages).describe("Customer journey stages, in order"),
  segments: z.array(CodeSchema).max(CODEBOOK_LIMITS.segments).describe("Who people say they are / what they use it for"),
  themes: z.array(ThemeSchema).min(3).max(CODEBOOK_LIMITS.themes).describe("Pains, delights, needs and topics people raise"),
  competitors: z
    .array(CodeSchema)
    .max(CODEBOOK_LIMITS.competitors)
    .default([])
    .describe("Other brands or product lines people compare with or switch to, e.g. Epson EcoTank, Canon MegaTank"),
});

export type Code = z.infer<typeof CodeSchema>;
export type Theme = z.infer<typeof ThemeSchema>;
/** Competitors are optional: codebooks saved before D39 have none. */
export type Codebook = z.input<typeof CodebookSchema>;

/** Reserved answer for stage and segment when the post doesn't say. */
export const NOT_STATED = "not_stated";
/**
 * Version of the questions Jev is asked, stored as the answer of the "about:product" row. Posts read with an older
 * set are read again (D39: competitors). Bump it whenever the questions change in a way results depend on.
 */
export const QUESTION_SET = "q39";

/** Reserved answers for the competitor question. */
export const OTHER_BRAND = "other_brand";
export const NO_BRAND = "no_brand";
/** The "Not sure" row in results, so one-answer questions add up to the posts counted. Never a stored answer. */
export const NOT_SURE = "_not_sure";

/** Checks a codebook (from Claude or from your edits): valid shape, unique keys, no reserved key. */
export function validateCodebook(candidate: unknown): { ok: true; codebook: Codebook } | { ok: false; error: string } {
  const parsed = CodebookSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid codebook" };
  for (const list of ["stages", "segments", "themes", "competitors"] as const) {
    const keys = parsed.data[list].map((c) => c.key);
    if (new Set(keys).size !== keys.length) return { ok: false, error: `Two ${list} have the same key.` };
    if (keys.some((k) => [NOT_STATED, OTHER_BRAND, NO_BRAND].includes(k))) return { ok: false, error: `"${keys.find((k) => [NOT_STATED, OTHER_BRAND, NO_BRAND].includes(k))}" is reserved.` };
    const labels = parsed.data[list].map((c) => c.label.trim().toLowerCase());
    if (new Set(labels).size !== labels.length) return { ok: false, error: `Two ${list} have the same name.` };
  }
  return { ok: true, codebook: parsed.data };
}

/** A key for a new item from its label, unique within its list: "Wi-Fi setup" → "wi_fi_setup". */
export function keyFor(label: string, taken: string[]): string {
  const base =
    label
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^(\d)/, "n$1")
      .slice(0, 36) || "item";
  const start = /^[a-z]/.test(base) ? base : `x_${base}`;
  let key = start.length >= 2 ? start : `${start}_x`;
  for (let i = 2; taken.includes(key) || [NOT_STATED, OTHER_BRAND, NO_BRAND].includes(key); i++) key = `${start.slice(0, 36)}_${i}`;
  return key;
}

// ---- Jev questions ------------------------------------------------------------------------------------------

export const Q = {
  /** What kind of post it is (see ABOUT). Replaced the yes/no "relevant" question (D38); old answers still read. */
  about: "about",
  /** Stored next to "about": Jev's probability that the post is feedback about the product (answer = QUESTION_SET). */
  aboutProduct: "about:product",
  /** The first, yes/no relevance question. Only read for answers stored before D38. */
  relevant: "relevant",
  sentiment: "sentiment",
  /** Which competitor a post mainly talks about, and how the writer feels about it (only with a competitor list). */
  competitor: "competitor",
  competitorFeeling: "competitor:feeling",
  stage: "stage",
  segment: "segment",
} as const;

/**
 * The kinds of post (D38, D39). Only "product" posts are analysed for the journey; competitor posts get their brand
 * and feeling; the others are counted as groups. "other_brands" is the D38 name of "competitor" (older answers).
 */
export const ABOUT = { product: "product", competitor: "competitor", chat: "chat", offTopic: "off_topic", unclear: "unclear", otherBrands: "other_brands" } as const;
export const themeQuestion = (key: string) => `theme:${key}`;

type Question =
  | { type: "boolean"; instructions: string; criteria?: { true?: string; false?: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> };

/**
 * The typed questions Jev answers for every post, all in one call: relevance, sentiment, journey stage, segment,
 * and one yes/no per theme (a post can have several themes).
 */
export function questionsFor(codebook: Codebook, subject: string): Record<string, Question> {
  const questions: Record<string, Question> = {
    [Q.about]: {
      type: "choice",
      instructions: `What kind of post is this, for research on ${subject}? Use its context: the video or thread it was posted under, and any products it names.`,
      criteria: {
        [ABOUT.product]: `About ${subject}: owning, buying, setting up, using, a problem, a question or an opinion. It counts when the post names it, or when it is a comment under a video or thread about ${subject} and talks about that. Comparisons that include it count.`,
        [ABOUT.competitor]: `Mainly about another brand or product line (one they own, recommend, switched to or compare with), not ${subject} itself. It counts even under a video or thread about ${subject}.`,
        [ABOUT.chat]: "Thanks or praise for the video or poster, greetings or jokes, with no experience, opinion or question about any product.",
        [ABOUT.offTopic]: "About something else entirely (not these products or this kind of product), or spam.",
        [ABOUT.unclear]: "Too short or vague to tell what it is about.",
      },
    },
    [Q.sentiment]: {
      type: "choice",
      instructions: `Overall, how does the writer feel about ${subject}?`,
      criteria: {
        positive: "Mostly favourable: praise, satisfaction, recommending it.",
        negative: "Mostly unfavourable: complaints, frustration, regret, warning others.",
        neutral: "No clear feeling: a plain question, fact or instruction.",
        mixed: "Clearly both good and bad points.",
      },
    },
    [Q.stage]: {
      type: "choice",
      instructions: `Where is the writer in their journey with ${subject}?`,
      criteria: { ...Object.fromEntries(codebook.stages.map((s) => [s.key, s.definition])), [NOT_STATED]: "The post doesn't show where they are." },
    },
  };
  const competitors = codebook.competitors ?? [];
  if (competitors.length > 0) {
    questions[Q.competitor] = {
      type: "choice",
      instructions: `Which other brand or product line (not ${subject}) does the post mainly talk about?`,
      criteria: {
        ...Object.fromEntries(competitors.map((c) => [c.key, c.definition])),
        [OTHER_BRAND]: "Another brand not listed here.",
        [NO_BRAND]: `No other brand; only ${subject} or nothing specific.`,
      },
    };
    questions[Q.competitorFeeling] = {
      type: "choice",
      instructions: "How does the writer feel about that other brand?",
      criteria: {
        positive: "Favourable: praises it, recommends it, happy they switched.",
        negative: "Unfavourable: complains about it or warns against it.",
        mixed: "Both good and bad points.",
        neutral: "No clear feeling, or no other brand is mentioned.",
      },
    };
  }
  if (codebook.segments.length > 0) {
    questions[Q.segment] = {
      type: "choice",
      instructions: "Which description fits the writer, from what they say about themselves or how they use it?",
      criteria: { ...Object.fromEntries(codebook.segments.map((s) => [s.key, s.definition])), [NOT_STATED]: "The post doesn't say." },
    };
  }
  for (const t of codebook.themes) {
    questions[themeQuestion(t.key)] = { type: "boolean", instructions: `Does the post talk about “${t.label}”? ${t.definition}` };
  }
  return questions;
}

/** What Jev reads for one post (long posts are cut, so no call runs away in size). */
export const MAX_POST_CHARS = 3000;

export interface PostForJev {
  source: string;
  title: string;
  text: string;
  /** Title of the video or Reddit thread a comment was posted under. */
  thread?: string | null;
  /** True for a comment or reply (it has a parent video or thread). */
  isComment?: boolean;
  /** Catalog products the post names (from the catalog matcher), e.g. "HP Smart Tank 7301". */
  names?: string | null;
}

export function stateFor(post: PostForJev): Record<string, string> {
  const channel =
    post.source === "youtube" ? "YouTube comment" : post.source === "reddit" ? (post.isComment ? "Reddit comment" : "Reddit post") : post.source;
  const state: Record<string, string> = { channel };
  if (post.thread) state.context = post.source === "youtube" ? `Comment on the YouTube video “${post.thread}”` : `Reply in the Reddit thread “${post.thread}”`;
  if (post.names) state.products_named = post.names;
  if (post.title) state.title = post.title;
  state.post = post.text.length > MAX_POST_CHARS ? `${post.text.slice(0, MAX_POST_CHARS)}…` : post.text;
  return state;
}

type Answer = { type: "boolean"; probability: number } | { type: "choice"; choice: string; probabilities?: Record<string, number> } | { type: "score"; score: number };

export interface DecisionRow {
  question: string;
  answer: string;
  confidence: number;
}

/**
 * One stored row per answer. A yes/no answer becomes "yes"/"no" with confidence max(p, 1 − p); a choice keeps
 * the probability of the chosen option (0.5, "uncertain", when Jev gives no distribution, so it's never counted
 * as sure without evidence).
 */
export function readAnswers(answers: Record<string, Answer>): DecisionRow[] {
  const rows: DecisionRow[] = [];
  for (const [question, a] of Object.entries(answers)) {
    if (a.type === "boolean") {
      const p = clamp(a.probability);
      rows.push({ question, answer: p >= 0.5 ? "yes" : "no", confidence: Math.max(p, 1 - p) });
    } else if (a.type === "choice") {
      const p = a.probabilities?.[a.choice];
      rows.push({ question, answer: a.choice, confidence: p === undefined ? 0.5 : clamp(p) });
      if (question === Q.about) {
        // How likely it is product feedback decides what counts; without a distribution it's unknown (0.5).
        const product = a.probabilities?.[ABOUT.product];
        rows.push({ question: Q.aboutProduct, answer: QUESTION_SET, confidence: product === undefined ? (a.choice === ABOUT.product && p !== undefined ? clamp(p) : 0.5) : clamp(product) });
      }
    }
  }
  return rows;
}
const clamp = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0.5);

// ---- Cost -----------------------------------------------------------------------------------------------------

/** Jev list price (docs/JEV.md): USD per million input tokens. */
export const JEV_USD_PER_MILLION_INPUT = 0.042;
const CHARS_PER_TOKEN = 4;

/** Rough tokens for one post's call: the post plus every question's wording. Errs high. */
export function estimateTokens(postChars: number, codebook: Codebook, subject: string): number {
  const questionChars = JSON.stringify(questionsFor(codebook, subject)).length;
  return Math.ceil((Math.min(postChars, MAX_POST_CHARS) + questionChars + 200) / CHARS_PER_TOKEN);
}

export const jevUsd = (inputTokens: number) => (inputTokens * JEV_USD_PER_MILLION_INPUT) / 1_000_000;

// ---- Confidence bands (docs/JEV.md) ---------------------------------------------------------------------------

export const COUNTED = DEFAULT_THRESHOLDS.counted;
export const UNCERTAIN = DEFAULT_THRESHOLDS.review;
/** At or below this probability of being product feedback, a post goes to its group without a look (D38). */
export const NOT_PRODUCT = Math.round((1 - COUNTED) * 100) / 100;

/** Stage order for display, with "not stated" last. */
export const orderOf = (codes: Code[]) => new Map([...codes.map((c, i) => [c.key, i] as const), [NOT_STATED, codes.length]]);
