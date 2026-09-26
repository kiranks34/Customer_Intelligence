"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, useTransition } from "react";

import type { AnalysisState } from "@/lib/analysis";
import type { Progress } from "@/lib/collect";
import type { SideFacts } from "@/lib/study-side";

import { aboutUsd, usd } from "../../format";
import { dot, ui, type Tone } from "../../ui";
import { clearSearchesAction, renameStudyAction, startCollectionAction, type ActionState } from "../actions";
import { reanalyzeWithKnowledgeAction, startAnalysisAction } from "../analysis-actions";
import { useRunner } from "../../runner";
import { resumeRunsAction, stopRunsAction } from "../../runs-actions";
import { removeComparisonAction, renameComparisonAction } from "../../compare/actions";

const SOURCE_LABELS: Record<string, string> = { youtube: "YouTube", reddit: "Reddit" };
const n = (k: number, one: string, many = `${one}s`) => `${k.toLocaleString("en-US")} ${k === 1 ? one : many}`;

type Phase = "idle" | "collecting" | "reading" | "stopping";
type StepState = "done" | "now" | "todo" | "bad";

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
  /** A study (one side) or a comparison (two sides, D48). */
  kind: "study" | "comparison";
  /** The study's search id, or the comparison's id. */
  id: number;
  title: string;
  /** `?run=1`: start the open work (or read what's new) once, on arrival. */
  autorun: boolean;
  sides: SideFacts[];
  /** A study that is one side of a comparison: new posts are collected for both sides together, from there. */
  partOf?: { id: number; title: string };
}

