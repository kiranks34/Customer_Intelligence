import type { RawPost } from "@/connectors/types";

import { pseudonymize, textHash } from "./text";

/** Values for one `posts` insert. Kept free of DB imports so it can be unit-tested. */
export interface PostRow {
  searchId: number;
  source: string;
  sourceId: string;
  parentSourceId: string | null;
  url: string | null;
  authorHash: string | null;
  postedAt: Date | null;
  title: string;
  text: string;
  textHash: string;
  rating: number | null;
  verifiedPurchase: boolean | null;
  lang: string | null;
  country: string | null;
  engagement: Record<string, number | string | null> | null;
  listingId: string | null;
}

/** Bodies that carry no customer voice. */
const EMPTY_BODIES = new Set(["[deleted]", "[removed]"]);

/**
 * Normalize a connector result into a row: pseudonymize the author, compute the dedupe key,
 * and drop posts with no usable text. Returns null for posts that should not be stored.
 */
export function toPostRow(raw: RawPost, searchId: number, salt: string): PostRow | null {
  const title = (raw.title ?? "").trim();
  const trimmed = raw.text.trim();
  // "[removed]"/"[deleted]" is a placeholder, not customer voice: never store or quote it.
  const text = EMPTY_BODIES.has(trimmed) ? "" : trimmed;
  if (!text && !title) return null;

  const postedAt = raw.postedAt && !Number.isNaN(raw.postedAt.getTime()) ? raw.postedAt : null;
  return {
    searchId,
    source: raw.source,
    sourceId: raw.sourceId,
    parentSourceId: raw.parentSourceId ?? null,
    url: raw.url ?? null,
    authorHash: pseudonymize(raw.author, salt),
    postedAt,
    title,
    text,
    textHash: textHash(title, text),
    rating: raw.rating ?? null,
    verifiedPurchase: raw.verifiedPurchase ?? null,
    lang: raw.lang ?? null,
    country: raw.country ?? null,
    engagement: raw.engagement ?? null,
    listingId: raw.listingId ?? null,
  };
}
