import { createHash, createHmac } from "node:crypto";

/** Lowercase, Unicode-normalize, drop punctuation, collapse whitespace. Works for Latin and CJK text. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Dedup key: the same review repeated across product variants or retailers
 * hashes to the same value (see PRD principle 4). Posts made only of emoji or
 * symbols normalize to "", so those are keyed on their raw text instead;
 * otherwise every such post would collide.
 */
export function textHash(title: string, body: string): string {
  const raw = `${title} ${body}`;
  const normalized = normalizeText(raw);
  const key = normalized || `raw:${raw.normalize("NFKC").replace(/\s+/g, " ").trim()}`;
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

/** Pseudonymous, stable author key. The raw handle is never stored. */
export function pseudonymize(author: string | null | undefined, salt: string): string | null {
  const handle = author?.trim();
  if (!handle) return null;
  if (!salt) throw new Error("AUTHOR_HASH_SALT is not set");
  return createHmac("sha256", salt).update(handle.toLowerCase()).digest("hex").slice(0, 16);
}
