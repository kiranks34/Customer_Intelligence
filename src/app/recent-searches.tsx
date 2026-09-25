"use client";

import Link from "next/link";
import { useOptimistic, useState, useSyncExternalStore, useTransition } from "react";

import type { Plan } from "@/lib/plan";
import { planTagline } from "@/lib/plan-edit";

import { Step } from "./product-lists";
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
      <Step
        n={3}
        id="recent-heading"
        title="Or continue a recent search"
        right={
          shown.length > 0 && (
            <button type="button" onClick={() => clear(shown.map((s) => s.id))} className="text-sm text-muted underline hover:text-critical">
              Clear list
            </button>
          )
        }
      />
      {message && (
        <p role="alert" className="mb-2 text-sm text-critical">
          {message}
        </p>
      )}
      {shown.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface px-5 py-4 text-sm text-muted">None yet. Your searches will appear here.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {shown.map((s) => (
            <li key={s.id} className="flex items-center gap-2 pr-3 hover:bg-border/20">
              <Link href={`/searches/${s.id}`} className="flex min-w-0 flex-1 flex-col gap-1 py-3 pl-5">
                <span className="line-clamp-2 font-medium break-words sm:line-clamp-1">{s.query}</span>
                <span className="text-xs text-muted">
                  <LocalTime value={s.createdAt} />
                  {s.plan && ` · ${planTagline(s.plan)}`}
                </span>
              </Link>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs ${s.posts > 0 ? "bg-accent/10 text-accent" : "bg-border/60 text-muted"}`}>
                {s.posts > 0 ? `${s.posts.toLocaleString()} posts` : "No posts yet"}
              </span>
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
