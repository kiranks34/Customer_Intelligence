/**
 * Product knowledge (D45): what Pulse knows about how a product family works, kept on the family's catalog and read by
 * Jev with every post. Updated only when you press "Update from <maker site>", the same way every time:
 *   1. the same fixed topics each run (so two runs are comparable),
 *   2. only the maker's own pages,
 *   3. every fact quoted from its page (checked here, so nothing comes from memory),
 *   4. every earlier fact checked again: still there, changed, or not found this time.
 * Facts you add yourself are never touched by an update. Pure: no DB, no network.
 */
import { normalize } from "./catalog";
import type { SearchPage } from "./product-facts";
import { onDomains } from "./product-facts";

/** The fixed topics, in the order they are shown and searched. */
export const TOPICS = [
  { key: "setup", label: "Setup", ask: "what happens at first-time setup, step by step" },
  { key: "parts", label: "Parts you can replace", ask: "parts that can be installed or replaced later (e.g. printheads, maintenance boxes), and when" },
  { key: "supplies", label: "Ink and supplies", ask: "ink or other supplies: filling, levels, what to use and avoid" },
  { key: "connecting", label: "Wi-Fi and connecting", ask: "connecting to Wi-Fi, USB or phones, and going offline" },
  { key: "app", label: "App and account", ask: "the maker's app and account: what they are needed for" },
  { key: "everyday", label: "Everyday use", ask: "everyday use: printing, scanning, copying, the control panel" },
  { key: "maintenance", label: "Maintenance", ask: "cleaning, alignment and routine maintenance" },
  { key: "subscriptions", label: "Subscriptions", ask: "subscription or ink delivery services" },
  { key: "warranty", label: "Warranty", ask: "warranty terms and what voids it" },
  { key: "support", label: "Support", ask: "support channels: chat, phone, community, repair" },
] as const;
export type TopicKey = (typeof TOPICS)[number]["key"];
export const TOPIC_KEYS = TOPICS.map((t) => t.key) as [TopicKey, ...TopicKey[]];
export const topicLabel = (key: string) => TOPICS.find((t) => t.key === key)?.label ?? "Other";

/** Most facts a family keeps from the maker (yours are extra), and the longest a fact can be. */
export const MAKER_FACTS_MAX = 40;
export const USER_FACTS_MAX = 20;
export const FACT_CHARS = 300;

export interface KnowledgeFact {
  id: string;
  text: string;
  /** Where it says so (maker facts only). */
  url?: string;
  title?: string;
  topic: TopicKey | "other";
  /** Models or series it is limited to, when the page says so ("510 series"); empty means the whole family. */
  models?: string;
  /** "maker": from the maker's pages. "you": added by you, never changed by an update. */
  source: "maker" | "you";
  /** "not_found": the last update didn't find it again. Kept until you remove it. */
  status: "current" | "not_found";
  /** When it was first found or added (YYYY-MM-DD). */
  since: string;
}

/** What a family's catalog stores. */
export interface Knowledge {
  facts: KnowledgeFact[];
  /** When the last update ran (ISO date-time), or null before the first. */
  checkedAt: string | null;
  domains: string[];
  /** Maker facts you removed: never added again by an update (normalized text). */
  dismissed: string[];
}

export const factKey = (text: string) => normalize(text).replace(/[^\p{L}\p{N} ]+/gu, "").slice(0, 200);

/** A short stable id for a new fact. */
export function newFactId(text: string, taken: Set<string>): string {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  let id = `f${h.toString(36)}`;
  for (let i = 2; taken.has(id); i++) id = `f${h.toString(36)}_${i}`;
  return id;
}

/** Reads what's stored, including the first version's shape (D44: facts without ids, topics or status). */
export function readKnowledge(raw: unknown): Knowledge {
  const r = (raw ?? {}) as Partial<Knowledge> & { facts?: Partial<KnowledgeFact>[]; checkedAt?: string };
  const taken = new Set<string>();
  const facts: KnowledgeFact[] = [];
  for (const f of Array.isArray(r.facts) ? r.facts : []) {
    if (!f || typeof f.text !== "string" || !f.text.trim()) continue;
    const id = typeof f.id === "string" && !taken.has(f.id) ? f.id : newFactId(f.text, taken);
    taken.add(id);
    facts.push({
      id,
      text: f.text.slice(0, FACT_CHARS),
      ...(typeof f.url === "string" ? { url: f.url } : {}),
      ...(typeof f.title === "string" ? { title: f.title } : {}),
      topic: TOPIC_KEYS.includes(f.topic as TopicKey) ? (f.topic as TopicKey) : "other",
      ...(typeof f.models === "string" && f.models ? { models: f.models } : {}),
      source: f.source === "you" ? "you" : "maker",
      status: f.status === "not_found" ? "not_found" : "current",
      since: typeof f.since === "string" ? f.since : (r.checkedAt ?? "").slice(0, 10) || "unknown",
    });
  }
  return {
    facts,
    checkedAt: typeof r.checkedAt === "string" ? r.checkedAt : null,
    domains: Array.isArray(r.domains) ? r.domains.filter((d): d is string => typeof d === "string") : [],
    dismissed: Array.isArray(r.dismissed) ? r.dismissed.filter((d): d is string => typeof d === "string") : [],
  };
}

