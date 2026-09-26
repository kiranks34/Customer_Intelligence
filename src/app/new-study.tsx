"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { choicesProblem, estimateStudy, PERIOD_CHOICES, SOURCES, type PeriodChoice, type SourceId, type StudyChoices } from "@/lib/study-setup";

import { aboutUsd, shortDay } from "./format";
import { byPostsThenName, pickLabel, shortName, type ListFamily } from "./picker-data";
import { startCollectionAction, startStudyAction, type StartStudyResult } from "./searches/actions";
import { ui } from "./ui";

export interface NewStudyDefaults {
  catalogId: number;
  nodeId: number | null;
  sources: SourceId[];
  period: PeriodChoice;
}

interface Props {
  families: ListFamily[];
  defaults: NewStudyDefaults;
  /** Budget left this month (null when unknown). */
  leftUsd: number | null;
  usdPerCredit: number;
  claudeModel: string;
}

type Notice = Exclude<StartStudyResult, { ok: true }> | null;

/**
 * New study (D46): one row (product · Start study) and a summary line of the choices; "Change" opens sources,
 * period and question. Filled in with your last choices. Problems are caught before anything is spent: not enough
 * budget (with a cheaper option), the same study already run (open it or collect new posts), Claude unavailable.
 */
/** Opens the calendar on a click anywhere in the field, not only on its small icon. */
const openPicker = (e: React.MouseEvent<HTMLInputElement>) => {
  try {
    e.currentTarget.showPicker?.();
  } catch {
    // Some browsers refuse without a direct user gesture; typing the date still works.
  }
};
const dateInput = "h-[34px] w-40 rounded-[10px] border border-accent bg-background px-3 text-sm";

