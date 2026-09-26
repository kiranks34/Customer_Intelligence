/** Shared display formats, used by server and client components alike. */

/** "Sep 27, 2026, 9:42 AM" in `timeZone` (default: where the code runs). Pages show timestamps with <LocalTime>. */
export const when = (iso: string | Date, timeZone?: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone });

/** "Sep 27" for a YYYY-MM-DD date or a timestamp (in `timeZone`, default where the code runs). */
export const shortDay = (d: string | Date, timeZone?: string) => {
  const date = typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00:00`) : new Date(d);
  return Number.isNaN(date.getTime()) ? String(d) : date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone });
};

/** Whole cents normally; sub-dollar amounts keep 3 decimals so a $0.002 call is visible. */
export const usd = (n: number) => `$${n > 0 && n < 1 ? n.toFixed(3) : n.toFixed(2)}`;
/** Estimates: "about $0.20", "under $0.01". */
export const aboutUsd = (n: number) => (n < 0.01 ? "under $0.01" : `about $${n.toFixed(2)}`);
