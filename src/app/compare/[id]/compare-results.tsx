"use client";

import { useState } from "react";

import type { AnalysisSummary, CellQuote, Tally } from "@/lib/analysis";
import { NOT_STATED, NOT_SURE } from "@/lib/codebook";

import { ui } from "../../ui";

const SOURCE_LABELS: Record<string, string> = { youtube: "YouTube", reddit: "Reddit" };
const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);

export interface CompareSide {
  searchId: number;
  label: string;
  summary: AnalysisSummary;
  quotes: CellQuote[];
}

/** Side colours (DESIGN-SYSTEM.md): A is blue, B is violet, everywhere in a comparison. */
export const SIDE = [
  { bar: "bg-accent", text: "text-accent", mix: "var(--accent)" },
  { bar: "bg-violet", text: "text-violet", mix: "var(--violet)" },
] as const;

export function SideName({ i, label }: { i: number; label: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 font-semibold">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-[3px] ${SIDE[i].bar}`} aria-hidden />
      <span className="truncate">{label}</span>
    </span>
  );
}

/**
 * A comparison's results (D48): the two sides next to each other. Every number is a share of that side's own posts
 * about its product, so a side with more posts doesn't weigh more; lists are matched by the categories both share.
 */
export function CompareResults({ sides }: { sides: [CompareSide, CompareSide] }) {
  return (
    <>
      <Overview sides={sides} />
      <Twin id="themes" title="Themes" note="Share of each side's posts about it · biggest differences first" sides={sides} pick={(s) => s.themes} sub={(t) => (t as { kind?: string }).kind} />
      <Journey sides={sides} />
      <Twin id="touchpoints" title="Touchpoints" note="Share of posts that deal with each" sides={sides} pick={(s) => s.touchpoints} />
      <Twin
        id="competitors"
        title="Competitors"
        note="Share of posts that mention each brand"
        sides={sides}
        pick={(s) => s.competitors.map((c) => ({ key: c.key, label: c.label, counted: c.posts, uncertain: 0 }))}
      />
      <Twin id="people" title="What people do" note="Share of posts of each kind" sides={sides} pick={(s) => s.postTypes.filter((t) => t.key !== NOT_SURE)} keepOrder />
      <Twin title="How long they've had it" note="Share of posts" sides={sides} pick={(s) => s.ownership.filter((t) => t.key !== NOT_SURE && t.key !== NOT_STATED)} keepOrder />
    </>
  );
}

function Overview({ sides }: { sides: [CompareSide, CompareSide] }) {
  const counted = sides.map((s) => s.summary.relevance.counted);
  const share = (s: AnalysisSummary, key: string) => pct(s.sentiment.find((t) => t.key === key)?.counted ?? 0, s.relevance.counted);
  const neg = sides.map((s) => share(s.summary, "negative"));
  const pos = sides.map((s) => share(s.summary, "positive"));
  const rec = sides.map((s) => s.summary.recommend);
  const topPain = sides.map((s) => [...s.summary.themes].filter((t) => t.kind === "pain" && t.counted > 0).sort((a, b) => b.counted - a.counted)[0]);
  const diff = (x: number, y: number, more: string) => {
    const d = x - y;
    if (Math.abs(d) < 5) return <span className={ui.meta}>About the same</span>;
    return (
      <span className="text-[13px] font-semibold">
        {sides[d > 0 ? 0 : 1].label}: {Math.abs(d)} pts {more}
      </span>
    );
  };
  const row = (label: string, cells: React.ReactNode[], difference: React.ReactNode) => (
    <div className="grid grid-cols-2 items-baseline gap-x-6 gap-y-1 border-t border-border py-3 first:border-t-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_200px]">
      <span className="col-span-2 text-[13px] font-semibold text-muted md:col-span-1">{label}</span>
      {cells}
      <span className="col-span-2 md:col-span-1">{difference}</span>
    </div>
  );
  return (
    <section id="overview" className={ui.card}>
      <div className={ui.cardHead}>
        <h2 className={ui.cardTitle}>Overview</h2>
      </div>
      <div className="px-4 py-3 sm:px-6">
        <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_200px] gap-x-6 pb-2 md:grid">
          <span />
          {sides.map((s, i) => (
            <span key={i} className="text-[13px]">
              <SideName i={i} label={s.label} />
            </span>
          ))}
          <span className={ui.eyebrow}>Difference</span>
        </div>
        {row(
          "About the product",
          counted.map((c, i) => (
            <span key={i} className="text-sm">
              <b className="text-2xl font-extrabold">{c}</b> <span className={ui.meta}>posts</span>
            </span>
          )),
          <span className={ui.meta}>Numbers below are shares of these</span>,
        )}
        {row(
          "Negative",
          neg.map((v, i) => (
            <b key={i} className="text-2xl font-extrabold text-critical">
              {v}%
            </b>
          )),
          diff(neg[0], neg[1], "more negative"),
        )}
        {row(
          "Positive",
          pos.map((v, i) => (
            <b key={i} className="text-2xl font-extrabold text-good">
              {v}%
            </b>
          )),
          diff(pos[0], pos[1], "more positive"),
        )}
        {row(
          "Would recommend",
          rec.map((r, i) => (
            <span key={i} className="text-sm">
              {r ? (
                <>
                  <b className="text-2xl font-extrabold">{r.for}</b> <span className={ui.meta}>for · {r.against} against</span>
                </>
              ) : (
                <span className={ui.meta}>Not asked</span>
              )}
            </span>
          )),
          rec[0] && rec[1] ? diff(pct(rec[0].for, counted[0]), pct(rec[1].for, counted[1]), "more would recommend") : null,
        )}
        {row(
          "Top pain",
          topPain.map((t, i) => (
            <span key={i} className="text-sm font-bold">
              {t ? t.label : <span className={ui.meta}>None found</span>}
            </span>
          )),
          null,
        )}
      </div>
    </section>
  );
}

