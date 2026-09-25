import type { SpendResult } from "@/lib/cost";

/** Whole cents normally; sub-dollar spend keeps 3 decimals so a $0.002 call is visible. */
const usd = (n: number) => `$${n > 0 && n < 1 ? n.toFixed(3) : n.toFixed(2)}`;

/** Month-to-date API spend against the monthly budget. Status is shown with text, never colour alone. */
export function SpendMeter({ spend }: { spend: SpendResult }) {
  if (spend.state === "unconfigured") {
    return (
      <div className="rounded-lg border border-border px-3 py-2 text-sm text-muted">
        Spend: database not connected
      </div>
    );
  }
  if (spend.state === "error") {
    return (
      <div role="alert" className="max-w-64 rounded-lg border border-critical px-3 py-2 text-sm">
        <span className="font-medium text-critical">⚠ Spend unavailable.</span>{" "}
        <span className="text-muted">Database error; have you run the migration? See server logs.</span>
      </div>
    );
  }
  const { status } = spend;
  const pct = Math.min(100, Math.round(status.fraction * 100));
  const label = status.level === "over" ? "Over budget" : status.level === "warning" ? "Near budget" : "Within budget";
  const bar = status.level === "over" ? "bg-critical" : status.level === "warning" ? "bg-warning" : "bg-accent";
  return (
    <div className="min-w-44 rounded-lg border border-border px-3 py-2 text-sm">
      <div className="flex justify-between gap-3">
        <span className="text-muted">This month</span>
        <span className="font-medium tabular-nums">
          {usd(status.spentUsd)} / {usd(status.budgetUsd)}
        </span>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-border"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={status.budgetUsd}
        aria-valuenow={status.spentUsd}
        aria-label="API spend this month"
      >
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-xs text-muted">{label}</div>
    </div>
  );
}
