"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { AnalysisState } from "@/lib/analysis";
import type { Progress } from "@/lib/collect";

import { aboutUsd, usd } from "../../format";
import { ui } from "../../ui";
import { advanceAction, resumeAction, type ActionState } from "../actions";
import { advanceAnalysisAction, resumeAnalysisAction, startAnalysisAction } from "../analysis-actions";

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
const isProgress = (r: Progress | ActionState): r is Progress => "jobs" in r;
const isState = (r: AnalysisState | ActionState): r is AnalysisState => "pending" in r;
const SOURCE_LABELS: Record<string, string> = { youtube: "YouTube", reddit: "Reddit" };
const MAX_RETRIES = 3;

type Phase = "idle" | "collecting" | "reading";

/**
 * A study's progress (D46): Collect posts → Read every post → Results. While the page is open it collects, then
 * reads the new posts by itself (Start study, Run again, Resume all land here with `autorun`). Closing the page pauses
 * the work; All studies then shows it as Paused with Resume. Stop pauses it on purpose.
 */
export function StudyRunner(props: { searchId: number; progress: Progress; analysis: AnalysisState; autorun: boolean }) {
  const { searchId } = props;
  const router = useRouter();
  const [p, setP] = useState(props.progress);
  const [a, setA] = useState(props.analysis);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const stop = useRef(false);
  const busy = useRef(false);

  useEffect(() => {
    stop.current = false;
    const collecting = !props.progress.finished && props.progress.jobs.waiting === 0;
    const reading = props.analysis.status === "running";
    // `?run=1` asks for one automatic run: drop it now, so a later refresh (after saving the categories, say) doesn't
    // start a second, paid run by itself.
    if (props.autorun) window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    // Without it, open work waits for Resume: Stop, then a reload, must not start paying again by itself.
    const readNew = props.analysis.pending > 0 && (props.analysis.status === "none" || props.analysis.status === "done");
    if (props.autorun && (collecting || reading || readNew)) void run(collecting, reading);
    return () => void (stop.current = true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  /** Collect (when there is collection work), then read whatever is new (`reading`: a run is already under way). */
  async function run(collectFirst: boolean, reading = false) {
    if (busy.current) return;
    busy.current = true;
    stop.current = false;
    setStopped(false);
    setMessage(null);
    try {
      if (collectFirst && !(await collect())) return;
      if (stop.current) return;
      await read(reading);
    } finally {
      busy.current = false;
      setPhase("idle");
      // After Stop, keep the card (and its Resume) as it is; a refresh would remount it.
      if (!stop.current) router.refresh();
    }
  }

  async function collect(): Promise<boolean> {
    setPhase("collecting");
    let failures = 0;
    while (!stop.current) {
      let r: Progress | ActionState;
      try {
        r = await advanceAction(searchId);
        failures = 0;
      } catch (err) {
        if (++failures > MAX_RETRIES) {
          setMessage(`${err instanceof Error ? err.message : "Connection lost"}. Press Resume to carry on.`);
          return false;
        }
        await sleep(3000 * failures);
        continue;
      }
      if (!isProgress(r)) {
        setMessage(r.message);
        return false;
      }
      setP(r);
      if (r.finished) return r.jobs.waiting === 0;
      if (r.jobs.running === 0) await sleep(3000);
    }
    return false;
  }

  async function read(running: boolean) {
    if (!running) {
      const started = await startAnalysisAction(searchId);
      // Nothing new to read is fine: the study is up to date.
      if (!started.ok) return started.message.startsWith("Every post") ? undefined : setMessage(started.message);
    }
    setPhase("reading");
    let failures = 0;
    while (!stop.current) {
      let r: AnalysisState | ActionState;
      try {
        r = await advanceAnalysisAction(searchId);
        failures = 0;
      } catch (err) {
        if (++failures > MAX_RETRIES) return setMessage(`${err instanceof Error ? err.message : "Connection lost"}. Press Resume to carry on.`);
        await sleep(3000 * failures);
        continue;
      }
      if (!isState(r)) return setMessage(r.message);
      setA(r);
      if (r.status !== "running") {
        if (r.status !== "done" && r.message) setMessage(r.message);
        return;
      }
      await sleep(1500);
    }
  }

  async function resume() {
    setMessage(null);
    if (p.jobs.waiting > 0) {
      const r = await resumeAction(searchId);
      if (!r.ok) return setMessage(r.message);
    }
    let reading = a.status === "running";
    if (a.status === "paused" || a.status === "failed") {
      const r = await resumeAnalysisAction(searchId);
      if (!r.ok) return setMessage(r.message);
      setA((x) => ({ ...x, status: "running" }));
      reading = true;
    }
    void run(!p.finished || p.jobs.waiting > 0, reading);
  }

  /** Work that is open but not being driven by this page: Stop, a closed page, or a pause for budget or errors. */
  const unfinished = (!p.finished && p.jobs.waiting === 0) || a.status === "running";
  const stuck = stopped || p.jobs.waiting > 0 || a.status === "paused" || a.status === "failed" || (phase === "idle" && unfinished);
  const readable = a.pending > 0 && phase === "idle" && !stuck && a.status !== "running";
  if (phase === "idle" && !stuck && !readable && !message) return null;

  const total = p.jobs.queued + p.jobs.running + p.jobs.done + p.jobs.failed + p.jobs.waiting;
  const collectPct = p.finished ? 100 : total ? Math.round(((p.jobs.done + p.jobs.failed) / total) * 100) : 0;
  const readPct = a.totalPosts ? Math.round((a.analyzed / a.totalPosts) * 100) : 0;
  const sources = Object.keys(p.runBySource).length ? p.runBySource : p.postsBySource;
  const step = (n: number, title: string, state: "done" | "now" | "todo", body: React.ReactNode) => (
    <div className={`flex flex-col gap-1.5 rounded-xl border px-4 py-3.5 ${state === "now" ? "border-accent bg-accent/10" : "border-border"} ${state === "todo" ? "text-faint" : ""}`}>
      <div className="flex items-center gap-2 font-bold">
        <span className={`grid size-[22px] place-items-center rounded-full border text-xs font-extrabold ${state === "done" ? "border-good bg-good text-[#0b1f15]" : state === "now" ? "border-accent bg-accent text-white" : "border-border bg-surface-2"}`}>
          {state === "done" ? "✓" : n}
        </span>
        {title}
      </div>
      {body}
    </div>
  );
  const bar = (value: number) => (
    <span className="h-1.5 overflow-hidden rounded-full bg-border" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <span className="block h-full rounded-full bg-accent" style={{ width: `${value}%` }} />
    </span>
  );
  const collectState = phase === "collecting" || !p.finished ? "now" : "done";
  const readState = phase === "reading" || a.status === "paused" || a.status === "failed" ? "now" : collectState === "now" || a.pending > 0 ? "todo" : "done";

  return (
    <section className={ui.card} aria-labelledby="progress" role="status">
      <div className={ui.cardHead}>
        <h2 id="progress" className={ui.cardTitle}>
          Progress
        </h2>
        <span className={`${ui.meta} sm:ml-auto`}>{phase === "idle" ? "Paused · press Resume to carry on" : "Keep this page open. Closing it pauses the study; you can resume any time."}</span>
      </div>
      <div className="grid gap-3 px-4 py-5 sm:grid-cols-3 sm:px-6">
        {step(
          1,
          "Collect posts",
          collectState,
          <>
            {collectState === "now" && bar(collectPct)}
            <span className="text-xs text-muted">
              {Object.entries(sources)
                .map(([s, n]) => `${SOURCE_LABELS[s] ?? s} ${n}${p.runCap ? ` of ${p.runCap}` : ""}`)
                .join(" · ") || "Starting…"}
            </span>
          </>,
        )}
        {step(
          2,
          "Read every post",
          readState,
          <>
            {readState === "now" && bar(readPct)}
            <span className="text-xs text-muted">{readState === "todo" ? "Jev sorts each post into the categories" : `${a.analyzed.toLocaleString("en-US")} of ${a.totalPosts.toLocaleString("en-US")} posts`}</span>
          </>,
        )}
        {step(3, "Results", readState === "done" && collectState === "done" ? "done" : "todo", <span className="text-xs text-muted">Journey map, themes, quotes</span>)}
      </div>
      <div className="flex flex-wrap items-center gap-3 px-4 pb-5 sm:px-6">
        {message && <span className="text-sm text-critical">{message}</span>}
        <span className="text-[13px] text-muted">Spent on this study: {usd(p.costUsd)}</span>
        <span className="flex-1" />
        {phase !== "idle" ? (
          <button
            type="button"
            onClick={() => {
              stop.current = true;
              setStopped(true);
            }}
            className={ui.plainSm}
          >
            Stop
          </button>
        ) : stuck || message ? (
          <button type="button" onClick={resume} className={ui.primarySm}>
            Resume
          </button>
        ) : (
          readable && (
            <button type="button" onClick={() => void run(false)} className={ui.primarySm}>
              Read {a.pending.toLocaleString("en-US")} new {a.pending === 1 ? "post" : "posts"} · {aboutUsd(a.estimateUsd)}
            </button>
          )
        )}
      </div>
    </section>
  );
}
