"use client";

import { useState } from "react";

import type { AnalysisSummary, CellQuote, Tally } from "@/lib/analysis";
import { NOT_STATED, NOT_SURE } from "@/lib/codebook";

import { ui } from "../../ui";

const SOURCE_LABELS: Record<string, string> = { youtube: "YouTube", reddit: "Reddit" };
const SENTIMENT_COLORS: Record<string, string> = { positive: "bg-good", negative: "bg-critical", mixed: "bg-warning", neutral: "bg-[#6f86b8]", [NOT_SURE]: "bg-border" };
const MUTED = new Set([NOT_SURE, NOT_STATED]);
const KIND: Record<string, string> = { pain: "pain", delight: "delight", need: "need", topic: "topic" };
const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);

/**
 * A study's results (D46): Overview, Journey (click a cell for its most-liked posts, quoted word for word), Themes and
 * Touchpoints, Competitors, and People. Every number is counted in SQL from the stored answers; only posts about the
 * product count ("about the product" is always the base).
 */
export function Results({ summary, subject, quotes }: { summary: AnalysisSummary; subject: string; quotes: CellQuote[] }) {
  const r = summary.relevance;
  const counted = r.counted;
  const collected = r.counted + r.competitors + r.chat + r.notRelevant + r.needsLook + r.skipped;
  const neg = summary.sentiment.find((s) => s.key === "negative")?.counted ?? 0;
  const pos = summary.sentiment.find((s) => s.key === "positive")?.counted ?? 0;
  const topPain = [...summary.themes].filter((t) => t.kind === "pain").sort((a, b) => b.counted - a.counted)[0];
  return (
    <div className="flex flex-col gap-6">
      <section id="overview" className={ui.card}>
        <div className={ui.cardHead}>
          <h2 className={ui.cardTitle}>Overview</h2>
        </div>
        <div className="grid gap-5 px-4 py-5 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          <Tile label="About the product" value={counted.toLocaleString("en-US")} sub={`of ${collected.toLocaleString("en-US")} posts collected`}>
            <Stacked
              parts={[
                { key: "p", label: "Product", n: r.counted, color: "bg-accent" },
                { key: "c", label: "Competitors", n: r.competitors, color: "bg-[#8f7cc9]" },
                { key: "h", label: "Chat", n: r.chat, color: "bg-faint/50" },
                { key: "o", label: "Off-topic", n: r.notRelevant, color: "bg-faint" },
                { key: "u", label: "Unclear", n: r.needsLook, color: "bg-warning" },
                { key: "s", label: "Skipped", n: r.skipped, color: "bg-border" },
              ]}
              total={collected}
            />
          </Tile>
          <Tile
            label="How people feel"
            value={neg >= pos ? `${pct(neg, counted)}% negative` : `${pct(pos, counted)}% positive`}
            tone={neg >= pos ? "text-critical" : "text-good"}
            sub={`of the ${counted} about the product`}
          >
            <Stacked parts={summary.sentiment.map((t) => ({ key: t.key, label: t.label, n: t.counted, color: SENTIMENT_COLORS[t.key] ?? "bg-border" }))} total={counted} />
          </Tile>
          <Tile
            label="Would recommend"
            value={summary.recommend ? `${summary.recommend.for}` : "–"}
            after={summary.recommend ? `vs ${summary.recommend.against} against` : undefined}
            sub={summary.recommend ? `of ${summary.recommend.for + summary.recommend.against + summary.recommend.neutral} who said` : "Not asked in this reading"}
          />
          <Tile label="Top pain" value={topPain?.label ?? "None found"} small sub={topPain ? `${topPain.counted} posts${topPain.severity !== null ? ` · severity ${topPain.severity.toFixed(1)} of 4` : ""}` : ""} />
        </div>
        <p className="border-t border-border px-4 py-3 text-xs text-muted sm:px-6">
          Everything below counts only the {counted} posts about {subject}, and only answers Jev was at least 80% sure of. Numbers are counted from stored
          answers, not written by AI.
        </p>
      </section>

      {summary.grid.length > 0 && <Journey summary={summary} quotes={quotes} />}

      <div className="grid gap-6 lg:grid-cols-2">
        <section id="themes" className={ui.card}>
          <div className={ui.cardHead}>
            <h2 className={ui.cardTitle}>Themes</h2>
            <span className={ui.meta}>A post can mention several</span>
          </div>
          <BarList
            items={summary.themes
              .filter((t) => t.counted + t.uncertain > 0)
              .map((t) => ({
                key: t.key,
                label: t.label,
                sub: [KIND[t.kind], t.severity !== null && t.severity >= 0.5 ? `severity ${t.severity.toFixed(1)}` : null].filter(Boolean).join(" · "),
                n: t.counted,
                extra: t.uncertain,
                color: t.kind === "pain" ? "bg-critical" : t.kind === "delight" ? "bg-good" : "bg-accent",
              }))}
          />
        </section>
        <section id="touchpoints" className={ui.card}>
          <div className={ui.cardHead}>
            <h2 className={ui.cardTitle}>Touchpoints</h2>
            <span className={ui.meta}>Where people deal with the product or the company</span>
          </div>
          <BarList
            items={summary.touchpoints
              .filter((t) => t.counted + t.uncertain > 0)
              .map((t) => ({ key: t.key, label: t.label, sub: t.complaints ? `${t.complaints} of them complaints` : "", n: t.counted, part: t.complaints, color: "bg-accent" }))}
          />
        </section>
      </div>

      <section id="competitors" className={ui.card}>
        <div className={ui.cardHead}>
          <h2 className={ui.cardTitle}>Competitors</h2>
          <span className={ui.meta}>Brands mentioned alongside it, and how people feel about them</span>
        </div>
        {(summary.codebook.competitors ?? []).length === 0 ? (
          <p className="px-6 py-5 text-sm text-muted">No competitor list yet. Add brands in Categories below, then re-analyze.</p>
        ) : (
          <BarList
            items={summary.competitors.map((c) => ({
              key: c.key,
              label: c.label,
              sub: [c.positive && `${c.positive} liked`, c.negative && `${c.negative} disliked`].filter(Boolean).join(" · "),
              n: c.posts,
              part: c.negative,
              color: "bg-good",
              partColor: "bg-critical",
            }))}
          />
        )}
      </section>

      {(summary.postTypes.length > 0 || summary.segments.length > 0) && (
        <section id="people" className={ui.card}>
          <div className={ui.cardHead}>
            <h2 className={ui.cardTitle}>People</h2>
            <span className={ui.meta}>
              {summary.firstHand.yes} share their own experience
              {summary.firstHand.no > 0 && ` · ${summary.firstHand.no} repeat what they heard`}
            </span>
          </div>
          <div className="grid gap-6 px-4 py-5 sm:px-6 lg:grid-cols-3">
            <Bars title="What they do" items={summary.postTypes} />
            <Bars title="How long they've had it" items={summary.ownership} />
            {summary.segments.length > 0 && <Bars title="Who is posting" items={summary.segments} />}
          </div>
        </section>
      )}
    </div>
  );
}

