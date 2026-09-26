import "server-only";

import { eq } from "drizzle-orm";

import { requireDb } from "@/db/client";
import { catalogs, searches } from "@/db/schema";

import { referenceFor } from "./catalog-references";
import type { ProductFact } from "./codebook";
import { recordCost } from "./cost";
import type { CatalogFacts } from "./product-facts";
import { FactsError, findProductFacts } from "./product-facts-finder";

/**
 * Official facts per product family (D44), kept on the family's catalog so every search of it reuses them. Looked up
 * only when you ask ("Fill from the maker's pages"), and only from the maker's own sites listed in the family's
 * verified reference.
 */

export interface FactsSource {
  catalogId: number;
  family: string;
  domains: string[];
  /** Facts already found for the family, if any. */
  stored: CatalogFacts | null;
}

/** The family a search belongs to and where its official facts come from; null when Pulse doesn't know its sites. */
export async function factsSourceFor(searchId: number): Promise<FactsSource | null> {
  const [row] = await requireDb()
    .select({ catalogId: catalogs.id, key: catalogs.key, name: catalogs.name, facts: catalogs.productFacts })
    .from(searches)
    .innerJoin(catalogs, eq(catalogs.id, searches.catalogId))
    .where(eq(searches.id, searchId));
  if (!row) return null;
  const domains = referenceFor(row.key)?.makerDomains ?? [];
  if (domains.length === 0) return null;
  return { catalogId: row.catalogId, family: row.name, domains, stored: (row.facts as CatalogFacts | null) ?? null };
}

/**
 * The family's facts: the stored ones, or (when there are none, or `fresh`) looked up again and stored. The lookup
 * costs a few cents and is recorded against the search that asked.
 */
export async function productFactsFor(searchId: number, fresh: boolean): Promise<{ facts: ProductFact[]; looked: boolean; domains: string[] }> {
  const source = await factsSourceFor(searchId);
  if (!source) throw new Error("Pulse doesn't know this product's official website yet.");
  if (source.stored && source.stored.facts.length > 0 && !fresh) return { facts: source.stored.facts, looked: false, domains: source.domains };
  let found;
  try {
    found = await findProductFacts(source.family, source.domains);
  } catch (err) {
    if (err instanceof FactsError && err.cost) await recordCost({ searchId, ...err.cost }).catch(() => undefined);
    throw err;
  }
  await recordCost({ searchId, ...found.cost });
  // Nothing verified: keep what was there rather than wiping it.
  if (found.facts.length > 0) {
    const value: CatalogFacts = { facts: found.facts, checkedAt: new Date().toISOString().slice(0, 10), domains: source.domains };
    await requireDb().update(catalogs).set({ productFacts: value }).where(eq(catalogs.id, source.catalogId));
  }
  return { facts: found.facts, looked: true, domains: source.domains };
}

/** Facts to start a search's first codebook with: the family's stored ones (no lookup, no cost). */
export async function storedFactsFor(searchId: number): Promise<ProductFact[]> {
  return (await factsSourceFor(searchId).catch(() => null))?.stored?.facts ?? [];
}