interface Action {
  label: string;
  /** Paid actions: shown under the button (the label stays a short verb, D47). */
  cost?: number;
  primary: boolean;
  onClick?: () => void;
  /** "#…" opens something on this page; anything else is a page link. */
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
  /** The side being worked on while collecting or reading. */
  current: number;
  ps: Progress[];
  as: AnalysisState[];
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

const unfinished = (p: Progress) => !p.finished && p.jobs.waiting === 0;
const everCollected = (p: Progress) => p.totalPosts > 0 || p.jobs.queued + p.jobs.running + p.jobs.done + p.jobs.failed + p.jobs.waiting > 0;

/**
 * A study's status and its one next step (D47), for one study or both sides of a comparison (D48). The work itself
 * runs in any open Pulse tab (the runner, D49): this page starts, stops and resumes it and shows the runner's live
 * state. Paid work starts only from the study bar's button.
 */
export function StudyControl({ facts, children }: { facts: StudyFacts; children: React.ReactNode }) {
  const router = useRouter();
  const runner = useRunner();
  const ids = facts.sides.map((x) => x.searchId);
  const key = ids.join(",");
  const [message, setMessage] = useState<string | null>(null);
  // From a click until the page shows the work it started: buttons stay locked, so a double click or a stale status
  // can't start paid work twice.
  const [starting, setStarting] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  // Stop shows at once, before the server confirms it (D49).
  const [halting, setHalting] = useState(false);

  const watch = runner?.watch;
  useEffect(() => watch?.(key.split(",").map(Number)), [watch, key]);
  useEffect(() => {
    // `?run=1` after New study: the run already started on the server; the URL is tidied.
    if (facts.autorun) window.history.replaceState(null, "", window.location.pathname + window.location.hash);
  }, [facts.autorun]);

  // The runner's copy when it is newer than the page's (a run in progress), else the page's.
  const live = facts.sides.map((x) => {
    const r = runner?.states[x.searchId];
    return r && r.at > x.run.at ? r : null;
  });
  const ps = facts.sides.map((x, i) => live[i]?.progress ?? x.progress);
  const as = facts.sides.map((x, i) => live[i]?.analysis ?? x.analysis);
  const runs = facts.sides.map((x, i) => live[i] ?? x.run);
  const runnerNote = ids.map((id, i) => (runner?.messages[id] ? `${who(facts, i)}${runner.messages[id]}` : null)).find(Boolean) ?? null;

  const working = (i: number) => runs[i].driven && !runs[i].stopped;
  const collecting = ps.findIndex((p, i) => unfinished(p) && working(i));
  // Reading also covers the moment between collecting and the first batch (the runner starts it next).
  const reading = as.findIndex((a, i) => (a.status === "running" || (runs[i].readNext && ps[i].finished && ps[i].jobs.waiting === 0 && ps[i].totalPosts > 0)) && working(i));
  const confirmed = runs.every((r) => r.stopped && !r.stopping);
  if (halting && confirmed) setHalting(false);
  const phase: Phase = (halting && !confirmed) || runs.some((r) => r.stopping) ? "stopping" : collecting >= 0 ? "collecting" : reading >= 0 ? "reading" : "idle";
  const current = Math.max(0, phase === "collecting" ? collecting : reading);

  /** Runs a button's server calls with the buttons locked, then lets the runner take over. */
  async function begin(first: () => Promise<string | null>) {
    if (starting || refreshing) return;
    setStarting(true);
    setMessage(null);
    runner?.clear(ids);
    try {
      const note = await first();
      setMessage(note);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Connection lost. Try again.");
    } finally {
      runner?.kick();
      startRefresh(() => router.refresh());
      setStarting(false);
    }
  }

  /** Every side's call in turn; a side that couldn't start is named, the others go ahead (D48). */
  async function eachSide(sides: number[], call: (id: number) => Promise<ActionState>, skip: (m: string) => boolean = () => false) {
    let note: string | null = null;
    for (const i of sides) {
      const r = await call(ids[i]);
      if (!r.ok && !skip(r.message)) note ??= `${who(facts, i)}${r.message}`;
    }
    return note;
  }

  const all = ids.map((_, i) => i);
  const collectNew = () => begin(() => eachSide(all, startCollectionAction));
  const analyze = () =>
    begin(() =>
      eachSide(
        all.filter((i) => as[i].pending > 0 || !facts.sides[i].hasResults),
        startAnalysisAction,
        // Nothing new on a side is fine; in a comparison, a side with no posts doesn't hold up the other.
        (m) => m.startsWith("Every post") || (facts.kind === "comparison" && m.startsWith("Collect some posts")),
      ),
    );
  const reanalyzeWithFacts = () => begin(() => eachSide(all.filter((i) => facts.sides[i].factsNotUsed > 0), reanalyzeWithKnowledgeAction));
  const resume = () =>
    begin(async () => {
      const r = await resumeRunsAction(ids);
      return r.ok ? null : r.message;
    });
  // Stop never waits for another click's refresh: it always goes out at once.
  const halt = () => {
    setHalting(true);
    setMessage(null);
    stopRunsAction(ids)
      .then((r) => {
        if (!r.ok) {
          setHalting(false);
          setMessage(r.message);
        }
      })
      .catch(() => {
        setHalting(false);
        setMessage("Connection lost. Press Stop again.");
      })
      .finally(() => {
        runner?.kick();
        startRefresh(() => router.refresh());
      });
  };

  const status = statusOf({ facts, phase, current, ps, as, runs, analyze, resume, halt, reanalyzeWithFacts, collectNew });
  const locked = starting || refreshing;
  return (
    <StudyContext.Provider value={{ facts, phase, current, ps, as, message: message ?? runnerNote, status, busy: phase !== "idle" || locked, locked, collectNew: () => void collectNew() }}>
      {children}
    </StudyContext.Provider>
  );
}

const who = (facts: StudyFacts, i: number) => (facts.kind === "comparison" ? `${facts.sides[i].label}: ` : "");
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * The status in one word and the one button that moves it on (the same words as All studies). The header shows the
 * word only; the detail sits where it belongs (Progress, the Improve rows). For a comparison, the side that holds
 * things up is named in the reason All studies shows.
 */
function statusOf(s: {
  facts: StudyFacts;
  phase: Phase;
  current: number;
  ps: Progress[];
  as: AnalysisState[];
  runs: { stopped: boolean; driven: boolean; stopping: boolean; readNext: boolean }[];
  analyze: () => Promise<void>;
  resume: () => Promise<void>;
  halt: () => void;
  reanalyzeWithFacts: () => Promise<void>;
  collectNew: () => Promise<void>;
}): Status {
  const { facts, phase, ps, as, runs } = s;
  const sides = facts.sides;
  const pair = facts.kind === "comparison";
  const name = (i: number) => (pair ? `${sides[i].label}: ` : "");
  const stopBtn: Action = { label: "Stop", primary: false, onClick: s.halt };
  const resumeBtn: Action = { label: "Resume", primary: true, onClick: () => void s.resume() };
  const collectUsd = sum(sides.map((x) => x.collectUsd));
  if (phase === "stopping") return { tone: "info", word: "Stopping…", reason: "Finishing the current step", action: null };
  if (phase === "collecting") return { tone: "info", word: "Collecting", reason: pair ? sides[s.current].label : "", action: stopBtn };
  if (phase === "reading") return { tone: "info", word: "Reading posts", reason: pair ? sides[s.current].label : "", action: stopBtn };
  const waiting = ps.findIndex((p) => p.jobs.waiting > 0);
  if (waiting >= 0)
    return {
      tone: "warn",
      word: "Waiting",
      reason: name(waiting) + (ps[waiting].lastErrors[0] ?? "Paused until you resume").replace(/^Paused:\s*/, "").replace(/\.$/, ""),
      action: resumeBtn,
    };
  const paused = as.findIndex((a) => a.status === "paused" || a.status === "failed");
  if (paused >= 0) return { tone: "muted", word: "Paused", reason: name(paused) + (as[paused].message ?? "Reading stopped before the end"), action: resumeBtn };
  // Open work nobody is driving: you stopped it, or every Pulse tab was closed (D49).
  const open = sides.findIndex((_, i) => !ps[i].finished || as[i].status === "running");
  if (open >= 0) return { tone: "muted", word: "Paused", reason: name(open) + (runs[open].stopped ? "You stopped it" : "No Pulse tab was open"), action: resumeBtn };
  const never = ps.findIndex((p) => !everCollected(p));
  if (never >= 0)
    return { tone: "muted", word: "Not started", reason: name(never) + "Nothing collected yet", action: { label: "Collect posts", cost: collectUsd, primary: true, onClick: () => void s.collectNew() } };
  const empty = ps.findIndex((p) => p.totalPosts === 0);
  if (empty >= 0)
    return {
      tone: "bad",
      word: "Stopped",
      reason: name(empty) + "No posts found",
      action: pair
        ? { label: "Change its search settings", primary: false, href: `/searches/${sides[empty].searchId}#settings` }
        : { label: "Change search settings", primary: false, href: "#settings" },
    };
  if (sides.some((x) => !x.hasResults))
    return {
      tone: "muted",
      word: "Not analyzed",
      reason: `${n(sum(as.map((a) => a.totalPosts)), "post")} collected, not read yet`,
      action: { label: "Analyze", cost: sum(as.map((a) => a.estimateUsd)), primary: true, onClick: () => void s.analyze() },
    };
  const facts2 = sum(sides.map((x) => x.factsNotUsed));
  if (facts2 > 0)
    return {
      tone: "warn",
      word: "Update ready",
      reason: `${n(facts2, "new product fact")} not used yet`,
      action: { label: "Re-analyze", cost: sum(sides.map((x, i) => (x.factsNotUsed > 0 ? as[i].rereadUsd : 0))), primary: true, onClick: () => void s.reanalyzeWithFacts() },
    };
  const pending = sum(as.map((a) => a.pending));
  if (pending > 0) {
    const newer = sides.map((x) => x.newerCategories).find((v) => v !== null) ?? null;
    return {
      tone: "warn",
      word: "Update ready",
      reason: newer !== null ? (pair ? "New categories not used yet" : `Categories version ${newer} not used yet`) : `${n(pending, "new post")} not read yet`,
      action: { label: newer !== null ? "Re-analyze" : "Analyze new posts", cost: sum(as.map((a) => a.estimateUsd)), primary: true, onClick: () => void s.analyze() },
    };
  }
  const answers = sum(sides.map((x) => x.openAnswers));
  if (answers > 0) {
    const first = sides.find((x) => x.openAnswers > 0)!;
    return {
      tone: "warn",
      word: "To review",
      reason: `${n(answers, "answer")} to check`,
      action: { label: "Check answers", primary: false, href: pair ? `/searches/${first.searchId}?from=compare-${facts.id}#accuracy` : "#accuracy" },
    };
  }
  if (facts.partOf) return { tone: "good", word: "Ready", reason: "Results use every post", action: { label: "Open the comparison", primary: false, href: `/compare/${facts.partOf.id}` } };
  return { tone: "good", word: "Ready", reason: "Results use every post", action: { label: "Collect new posts", cost: collectUsd, primary: false, onClick: () => void s.collectNew() } };
}

/**
 * The study's status and its one next step (D47): a short word and why, the button (its cost under it) and ⋯. It
 * sits top right, level with the page title (DESIGN-SYSTEM.md, page header), and moves into the study bar once the
 * title has scrolled away, so it is always in reach and never shown twice.
 */
export function NextStep() {
  const { facts, status, message, busy, locked, collectNew } = useStudy();
  const act = status.action;
  const cls = act ? (act.primary ? ui.primarySm : ui.secondarySm) : "";
  const cost = facts.sides.reduce((t, x) => t + x.collectUsd, 0);
  // ⋯ offers collecting only where it isn't the bar's own button and adds to something (never on Not analyzed).
  const menuCollect =
    busy || facts.partOf
      ? null
      : status.word === "Stopped"
        ? { label: "Collect again", note: "runs the same searches again", cost, run: collectNew }
        : ["Update ready", "To review"].includes(status.word)
          ? { label: "Collect new posts", note: "searches again, then reads what's new", cost, run: collectNew }
          : null;
  return (
    <div className="flex min-w-0 items-start gap-3">
      <div className="flex min-w-0 flex-col items-end pt-1.5 text-right" role="status">
        <span className="inline-flex items-center gap-2 text-[13px] font-semibold">
          <span className={`h-2 w-2 shrink-0 rounded-full ${dot[status.tone]}`} aria-hidden />
          {status.word}
        </span>
        {/* The word only: the reason is shown where it belongs (Progress, the Improve rows). Problems do show. */}
        {message && <span className="text-xs text-critical">{message}</span>}
      </div>
      {act && (
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          {act.href?.startsWith("#") ? (
            <a href={act.href} onClick={() => openOnPage(act.href!.slice(1))} className={cls}>
              {act.label}
            </a>
          ) : act.href ? (
            <Link href={act.href} className={cls}>
              {act.label} →
            </Link>
          ) : (
            <button type="button" disabled={locked && act.label !== "Stop"} onClick={act.onClick} className={cls}>
              {act.label}
            </button>
          )}
          {act.cost !== undefined && <span className={ui.meta}>{aboutUsd(act.cost)}</span>}
        </div>
      )}
      <StudyMenu facts={facts} collect={menuCollect} />
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

/**
 * ⋯: Collect new posts (when it isn't the bar's button), Rename, Search settings (a comparison: each side's study,
 * where its settings, Needs a look and Accuracy live), Remove.
 */
function StudyMenu({ facts, collect }: { facts: StudyFacts; collect: { label: string; note: string; cost: number; run: () => void } | null }) {
  const { id, title } = facts;
  const pair = facts.kind === "comparison";
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
                act(() => (pair ? renameComparisonAction(id, name) : renameStudyAction(id, name)), () => router.refresh());
              }}
            >
              <input autoFocus value={name} maxLength={pair ? 160 : 120} onChange={(e) => setName(e.target.value)} aria-label="Study name" className={ui.input} />
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
                  <span className="block text-xs text-muted">
                    {aboutUsd(collect.cost)} · {collect.note}
                  </span>
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
              {pair ? (
                facts.sides.map((x) => (
                  <Link key={x.searchId} href={`/searches/${x.searchId}?from=compare-${id}`} className={item}>
                    Open {x.label} →
                    <span className="block text-xs text-muted">Its search settings, Needs a look and Accuracy</span>
                  </Link>
                ))
              ) : (
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
              )}
              {/* One side of a comparison is removed with the comparison, from its page (D48). */}
              {!facts.partOf && (
                <>
                  <div className="my-1 border-t border-border" />
                  <button
                    type="button"
                    disabled={pending}
                    className={`${item} text-critical`}
                    onClick={() => {
                      if (window.confirm(`Remove “${title}” from Studies? Its posts and costs are kept.`))
                        act(() => (pair ? removeComparisonAction(id) : clearSearchesAction([id])), () => router.push("/"));
                    }}
                  >
                    Remove from Studies
                  </button>
                </>
              )}
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
  const { facts, phase, current, ps, as, status } = useStudy();
  const working = phase !== "idle" || ["Paused", "Waiting", "Not analyzed", "Stopped", "Not started"].includes(status.word);
  if (!working) return null;
  const pair = facts.kind === "comparison";
  const total = (p: Progress) => p.jobs.queued + p.jobs.running + p.jobs.done + p.jobs.failed + p.jobs.waiting;
  const pctOf = (p: Progress) => (p.finished ? 100 : total(p) ? Math.round(((p.jobs.done + p.jobs.failed) / total(p)) * 100) : 0);
  const collectState: StepState =
    status.word === "Stopped" ? "bad" : phase === "collecting" || ps.some((p) => !p.finished || !everCollected(p)) ? "now" : "done";
  const readState =
    phase === "reading" || as.some((a) => a.status === "paused" || a.status === "failed") || (collectState === "done" && facts.sides.some((x) => !x.hasResults))
      ? "now"
      : collectState === "now" || as.some((a) => a.pending > 0)
        ? "todo"
        : "done";
  const line = (i: number, text: string) => (
    <span key={i} className="text-xs text-muted">
      {pair && <b className={`font-semibold ${i === 0 ? "text-accent" : "text-violet"}`}>{facts.sides[i].label}: </b>}
      {text}
    </span>
  );
  const step = (k: number, title: string, state: StepState, body: React.ReactNode) => (
    <div className={`flex flex-col gap-1.5 rounded-xl border px-4 py-3.5 ${state === "now" ? "border-accent bg-accent/10" : state === "bad" ? "border-critical" : "border-border"} ${state === "todo" ? "text-faint" : ""}`}>
      <div className="flex items-center gap-2 font-bold">
        <span
          className={`grid size-[22px] place-items-center rounded-full border text-xs font-extrabold ${state === "done" ? "border-good bg-good text-background" : state === "now" ? "border-accent bg-accent text-background" : state === "bad" ? "border-critical bg-critical text-background" : "border-border bg-surface-2"}`}
        >
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
  const sources = (p: Progress) => (Object.keys(p.runBySource).length ? p.runBySource : p.postsBySource);

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
            {phase === "collecting" && bar(pctOf(ps[current]), "Collecting")}
            {ps.map((p, i) =>
              line(
                i,
                !everCollected(p)
                  ? "Not started"
                  : p.finished && p.totalPosts === 0
                    ? "No posts found"
                    : Object.entries(sources(p))
                        .map(([src, k]) => `${SOURCE_LABELS[src] ?? src} ${k}${p.runCap ? ` of ${p.runCap}` : ""}`)
                        .join(" · ") || "Nothing yet",
              ),
            )}
          </>,
        )}
        {step(
          2,
          "Read every post",
          readState,
          <>
            {phase === "reading" && bar(as[current].totalPosts ? Math.round((as[current].analyzed / as[current].totalPosts) * 100) : 0, "Reading")}
            {as.some((a) => a.analyzed > 0) || phase === "reading"
              ? as.map((a, i) => line(i, `${a.analyzed.toLocaleString("en-US")} of ${a.totalPosts.toLocaleString("en-US")} posts`))
              : line(0, pair ? "Jev sorts each side's posts into the same categories" : "Jev sorts each post into the categories")}
          </>,
        )}
        {step(3, "Results", readState === "done" && collectState === "done" ? "done" : "todo", <span className="text-xs text-muted">{pair ? "Side by side: themes, journey, quotes" : "Journey map, themes, quotes"}</span>)}
      </div>
      <p className="px-4 pb-5 text-[13px] text-muted sm:px-6">
        {/* Why it waits: the header shows only the word (D47). */}
        {["Paused", "Waiting"].includes(status.word) && (
          <b className="font-semibold text-foreground">
            {status.word}: {status.reason.charAt(0).toLowerCase() + status.reason.slice(1)}.{" "}
          </b>
        )}
        Spent on this {pair ? "comparison" : "study"}: {usd(ps.reduce((t, p) => t + p.costUsd, 0))}
      </p>
    </section>
  );
}
