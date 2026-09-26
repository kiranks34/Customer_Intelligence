"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, useTransition } from "react";

import type { AnalysisState } from "@/lib/analysis";
import type { Progress } from "@/lib/collect";

import { aboutUsd, usd } from "../../format";
import { dot, ui, type Tone } from "../../ui";
import { advanceAction, clearSearchesAction, renameStudyAction, resumeAction, startCollectionAction, type ActionState } from "../actions";
import { advanceAnalysisAction, reanalyzeWithKnowledgeAction, resumeAnalysisAction, startAnalysisAction } from "../analysis-actions";

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
const isProgress = (r: Progress | ActionState): r is Progress => "jobs" in r;
const isState = (r: AnalysisState | ActionState): r is AnalysisState => "pending" in r;
const SOURCE_LABELS: Record<string, string> = { youtube: "YouTube", reddit: "Reddit" };
const MAX_RETRIES = 3;
const n = (k: number, one: string, many = `${one}s`) => `${k.toLocaleString("en-US")} ${k === 1 ? one : many}`;

type Phase = "idle" | "collecting" | "reading";

/**
 * Opens what an in-page link points at: Search settings, or a row of Improve these results (which listens for
 * "pulse:open"). Works on repeated clicks, which a hash change alone doesn't.
 */
export function openOnPage(target: string) {
  if (target === "settings") {
    const d = document.getElementById("settings") as HTMLDetailsElement | null;
    if (d) d.open = true;
  }
  window.dispatchEvent(new CustomEvent("pulse:open", { detail: target }));
}

export interface StudyFacts {
  searchId: number;
  title: string;
  progress: Progress;
  analysis: AnalysisState;
  /** `?run=1`: start the open work (or read what's new) once, on arrival. */
  autorun: boolean;
  /** Results exist (some codebook version has read the posts). */
  hasResults: boolean;
  /** The categories were saved after the results were computed (a newer version isn't read yet). */
  newerCategories: number | null;
  /** Family facts the study's categories don't carry yet (D45). */
  factsNotUsed: number;
  /** Claude-vs-Jev disagreements waiting in Accuracy. */
  openAnswers: number;
  /** Cost of Collect new posts: the searches plus reading what they find, at most. */
  collectUsd: number;
}

interface Action {
  label: string;
  /** Paid actions: shown under the button (the label stays a short verb, D47). */
  cost?: number;
  primary: boolean;
  onClick?: () => void;
  href?: string;
}

interface Status {
  tone: Tone;
  word: string;
  reason: string;
  action: Action | null;
}

interface Ctx {
  facts: StudyFacts;
  phase: Phase;
  p: Progress;
  a: AnalysisState;
  message: string | null;
  status: Status;
  busy: boolean;
  /** A button's first call, or the refresh after a run, is under way: every button waits. */
  locked: boolean;
  collectNew: () => void;
}

const StudyContext = createContext<Ctx | null>(null);
const useStudy = () => {
  const c = useContext(StudyContext);
  if (!c) throw new Error("StudyControl missing");
  return c;
};

/**
 * One study's work and its one next step (D47). The page drives the work while it is open: collect, then read what's
 * new. Paid work starts only from the study bar's button (or `?run=1` right after you started it elsewhere); a reload
 * or Stop leaves open work waiting for Resume.
 */
