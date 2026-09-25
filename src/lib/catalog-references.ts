/**
 * Registry of verified catalog references, keyed by family key (see familyKey). Each file lives in
 * src/data/catalog-references/ and is checked by ReferenceSchema in tests, so an invalid file fails CI.
 */
import hpSmartTank from "@/data/catalog-references/hp-smart-tank.json";

import { looseFamilyKey } from "./catalog";
import { ReferenceSchema, type Reference } from "./catalog-reference";

const FILES: Record<string, unknown> = { "hp smart tank": hpSmartTank };

/** All registered references, validated. For tests. */
export const registeredReferences = () => Object.entries(FILES);

let cache: Reference[] | null = null;
/** Validated once per server instance (the files are part of the build). */
const parsed = () => (cache ??= Object.values(FILES).map((raw) => ReferenceSchema.parse(raw)));

/**
 * The verified reference for a family key, found loosely ("smart tank", "HP SmartTank" and "hp smart tank" are the
 * same family) by the reference's key, family name and family aliases.
 */
export function referenceFor(key: string): Reference | null {
  const want = looseFamilyKey(key);
  if (!want) return null;
  for (const ref of parsed()) {
    if ([ref.key, ref.family, ...ref.familyAliases].some((k) => looseFamilyKey(k) === want)) return ref;
  }
  return null;
}
