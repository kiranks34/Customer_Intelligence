"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { Progress } from "@/lib/collect";

import { advanceAction, resumeAction, startCollectionAction, type ActionState } from "../actions";

const isProgress = (r: Progress | ActionState): r is Progress => "jobs" in r;
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
const MAX_RETRIES = 3;
const SOURCE_LABELS: Record<string, string> = { youtube: "YouTube", reddit: "Reddit", amazon_us: "Amazon" };

interface Props {
  searchId: number;
  initial: Progress;
  /** Runs before a new collection starts (e.g. saving plan edits); returns an error message to stop, or null. */
  beforeStart?: () => Promise<string | null>;
  onRunningChange?: (running: boolean) => void;
}

export function CollectionPanel({ searchId, initial, beforeStart, onRunningChange }: Props) {
  const router = useRouter();
  const [p, setP] = useState(initial);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const stop = useRef(false);
  const looping = useRef(false);

  // An unfinished run (page reloaded or reopened mid-collection) carries on by itself. Paused steps are never
  // picked up by the loop, so they still wait for Resume.
  // The ref guard keeps a remount (e.g. React Strict Mode) from starting a second loop.
  useEffect(() => {
    stop.current = false;
    if (!initial.finished) void loop();
    return () => void (stop.current = true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);
  useEffect(() => onRunningChange?.(running), [running, onRunningChange]);

  async function loop() {
    if (looping.current) return;
    looping.current = true;
    setRunning(true);
    stop.current = false;
    let failures = 0;
    try {
      while (!stop.current) {
        let r: Progress | ActionState;
        try {
          r = await advanceAction(searchId);
          failures = 0;
        } catch (err) {
          // A dropped connection or a restarted server: retry a few times before giving up.
          if (++failures > MAX_RETRIES) {
            setMessage(`${err instanceof Error ? err.message : "Connection lost"}. Press Continue to resume.`);
            break;
          }
          await sleep(3000 * failures);
          continue;
        }
        if (!isProgress(r)) {
          setMessage(r.message);
          break;
        }
        setP(r);
        if (r.finished) break;
        // Jobs waiting on a retry delay: pause briefly instead of hammering the server.
        if (r.jobs.running === 0) await sleep(3000);
      }
    } finally {
      looping.current = false;
      setRunning(false);
      router.refresh();
    }
  }

  async function start() {
    setMessage(null);
    setRunning(true);
    const blocked = beforeStart ? await beforeStart().catch(() => "Couldn't save the plan. Try again.") : null;
    if (blocked) {
      setRunning(false);
      return setMessage(blocked);
    }
    const r = await startCollectionAction(searchId);
    if (!r.ok) {
      setRunning(false);
      return setMessage(r.message);
    }
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
  // Channels with posts, plus any the last run searched that found nothing yet.
  const sources = [...new Set([...Object.keys(p.postsBySource), ...Object.keys(p.runBySource)])];
  const pct = total ? Math.round(((p.jobs.done + p.jobs.failed) / total) * 100) : 0;

  return (
    <section aria-labelledby="collect-heading" className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
      <h2 id="collect-heading" className="text-lg font-medium">
        Collection
      </h2>

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-muted">Posts collected (total)</dt>
          <dd className="text-xl font-semibold tabular-nums">{p.totalPosts}</dd>
          {hasRun && <dd className="text-xs text-muted">Last run +{p.runPosts}</dd>}
        </div>
        {sources.map((s) => {
          const n = p.postsBySource[s] ?? 0;
          const added = p.runBySource[s];
          return (
            <div key={s}>
              <dt className="text-muted">{SOURCE_LABELS[s] ?? s}</dt>
              <dd className="text-xl font-semibold tabular-nums">{n}</dd>
              {hasRun && added !== undefined && (
                <dd className="text-xs text-muted">
                  Last run +{added} of up to {p.runCap}
                  {p.finished && p.jobs.failed === 0 && p.jobs.waiting === 0 && added < p.runCap && " (all it found)"}
                </dd>
              )}
            </div>
          );
        })}
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
        Collection runs while this page is open; closing it pauses safely and reopening the page carries on. Each run adds up to {p.postCap} new posts per channel and skips ones already collected.
      </p>
    </section>
  );
}