/** Claude's answer for one update step: earlier facts checked again, and new ones. */
export interface CheckedFact {
  id: string;
  status: "same" | "changed" | "not_found";
  text?: string | null;
  url?: string | null;
  quote?: string | null;
}
export interface NewFact {
  topic: TopicKey;
  text: string;
  url: string;
  quote: string;
  models?: string | null;
}

export interface Change {
  kind: "new" | "changed" | "not_found";
  text: string;
  was?: string;
  url?: string;
  topic: string;
}

/** The page a quote is from, when that page was in the search results and really contains the quote. */
function quotedPage(url: string | null | undefined, quote: string | null | undefined, pages: Map<string, SearchPage>): SearchPage | null {
  if (!url || !quote) return null;
  const page = pages.get(samePage(url));
  const q = normalize(quote);
  if (!page || q.length < 8) return null;
  return normalize(`${page.title} ${page.snippet}`).includes(q) ? page : null;
}
const samePage = (url: string) => url.replace(/#.*$/, "").replace(/\/+$/, "");

/**
 * Applies one update step (a set of topics) to the stored knowledge. Earlier maker facts of those topics that Claude
 * confirms with a checked quote stay; changed ones take the new wording (if its quote checks out); anything not
 * confirmed this time is marked "not found" (kept until you remove it). New facts need a checked quote, can't repeat
 * a fact already known or one you removed, and stop at the limit. Your own facts are never touched.
 */
export function applyUpdate(
  before: Knowledge,
  topics: readonly (TopicKey | "other")[],
  checked: CheckedFact[],
  found: NewFact[],
  searchPages: SearchPage[],
  domains: string[],
  today: string,
): { knowledge: Knowledge; changes: Change[] } {
  const pages = new Map(searchPages.filter((p) => onDomains(p.url, domains)).map((p) => [samePage(p.url), p]));
  const inScope = new Set<string>(topics);
  const byId = new Map(checked.map((c) => [c.id, c]));
  const changes: Change[] = [];
  const facts: KnowledgeFact[] = [];
  const known = new Set<string>();

  for (const f of before.facts) {
    if (f.source === "you" || !inScope.has(f.topic)) {
      facts.push(f);
      known.add(factKey(f.text));
      continue;
    }
    const c = byId.get(f.id);
    const page = c && c.status !== "not_found" ? quotedPage(c.url ?? f.url, c.quote, pages) : null;
    const newText = c?.status === "changed" ? c.text?.trim().replace(/\s+/g, " ").slice(0, FACT_CHARS) : undefined;
    if (page && newText && factKey(newText) !== factKey(f.text)) {
      changes.push({ kind: "changed", text: newText, was: f.text, url: page.url, topic: f.topic });
      facts.push({ ...f, text: newText, url: page.url, title: page.title || f.title, status: "current", since: today });
      known.add(factKey(newText));
    } else if (page) {
      facts.push({ ...f, status: "current" });
      known.add(factKey(f.text));
    } else {
      if (f.status !== "not_found") changes.push({ kind: "not_found", text: f.text, url: f.url, topic: f.topic });
      facts.push({ ...f, status: "not_found" });
      known.add(factKey(f.text));
    }
  }

  const dismissed = new Set(before.dismissed);
  const taken = new Set(facts.map((f) => f.id));
  let makerCount = facts.filter((f) => f.source === "maker").length;
  for (const n of found) {
    if (makerCount >= MAKER_FACTS_MAX) break;
    if (!inScope.has(n.topic)) continue;
    const text = n.text.trim().replace(/\s+/g, " ").slice(0, FACT_CHARS);
    const key = factKey(text);
    if (!text || known.has(key) || dismissed.has(key)) continue;
    const page = quotedPage(n.url, n.quote, pages);
    if (!page) continue;
    const id = newFactId(text, taken);
    taken.add(id);
    known.add(key);
    makerCount++;
    const models = n.models?.trim().slice(0, 80);
    facts.push({ id, text, url: page.url, ...(page.title ? { title: page.title.slice(0, 200) } : {}), topic: n.topic, ...(models ? { models } : {}), source: "maker", status: "current", since: today });
    changes.push({ kind: "new", text, url: page.url, topic: n.topic });
  }
  return { knowledge: { ...before, facts, domains }, changes };
}

/** The facts a search reads: current maker facts (with their pages) and yours. */
export function factsForReading(k: Knowledge): { maker: { text: string; url: string; title?: string }[]; yours: string[] } {
  return {
    maker: k.facts
      .filter((f): f is KnowledgeFact & { url: string } => f.source === "maker" && f.status === "current" && !!f.url)
      .map((f) => ({ text: f.models ? `${f.text} (${f.models})` : f.text, url: f.url, ...(f.title ? { title: f.title } : {}) })),
    yours: k.facts.filter((f) => f.source === "you").map((f) => f.text),
  };
}
