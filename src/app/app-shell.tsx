import Link from "next/link";
import type { ReactNode } from "react";

import { monthToDate } from "@/lib/cost";

import { usd } from "./format";


/**
 * Every signed-in page: the top bar (Pulse · Studies · Products, and this month's spend) and the page body at one
 * width, so pages line up.
 */
export async function AppShell({ active, children }: { active: "studies" | "products" | null; children: ReactNode }) {
  const spend = await monthToDate().catch(() => ({ state: "error" as const }));
  const tab = (href: string, label: string, on: boolean) => (
    <Link href={href} aria-current={on ? "page" : undefined} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${on ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"}`}>
      {label}
    </Link>
  );
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 pb-12 sm:px-6">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border py-3 sm:h-16 sm:py-0">
        <Link href="/" className="text-xl font-extrabold tracking-tight">
          Pulse
        </Link>
        <nav aria-label="Main" className="flex gap-1">
          {tab("/", "Studies", active === "studies")}
          {tab("/products", "Products", active === "products")}
        </nav>
        <SpendLine spend={spend} />
      </header>
      {children}
    </div>
  );
}

function SpendLine({ spend }: { spend: Awaited<ReturnType<typeof monthToDate>> | { state: "error" } }) {
  if (spend.state !== "ok") {
    return <span className="text-xs text-muted sm:ml-auto">{spend.state === "unconfigured" ? "Spend: database not connected" : "Spend unavailable"}</span>;
  }
  const { status } = spend;
  const pct = Math.min(100, Math.round(status.fraction * 100));
  const bar = status.level === "over" ? "bg-critical" : status.level === "warning" ? "bg-warning" : "bg-accent";
  return (
    <div className="flex w-full items-center gap-3 text-[13px] text-muted sm:ml-auto sm:w-auto">
      <span className="tabular-nums">
        This month {usd(status.spentUsd)} of {usd(status.budgetUsd)}
        {status.level !== "ok" && <span className="font-semibold text-foreground"> · {status.level === "over" ? "over budget" : "near budget"}</span>}
      </span>
      <span
        className="h-1.5 w-24 overflow-hidden rounded-full bg-border"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={status.budgetUsd}
        aria-valuenow={status.spentUsd}
        aria-label="API spend this month"
      >
        <span className={`block h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}