export function NewStudy({ families, defaults, leftUsd, usdPerCredit, claudeModel }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pick, setPick] = useState({ catalogId: defaults.catalogId, nodeId: defaults.nodeId });
  const [sources, setSources] = useState<SourceId[]>(defaults.sources);
  const [period, setPeriod] = useState<PeriodChoice>(defaults.period);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [question, setQuestion] = useState("");
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const choices: StudyChoices = { sources, period, from, to, question: question.trim() };
  const label = pickLabel(families, pick.catalogId, pick.nodeId);
  const problem = label ? choicesProblem(choices) : "Pick a product.";
  const est = useMemo(() => estimateStudy(sources, usdPerCredit, claudeModel), [sources, usdPerCredit, claudeModel]);
  const short = leftUsd !== null && est.usd > leftUsd;
  // A cheaper study that fits: one source instead of two.
  const cheaper = short
    ? SOURCES.map((s) => ({ id: s.id, label: s.label, usd: estimateStudy([s.id], usdPerCredit, claudeModel).usd }))
        .filter((s) => sources.length > 1 && s.usd <= (leftUsd ?? 0))
        .sort((a, b) => a.usd - b.usd)[0]
    : undefined;
  // Local YYYY-MM-DD; only used by the date inputs, which render after you pick Custom.
  const today = new Date().toLocaleDateString("en-CA");
  const periodLabel = period === "custom" ? (from ? `${shortDay(from)} – ${to ? shortDay(to) : "today"}` : "Custom") : PERIOD_CHOICES.find((p) => p.id === period)?.label;
  const change = <T,>(set: (v: T) => void) => (v: T) => (set(v), setNotice(null));

  function start(force = false) {
    if (!label || problem) return;
    setNotice(null);
    startTransition(async () => {
      const r = await startStudyAction({ catalogId: pick.catalogId, nodeId: pick.nodeId, choices, force });
      if (r.ok) router.push(`/searches/${r.id}?run=1`);
      else setNotice(r);
    });
  }
  function collectNew(id: number) {
    startTransition(async () => {
      const r = await startCollectionAction(id);
      if (r.ok) router.push(`/searches/${id}?run=1`);
      else setNotice({ ok: false, kind: "other", message: r.message });
    });
  }

  if (families.length === 0) {
    return (
      <section className={ui.card}>
        <div className={ui.cardHead}>
          <h2 className={ui.cardTitle}>New study</h2>
        </div>
        <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
          <h3 className="text-base font-bold">Add the product you want to hear about</h3>
          <p className="max-w-md text-sm text-muted">Pulse finds what people say about it on YouTube and Reddit and maps it onto the customer journey.</p>
          <Link href="/products?from=new" className={ui.primary}>
            Add a product family
          </Link>
          <span className={ui.meta}>For example HP Smart Tank or Epson EcoTank</span>
        </div>
      </section>
    );
  }

  return (
    <section className={ui.card} aria-labelledby="new-study">
      <div className={ui.cardHead}>
        <h2 id="new-study" className={ui.cardTitle}>
          New study
        </h2>
      </div>
      <div className={ui.cardBody}>
        <div className="flex flex-wrap items-center gap-3">
          <ProductPicker families={families} pick={pick} label={label} onPick={change(setPick)} />
          <span className="flex-1" />
          <button type="button" disabled={pending || !!problem || short} onClick={() => start()} className={ui.primary}>
            {pending ? "Starting…" : "Start study"}
          </button>
        </div>

        {open && (
          <div className="flex flex-col gap-4 border-t border-border pt-4">
            <Field label="Sources">
              {SOURCES.map((s) => {
                const on = sources.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => change(setSources)(on ? sources.filter((x) => x !== s.id) : [...sources, s.id])}
                    className={on ? ui.chipOn : ui.chip}
                  >
                    {on && "✓ "}
                    {s.label}
                  </button>
                );
              })}
              <Link href="/products?tab=sources&from=new" className={`${ui.chip} border-dashed text-muted`}>
                + Add source
              </Link>
            </Field>
            <Field label="Period">
              <div role="radiogroup" aria-label="Period" className="flex flex-wrap items-center gap-2">
                {PERIOD_CHOICES.map((p) => (
                  <button key={p.id} type="button" role="radio" aria-checked={period === p.id} onClick={() => change(setPeriod)(p.id)} className={period === p.id ? ui.chipOn : ui.chip}>
                    {p.label}
                  </button>
                ))}
                <button type="button" role="radio" aria-checked={period === "custom"} onClick={() => change(setPeriod)("custom")} className={period === "custom" ? ui.chipOn : ui.chip}>
                  Custom…
                </button>
                {period === "custom" && (
                  <span className="flex basis-full flex-wrap items-center gap-2 text-sm">
                    <input type="date" aria-label="From" value={from} max={to || today} onChange={(e) => change(setFrom)(e.target.value)} onClick={openPicker} className={dateInput} />
                    to
                    <input type="date" aria-label="To (empty means today)" value={to} min={from || undefined} max={today} onChange={(e) => change(setTo)(e.target.value)} onClick={openPicker} className={dateInput} />
                  </span>
                )}
              </div>
            </Field>
            <Field label="Question">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                maxLength={300}
                placeholder="Optional, e.g. Why do people return it in the first month?"
                aria-label="Question (optional)"
                className={ui.input}
              />
            </Field>
          </div>
        )}

        {short && (
          <div className={ui.noticeWarn} role="status">
            <span className="min-w-56 flex-1">
              <b>Not enough budget left this month.</b> This study needs {aboutUsd(est.usd)}; ${(leftUsd ?? 0).toFixed(2)} is left.
              {cheaper && ` With ${cheaper.label} only it's ${aboutUsd(cheaper.usd)}.`}
            </span>
            {cheaper && (
              <button type="button" onClick={() => setSources([cheaper.id])} className={ui.plainSm}>
                Use {cheaper.label} only
              </button>
            )}
          </div>
        )}
        {notice?.kind === "duplicate" && (
          <div className={ui.noticeInfo} role="status">
            <span className="min-w-56 flex-1">
              <b>You ran this study on {shortDay(notice.date)}</b> with the same sources and period.
            </span>
            <Link href={`/searches/${notice.id}`} className={ui.secondarySm}>
              Open it →
            </Link>
            <button type="button" disabled={pending} onClick={() => collectNew(notice.id)} className={ui.plainSm}>
              Collect new posts
            </button>
            <button type="button" disabled={pending} onClick={() => start(true)} className={ui.plainSm}>
              Start a new one
            </button>
          </div>
        )}
        {notice?.kind === "claude" && (
          <div className={ui.noticeBad} role="alert">
            <span className="min-w-56 flex-1">
              <b>Couldn&apos;t plan the study.</b> {notice.message.replace(/\.?$/, ".")} Nothing was collected.
            </span>
            <button type="button" disabled={pending} onClick={() => start()} className={ui.secondarySm}>
              Try again
            </button>
          </div>
        )}
        {(notice?.kind === "other" || notice?.kind === "budget") && (
          <p role="alert" className="text-sm text-critical">
            {notice.message}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted">
          {open ? (
            <button type="button" onClick={() => setOpen(false)} className={ui.link}>
              Fewer options
            </button>
          ) : (
            <>
              <b className="font-semibold text-foreground">{sources.length ? sources.map((s) => SOURCES.find((x) => x.id === s)!.label).join(", ") : "No sources"}</b>
              <span className="h-3.5 w-px bg-border" aria-hidden />
              <b className="font-semibold text-foreground">{periodLabel}</b>
              <span className="h-3.5 w-px bg-border" aria-hidden />
              <span className="max-w-64 truncate">{question.trim() ? `“${question.trim()}”` : "No question"}</span>
              <button type="button" onClick={() => setOpen(true)} className={ui.link}>
                Change
              </button>
            </>
          )}
          <span className="flex-1" />
          <span>
            {problem ?? `${aboutUsd(est.usd)} · about ${est.minutes} min · keep the study's page open`}
          </span>
        </div>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid items-center gap-2 sm:grid-cols-[104px_minmax(0,1fr)] sm:gap-4">
      <span className="text-[13px] font-semibold text-muted">{label}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/**
 * The product picker: a button showing the pick; it opens a list floating over the page (the card never grows) with
 * a search box, family tabs when there are several, the whole family, then each series (most discussed first) with
 * its models and their post counts, so you choose from what has data.
 */
function ProductPicker({ families, pick, label, onPick }: { families: ListFamily[]; pick: { catalogId: number; nodeId: number | null }; label: string | null; onPick: (p: { catalogId: number; nodeId: number | null }) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [familyId, setFamilyId] = useState(pick.catalogId);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const family = families.find((f) => f.id === familyId) ?? families[0];
  const needle = q.trim().toLowerCase();
  const hit = (name: string) => !needle || name.toLowerCase().includes(needle);
  const series = [...family.series].sort(byPostsThenName).filter((s) => hit(s.name) || s.models.some((m) => hit(m.name)));
  const max = Math.max(1, family.posts);
  const choose = (nodeId: number | null) => {
    onPick({ catalogId: family.id, nodeId });
    setOpen(false);
    setQ("");
  };
  const option = (nodeId: number | null, name: string, posts: number, indent = false) => {
    const on = pick.catalogId === family.id && pick.nodeId === nodeId;
    return (
      <button
        key={nodeId ?? "all"}
        type="button"
        role="option"
        aria-selected={on}
        onClick={() => choose(nodeId)}
        className={`grid w-full grid-cols-[minmax(0,1fr)_64px_40px] items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm sm:grid-cols-[minmax(0,1fr)_96px_44px] ${on ? "bg-accent/15 font-semibold outline-[1.5px] outline-accent outline-solid" : "hover:bg-surface-2"} ${indent ? "pl-6" : ""}`}
      >
        <span className="truncate">{name}</span>
        <span className="h-1.5 overflow-hidden rounded-full bg-border" aria-hidden>
          <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.round((posts / max) * 100)}%` }} />
        </span>
        <span className="text-right text-[13px] text-muted tabular-nums">{posts}</span>
      </button>
    );
  };

  return (
    <div ref={box} className="relative max-w-full">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-11 max-w-full items-center gap-3 rounded-[10px] border-[1.5px] border-accent bg-accent/15 px-4 text-[15px] font-semibold"
      >
        <span className="truncate">{label ?? "Pick a product"}</span>
        <span className="text-xs text-muted" aria-hidden>
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <div className="absolute top-[52px] left-0 z-20 w-[min(560px,calc(100vw-2rem))] rounded-[14px] border border-border bg-surface shadow-[0_16px_48px_rgba(0,0,0,.45)]">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a series or model…" aria-label="Find a series or model" className={`${ui.input} m-3 w-[calc(100%-1.5rem)]`} />
          {families.length > 1 && (
            <div className="flex flex-wrap gap-1.5 border-b border-border px-3 pb-3">
              {families.map((f) => (
                <button key={f.id} type="button" onClick={() => setFamilyId(f.id)} className={`h-7 rounded-full border px-3 text-[13px] ${f.id === family.id ? "border-foreground bg-foreground font-semibold text-background" : "border-border"}`}>
                  {f.name}
                </button>
              ))}
            </div>
          )}
          <div role="listbox" aria-label="Products" className="max-h-80 overflow-y-auto p-1.5">
            {!needle && option(null, `All of ${family.name}`, family.posts)}
            {series.map((s) => (
              <div key={s.id}>
                <div className="px-2.5 pt-2.5 pb-1 text-[11px] font-bold tracking-wider text-muted uppercase">{shortName(s.name, family.name)}</div>
                {hit(s.name) && option(s.id, `Whole ${shortName(s.name, family.name)}`, s.posts)}
                {[...s.models].sort(byPostsThenName).filter((m) => hit(m.name) || hit(s.name)).map((m) => option(m.id, shortName(m.name, family.name), m.posts, true))}
              </div>
            ))}
            {series.length === 0 && needle && <p className="px-3 py-4 text-sm text-muted">Nothing matches “{q}”.</p>}
          </div>
          <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-[13px]">
            <span className="text-muted">Missing a product?</span>
            <Link href="/products?from=new" className={ui.link}>
              Manage products →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