function Tile(props: { label: string; value: string; after?: string; sub: string; tone?: string; small?: boolean; children?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="mb-1.5 text-xs font-semibold text-muted">{props.label}</span>
      <span className={`leading-tight font-extrabold tracking-tight ${props.small ? "text-lg" : "text-2xl"} ${props.tone ?? ""}`}>
        {props.value}
        {props.after && <span className="ml-1.5 text-[15px] font-semibold text-muted">{props.after}</span>}
      </span>
      {props.sub && <span className="mt-1 text-xs text-muted">{props.sub}</span>}
      {props.children}
    </div>
  );
}

/** One bar split into labelled parts that add up to `total`, with the numbers in the legend (never colour alone). */
function Stacked({ parts, total }: { parts: { key: string; label: string; n: number; color: string }[]; total: number }) {
  const shown = parts.filter((p) => p.n > 0);
  if (total === 0) return null;
  return (
    <>
      <div className="mt-2.5 flex h-2.5 overflow-hidden rounded-full bg-border" role="img" aria-label={shown.map((p) => `${p.label} ${p.n}`).join(", ")}>
        {shown.map((p) => (
          <span key={p.key} className={p.color} style={{ width: `${(p.n / total) * 100}%` }} />
        ))}
      </div>
      <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
        {shown.map((p) => (
          <span key={p.key} className="inline-flex items-center gap-1.5">
            <span className={`size-2 rounded-sm ${p.color}`} aria-hidden />
            {p.label} {p.n}
          </span>
        ))}
      </p>
    </>
  );
}