export function StudyControl({ facts, children }: { facts: StudyFacts; children: React.ReactNode }) {
  const { searchId } = facts;
  const router = useRouter();
  const [p, setP] = useState(facts.progress);
  const [a, setA] = useState(facts.analysis);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  // From a click until the run owns the work (and while the page refreshes after it): buttons stay locked, so a
  // double click or a stale status can't start paid work twice.
  const [starting, setStarting] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const stop = useRef(false);
  const busy = useRef(false);

  // Fresh server data (after saving categories, keeping a post, a finished run) is taken while nothing runs; a run in
  // progress keeps its own, newer state. Done during render, React's way to follow props.
  const [seen, setSeen] = useState({ progress: facts.progress, analysis: facts.analysis });
  if (seen.progress !== facts.progress || seen.analysis !== facts.analysis) {
    setSeen({ progress: facts.progress, analysis: facts.analysis });
    if (phase === "idle" && !starting) {
      setP(facts.progress);
      setA(facts.analysis);
      if (facts.progress.finished && facts.progress.jobs.waiting === 0 && facts.analysis.status !== "running") setStopped(false);
    }
  }

  useEffect(() => {
    stop.current = false;
    if (facts.autorun) {
      window.history.replaceState(null, "", window.location.pathname + window.location.hash);
      const collecting = !facts.progress.finished && facts.progress.jobs.waiting === 0;
      const reading = facts.analysis.status === "running";
      const readNew = facts.analysis.pending > 0 && (facts.analysis.status === "none" || facts.analysis.status === "done");
      if (collecting || reading || readNew) void run(collecting, reading);
    }
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
      setStarting(false);
      if (!stop.current) startRefresh(() => router.refresh());
    }
  }

  async function collect(): Promise<boolean> {
    setPhase("collecting");
    setStarting(false);
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
      if (r.finished) {
        // Failed searches don't stop the run (the rest is read), but they must never pass silently.
        if (r.jobs.failed > 0) setMessage(`${r.jobs.failed} of the searches failed: ${r.lastErrors[0] ?? "no reason given"}`);
        return r.jobs.waiting === 0;
      }
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
    setStarting(false);
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

  /** Runs a button's first server call with the buttons locked; the run loop takes over from there. */
  async function begin(first: () => Promise<boolean>) {
    if (busy.current || starting || refreshing) return;
    setStarting(true);
    setMessage(null);
    try {
      if (!(await first())) setStarting(false);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Connection lost. Try again.");
      setStarting(false);
    }
  }
  const fail = (m: string) => {
    setMessage(m);
    return false;
  };

  const resume = () =>
    begin(async () => {
      if (p.jobs.waiting > 0) {
        const r = await resumeAction(searchId);
        if (!r.ok) return fail(r.message);
      }
      let reading = a.status === "running";
      if (a.status === "paused" || a.status === "failed") {
        const r = await resumeAnalysisAction(searchId);
        if (!r.ok) return fail(r.message);
        setA((x) => ({ ...x, status: "running" }));
        reading = true;
      }
      void run(!p.finished || p.jobs.waiting > 0, reading);
      return true;
    });

  /** New product facts: save them into the categories (a new version) and read every post again. */
  const reanalyzeWithFacts = () =>
    begin(async () => {
      const r = await reanalyzeWithKnowledgeAction(searchId);
      if (!r.ok) return fail(r.message);
      void run(false, true);
      return true;
    });

  const collectNew = () =>
    begin(async () => {
      const r = await startCollectionAction(searchId);
      if (!r.ok) return fail(r.message);
      setP((x) => ({ ...x, finished: false }));
      void run(true);
      return true;
    });

  const analyze = () =>
    begin(async () => {
      void run(false);
      return true;
    });

  const halt = () => {
    stop.current = true;
    setStopped(true);
  };

  const status = statusOf({ facts, phase, p, a, stopped, analyze, resume, halt, reanalyzeWithFacts, collectNew });
  const locked = starting || refreshing;
  return (
    <StudyContext.Provider value={{ facts, phase, p, a, message, status, busy: phase !== "idle" || locked, locked, collectNew: () => void collectNew() }}>
      {children}
    </StudyContext.Provider>
  );
}

/** The study's status in one word, why, and the one button that moves it on (the same words as All studies). */
function statusOf(s: {
  facts: StudyFacts;
  phase: Phase;
  p: Progress;
  a: AnalysisState;
  stopped: boolean;
  analyze: () => Promise<void>;
  resume: () => Promise<void>;
  halt: () => void;
  reanalyzeWithFacts: () => Promise<void>;
  collectNew: () => Promise<void>;
}): Status {
  const { facts, phase, p, a } = s;
  const stopBtn: Action = { label: "Stop", primary: false, onClick: s.halt };
  const resumeBtn: Action = { label: "Resume", primary: true, onClick: () => void s.resume() };
  if (phase === "collecting") return { tone: "info", word: "Collecting", reason: "Keep this page open", action: stopBtn };
  if (phase === "reading") return { tone: "info", word: "Reading posts", reason: "Keep this page open", action: stopBtn };
  if (p.jobs.waiting > 0) return { tone: "warn", word: "Waiting", reason: (p.lastErrors[0] ?? "Paused until you resume").replace(/^Paused:\s*/, "").replace(/\.$/, ""), action: resumeBtn };
  if (a.status === "paused" || a.status === "failed") return { tone: "muted", word: "Paused", reason: a.message ?? "Reading stopped before the end", action: resumeBtn };
  if (s.stopped || !p.finished || a.status === "running") return { tone: "muted", word: "Paused", reason: "You stopped it, or the page was closed", action: resumeBtn };
  if (p.totalPosts === 0) {
    const ran = p.jobs.queued + p.jobs.running + p.jobs.done + p.jobs.failed + p.jobs.waiting > 0;
    return { tone: "bad", word: "Stopped", reason: ran ? "No posts found" : "Nothing collected yet", action: { label: "Change search settings", primary: false, href: "#settings" } };
  }
  if (!facts.hasResults)
    return {
      tone: "muted",
      word: "Not analyzed",
      reason: `${n(a.totalPosts, "post")} collected, not read yet`,
      action: { label: "Analyze", cost: a.estimateUsd, primary: true, onClick: () => void s.analyze() },
    };
  if (facts.factsNotUsed > 0)
    return {
      tone: "warn",
      word: "Update ready",
      reason: `${n(facts.factsNotUsed, "new product fact")} not used yet`,
      action: { label: "Re-analyze", cost: a.rereadUsd, primary: true, onClick: () => void s.reanalyzeWithFacts() },
    };
  if (a.pending > 0) {
    const categories = facts.newerCategories !== null;
    return {
      tone: "warn",
      word: "Update ready",
      reason: categories ? `Categories version ${facts.newerCategories} not used yet` : `${n(a.pending, "new post")} not read yet`,
      action: { label: categories ? "Re-analyze" : "Analyze new posts", cost: a.estimateUsd, primary: true, onClick: () => void s.analyze() },
    };
  }
  if (facts.openAnswers > 0)
    return { tone: "warn", word: "To review", reason: `${n(facts.openAnswers, "answer")} to check`, action: { label: "Check answers", primary: false, href: "#accuracy" } };
  return { tone: "good", word: "Ready", reason: "Results use every post", action: { label: "Collect new posts", cost: facts.collectUsd, primary: false, onClick: () => void s.collectNew() } };
}

/**
 * The study's status and its one next step (D47): a short word and why, the button (its cost under it) and ⋯. It
 * sits top right, level with the page title (DESIGN-SYSTEM.md, page header), and moves into the study bar once the
 * title has scrolled away, so it is always in reach and never shown twice.
 */
export function NextStep() {
  const { facts, p, status, message, busy, locked, collectNew } = useStudy();
  const act = status.action;
  const cls = act ? (act.primary ? ui.primarySm : ui.secondarySm) : "";
  const showCollect = !busy && status.word !== "Ready" && !["Paused", "Waiting"].includes(status.word);
  return (
    <div className="flex min-w-0 items-start gap-3">
      <div className="flex min-w-0 flex-col items-end pt-1.5 text-right" role="status">
        <span className="inline-flex items-center gap-2 text-[13px] font-semibold">
          <span className={`h-2 w-2 shrink-0 rounded-full ${dot[status.tone]}`} aria-hidden />
          {status.word}
        </span>
        <span className={`text-xs ${message ? "text-critical" : "text-muted"}`}>{message ?? status.reason}</span>
      </div>
      {act && (
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          {act.href ? (
            <a href={act.href} onClick={() => openOnPage(act.href!.slice(1))} className={cls}>
              {act.label}
            </a>
          ) : (
            <button type="button" disabled={locked && act.label !== "Stop"} onClick={act.onClick} className={cls}>
              {act.label}
            </button>
          )}
          {act.cost !== undefined && <span className={ui.meta}>{aboutUsd(act.cost)}</span>}
        </div>
      )}
      <StudyMenu id={facts.searchId} title={facts.title} collect={showCollect ? { label: p.totalPosts ? "Collect new posts" : "Collect posts", cost: facts.collectUsd, run: collectNew } : null} />
    </div>
  );
}

/** True once the page title (#study-title) has scrolled out of view. */
function useTitleGone() {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const el = document.getElementById("study-title");
    if (!el) return;
    const o = new IntersectionObserver(([e]) => setGone(!e.isIntersecting), { threshold: 0 });
    o.observe(el);
    return () => o.disconnect();
  }, []);
  return gone;
}

