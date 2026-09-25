/**
 * Registry of verified catalog references, keyed by family key (see familyKey). Each file lives in
 * src/data/catalog-references/ and is checked by ReferenceSchema in tests, so an invalid file fails CI.
 */
import hpSmartTank from "@/data/catalog-references/hp-smart-tank.json";

import { ReferenceSchema, type Reference } from "./catalog-reference";

const FILES: Record<string, unknown> = { "hp smart tank": hpSmartTank };

/** All registered references, validated. For tests. */
export const registeredReferences = () => Object.entries(FILES);

export function referenceFor(key: string): Reference | null {
  const raw = FILES[key];
  return raw ? ReferenceSchema.parse(raw) : null;
}