/** Where people are (rows) × what they do (columns); a cell opens its most-liked posts. */
function Journey({ summary, quotes }: { summary: AnalysisSummary; quotes: CellQuote[] }) {
  const types = summary.postTypes.filter((t) => t.key !== NOT_SURE && t.key !== "other");
  const stages = summary.codebook.stages;
  const cell = (stage: string, type: string) => summary.grid.find((g) => g.stage === stage && g.type === type)?.n ?? 0;
  const max = Math.max(1, ...summary.grid.map((g) => g.n));
  const busiest = [...summary.grid].filter((g) => stages.some((s) => s.key === g.stage) && types.some((t) => t.key === g.type)).sort((a, b) => b.n - a.n)[0];
  const [sel, setSel] = useState<{ stage: string; type: string } | null>(busiest ? { stage: busiest.stage, type: busiest.type } : null);
  const selQuotes = sel ? quotes.filter((q) => q.stage === sel.stage && q.type === sel.type) : [];
  const name = (key: string, list: { key: string; label: string }[]) => list.find((x) => x.key === key)?.label ?? key;
  return (
    <section id="journey" className={ui.card}>
      <div className={ui.cardHead}>
        <h2 className={ui.cardTitle}>Journey</h2>
        <span className={ui.meta}>Where people are × what they do. Pick a cell for its most-liked posts.</span>
      </div>
      <div className="overflow-x-auto px-4 pt-4 sm:px-6">
        <table className="w-full min-w-[40rem] border-separate border-spacing-1 text-[13px]">
          <thead>
            <tr>
              <th className="w-36" />
              {types.map((t) => (
                <th key={t.key} scope="col" className="px-1 pb-1 text-center text-[11px] font-bold tracking-wider text-muted uppercase">
                  {t.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stages.map((s) => (
              <tr key={s.key}>
                <th scope="row" className="pr-2 text-left font-semibold">
                  {s.label}
                </th>
                {types.map((t) => {
                  const n = cell(s.key, t.key);
                  const on = sel?.stage === s.key && sel.type === t.key;
                  return (
                    <td key={t.key} className="p-0">
                      {n ? (
                        <button
                          type="button"
                          aria-pressed={on}
                          aria-label={`${s.label} × ${t.label}: ${n} posts`}
                          onClick={() => setSel({ stage: s.key, type: t.key })}
                          className={`h-10 w-full rounded-lg font-semibold tabular-nums hover:outline-2 hover:outline-foreground/60 hover:outline-solid ${on ? "outline-2 outline-foreground outline-solid" : ""}`}
                          style={{ background: `color-mix(in srgb, var(--accent) ${Math.round(18 + (n / max) * 70)}%, transparent)` }}
                        >
                          {n}
                        </button>
                      ) : (
                        <span className="grid h-10 place-items-center rounded-lg bg-surface-2 text-faint">–</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sel && (
        <div className="m-4 rounded-xl border border-border bg-surface-2 px-4 py-3 sm:m-6">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <b className="text-sm">
              {name(sel.stage, stages)} × {name(sel.type, types)}
            </b>
            <span className={ui.meta}>{cell(sel.stage, sel.type)} posts · most liked first</span>
          </div>
          {selQuotes.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No posts to quote here.</p>
          ) : (
            <ul>
              {selQuotes.map((q) => (
                <li key={q.id} className="border-t border-border py-2.5 text-sm first:border-t-0">
                  <p className="line-clamp-4">“{q.text}”</p>
                  <p className="mt-1 text-xs text-muted">
                    {SOURCE_LABELS[q.source] ?? q.source} · {q.likes} {q.source === "reddit" ? "upvotes" : "likes"}
                    {q.postedAt && ` · ${new Date(q.postedAt).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}`}
                    {q.url && (
                      <>
                        {" · "}
                        <a href={q.url} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2 hover:text-accent">
                          open ↗
                        </a>
                      </>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

interface BarItem {
  key: string;
  label: string;
  sub?: string;
  n: number;
  /** Less sure answers, shown lighter after the bar. */
  extra?: number;
  /** A part of n shown in a second colour (e.g. complaints). */
  part?: number;
  color: string;
  partColor?: string;
}

function BarList({ items }: { items: BarItem[] }) {
  if (items.length === 0) return <p className="px-6 py-5 text-sm text-muted">None found yet.</p>;
  const max = Math.max(1, ...items.map((t) => t.n + (t.extra ?? 0)));
  return (
    <ul className="flex flex-col gap-3 px-4 py-5 sm:px-6">
      {items.map((t) => (
        <li key={t.key} className="grid grid-cols-[minmax(0,1fr)_110px_56px] items-center gap-3 text-sm sm:grid-cols-[minmax(0,1fr)_150px_64px]">
          <span className="min-w-0">
            <span className="block truncate" title={t.label}>
              {t.label}
            </span>
            {t.sub && <span className="block text-xs text-muted">{t.sub}</span>}
          </span>
          <span className="flex h-2 overflow-hidden rounded-full bg-border" aria-hidden>
            {t.part ? (
              <>
                <span className={t.partColor ?? "bg-critical"} style={{ width: `${(t.part / max) * 100}%` }} />
                <span className={t.color} style={{ width: `${((t.n - t.part) / max) * 100}%` }} />
              </>
            ) : (
              <span className={t.color} style={{ width: `${(t.n / max) * 100}%` }} />
            )}
            {t.extra ? <span className={`${t.color} opacity-35`} style={{ width: `${(t.extra / max) * 100}%` }} /> : null}
          </span>
          <span className="text-right text-[13px] text-muted tabular-nums">
            {t.n}
            {t.extra ? <span className="block text-[11px]">+{t.extra} likely</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** One answer per post: rows add up to the posts about the product ("Not stated" and "Not sure" muted, last). */
function Bars({ title, items }: { title: string; items: Tally[] }) {
  const max = Math.max(1, ...items.map((t) => t.counted));
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-bold">{title}</h3>
      <ul className="flex flex-col gap-1.5">
        {items.map((t) => (
          <li key={t.key} className={`grid grid-cols-[minmax(0,1fr)_72px_36px] items-center gap-3 text-sm ${MUTED.has(t.key) ? "text-muted" : ""}`}>
            <span className="truncate" title={t.label}>
              {t.label}
            </span>
            <span className="h-1.5 overflow-hidden rounded-full bg-border" aria-hidden>
              <span className={`block h-full rounded-full ${MUTED.has(t.key) ? "bg-faint/60" : "bg-accent"}`} style={{ width: `${(t.counted / max) * 100}%` }} />
            </span>
            <span className="text-right tabular-nums">{t.counted}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