/** The page header's right side: the next step while the title is in view (the study bar takes it over after). */
export function HeaderStep() {
  const gone = useTitleGone();
  return <div className={`ml-auto shrink-0 ${gone ? "invisible" : ""}`}>{gone ? null : <NextStep />}</div>;
}

/**
 * The study bar: stays at the top while you scroll, with the jump links to the results. Once the title has scrolled
 * away it also carries the study's name and its next step.
 */
export function StudyBar({ sections }: { sections: [string, string][] }) {
  const { facts } = useStudy();
  const gone = useTitleGone();
  if (!gone && sections.length === 0) return null;
  return (
    <div className="sticky top-0 z-20 -mx-4 flex flex-col gap-2.5 border-b border-border bg-background/95 px-4 py-2.5 backdrop-blur sm:mx-0 sm:px-0">
      {gone && (
        <div className="flex items-center justify-between gap-4">
          <span className="hidden min-w-0 truncate text-base font-bold sm:block">{facts.title}</span>
          <NextStep />
        </div>
      )}
      {sections.length > 0 && (
        <nav aria-label="On this page" className="flex flex-wrap gap-1.5">
          {sections.map(([anchor, label]) => (
            <a key={anchor} href={`#${anchor}`} className="inline-flex h-[30px] items-center rounded-full border border-border px-3 text-[13px] text-muted hover:text-foreground">
              {label}
            </a>
          ))}
        </nav>
      )}
    </div>
  );
}

