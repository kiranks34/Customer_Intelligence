"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import type { Accuracy, AnalysisState, AnalysisSummary, CheckItem, LookPost, Tally } from "@/lib/analysis";
import { NOT_STATED, NOT_SURE } from "@/lib/codebook";
import type { Codebook } from "@/lib/codebook";

import { advanceAnalysisAction, resumeAnalysisAction, reviewAction, startAnalysisAction } from "../analysis-actions";
import type { ActionState } from "../actions";
import { CodebookEditor, type EditorHandle } from "./codebook-editor";
import { SpotCheck } from "./spot-check";

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
  /** The accuracy check for the results shown: 20 counted posts and the score so far. */
  check: { items: CheckItem[]; accuracy: Accuracy } | null;
  /** Collection is finished, so the set of posts is stable. */
  ready: boolean;
  /** The Claude model in use, and whether it comes from the PULSE_CLAUDE_MODEL setting (Vercel hides the value). */
  claude: { model: string; fromSetting: boolean };
}

/**
 * Step 5 on the search page: one button to analyze, a progress bar while Jev reads, then the results (all counted
 * in SQL), the posts Jev wasn't sure about, and the codebook you can edit.
 */
export function AnalysisPanel({ searchId, subject, initial, summary, look, codebook, check, ready, claude }: Props) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const stop = useRef(false);
  const looping = useRef(false);
  const editor = useRef<EditorHandle>(null);

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
            {s.improved || (summary && summary.version !== s.version) ? "Re-analyze" : "Analyze"}{" "}
            {s.version === null || s.improved || (summary && summary.version !== s.version) ? "" : "new "}
            {s.pending.toLocaleString()} {s.pending === 1 ? "post" : "posts"}
            {s.improved ? " with the improved check" : ""} · about {usd(s.estimateUsd)}
          </button>
          <p className="text-sm text-muted">
            {!ready
              ? "Available when the collection has finished."
              : s.version === null
                ? "Claude drafts the themes, journey stages and user types from a sample (a few cents), then Jev checks every post: is it about the product, how the writer feels, where they are in their journey, which themes it mentions."
                : s.improved
                  ? `Removes duplicate posts, then reads every post with its video or thread title and sorts it into: about ${subject}, competitors, chat, off-topic, or unclear.`
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

      {summary && <Results summary={summary} subject={subject} totalPosts={s.totalPosts} />}
      {summary && look.length > 0 && <NeedsLook searchId={searchId} version={summary.version} posts={look} total={summary.relevance.needsLook} />}
      {summary && check && check.items.length > 0 && (
        <SpotCheck
          searchId={searchId}
          version={summary.version}
          codebook={summary.codebook}
          items={check.items}
          accuracy={check.accuracy}
          claudeModel={claude.model}
          onImprove={() => editor.current?.improve()}
        />
      )}
      {codebook && <CodebookEditor key={codebook.version} searchId={searchId} codebook={codebook.codebook} version={codebook.version} handle={editor} />}
      <p className="text-xs text-muted">
        Jev reads every post. Claude ({claude.model}
        {claude.fromSetting ? ", from your PULSE_CLAUDE_MODEL setting" : ", the default; set PULSE_CLAUDE_MODEL to change it"}) drafts the definitions and
        runs the auto-check.
      </p>
    </section>
  );
}

/** Sentiment colours: green / red / amber / slate, and a light hatch for "not sure". Never colour alone: every part is labelled. */
const SENTIMENT_COLORS: Record<string, string> = {
  positive: "bg-[#2f9e6e]",
  negative: "bg-critical",
  mixed: "bg-warning",
  neutral: "bg-[#6f86b8]",
  [NOT_SURE]: "bg-border",
};
const TALLY_COLORS = { about: "bg-accent", other: "bg-[#8f7cc9]", chat: "bg-muted/25", not: "bg-muted/50", look: "bg-warning", skipped: "bg-border" };

