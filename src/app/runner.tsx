"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import type { ActionState } from "@/lib/action-guards";
import type { ActiveRun, RunState } from "@/lib/runs";
import type { Headline } from "@/lib/studies";

import { activeRunsAction, keepDrivenAction, runFinishedAction, runStatesAction, runStepAction } from "./runs-actions";
import { ui } from "./ui";

/**
 * The runner (D49): any open Pulse tab drives every study with open work, a few at a time, so studies run side by
 * side while you use the rest of Pulse. One tab per browser drives (a Web Lock); the others only watch. Two browsers
 * can both drive safely: each search step and each batch of posts is claimed by one request only. When a run
 * finishes, a toast says so and links to the results.
 */

interface Toast {
  key: string;
  title: string;
  detail: string;
  href: string;
  /** Found nothing: says so in red instead of green, and links to the study rather than results. */
  bad?: boolean;
}

interface Runner {
  /** Studies being worked on (a comparison's two sides are two entries). */
  active: ActiveRun[];
  /** Latest state of the studies this page watches or the runner drives, by search id. */
  states: Record<number, RunState>;
  /** A step's problem, by search id (e.g. reading couldn't start). */
  messages: Record<number, string>;
  /** Look now instead of at the next tick (after Start, Stop or Resume). */
  kick: () => void;
  /** Keep these studies' state fresh while this page is open (the study page's own sides). */
  watch: (ids: number[]) => () => void;
  /** Forget earlier problems of these studies (a new run starts). */
  clear: (ids: number[]) => void;
}

const RunnerContext = createContext<Runner | null>(null);
export const useRunner = () => useContext(RunnerContext);

/** Studies worked on at the same time; the rest wait for the next round. */
const PARALLEL = 3;
const isList = <T,>(r: T[] | ActionState): r is T[] => Array.isArray(r);