/** ⋯: Collect new posts (when it isn't the bar's button), Rename, Search settings, Remove. */
function StudyMenu({ id, title, collect }: { id: number; title: string; collect: { label: string; cost: number; run: () => void } | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(title);
  const [note, setNote] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) {
        setOpen(false);
        setRenaming(false);
        if (e instanceof KeyboardEvent) button.current?.focus();
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const act = (fn: () => Promise<{ ok: boolean; message: string }>, then: () => void) =>
    startTransition(async () => {
      const r = await fn();
      setOpen(false);
      setRenaming(false);
      if (r.ok) then();
      else setNote(r.message);
    });
  const item = "block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2 disabled:opacity-50";

  return (
    <div ref={box} className="relative">
      <button ref={button} type="button" aria-label="More actions" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={ui.icon}>
        ⋯
      </button>
      {open && (
        <div className="absolute top-10 right-0 z-30 w-64 rounded-xl border border-border bg-surface p-1.5 text-left shadow-[0_16px_48px_rgba(0,0,0,.45)]">
          {renaming ? (
            <form
              className="flex flex-col gap-2 p-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                act(() => renameStudyAction(id, name), () => router.refresh());
              }}
            >
              <input autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} aria-label="Study name" className={ui.input} />
              <div className="flex gap-2">
                <button type="submit" disabled={pending} className={ui.primarySm}>
                  Save
                </button>
                <button type="button" onClick={() => setRenaming(false)} className={ui.plainSm}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              {collect && (
                <button
                  type="button"
                  className={item}
                  onClick={() => {
                    setOpen(false);
                    collect.run();
                  }}
                >
                  {collect.label}
                  <span className="block text-xs text-muted">{aboutUsd(collect.cost)} · searches again, then reads what&apos;s new</span>
                </button>
              )}
              <button
                type="button"
                className={item}
                onClick={() => {
                  setName(title);
                  setRenaming(true);
                }}
              >
                Rename
              </button>
              <a
                href="#settings"
                className={item}
                onClick={() => {
                  setOpen(false);
                  openOnPage("settings");
                }}
              >
                Search settings
                <span className="block text-xs text-muted">What Pulse searches for, and how much</span>
              </a>
              <div className="my-1 border-t border-border" />
              <button
                type="button"
                disabled={pending}
                className={`${item} text-critical`}
                onClick={() => {
                  if (window.confirm(`Remove “${title}” from Studies? Its posts and costs are kept.`)) act(() => clearSearchesAction([id]), () => router.push("/"));
                }}
              >
                Remove from Studies
              </button>
            </>
          )}
        </div>
      )}
      {note && (
        <span role="alert" className="absolute top-10 right-0 w-64 text-right text-xs text-critical">
          {note}
        </span>
      )}
    </div>
  );
}

