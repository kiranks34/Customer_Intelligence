import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";

import { requireDb } from "@/db/client";
import { catalogs, knowledgeRuns, searches } from "@/db/schema";

import { referenceFor } from "./catalog-references";
import type { ProductFact } from "./codebook";
import { recordCost } from "./cost";
import {
  applyUpdate,
  factKey,
  factsForReading,
  factsNotUsed,
  MAKER_FACTS_MAX,
  notesFor,
  FACT_CHARS,
  newFactId,
  readKnowledge,
  TOPICS,
  USER_FACTS_MAX,
  type Change,
  type Knowledge,
  type TopicKey,
} from "./knowledge";
import { FactsError, knowledgeStep } from "./product-facts-finder";

/**
 * Product knowledge per family (D45), kept on the family's catalog so every study of it reads the same facts, with a
 * history of every update. Updated only when you press "Update from <site>", in two steps of five topics (each fits
 * one server call), and only from the maker's own sites listed in the family's verified reference.
 */

/** The two update steps: the topics each one covers. */
export const UPDATE_STEPS: TopicKey[][] = [TOPICS.slice(0, 5).map((t) => t.key), TOPICS.slice(5).map((t) => t.key)];

export interface KnowledgeRun {
  id: number;
  at: string;
  summary: { new: number; changed: number; notFound: number; emptyTopics: string[] };
  changes: Change[];
}

export interface FamilyKnowledge {
  catalogId: number;
  family: string;
  /** The maker's sites facts may come from; empty when Pulse doesn't know them (no update possible). */
  domains: string[];
  knowledge: Knowledge;
  runs: KnowledgeRun[];
}

const domainsFor = (key: string) => referenceFor(key)?.makerDomains ?? [];

/** A family's knowledge and its last updates, newest first. */
export async function familyKnowledge(catalogId: number, runLimit = 10): Promise<FamilyKnowledge | null> {
  const db = requireDb();
  const [row] = await db.select({ key: catalogs.key, name: catalogs.name, facts: catalogs.productFacts }).from(catalogs).where(eq(catalogs.id, catalogId));
  if (!row) return null;
  const runs = await db
    .select()
    .from(knowledgeRuns)
    .where(eq(knowledgeRuns.catalogId, catalogId))
    .orderBy(desc(knowledgeRuns.createdAt))
    .limit(runLimit)
    .catch(() => []);
  return {
    catalogId,
    family: row.name,
    domains: domainsFor(row.key),
    knowledge: readKnowledge(row.facts),
    runs: runs.map((r) => ({ id: r.id, at: r.createdAt.toISOString(), summary: r.summary as KnowledgeRun["summary"], changes: r.changes as Change[] })),
  };
}

/**
 * Changes a family's knowledge without losing a change made meanwhile (an update step takes up to a minute, and you
 * may remove or add a fact in another tab): the write only lands if the stored knowledge is still what `change` saw,
 * otherwise `change` runs again on the fresh copy. `change` returns null to leave it as it is.
 */
async function mutate(catalogId: number, change: (k: Knowledge) => Knowledge | null): Promise<boolean> {
  const db = requireDb();
  for (let attempt = 0; attempt < 3; attempt++) {
    const [row] = await db.select({ facts: catalogs.productFacts }).from(catalogs).where(eq(catalogs.id, catalogId));
    if (!row) return false;
    const next = change(readKnowledge(row.facts));
    if (!next) return false;
    const seen = row.facts === null ? null : JSON.stringify(row.facts);
    const saved = await db
      .update(catalogs)
      .set({ productFacts: next })
      .where(and(eq(catalogs.id, catalogId), sql`${catalogs.productFacts} is not distinct from ${seen}::jsonb`))
      .returning({ id: catalogs.id });
    if (saved.length) return true;
  }
  throw new Error("The product knowledge was being changed at the same time. Try again.");
}

/**
 * Runs one update step (`step` 0 or 1). Step 0 starts a new history entry; step 1 adds to the one step 0 returned, so
 * the two halves read as one update. Nothing found for a topic is recorded too, so gaps are visible.
 */
