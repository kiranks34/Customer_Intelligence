"use client";

import Link from "next/link";
import { useOptimistic, useState, useSyncExternalStore, useTransition } from "react";

import type { Plan } from "@/lib/plan";
import { planTagline } from "@/lib/plan-edit";

import { clearSearchesAction } from "./searches/actions";

export interface RecentSearch {
  id: number;
  query: string;
  createdAt: Date;
  posts: number;
  plan: Plan | null;
}

/** Local date and time, e.g. "Sep 25, 2026, 5:41 AM". Only formatted in the browser, so it's in your time zone. */
function LocalTime({ value }: { value: Date }) {
  const inBrowser = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const d = new Date(value);
  return <time dateTime={d.toISOString()}>{inBrowser ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : ""}</time>;
}

export function RecentSearches({ items }: { items: RecentSearch[] }) {
  const [shown, remove] = useOptimistic(items, (list, ids: number[]) => list.filter((s) => !ids.includes(s.id)));
  const [message, setMessage] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Clearing only hides searches from this list; their posts and data are kept.
  function clear(ids: number[]) {
    if (ids.length > 1 && !window.confirm(`Clear all ${ids.length} searches from this list? Their posts and data are kept.`)) return;
    setMessage(null);
    startTransition(async () => {
      remove(ids);
      const r = await clearSearchesAction(ids);
      if (!r.ok) setMessage(r.message);
    });
  }

  return (
    <section aria-labelledby="recent-heading">
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <h2 id="recent-heading" className="text-lg font-medium">
          Recent searches
        </h2>
        {shown.length > 0 && (
          <button type="button" onClick={() => clear(shown.map((s) => s.id))} className="text-sm text-muted underline hover:text-critical">
            Clear all
          </button>
        )}
      </div>
      {message && (
        <p role="alert" className="mb-2 text-sm text-critical">
          {message}
        </p>
      )}
      {shown.length === 0 ? (
        <p className="text-sm text-muted">None yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
          {shown.map((s) => (
            <li key={s.id} className="flex items-center gap-2 pr-2 hover:bg-surface">
              <Link href={`/searches/${s.id}`} className="flex min-w-0 flex-1 flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                <span className="line-clamp-2 break-words sm:line-clamp-1">{s.query}</span>
                <span className="shrink-0 text-xs text-muted">
                  {s.plan && `${planTagline(s.plan)} · `}
                  {s.posts.toLocaleString()} posts ·{" "}
                  <LocalTime value={s.createdAt} />
                </span>
              </Link>
              <button
                type="button"
                onClick={() => clear([s.id])}
                aria-label={`Clear ${s.query} from the list`}
                title="Clear from the list (data is kept)"
                className="rounded-md px-2 py-1 text-muted hover:bg-border/60 hover:text-critical"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