export function RunnerProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [active, setActive] = useState<ActiveRun[]>([]);
  const [states, setStates] = useState<Record<number, RunState>>({});
  const [messages, setMessages] = useState<Record<number, string>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  const watched = useRef(new Map<number, number>());
  const wake = useRef<() => void>(() => undefined);
  const turn = useRef(0);

  const kick = useCallback(() => wake.current(), []);
  const clear = useCallback((ids: number[]) => setMessages((m) => Object.fromEntries(Object.entries(m).filter(([id]) => !ids.includes(Number(id))))), []);
  const watch = useCallback((ids: number[]) => {
    for (const id of ids) watched.current.set(id, (watched.current.get(id) ?? 0) + 1);
    wake.current();
    return () => {
      for (const id of ids) {
        const n = (watched.current.get(id) ?? 1) - 1;
        if (n <= 0) watched.current.delete(id);
        else watched.current.set(id, n);
      }
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let driver = typeof navigator === "undefined" || !("locks" in navigator);
    let release: (() => void) | null = null;
    const waiting = new AbortController();
    const hasLocks = !driver;
    const takeTurn = () =>
      // Held for as long as this tab is open; the next tab in line takes over when it closes. A request still
      // waiting when this closes is withdrawn, and one granted after that is given straight back.
      navigator.locks
        .request("pulse-runner", { signal: waiting.signal }, () => {
          if (!alive) return;
          driver = true;
          wake.current();
          return new Promise<void>((res) => (release = res));
        })
        .catch(() => undefined);
    if (hasLocks) void takeTurn();
    /** A tab in the background runs slowly (browsers slow its timers): it hands over to a visible Pulse tab. */
    async function handOver() {
      if (!hasLocks || !driver || !document.hidden) return;
      const state = await navigator.locks.query().catch(() => null);
      if (!state?.pending?.some((l) => l.name === "pulse-runner")) return;
      driver = false;
      (release as (() => void) | null)?.();
      release = null;
      void takeTurn();
    }
    let previous: Map<number, ActiveRun> | null = null;

    const sleep = (ms: number) =>
      new Promise<void>((res) => {
        const t = setTimeout(res, ms);
        wake.current = () => {
          clearTimeout(t);
          res();
        };
      });

    async function finished(run: ActiveRun, still: Set<number>, state: RunState | undefined) {
      // A comparison says so once, when its second side is done.
      if (run.comparison) {
        const pairStill = [...still].some((id) => previous?.get(id)?.comparison?.id === run.comparison!.id);
        if (pairStill) return;
      }
      const headline = await runFinishedAction(run.searchId);
      const name = run.comparison ? run.comparison.title : run.label;
      const href = run.comparison ? `/compare/${run.comparison.id}` : `/searches/${run.searchId}`;
      const toast = outcome(name, href, state, headline, !!run.comparison);
      const key = `${href}-${Date.now()}`;
      setToasts((t) => [...t.filter((x) => x.href !== href), { key, ...toast }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.key !== key)), 12_000);
    }

    async function loop() {
      while (alive) {
        let runs: ActiveRun[] = [];
        try {
          const r = await activeRunsAction();
          if (!isList(r)) {
            // Signed out, or the database is unreachable: look again later.
            await sleep(15_000);
            continue;
          }
          runs = r;
        } catch {
          await sleep(5_000);
          continue;
        }
        if (!alive) break;
        setActive(runs);

        const fresh: Record<number, RunState> = {};
        let moved = false;
        const notes: Record<number, string> = {};
        if (driver) {
          // A few at a time, taking turns, so one long study doesn't hold up the others.
          const drive = runs.filter((r) => !r.stopped);
          if (drive.length) await keepDrivenAction(drive.map((r) => r.searchId)).catch(() => undefined);
          const start = drive.length ? (turn.current += PARALLEL) % drive.length : 0;
          const pick = [...drive.slice(start), ...drive.slice(0, start)].slice(0, PARALLEL);
          await Promise.all(
            pick.map(async (run) => {
              try {
                const s = await runStepAction(run.searchId);
                if ("progress" in s) {
                  fresh[run.searchId] = s;
                  if (s.worked) moved = true;
                  if (s.message) notes[run.searchId] = s.message;
                } else notes[run.searchId] = s.message;
              } catch (err) {
                notes[run.searchId] = err instanceof Error ? err.message : "Connection lost";
              }
            }),
          );
        }
        const now = new Map(runs.map((r) => [r.searchId, r]));
        const ended = previous ? [...previous.values()].filter((r) => !now.has(r.searchId)) : [];
        // Watched studies not stepped this round (another tab drives, stopping, or just ended): their state only.
        const look = [...new Set([...watched.current.keys(), ...runs.map((r) => r.searchId), ...ended.map((r) => r.searchId)])].filter((id) => !fresh[id]);
        if (look.length) {
          try {
            const r = await runStatesAction(look);
            if (isList(r)) for (const s of r) fresh[s.searchId] = s;
          } catch {
            // Shown again at the next tick.
          }
        }
        if (!alive) break;
        if (Object.keys(fresh).length) setStates((x) => ({ ...x, ...fresh }));
        if (Object.keys(notes).length) setMessages((x) => ({ ...x, ...notes }));

        if (previous) {
          for (const run of ended) {
            const s = fresh[run.searchId];
            // Stopped, or no tab drove it for a while (another browser closed): Paused, not ready.
            if (run.stopped || s?.stopped || (s && !s.progress.finished)) continue;
            void finished(run, new Set(now.keys()), s);
          }
          if (ended.length) router.refresh();
        }
        previous = now;
        await handOver();
        // Straight on while steps get work done; slower while they only wait (a retry later, a stopped step ending).
        await sleep(runs.length === 0 ? 5_000 : driver && moved ? 400 : 2_500);
      }
    }
    void loop();
    return () => {
      alive = false;
      waiting.abort();
      wake.current();
      (release as (() => void) | null)?.();
    };
  }, [router]);

  return (
    <RunnerContext.Provider value={{ active, states, messages, kick, watch, clear }}>
      {children}
      {toasts.length > 0 && (
        <div className={ui.toastStack} aria-live="polite">
          {toasts.map((t) => (
            <div key={t.key} role="status" className={`${ui.toast} ${t.bad ? "border-l-critical" : ""}`}>
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${t.bad ? "bg-critical" : "bg-good"}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold">{t.title}</p>
                <p className={ui.meta}>{t.detail}</p>
                <Link href={t.href} className={`${ui.link} text-[13px]`} onClick={() => setToasts((x) => x.filter((y) => y.key !== t.key))}>
                  {t.bad ? "Open it →" : "Open results →"}
                </Link>
              </div>
              <button type="button" aria-label="Dismiss" className={ui.icon} onClick={() => setToasts((x) => x.filter((y) => y.key !== t.key))}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </RunnerContext.Provider>
  );
}

/** What a finished run's toast says: ready, or why it stopped short (found nothing, paused, failed, not read). */
function outcome(name: string, href: string, s: RunState | undefined, headline: Headline | null, pair: boolean): Omit<Toast, "key"> {
  if (s) {
    const failed = s.progress.jobs.failed > 0 ? (s.progress.lastErrors[0] ?? "no reason given") : null;
    if (s.progress.totalPosts === 0 && !pair)
      return failed
        ? { title: `${name}: the searches failed`, detail: failed, href, bad: true }
        : { title: `${name}: no posts found`, detail: "Its searches found nothing in this period", href, bad: true };
    if (s.progress.jobs.waiting > 0) return { title: `${name} is waiting`, detail: (s.progress.lastErrors[0] ?? "Paused").replace(/^Paused:\s*/, ""), href, bad: true };
    if (s.analysis.status === "paused" || s.analysis.status === "failed")
      return { title: `${name}: reading stopped`, detail: s.analysis.message ?? "Reading stopped before the end", href, bad: true };
    if (s.analysis.pending > 0 || s.analysis.status === "none")
      return { title: `${name}: posts not read yet`, detail: s.message ?? "Collected; open it to read them", href, bad: true };
  }
  return {
    title: `${name} is ready`,
    detail: pair
      ? "Both sides are read"
      : headline && headline.counted > 0
        ? `${headline.counted} ${headline.counted === 1 ? "post" : "posts"} about the product · ${headline.negativePct}% negative`
        : "Collecting and reading are done",
    href,
  };
}

/** "2 running" in the top bar, on every page, while studies are being worked on. Opens All studies. */
export function RunIndicator() {
  const runner = useRunner();
  if (!runner) return null;
  const n = new Set(runner.active.filter((r) => !r.stopped).map((r) => (r.comparison ? `c${r.comparison.id}` : `s${r.searchId}`))).size;
  if (n === 0) return null;
  return (
    <Link href="/" className={ui.running}>
      <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden />
      {n} running
    </Link>
  );
}
