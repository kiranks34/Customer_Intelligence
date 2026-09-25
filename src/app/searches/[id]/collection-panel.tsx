"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { Progress } from "@/lib/collect";

import { advanceAction, resumeAction, startCollectionAction, type ActionState } from "../actions";

const isProgress = (r: Progress | ActionState): r is Progress => "jobs" in r;
const SOURCE_LABELS: Record<string, string> = { youtube: "YouTube", reddit: "Reddit", amazon_us: "Amazon" };

export function CollectionPanel({ searchId, initial }: { searchId: number; initial: Progress }) {
  const router = useRouter();
  const [p, setP] = useState(initial);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const stop = useRef(false);

  useEffect(() => () => void (stop.current = true), []);

  async function loop() {
    setRunning(true);
    stop.current = false;
    try {
      while (!stop.current) {
        const r = await advanceAction(searchId);
        if (!isProgress(r)) {
          setMessage(r.message);
          break;
        }
        setP(r);
        if (r.finished) break;
        // Jobs waiting on a retry delay: pause briefly instead of hammering the server.
        if (r.jobs.running === 0) await new Promise((res) => setTimeout(res, 3000));
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Connection lost. Press Continue to resume.");
    } finally {
      setRunning(false);
      router.refresh();
    }
  }

  async function start() {
    setMessage(null);
    const r = await startCollectionAction(searchId);
    if (!r.ok) return setMessage(r.message);
    await loop();
  }

  async function resume() {
    setMessage(null);
    const r = await resumeAction(searchId);
    if (!r.ok) return setMessage(r.message);
    await loop();
  }

  const total = p.jobs.queued + p.jobs.running + p.jobs.done + p.jobs.failed + p.jobs.waiting;
  const hasRun = total > 0;
  const pct = total ? Math.round(((p.jobs.done + p.jobs.failed) / total) * 100) : 0;

  return (
    <section aria-labelledby="collect-heading" className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
      <h2 id="collect-heading" className="text-lg font-medium">
        Collection
      </h2>

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-muted">Posts collected</dt>
          <dd className="text-xl font-semibold tabular-nums">
            {p.totalPosts}
            <span className="text-sm font-normal text-muted"> / {p.postCap}</span>
          </dd>
        </div>
        {Object.entries(p.postsBySource).map(([s, n]) => (
          <div key={s}>
            <dt className="text-muted">{SOURCE_LABELS[s] ?? s}</dt>
            <dd className="text-xl font-semibold tabular-nums">{n}</dd>
          </div>
        ))}
        <div>
          <dt className="text-muted">Spent on this search</dt>
          <dd className="text-xl font-semibold tabular-nums">${p.costUsd.toFixed(3)}</dd>
        </div>
      </dl>

      {hasRun && (
        <div>
          <div className="h-1.5 overflow-hidden rounded-full bg-border" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Collection progress">
            <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted">
            {p.jobs.done} steps done · {p.jobs.queued + p.jobs.running} to go
            {p.jobs.failed > 0 && ` · ${p.jobs.failed} failed`}
            {p.jobs.waiting > 0 && ` · ${p.jobs.waiting} paused`}
          </p>
        </div>
      )}

      {p.lastErrors.length > 0 && (
        <ul className="text-sm text-critical">
          {p.lastErrors.map((e) => (
            <li key={e}>⚠ {e}</li>
          ))}
        </ul>
      )}
      {message && (
        <p role="alert" className="text-sm text-critical">
          {message}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        {!hasRun || (p.finished && p.jobs.waiting === 0) ? (
          <button onClick={start} disabled={running} className="rounded-lg bg-accent px-5 py-2 font-medium text-white disabled:opacity-60">
            {running ? "Collecting…" : hasRun ? "Run again (collects new posts only)" : "Run collection"}
          </button>
        ) : p.jobs.waiting > 0 && p.finished ? (
          <button onClick={resume} disabled={running} className="rounded-lg bg-accent px-5 py-2 font-medium text-white disabled:opacity-60">
            {running ? "Collecting…" : "Resume paused steps"}
          </button>
        ) : (
          <button onClick={loop} disabled={running} className="rounded-lg bg-accent px-5 py-2 font-medium text-white disabled:opacity-60">
            {running ? "Collecting… keep this page open" : "Continue collection"}
          </button>
        )}
      </div>
      <p className="text-xs text-muted">
        Collection runs while this page is open. Closing it pauses safely; press Continue to pick up where it stopped.
      </p>
    </section>
  );
}