export async function runUpdateStep(catalogId: number, step: number, runId: number | null): Promise<{ runId: number; done: boolean }> {
  const topics = UPDATE_STEPS[step];
  if (!topics) throw new Error("Unknown update step.");
  const fam = await familyKnowledge(catalogId, 0);
  if (!fam) throw new Error("That product family no longer exists.");
  if (fam.domains.length === 0) throw new Error(`Pulse doesn't know ${fam.family}'s official website yet.`);
  // Facts saved before topics existed (D44, topic "other") are checked again with the last step, so they can still be
  // marked not found and don't hold places under the limit forever.
  const scope: (TopicKey | "other")[] = step === UPDATE_STEPS.length - 1 ? [...topics, "other"] : topics;
  const earlier = fam.knowledge.facts.filter((f) => f.source === "maker" && scope.includes(f.topic));
  let result;
  try {
    result = await knowledgeStep(fam.family, fam.domains, topics, earlier);
  } catch (err) {
    if (err instanceof FactsError && err.cost) await recordCost({ ...err.cost }).catch(() => undefined);
    throw err;
  }
  await recordCost({ ...result.cost });
  const now = new Date();
  const done = step === UPDATE_STEPS.length - 1;
  let knowledge = fam.knowledge;
  let changes: Change[] = [];
  // The update time is set once the last step is done, so "last updated" means a complete update.
  await mutate(catalogId, (current) => {
    ({ knowledge, changes } = applyUpdate(current, scope, result.checked, result.found, result.pages, fam.domains, now.toISOString().slice(0, 10)));
    return done ? { ...knowledge, checkedAt: now.toISOString() } : knowledge;
  });
  const emptyTopics = topics.filter((t) => !knowledge.facts.some((f) => f.topic === t && f.source === "maker" && f.status === "current"));
  const count = (kind: Change["kind"]) => changes.filter((c) => c.kind === kind).length;
  const db = requireDb();
  let id = runId;
  if (id === null) {
    const [row] = await db
      .insert(knowledgeRuns)
      .values({ catalogId, summary: { new: count("new"), changed: count("changed"), notFound: count("not_found"), emptyTopics }, changes, usd: result.cost.usd.toFixed(6) })
      .returning({ id: knowledgeRuns.id });
    id = row.id;
  } else {
    await db.execute(sql`
      update ${knowledgeRuns} set
        changes = changes || ${JSON.stringify(changes)}::jsonb,
        summary = jsonb_build_object(
          'new', (summary->>'new')::int + ${count("new")},
          'changed', (summary->>'changed')::int + ${count("changed")},
          'notFound', (summary->>'notFound')::int + ${count("not_found")},
          'emptyTopics', (summary->'emptyTopics') || ${JSON.stringify(emptyTopics)}::jsonb),
        usd = usd + ${result.cost.usd.toFixed(6)}::numeric
      where id = ${id} and catalog_id = ${catalogId}`);
  }
  return { runId: id, done };
}

/** Adds a fact you know (e.g. from a manual or your own experience). Updates never change or remove it. */
export async function addUserFact(catalogId: number, text: string): Promise<boolean> {
  const clean = text.trim().replace(/\s+/g, " ").slice(0, FACT_CHARS);
  if (clean.length < 3) return false;
  let known = false;
  const added = await mutate(catalogId, (k) => {
    known = k.facts.some((f) => factKey(f.text) === factKey(clean));
    if (known || k.facts.filter((f) => f.source === "you").length >= USER_FACTS_MAX) return null;
    const id = newFactId(clean, new Set(k.facts.map((f) => f.id)));
    return { ...k, facts: [...k.facts, { id, text: clean, topic: "other", source: "you", status: "current", since: new Date().toISOString().slice(0, 10) }] };
  });
  return added || known;
}

/** Removes a fact. A maker fact you remove is remembered, so an update never adds it back. */
export async function removeFact(catalogId: number, factId: string): Promise<boolean> {
  return mutate(catalogId, (k) => {
    const fact = k.facts.find((f) => f.id === factId);
    if (!fact) return null;
    return {
      ...k,
      facts: k.facts.filter((f) => f.id !== factId),
      dismissed: fact.source === "maker" ? [...new Set([...k.dismissed, factKey(fact.text)])].slice(-200) : k.dismissed,
    };
  });
}

/** The family a study belongs to, for "Product knowledge" on the study page. */
export async function knowledgeForSearch(searchId: number): Promise<FamilyKnowledge | null> {
  const [row] = await requireDb().select({ catalogId: searches.catalogId }).from(searches).where(eq(searches.id, searchId));
  if (!row?.catalogId) return null;
  return familyKnowledge(row.catalogId, 1).catch(() => null);
}

/** What a study's codebook takes from its family: maker facts (with pages) and your facts as notes. */
export function codebookKnowledge(k: Knowledge): { productFacts: ProductFact[]; productNotes: string } {
  const { maker, yours } = factsForReading(k);
  return { productFacts: maker.slice(0, MAKER_FACTS_MAX), productNotes: notesFor(yours) };
}

/** Facts to start a study's first codebook with: the family's current ones (no lookup, no cost). */
export async function storedFactsFor(searchId: number): Promise<{ productFacts: ProductFact[]; productNotes: string }> {
  const fam = await knowledgeForSearch(searchId);
  return fam ? codebookKnowledge(fam.knowledge) : { productFacts: [], productNotes: "" };
}

export interface FamilyStudy {
  id: number;
  title: string;
  /** Family facts this study's latest categories don't carry yet. */
  notUsed: number;
}

/** The studies of a family (not removed), and whether each reads with the family's latest facts. */
export async function familyStudies(catalogId: number): Promise<FamilyStudy[]> {
  const db = requireDb();
  const [fam] = await db.select({ facts: catalogs.productFacts }).from(catalogs).where(eq(catalogs.id, catalogId));
  if (!fam) return [];
  const k = readKnowledge(fam.facts);
  const res = await db.execute(sql`
    select s.id, s.query,
      (select json_build_object('productFacts', c.codebook->'productFacts', 'productNotes', c.codebook->'productNotes')
         from codebooks c where c.search_id = s.id order by c.version desc limit 1) as used
    from ${searches} s
    where s.catalog_id = ${catalogId} and s.hidden_at is null
    order by s.id desc`);
  return (res.rows as { id: number; query: string; used: { productFacts: { text: string }[] | null; productNotes: string | null } | null }[]).map((r) => ({
    id: Number(r.id),
    title: r.query,
    notUsed: factsNotUsed(k, r.used ? { productFacts: r.used.productFacts ?? [], productNotes: r.used.productNotes ?? "" } : null),
  }));
}