/**
 * Progress while a study collects and reads, or is paused or not analyzed yet: the three steps and what they cost.
 * It has no buttons of its own; the study bar holds the one next step.
 */
export function StudyProgress() {
  const { facts, phase, p, a, status } = useStudy();
  const working = phase !== "idle" || ["Paused", "Waiting", "Not analyzed", "Stopped"].includes(status.word);
  if (!working) return null;
  const total = p.jobs.queued + p.jobs.running + p.jobs.done + p.jobs.failed + p.jobs.waiting;
  const collectPct = p.finished ? 100 : total ? Math.round(((p.jobs.done + p.jobs.failed) / total) * 100) : 0;
  const readPct = a.totalPosts ? Math.round((a.analyzed / a.totalPosts) * 100) : 0;
  const sources = Object.keys(p.runBySource).length ? p.runBySource : p.postsBySource;
  const collectState = phase === "collecting" || !p.finished ? "now" : "done";
  const readState = phase === "reading" || a.status === "paused" || a.status === "failed" || (collectState === "done" && !facts.hasResults) ? "now" : collectState === "now" || a.pending > 0 ? "todo" : "done";
  const step = (k: number, title: string, state: "done" | "now" | "todo", body: React.ReactNode) => (
    <div className={`flex flex-col gap-1.5 rounded-xl border px-4 py-3.5 ${state === "now" ? "border-accent bg-accent/10" : "border-border"} ${state === "todo" ? "text-faint" : ""}`}>
      <div className="flex items-center gap-2 font-bold">
        <span className={`grid size-[22px] place-items-center rounded-full border text-xs font-extrabold ${state === "done" ? "border-good bg-good text-background" : state === "now" ? "border-accent bg-accent text-background" : "border-border bg-surface-2"}`}>
          {state === "done" ? "✓" : k}
        </span>
        {title}
      </div>
      {body}
    </div>
  );
  const bar = (value: number, label: string) => (
    <span className="h-1.5 overflow-hidden rounded-full bg-border" role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <span className="block h-full rounded-full bg-accent" style={{ width: `${value}%` }} />
    </span>
  );

  return (
    <section className={ui.card} aria-labelledby="progress">
      <div className={ui.cardHead}>
        <h2 id="progress" className={ui.cardTitle}>
          Progress
        </h2>
      </div>
      <div className="grid gap-3 px-4 py-5 sm:grid-cols-3 sm:px-6">
        {step(
          1,
          "Collect posts",
          collectState,
          <>
            {phase === "collecting" && bar(collectPct, "Collecting")}
            <span className="text-xs text-muted">
              {Object.entries(sources)
                .map(([src, k]) => `${SOURCE_LABELS[src] ?? src} ${k}${p.runCap ? ` of ${p.runCap}` : ""}`)
                .join(" · ") || "Nothing yet"}
            </span>
          </>,
        )}
        {step(
          2,
          "Read every post",
          readState,
          <>
            {phase === "reading" && bar(readPct, "Reading")}
            <span className="text-xs text-muted">
              {phase === "reading" || a.analyzed > 0 ? `${a.analyzed.toLocaleString("en-US")} of ${a.totalPosts.toLocaleString("en-US")} posts` : "Jev sorts each post into the categories"}
            </span>
          </>,
        )}
        {step(3, "Results", readState === "done" && collectState === "done" ? "done" : "todo", <span className="text-xs text-muted">Journey map, themes, quotes</span>)}
      </div>
      <p className="px-4 pb-5 text-[13px] text-muted sm:px-6">Spent on this study: {usd(p.costUsd)}</p>
    </section>
  );
}
