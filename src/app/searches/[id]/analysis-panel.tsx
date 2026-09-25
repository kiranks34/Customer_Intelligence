"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import type { AnalysisState, AnalysisSummary, LookPost, Tally } from "@/lib/analysis";
import type { Codebook } from "@/lib/codebook";

import { advanceAnalysisAction, resumeAnalysisAction, reviewAction, startAnalysisAction } from "../analysis-actions";
import type { ActionState } from "../actions";
import { CodebookEditor } from "./codebook-editor";

const isState = (r: AnalysisState | ActionState): r is AnalysisState => "pending" in r;
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
const MAX_RETRIES = 3;
const usd = (n: number) => (n < 0.01 ? "under $0.01" : `$${n.toFixed(2)}`);
const SOURCE_LABELS: Record<string, string> = { youtube: "YouTube", reddit: "Reddit" };

interface Props {
  searchId: number;
  subject: string;
  initial: AnalysisState;
  summary: AnalysisSummary | null;
  look: LookPost[];
  /** The latest codebook (what the editor shows and the next analysis uses); results may still be on an older one. */
  codebook: { version: number; codebook: Codebook } | null;
  /** Collection is finished, so the set of posts is stable. */
  ready: boolean;
}

/**
 * Step 5 on the search page: one button to analyze, a progress bar while Jev reads, then the results (all counted
 * in SQL), the posts Jev wasn't sure about, and the codebook you can edit.
 */
export function AnalysisPanel({ searchId, subject, initial, summary, look, codebook, ready }: Props) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const stop = useRef(false);
  const looping = useRef(false);

  // A run that was going when the page closed carries on when it's opened again.
  useEffect(() => {
    stop.current = false;
    if (initial.status === "running") void loop();
    return () => void (stop.current = true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  async function loop() {
    if (looping.current) return;
    looping.current = true;
    setBusy(true);
    let failures = 0;
    try {
      while (!stop.current) {
        let r: AnalysisState | ActionState;
        try {
          r = await advanceAnalysisAction(searchId);
          failures = 0;
        } catch (err) {
          if (++failures > MAX_RETRIES) {
            setMessage(`${err instanceof Error ? err.message : "Connection lost"}. Press Resume to carry on.`);
            break;
          }
          await sleep(3000 * failures);
          continue;
        }
        if (!isState(r)) {
          setMessage(r.message);
          break;
        }
        setS(r);
        if (r.status !== "running") {
          if (r.message && r.status !== "done") setMessage(r.message);
          break;
        }
        // Waiting on a retry delay: pause instead of hammering the server.
        await sleep(1500);
      }
    } finally {
      looping.current = false;
      setBusy(false);
      router.refresh();
    }
  }

  async function start() {
    setMessage(null);
    setBusy(true);
    const r = await startAnalysisAction(searchId);
    setBusy(false);
    setMessage(r.message);
    if (r.ok) void loop();
  }

  async function resume() {
    setMessage(null);
    const r = await resumeAnalysisAction(searchId);
    if (!r.ok) return setMessage(r.message);
    void loop();
  }

  const running = busy || s.status === "running";
  const pct = s.totalPosts ? Math.round((s.analyzed / s.totalPosts) * 100) : 0;

  return (
    <section aria-labelledby="analysis-heading" className="flex flex-col gap-5 rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="analysis-heading" className="text-lg font-medium">
          Analysis
        </h2>
        {s.costUsd > 0 && <span className="text-sm text-muted">Spent on analysis: {usd(s.costUsd)}</span>}
      </div>

      {s.status === "running" || busy ? (
        <div className="flex flex-col gap-2" role="status">
          <div className="flex justify-between text-sm">
            <span>{s.version === null ? "Drafting themes and stages from a sample…" : "Jev is reading the posts…"}</span>
            <span className="text-muted tabular-nums">
              {s.analyzed.toLocaleString()} of {s.totalPosts.toLocaleString()}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-border">
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-muted">Keep this page open; closing it pauses the analysis.</p>
        </div>
      ) : s.status === "paused" || s.status === "failed" ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-critical">{s.message ?? "The analysis stopped."}</p>
          <button type="button" onClick={resume} className="rounded-lg border border-border px-4 py-1.5 text-sm font-medium hover:border-accent">
            Resume
          </button>
        </div>
      ) : s.pending > 0 ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={!ready || running}
            onClick={start}
            className="self-start rounded-lg bg-accent px-5 py-2.5 font-medium text-white disabled:opacity-50"
          >
            {summary && summary.version !== s.version ? "Re-analyze" : "Analyze"} {s.version === null || (summary && summary.version !== s.version) ? "" : "new "}
            {s.pending.toLocaleString()} {s.pending === 1 ? "post" : "posts"} · about {usd(s.estimateUsd)}
          </button>
          <p className="text-sm text-muted">
            {!ready
              ? "Available when the collection has finished."
              : s.version === null
                ? "Claude drafts the themes, journey stages and user types from a sample (a few cents), then Jev checks every post: is it about the product, how the writer feels, where they are in their journey, which themes it mentions."
                : summary && summary.version !== s.version
                  ? `Applies your edited themes (version ${s.version}). Results below stay on version ${summary.version} until it's done.`
                  : "Jev reads only the posts it hasn't read with the current themes."}
          </p>
        </div>
      ) : null}

      {(message ?? (s.status === "none" ? s.message : null)) && (
        <p role="status" className="-mt-2 text-sm text-muted">
          {message ?? s.message}
        </p>
      )}

      {summary && <Results summary={summary} subject={subject} />}
      {summary && look.length > 0 && <NeedsLook searchId={searchId} version={summary.version} posts={look} total={summary.relevance.needsLook} />}
      {codebook && <CodebookEditor key={codebook.version} searchId={searchId} codebook={codebook.codebook} version={codebook.version} />}
    </section>
  );
}