function Results({ summary, subject, totalPosts }: { summary: AnalysisSummary; subject: string; totalPosts: number }) {
  const r = summary.relevance;
  const parts = [
    { key: "about", label: `About ${subject}`, n: r.counted, color: TALLY_COLORS.about },
    { key: "other", label: "Competitors", n: r.competitors, color: TALLY_COLORS.other },
    { key: "chat", label: "Chat (thanks, jokes)", n: r.chat, color: TALLY_COLORS.chat },
    { key: "not", label: "Off-topic", n: r.notRelevant, color: TALLY_COLORS.not },
    { key: "look", label: "Unsure (Needs a look)", n: r.needsLook, color: TALLY_COLORS.look },
    { key: "skipped", label: "Skipped", n: r.skipped, color: TALLY_COLORS.skipped },
  ].filter((p) => p.n > 0);
  const analyzed = r.counted + r.competitors + r.chat + r.notRelevant + r.needsLook + r.skipped;
  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-2">
        <p className="text-sm">
          <span className="text-2xl font-semibold tabular-nums">{r.counted.toLocaleString()}</span> of {analyzed.toLocaleString()} posts are about {subject}
          {analyzed < totalPosts && <span className="text-muted"> ({(totalPosts - analyzed).toLocaleString()} not analyzed yet)</span>}
        </p>
        <Stacked parts={parts} total={analyzed} label="Posts collected" />
        <p className="text-xs text-muted">Everything below counts only the {r.counted} posts about {subject}.</p>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">How people feel</h3>
        <Stacked parts={summary.sentiment.map((t) => ({ key: t.key, label: t.label, n: t.counted, color: SENTIMENT_COLORS[t.key] }))} total={r.counted} label="Sentiment" />
      </div>

      {summary.grid.length > 0 && <JourneyMap summary={summary} />}

      {summary.postTypes.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>
              <span className="font-medium tabular-nums">{summary.firstHand.yes}</span> <span className="text-muted">share their own experience</span>
              {summary.firstHand.no > 0 && <span className="text-muted"> · {summary.firstHand.no} repeat what they heard</span>}
            </span>
            {summary.recommend && (
              <span>
                <span className="text-muted">Would recommend:</span> <span className="font-medium tabular-nums">{summary.recommend.for}</span>{" "}
                <span className="text-muted">yes ·</span> <span className="font-medium tabular-nums">{summary.recommend.against}</span>{" "}
                <span className="text-muted">warn against · {summary.recommend.neutral} no clear view</span>
              </span>
            )}
          </p>
          <div className="grid gap-7 sm:grid-cols-2">
            <Bars title="What people do" note="One per post: asking, complaining, praising, advising, comparing, deciding." items={summary.postTypes} />
            <Bars title="How long they've had it" note="Anchors where they are in the journey." items={summary.ownership} />
          </div>
        </div>
      )}

      <div className="grid gap-7 sm:grid-cols-2">
        <Themes items={summary.themes} total={r.counted} />
        <Bars title="Journey stage" note="One stage per post; adds up to the posts about it." items={summary.stages} />
      </div>
      {summary.touchpoints.length > 0 && <Touchpoints items={summary.touchpoints} />}

      <div className="grid gap-7 sm:grid-cols-2">
        {summary.segments.length > 0 && <Bars title="Who is posting" note="From what people say about themselves." items={summary.segments} />}
        <Competitors items={summary.competitors} hasList={(summary.codebook.competitors ?? []).length > 0} />
      </div>
      <p className="text-xs text-muted">
        “Sure” means Jev was at least 80% confident. “Not sure” is everything below that, so every chart adds up. All numbers are counted from the
        stored answers, not written by AI.
      </p>
    </div>
  );
}

/**
 * The journey map: stages down, what people do across. Each cell is a moment (e.g. Set up × Complaint); shading shows
 * where people are loudest. Only answers Jev was sure of, so it can be smaller than the charts below.
 */