/**
 * One list (themes, touchpoints, …) side by side: each item with a bar per side, as a share of that side's posts
 * about it. Sorted by the biggest difference unless the list has its own order.
 */
function Twin(props: {
  id?: string;
  title: string;
  note: string;
  sides: [CompareSide, CompareSide];
  pick: (s: AnalysisSummary) => Tally[];
  sub?: (t: Tally) => string | undefined;
  keepOrder?: boolean;
}) {
  const { sides } = props;
  const lists = sides.map((s) => props.pick(s.summary));
  const keys = [...new Set(lists.flatMap((l) => l.map((t) => t.key)))];
  const rows = keys.map((key) => {
    const items = lists.map((l) => l.find((t) => t.key === key));
    const shares = items.map((t, i) => pct(t?.counted ?? 0, sides[i].summary.relevance.counted));
    const any = items.find(Boolean)!;
    return { key, label: any.label, sub: props.sub?.(any), shares };
  }).filter((r) => r.shares.some((v) => v > 0));
  if (!props.keepOrder) rows.sort((x, y) => Math.abs(y.shares[0] - y.shares[1]) - Math.abs(x.shares[0] - x.shares[1]));
  const max = Math.max(1, ...rows.flatMap((r) => r.shares));
  return (
    <section id={props.id} className={ui.card}>
      <div className={ui.cardHead}>
        <h2 className={ui.cardTitle}>{props.title}</h2>
        <span className={ui.meta}>{props.note}</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-6 py-5 text-sm text-muted">None found yet.</p>
      ) : (
        <ul className="flex flex-col gap-4 px-4 py-5 sm:px-6">
          {rows.map((r) => (
            <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_44px] items-center gap-x-4 gap-y-1 text-sm">
              <span className="row-span-2 min-w-0">
                <span className="block truncate font-semibold">{r.label}</span>
                {r.sub && <span className={ui.meta}>{r.sub}</span>}
              </span>
              {r.shares.map((v, i) => (
                <span key={i} className="contents">
                  <span className="h-2 overflow-hidden rounded-full bg-border" role="img" aria-label={`${sides[i].label}: ${v}%`}>
                    <span className={`block h-full rounded-full ${SIDE[i].bar}`} style={{ width: `${(v / max) * 100}%` }} />
                  </span>
                  <span className="text-right text-[13px] text-muted tabular-nums">{v}%</span>
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The journey map (stage × what people do) with both sides in every cell: A's share on the left, B's on the right,
 * each of its own posts. Picking a cell shows the most-liked posts of both sides for it.
 */
function Journey({ sides }: { sides: [CompareSide, CompareSide] }) {
  const types = sides[0].summary.postTypes.filter((t) => t.key !== NOT_SURE && t.key !== "other");
  const stages = sides[0].summary.codebook.stages;
  const cell = (s: AnalysisSummary, stage: string, type: string) => s.grid.find((g) => g.stage === stage && g.type === type)?.n ?? 0;
  const share = (i: number, stage: string, type: string) => pct(cell(sides[i].summary, stage, type), sides[i].summary.relevance.counted);
  const max = Math.max(1, ...sides.flatMap((_, i) => stages.flatMap((s) => types.map((t) => share(i, s.key, t.key)))));
  const [sel, setSel] = useState<{ stage: string; type: string } | null>(null);
  const name = (key: string, list: { key: string; label: string }[]) => list.find((x) => x.key === key)?.label ?? key;
  const half = (i: number, v: number) => (
    <span
      className="grid h-full place-items-center tabular-nums"
      style={v ? { background: `color-mix(in srgb, ${SIDE[i].mix} ${Math.round(18 + (v / max) * 70)}%, transparent)` } : undefined}
    >
      {v ? `${v}%` : <span className="text-faint">–</span>}
    </span>
  );
  return (
    <section id="journey" className={ui.card}>
      <div className={ui.cardHead}>
        <h2 className={ui.cardTitle}>Journey</h2>
        <span className={ui.meta}>Where people are × what they do, as a share of each side&apos;s posts. Pick a cell for its most-liked posts.</span>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 px-4 pt-4 text-[13px] sm:px-6">
        {sides.map((s, i) => (
          <span key={i} className="inline-flex items-center gap-1.5">
            <SideName i={i} label={s.label} /> <span className={ui.meta}>{i === 0 ? "left" : "right"} in each cell</span>
          </span>
        ))}
      </div>
      <div className="overflow-x-auto px-4 pt-3 sm:px-6">
        <table className="w-full min-w-[44rem] border-separate border-spacing-1 text-[13px]">
          <thead>
            <tr>
              <th className="w-32" />
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
                  const va = share(0, s.key, t.key);
                  const vb = share(1, s.key, t.key);
                  const on = sel?.stage === s.key && sel.type === t.key;
                  return (
                    <td key={t.key} className="p-0">
                      {va || vb ? (
                        <button
                          type="button"
                          aria-pressed={on}
                          aria-label={`${s.label} × ${t.label}: ${sides[0].label} ${va}%, ${sides[1].label} ${vb}%`}
                          onClick={() => setSel({ stage: s.key, type: t.key })}
                          className={`grid h-10 w-full grid-cols-2 overflow-hidden rounded-lg bg-surface-2 font-semibold hover:outline-2 hover:outline-foreground/60 hover:outline-solid ${on ? "outline-2 outline-foreground outline-solid" : ""}`}
                        >
                          {half(0, va)}
                          {half(1, vb)}
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
      {sel ? (
        <div className="m-4 rounded-xl border border-border bg-surface-2 px-4 py-3 sm:m-6">
          <b className="text-sm">
            {name(sel.stage, stages)} × {name(sel.type, types)}
          </b>
          <div className="mt-2 grid gap-4 lg:grid-cols-2">
            {sides.map((side, i) => {
              const qs = side.quotes.filter((q) => q.stage === sel.stage && q.type === sel.type);
              return (
                <div key={i} className="min-w-0">
                  <div className="text-[13px]">
                    <SideName i={i} label={side.label} />
                  </div>
                  {qs.length === 0 ? (
                    <p className="mt-1 text-sm text-muted">No posts here.</p>
                  ) : (
                    <ul>
                      {qs.map((q) => (
                        <li key={q.id} className="border-t border-border py-2.5 text-sm first:border-t-0">
                          <p className="line-clamp-4">“{q.text}”</p>
                          <p className="mt-1 text-xs text-muted">
                            {SOURCE_LABELS[q.source] ?? q.source} · {q.likes} {q.source === "reddit" ? "upvotes" : "likes"}
                            {q.url && (
                              <>
                                {" · "}
                                <a href={q.url} target="_blank" rel="noreferrer noopener" className={ui.link}>
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
              );
            })}
          </div>
        </div>
      ) : (
        <div className="h-4" />
      )}
    </section>
  );
}