function Results({ summary, subject }: { summary: AnalysisSummary; subject: string }) {
  const r = summary.relevance;
  const sentimentTotal = summary.sentiment.reduce((n, t) => n + t.counted, 0);
  const COLORS: Record<string, string> = { positive: "bg-accent", negative: "bg-critical", mixed: "bg-warning", neutral: "bg-muted/40" };
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm">
        <span className="text-2xl font-semibold tabular-nums">{r.counted.toLocaleString()}</span> posts are about {subject}
        <span className="text-muted">
          {" "}
          · {r.notRelevant} not about it{r.needsLook > 0 && ` · ${r.needsLook} need a look`}
          {r.skipped > 0 && ` · ${r.skipped} skipped (Jev couldn't read them)`}
        </span>
      </p>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">How people feel</h3>
        {sentimentTotal > 0 ? (
          <>
            <div className="flex h-3 overflow-hidden rounded-full bg-border" role="img" aria-label={summary.sentiment.map((t) => `${t.label} ${t.counted}`).join(", ")}>
              {summary.sentiment.map((t) => (
                <div key={t.key} className={COLORS[t.key]} style={{ width: `${(t.counted / sentimentTotal) * 100}%` }} />
              ))}
            </div>
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {summary.sentiment.map((t) => (
                <span key={t.key} className="flex items-center gap-1.5">
                  <span className={`size-2.5 rounded-full ${COLORS[t.key]}`} aria-hidden />
                  {t.label} <span className="text-muted tabular-nums">{t.counted}</span>
                </span>
              ))}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted">No sure answers yet.</p>
        )}
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <Bars title="Themes" items={summary.themes} tag={(t) => (t as Tally & { kind: string }).kind} />
        <Bars title="Journey stage" items={summary.stages} keepOrder />
      </div>
      {summary.segments.length > 0 && (
        <div className="grid gap-6 sm:grid-cols-2">
          <Bars title="Who is posting" items={summary.segments} />
        </div>
      )}
      <p className="text-xs text-muted">
        Only posts Jev is sure are about {subject} (confidence 0.8 or more), or that you kept, are counted. Within them, counts use answers Jev was
        sure about; “+N” shows less sure ones (0.5 to 0.8).
      </p>
    </div>
  );
}

const KIND: Record<string, string> = { pain: "Pain", delight: "Delight", need: "Need", topic: "Topic" };

function Bars({ title, items, tag, keepOrder }: { title: string; items: Tally[]; tag?: (t: Tally) => string; keepOrder?: boolean }) {
  const shown = keepOrder ? items : items.filter((t) => t.counted + t.uncertain > 0);
  const max = Math.max(1, ...items.map((t) => t.counted));
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {shown.length === 0 ? (
        <p className="text-sm text-muted">None found yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {shown.map((t) => (
            <li key={t.key} className="grid grid-cols-[minmax(0,1fr)_5rem_4.5rem] items-center gap-3 text-sm">
              <span className="truncate" title={t.label}>
                {t.label}
                {tag && <span className="ml-2 text-xs text-muted">{KIND[tag(t)] ?? ""}</span>}
              </span>
              <span className="h-1.5 rounded-full bg-border" aria-hidden>
                <span className="block h-1.5 rounded-full bg-accent" style={{ width: `${(t.counted / max) * 100}%` }} />
              </span>
              <span className="text-right tabular-nums">
                {t.counted}
                {t.uncertain > 0 && <span className="text-xs text-muted"> +{t.uncertain}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NeedsLook({ searchId, version, posts, total }: { searchId: number; version: number; posts: LookPost[]; total: number }) {
  const router = useRouter();
  const [done, setDone] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const shown = posts.filter((p) => !done.includes(p.id));

  function decide(post: LookPost, keep: boolean) {
    setError(null);
    setDone((d) => [...d, post.id]);
    startTransition(async () => {
      const r = await reviewAction(searchId, post.id, version, keep);
      if (!r.ok) {
        setError(r.message);
        setDone((d) => d.filter((id) => id !== post.id));
      } else router.refresh();
    });
  }

  if (shown.length === 0) return null;
  return (
    <details className="rounded-lg border border-warning/60 bg-warning/5 px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium">
        Needs a look ({total}) <span className="font-normal text-muted">· optional. Jev wasn&apos;t sure these are about the product, so they aren&apos;t counted unless you keep them.</span>
      </summary>
      {error && (
        <p role="alert" className="mt-2 text-sm text-critical">
          {error}
        </p>
      )}
      <ul className="mt-3 flex flex-col divide-y divide-border">
        {shown.map((p) => (
          <li key={p.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0 text-sm">
              <p className="line-clamp-3 break-words">{p.text}</p>
              <p className="mt-1 text-xs text-muted">
                {SOURCE_LABELS[p.source] ?? p.source}
                {p.url && (
                  <>
                    {" · "}
                    <a href={p.url} target="_blank" rel="noreferrer noopener" className="underline">
                      open ↗
                    </a>
                  </>
                )}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button type="button" disabled={pending} onClick={() => decide(p, true)} className="rounded-md border border-border px-3 py-1 text-sm font-medium hover:border-accent">
                Keep
              </button>
              <button type="button" disabled={pending} onClick={() => decide(p, false)} className="px-2 py-1 text-sm text-muted underline hover:text-critical">
                Drop
              </button>
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}