function JourneyMap({ summary }: { summary: AnalysisSummary }) {
  const types = summary.postTypes.filter((t) => t.key !== NOT_SURE && t.key !== "other");
  const stages = summary.codebook.stages;
  const cell = (stage: string, type: string) => summary.grid.find((g) => g.stage === stage && g.type === type)?.n ?? 0;
  const max = Math.max(1, ...summary.grid.map((g) => g.n));
  const shownTypes = new Set(types.map((t) => t.key));
  const shownStages = new Set(stages.map((st) => st.key));
  // Only the cells in the table ("not stated" stages and "other" types aren't shown).
  const total = summary.grid.filter((g) => shownStages.has(g.stage) && shownTypes.has(g.type)).reduce((n, g) => n + g.n, 0);
  return (
    <div className="flex flex-col gap-2">
      <div>
        <h3 className="text-sm font-medium">Journey map</h3>
        <p className="text-xs text-muted">
          Where people are (rows) × what they do (columns). Darker = more posts. {total} posts where Jev was sure of both.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] border-separate border-spacing-1 text-sm">
          <thead>
            <tr>
              <th className="w-40" />
              {types.map((t) => (
                <th key={t.key} className="px-1 text-left text-xs font-normal text-muted">
                  {t.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stages.map((s) => (
              <tr key={s.key}>
                <th className="pr-2 text-left font-normal">{s.label}</th>
                {types.map((t) => {
                  const n = cell(s.key, t.key);
                  return (
                    <td
                      key={t.key}
                      className="h-9 rounded-md text-center tabular-nums"
                      style={{ background: n ? `color-mix(in srgb, var(--accent) ${Math.round(12 + (n / max) * 70)}%, transparent)` : undefined }}
                      title={`${s.label} × ${t.label}: ${n}`}
                    >
                      {n || <span className="text-muted/50">·</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Where people meet the product and the company (app, support, website, store…), and how often it goes wrong there. */
function Touchpoints({ items }: { items: AnalysisSummary["touchpoints"] }) {
  const shown = items.filter((t) => t.counted + t.uncertain > 0);
  const max = Math.max(1, ...items.map((t) => t.counted));
  return (
    <div className="flex flex-col gap-2">
      <div>
        <h3 className="text-sm font-medium">Touchpoints</h3>
        <p className="text-xs text-muted">Where people deal with the product or the company. A post can mention several.</p>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted">None found yet.</p>
      ) : (
        <ul className="grid gap-x-7 gap-y-1.5 sm:grid-cols-2">
          {shown.map((t) => (
            <li key={t.key} className="grid grid-cols-[minmax(0,1fr)_5rem_6.5rem] items-center gap-3 text-sm">
              <span className="truncate" title={t.label}>
                {t.label}
              </span>
              <span className="h-1.5 rounded-full bg-border/50" aria-hidden>
                <span className="block h-1.5 rounded-full bg-accent" style={{ width: `${(t.counted / max) * 100}%` }} />
              </span>
              <span className="text-right tabular-nums">
                {t.counted}
                {t.complaints > 0 && <span className="text-xs text-critical"> · {t.complaints} complaints</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Other brands people talk about (in competitor posts and in posts comparing with the product), and how they feel. */
function Competitors({ items, hasList }: { items: AnalysisSummary["competitors"]; hasList: boolean }) {
  const max = Math.max(1, ...items.map((c) => c.posts));
  return (
    <div className="flex flex-col gap-2">
      <div>
        <h3 className="text-sm font-medium">Competitors mentioned</h3>
        <p className="text-xs text-muted">Posts mainly about another brand, and how the writer feels about it.</p>
      </div>
      {!hasList ? (
        <p className="text-sm text-muted">Add competitors in “Themes, stages, user types and competitors” below, then re-analyze.</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">None found yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((c) => (
            <li key={c.key} className="grid grid-cols-[minmax(0,1fr)_5rem_2.5rem] items-center gap-3 text-sm">
              <span className="truncate" title={c.label}>
                {c.label}
                <span className="ml-2 text-xs text-muted">
                  {c.positive > 0 && `${c.positive} liked`}
                  {c.positive > 0 && c.negative > 0 && " · "}
                  {c.negative > 0 && `${c.negative} disliked`}
                </span>
              </span>
              <span className="h-1.5 rounded-full bg-border/50" aria-hidden>
                <span className="block h-1.5 rounded-full bg-[#8f7cc9]" style={{ width: `${(c.posts / max) * 100}%` }} />
              </span>
              <span className="text-right tabular-nums">{c.posts}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One bar split into labelled parts that add up to `total`, with the numbers in the legend. */
function Stacked({ parts, total, label }: { parts: { key: string; label: string; n: number; color: string }[]; total: number; label: string }) {
  if (total === 0) return <p className="text-sm text-muted">Nothing yet.</p>;
  return (
    <>
      <div className="flex h-3 overflow-hidden rounded-full bg-border/50" role="img" aria-label={`${label}: ${parts.map((p) => `${p.label} ${p.n}`).join(", ")}`}>
        {parts.map((p) => (
          <div key={p.key} className={p.color} style={{ width: `${(p.n / total) * 100}%` }} title={`${p.label}: ${p.n}`} />
        ))}
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {parts.map((p) => (
          <span key={p.key} className="flex items-center gap-1.5">
            <span className={`size-2.5 rounded-full ${p.color}`} aria-hidden />
            {p.label} <span className="text-muted tabular-nums">{p.n}</span>
          </span>
        ))}
      </p>
    </>
  );
}

const KIND: Record<string, string> = { pain: "Pain", delight: "Delight", need: "Need", topic: "Topic" };
const MUTED = new Set([NOT_SURE, NOT_STATED]);

/** One answer per post: rows add up to the posts about the subject ("Not stated" and "Not sure" shown last, muted). */
function Bars({ title, note, items }: { title: string; note: string; items: Tally[] }) {
  const max = Math.max(1, ...items.map((t) => t.counted));
  return (
    <div className="flex flex-col gap-2">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-xs text-muted">{note}</p>
      </div>
      <ul className="flex flex-col gap-1.5">
        {items.map((t) => (
          <li key={t.key} className={`grid grid-cols-[minmax(0,1fr)_5rem_2.5rem] items-center gap-3 text-sm ${MUTED.has(t.key) ? "text-muted" : ""}`}>
            <span className="truncate" title={t.label}>
              {t.label}
            </span>
            <span className="h-1.5 rounded-full bg-border/50" aria-hidden>
              <span className={`block h-1.5 rounded-full ${MUTED.has(t.key) ? "bg-muted/40" : "bg-accent"}`} style={{ width: `${(t.counted / max) * 100}%` }} />
            </span>
            <span className="text-right tabular-nums">{t.counted}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Themes can overlap (a post can mention several), so they don't add up. Solid = sure, light = likely. */
function Themes({ items, total }: { items: (Tally & { kind: string; severity: number | null })[]; total: number }) {
  const shown = items.filter((t) => t.counted + t.uncertain > 0);
  const max = Math.max(1, ...items.map((t) => t.counted + t.uncertain));
  return (
    <div className="flex flex-col gap-2">
      <div>
        <h3 className="text-sm font-medium">Themes</h3>
        <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted">
          <span>A post can mention several; out of {total} posts.</span>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-3 rounded-full bg-accent" aria-hidden /> sure
          </span>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-3 rounded-full bg-accent/35" aria-hidden /> likely
          </span>
        </p>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted">None found yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {shown.map((t) => (
            <li key={t.key} className="grid grid-cols-[minmax(0,1fr)_5rem_5.5rem] items-center gap-3 text-sm">
              <span className="truncate" title={t.label}>
                {t.label}
                <span className="ml-2 text-xs text-muted">{KIND[t.kind] ?? ""}</span>
                {t.severity !== null && t.severity >= 0.5 && (
                  <span className="ml-2 text-xs text-muted" title="Average seriousness of the problem, 0 (none) to 4 (unusable)">
                    · severity {t.severity.toFixed(1)}/4
                  </span>
                )}
              </span>
              <span className="flex h-1.5 overflow-hidden rounded-full bg-border/50" aria-hidden>
                <span className="h-1.5 bg-accent" style={{ width: `${(t.counted / max) * 100}%` }} />
                <span className="h-1.5 bg-accent/35" style={{ width: `${(t.uncertain / max) * 100}%` }} />
              </span>
              <span className="text-right tabular-nums">
                {t.counted}
                {t.uncertain > 0 && <span className="text-xs text-muted"> +{t.uncertain} likely</span>}
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
        Needs a look ({total}){" "}
        <span className="font-normal text-muted">
          · optional{total > posts.length ? `, showing the first ${posts.length}` : ""}. Jev couldn&apos;t tell if these are feedback on the product, so
          they aren&apos;t counted unless you keep them.
        </span>
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
              {p.thread && <p className="mb-1 text-xs text-muted">Under: “{p.thread}”</p>}
              {p.replyingTo && <p className="mb-1 line-clamp-2 border-l-2 border-border pl-2 text-xs text-muted">Replying to: “{p.replyingTo}”</p>}
              {p.title && <p className="font-medium break-words">{p.title}</p>}
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
