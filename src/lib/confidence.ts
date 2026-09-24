/** Confidence policy from docs/JEV.md. */
export type Band = "counted" | "uncertain" | "review";

export interface Thresholds {
  counted: number; // at or above: counted automatically
  review: number; // below: goes to the review queue
}

export const DEFAULT_THRESHOLDS: Thresholds = { counted: 0.8, review: 0.5 };

export function band(confidence: number, t: Thresholds = DEFAULT_THRESHOLDS): Band {
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new RangeError(`confidence must be within [0, 1], got ${confidence}`);
  }
  if (!(t.review <= t.counted)) throw new RangeError("review threshold must not exceed counted threshold");
  if (confidence >= t.counted) return "counted";
  if (confidence >= t.review) return "uncertain";
  return "review";
}
