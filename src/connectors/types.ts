/**
 * Shared shapes for every source connector (docs/ARCHITECTURE.md §5).
 * Connectors return raw, un-normalized data; `src/lib/ingest.ts` turns it into `posts` rows.
 */

export type SourceId = "youtube" | "reddit" | "amazon_us";

/** One piece of customer voice as the source returned it. Author handles are raw here and pseudonymized on ingest. */
export interface RawPost {
  source: SourceId;
  sourceId: string;
  parentSourceId?: string;
  url?: string;
  author?: string | null;
  postedAt?: Date | null;
  title?: string;
  text: string;
  rating?: number | null;
  verifiedPurchase?: boolean | null;
  lang?: string | null;
  country?: string | null;
  engagement?: Record<string, number | string | null>;
  listingId?: string;
}

/** What one paid/metered call cost, recorded via `recordCost`. */
export interface CallCost {
  provider: "youtube" | "scrapecreators" | "apify" | "anthropic";
  operation: string;
  usd: number;
  units: Record<string, number>;
}

export interface Page<T> {
  items: T[];
  /** Opaque token for the next page; undefined when there is no next page. */
  next?: string;
  cost: CallCost;
}

export class ConnectorError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    public readonly status?: number,
    public readonly retryable = false,
    /** Machine-readable reason from the API, e.g. YouTube's "commentsDisabled". */
    public readonly reason?: string,
  ) {
    super(`${provider}: ${message}`);
    this.name = "ConnectorError";
  }
}
