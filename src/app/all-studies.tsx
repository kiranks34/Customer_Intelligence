"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import type { StudyRow, StudyStatus } from "@/lib/studies";

import { clearSearchesAction, renameStudyAction, startCollectionAction } from "./searches/actions";
import { dot, ui, type Tone } from "./ui";
import { LocalTime } from "./local-time";

type Filter = "ready" | "progress" | "review" | "not_analyzed" | "stopped";
const FILTERS: { id: Filter; label: string; has: (s: StudyStatus) => boolean }[] = [
  { id: "ready", label: "Ready", has: (s) => s.kind === "ready" },
  { id: "progress", label: "In progress", has: (s) => ["collecting", "reading", "paused", "waiting"].includes(s.kind) },
  { id: "review", label: "To review", has: (s) => s.kind === "review" },
  { id: "not_analyzed", label: "Not analyzed", has: (s) => s.kind === "not_analyzed" },
  { id: "stopped", label: "Stopped", has: (s) => s.kind === "stopped" },
];

/**
 * All studies (D46): what each covers, its result in one line, and a status that always says what's happening and
 * what to do: a short word, one line of reason, and the button to fix it. ⋯ has Open, Run again, Rename, Remove.
 */
export function AllStudies({ rows }: { rows: StudyRow[] }) {
  const [filter, setFilter] = useState<Filter | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const shown = filter ? rows.filter((r) => FILTERS.find((f) => f.id === filter)!.has(r.status)) : rows;

  return (
    <section className={ui.card} aria-labelledby="all-studies">
      <div className={ui.cardHead}>
        <h2 id="all-studies" className={ui.cardTitle}>
          All studies
          {rows.length > 0 && <span className="ml-2 inline-flex h-[22px] items-center rounded-full border border-border bg-surface-2 px-2 align-[3px] text-xs font-bold text-muted">{rows.length}</span>}
        </h2>
        <div className="flex flex-wrap gap-1 sm:ml-auto" role="group" aria-label="Show only">
          {FILTERS.map((f) => {
            const n = rows.filter((r) => f.has(r.status)).length;
            if (n === 0) return null;
            const on = filter === f.id;
            return (
              <button key={f.id} type="button" aria-pressed={on} onClick={() => setFilter(on ? null : f.id)} className={`h-7 rounded-full border px-2.5 text-[13px] ${on ? "border-foreground bg-foreground font-semibold text-background" : "border-border text-muted hover:text-foreground"}`}>
                {f.label} {n}
              </button>
            );
          })}
        </div>
      </div>
      {note && (
        <p role="status" className="px-6 pt-3 text-sm text-muted">
          {note}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-muted">Studies you start will appear here.</p>
      ) : (
        <>
          <div className="hidden h-9 grid-cols-[minmax(0,1.3fr)_150px_minmax(0,1.6fr)_200px_32px] items-center gap-4 px-6 text-[11px] font-bold tracking-wider text-muted uppercase md:grid">
            <span>Study</span>
            <span>Sources · period</span>
            <span>Result</span>
            <span>Status</span>
            <span />
          </div>
          <ul>
            {shown.map((r) => (
              <Row key={r.id} r={r} onNote={setNote} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Row({ r, onNote }: { r: StudyRow; onNote: (s: string) => void }) {
  const h = r.headline;
  const result =
    r.status.kind === "ready" || r.status.kind === "review" ? (
      h ? (
        <span>
          {h.counted} about the product
          {h.counted > 0 && (
            <>
              {" · "}
              {h.negativePct >= h.positivePct ? <b className="font-semibold text-critical">{h.negativePct}% negative</b> : <b className="font-semibold text-good">{h.positivePct}% positive</b>}
            </>
          )}
          {h.topPain && ` · top pain: “${h.topPain}”`}
        </span>
      ) : (
        <span className="text-muted">Open to see the results</span>
      )
    ) : (
      <span className="text-muted">{r.posts > 0 ? `${r.posts} posts so far` : r.status.kind === "stopped" ? "0 posts" : "Starting…"}</span>
    );
  return (
    <li className="grid min-h-16 grid-cols-[minmax(0,1fr)_32px] items-center gap-x-3 gap-y-1.5 border-t border-border px-4 py-3 sm:px-6 md:grid-cols-[minmax(0,1.3fr)_150px_minmax(0,1.6fr)_200px_32px] md:gap-x-4">
      <div className="min-w-0">
        <Link href={`/searches/${r.id}`} className="font-bold hover:underline">
          {r.title}
        </Link>
        <div className={ui.meta}>
          <LocalTime iso={r.createdAt} day />
        </div>
      </div>
      <div className="col-start-1 md:col-start-auto">
        <div className="flex flex-wrap gap-1">
          {r.sources.map((s) => (
            <span key={s} className="inline-flex h-[22px] items-center rounded-md border border-border bg-surface-2 px-1.5 text-[11px] font-bold text-muted">
              {s}
            </span>
          ))}
        </div>
        <div className={`${ui.meta} mt-0.5`}>{r.period}</div>
      </div>
      <div className="col-start-1 text-sm md:col-start-auto">{result}</div>
      <div className="col-start-1 md:col-start-auto">
        <Status id={r.id} s={r.status} />
      </div>
      <div className="col-start-2 row-start-1 md:col-start-auto md:row-start-auto">
        <Menu r={r} onNote={onNote} />
      </div>
    </li>
  );
}

function Tag({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-[13px] font-semibold">
      <span className={`h-2 w-2 rounded-full ${dot[tone]}`} aria-hidden />
      {children}
    </span>
  );
}

function Status({ id, s }: { id: number; s: StudyStatus }) {
  const open = (label: string, suffix = "") => (
    <Link href={`/searches/${id}${suffix}`} className={`${ui.secondarySm} mt-1`}>
      {label}
    </Link>
  );
  const line = (text: string) => <span className={ui.meta}>{text}</span>;
  const box = (children: React.ReactNode) => <div className="flex flex-col items-start gap-1">{children}</div>;
  switch (s.kind) {
    case "ready":
      return box(<Tag tone="good">Ready</Tag>);
    case "review":
      return box(
        <>
          <Tag tone="warn">To review</Tag>
          {line(`${s.answers} ${s.answers === 1 ? "answer" : "answers"} to check`)}
          {open("Check answers", "#improve")}
        </>,
      );
    case "collecting":
    case "reading":
      return box(
        <>
          <Tag tone="info">{s.kind === "collecting" ? "Collecting" : "Reading posts"}</Tag>
          {line("Keep its page open")}
        </>,
      );
    case "paused":
      return box(
        <>
          <Tag tone="muted">Paused</Tag>
          {line("The page was closed")}
          {open("Resume", "?run=1")}
        </>,
      );
    case "waiting":
      return box(
        <>
          <Tag tone="info">Waiting</Tag>
          {line(s.reason)}
        </>,
      );
    case "not_analyzed":
      return box(
        <>
          <Tag tone="muted">Not analyzed</Tag>
          {open("Analyze", "?run=1")}
        </>,
      );
    case "stopped":
      return box(
        <>
          <Tag tone="bad">Stopped</Tag>
          {line(s.reason)}
          {open("Open")}
        </>,
      );
  }
}

/** ⋯: Open, Run again (new posts only), Rename, Remove. */
function Menu({ r, onNote }: { r: StudyRow; onNote: (s: string) => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(r.title);
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

  const act = (fn: () => Promise<{ ok: boolean; message: string }>, then?: () => void) =>
    startTransition(async () => {
      const res = await fn();
      onNote(res.message);
      setOpen(false);
      if (!res.ok) return;
      if (then) then();
      else router.refresh();
    });
  const item = "block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2 disabled:opacity-50";

  return (
    <div ref={box} className="relative">
      <button ref={button} type="button" aria-label={`More actions for ${r.title}`} aria-expanded={open} onClick={() => setOpen((o) => !o)} className={ui.icon}>
        ⋯
      </button>
      {open && (
        <div className="absolute top-9 right-0 z-20 w-60 rounded-xl border border-border bg-surface p-1.5 shadow-[0_16px_48px_rgba(0,0,0,.45)]">
          {renaming ? (
            <form
              className="flex flex-col gap-2 p-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                act(() => renameStudyAction(r.id, title));
              }}
            >
              <input autoFocus value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} aria-label="Study name" className={ui.input} />
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
              <Link href={`/searches/${r.id}`} className={item}>
                Open
              </Link>
              <button type="button" disabled={pending} className={item} onClick={() => act(() => startCollectionAction(r.id), () => router.push(`/searches/${r.id}?run=1`))}>
                Run again (new posts only)
              </button>
              <button type="button" className={item} onClick={() => setRenaming(true)}>
                Rename
              </button>
              <button
                type="button"
                disabled={pending}
                className={`${item} text-critical`}
                onClick={() => {
                  if (window.confirm(`Remove “${r.title}” from All studies? Its posts and costs are kept.`)) act(() => clearSearchesAction([r.id]));
                }}
              >
                Remove
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
