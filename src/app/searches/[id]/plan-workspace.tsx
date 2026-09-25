"use client";

import { useCallback, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";

import type { Progress } from "@/lib/collect";
import { estimatePlan, LIMITS, type Plan } from "@/lib/plan";
import { activeDepth, activePeriod, applyDepth, applyPeriod, DEPTHS, PERIODS, planSummary, planWarnings, type PeriodId } from "@/lib/plan-edit";

import { savePlanAction } from "../actions";
import { CollectionPanel } from "./collection-panel";

const field = "rounded-lg border border-border bg-background px-3 py-2 text-sm";
const label = "flex flex-col gap-1 text-sm";
const card = "flex flex-col gap-4 rounded-xl border border-border bg-surface p-5";

interface Props {
  searchId: number;
  plan: Plan;
  version: number;
  usdPerCredit: number;
  initialProgress: Progress;
  /** A collection is part-way through; the plan can't change until it finishes. */
  locked: boolean;
}

/**
 * The search screen: a one-line summary, one-click choices for period, depth and sources, and the Run button.
 * Everything else sits under "More options". Pressing Run saves any edits first, so there is no separate save step.
 */
export function PlanWorkspace({ searchId, plan, version, usdPerCredit, initialProgress, locked }: Props) {
  const [saved, setSaved] = useState({ plan, version });
  const [draft, setDraft] = useState(plan);
  const [running, setRunning] = useState(false);
  const [customDates, setCustomDates] = useState(activePeriod(plan) === "custom");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // A newer version from the server (another tab, or our own save) replaces the saved copy; untouched drafts follow it.
  if (version !== saved.version) {
    if (JSON.stringify(draft) === JSON.stringify(saved.plan)) setDraft(plan);
    setSaved({ plan, version });
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved.plan);
  const est = useMemo(() => estimatePlan(draft, usdPerCredit), [draft, usdPerCredit]);
  const warnings = useMemo(() => planWarnings(draft), [draft]);
  const period = customDates ? "custom" : activePeriod(draft);
  const depth = activeDepth(draft);
  const disabled = locked || running || saving;
  const update = (patch: Partial<Plan>) => setDraft((d) => ({ ...d, ...patch }));

  const save = useCallback(async (): Promise<string | null> => {
    setSaving(true);
    try {
      const r = await savePlanAction(searchId, draft);
      if (!r.ok) return r.message;
      setSaved({ plan: r.plan, version: r.version });
      setDraft(r.plan);
      setNote({ ok: true, text: r.message });
      return null;
    } finally {
      setSaving(false);
    }
  }, [searchId, draft]);

  const beforeStart = useCallback(async () => (dirty ? save() : null), [dirty, save]);

  async function saveOnly() {
    const err = await save().catch(() => "Couldn't save the plan. Try again.");
    if (err) setNote({ ok: false, text: err });
  }

  function pickPeriod(id: PeriodId) {
    if (id === "custom") return setCustomDates(true);
    setCustomDates(false);
    setDraft((d) => applyPeriod(d, id));
  }

  return (
    <>
      <section aria-labelledby="plan-heading" className={card}>
        <div className="flex flex-col gap-1">
          <h2 id="plan-heading" className="text-lg font-medium">
            What will be collected
          </h2>
          <p className="text-base">{planSummary(draft, est)}</p>
          <p className="text-xs text-muted">
            {est.redditCredits} Reddit credits · {est.youtubeQuotaUnits} YouTube units (free up to 10,000 a day)
            {dirty && " · unsaved changes are saved when you start a run"}
          </p>
        </div>

        {warnings.length > 0 && (
          <ul className="flex flex-col gap-1 rounded-lg border border-warning/60 bg-warning/10 px-3 py-2 text-sm">
            {warnings.map((w) => (
              <li key={w}>⚠ {w}</li>
            ))}
          </ul>
        )}

        <fieldset disabled={disabled} className="flex flex-col gap-4">
          <Choice legend="Period">
            {[...PERIODS.map((p) => ({ id: p.id as PeriodId, label: p.label })), { id: "custom" as PeriodId, label: "Custom dates" }].map((p) => (
              <Pill key={p.id} active={period === p.id} onClick={() => pickPeriod(p.id)}>
                {p.label}
              </Pill>
            ))}
          </Choice>
          {period === "custom" && (
            <div className="flex flex-wrap items-end gap-3">
              <label className={label}>
                From
                <input
                  type="date"
                  value={draft.timeWindow.from ?? ""}
                  max={draft.timeWindow.to ?? undefined}
                  onChange={(e) => update({ timeWindow: { ...draft.timeWindow, from: e.target.value || null, label: "custom dates" } })}
                  className={field}
                />
              </label>
              <label className={label}>
                To
                <input
                  type="date"
                  value={draft.timeWindow.to ?? ""}
                  min={draft.timeWindow.from ?? undefined}
                  onChange={(e) => update({ timeWindow: { ...draft.timeWindow, to: e.target.value || null, label: "custom dates" } })}
                  className={field}
                />
              </label>
              <span className="pb-2 text-xs text-muted">Leave empty for no limit.</span>
            </div>
          )}

          <Choice legend="Depth">
            {DEPTHS.map((d) => (
              <Pill key={d.id} active={depth === d.id} onClick={() => setDraft((p) => applyDepth(p, d.id))}>
                {d.label} <span className="text-muted">{d.hint}</span>
              </Pill>
            ))}
            {depth === "custom" && <Pill active>Custom</Pill>}
          </Choice>

          <div className="grid gap-4 sm:grid-cols-2">
            <SourceBox
              name="YouTube"
              enabled={draft.youtube.enabled}
              queries={draft.youtube.queries}
              onToggle={(enabled) => update({ youtube: { ...draft.youtube, enabled } })}
              onQueries={(queries) => update({ youtube: { ...draft.youtube, queries } })}
            />
            <SourceBox
              name="Reddit"
              enabled={draft.reddit.enabled}
              queries={draft.reddit.queries}
              onToggle={(enabled) => update({ reddit: { ...draft.reddit, enabled } })}
              onQueries={(queries) => update({ reddit: { ...draft.reddit, queries } })}
            />
          </div>
        </fieldset>
        {locked && <p className="text-sm text-muted">The plan is locked until the current collection, including any paused steps, finishes.</p>}
      </section>

      <CollectionPanel searchId={searchId} initial={initialProgress} beforeStart={beforeStart} onRunningChange={setRunning} />

      <details className={`${card} group`}>
        <summary className="cursor-pointer text-sm font-medium select-none">More options (subject, other names, exclusions, exact numbers)</summary>
        <fieldset disabled={disabled} className="mt-2 flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={`${label} sm:col-span-2`}>
              Subject
              <input value={draft.subject} onChange={(e) => update({ subject: e.target.value })} className={field} />
            </label>
            <label className={label}>
              Kind
              <select value={draft.kind} onChange={(e) => update({ kind: e.target.value as Plan["kind"] })} className={field}>
                <option value="product">Product</option>
                <option value="family">Product family</option>
                <option value="category">Category</option>
                <option value="audience">Audience</option>
              </select>
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.intent === "question"}
              onChange={(e) => update({ intent: e.target.checked ? "question" : "topic", question: e.target.checked ? (draft.question ?? "") : null })}
            />
            Answer a specific question
          </label>
          {draft.intent === "question" && (
            <label className={label}>
              Question
              <input value={draft.question ?? ""} onChange={(e) => update({ question: e.target.value })} className={field} />
            </label>
          )}

          <ChipField label="Focus themes" hint="e.g. wifi, ink cost" values={draft.focus} onChange={(focus) => update({ focus })} />
          <ChipField label="Other names people use" hint="model numbers, nicknames" values={draft.aliases} onChange={(aliases) => update({ aliases })} />
          <ChipField
            label="Drop results mentioning"
            hint="only unrelated products with a similar name, e.g. fish tank"
            values={draft.exclusions}
            onChange={(exclusions) => update({ exclusions })}
          />

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <NumberField label="Videos per search" value={draft.youtube.videosPerQuery} limits={LIMITS.videosPerQuery} onChange={(videosPerQuery) => update({ youtube: { ...draft.youtube, videosPerQuery } })} />
            <NumberField label="Comments per video" value={draft.youtube.commentsPerVideo} limits={LIMITS.commentsPerVideo} onChange={(commentsPerVideo) => update({ youtube: { ...draft.youtube, commentsPerVideo } })} />
            <NumberField
              label="Reddit threads per search"
              value={draft.reddit.commentThreadsPerQuery}
              limits={LIMITS.commentThreadsPerQuery}
              onChange={(commentThreadsPerQuery) => update({ reddit: { ...draft.reddit, commentThreadsPerQuery } })}
            />
            <NumberField label="Stop after posts" value={draft.postCap} limits={LIMITS.postCap} onChange={(postCap) => update({ postCap })} />
          </div>

          <label className={label}>
            Notes
            <input value={draft.notes} onChange={(e) => update({ notes: e.target.value })} className={field} />
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={saveOnly} disabled={!dirty} className="rounded-lg border border-border px-4 py-2 text-sm font-medium disabled:opacity-50">
              {saving ? "Saving…" : "Save without running"}
            </button>
            <button type="button" onClick={() => setDraft(saved.plan)} disabled={!dirty} className="text-sm text-muted underline disabled:opacity-50">
              Undo changes
            </button>
            <span className="text-xs text-muted">Plan v{saved.version}</span>
          </div>
        </fieldset>
      </details>

      {note && (
        <p role="status" className={`text-sm ${note.ok ? "text-muted" : "text-critical"}`}>
          {note.text}
        </p>
      )}
    </>
  );
}

function Choice({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={legend} className="flex flex-col gap-2">
      <span className="text-sm font-medium">{legend}</span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-sm disabled:opacity-60 ${active ? "border-accent bg-accent/10 font-medium" : "border-border hover:border-accent/60"}`}
    >
      {children}
    </button>
  );
}

function SourceBox(props: { name: string; enabled: boolean; queries: string[]; onToggle: (on: boolean) => void; onQueries: (q: string[]) => void }) {
  return (
    <div className={`flex flex-col gap-2 rounded-lg border border-border p-3 ${props.enabled ? "" : "opacity-60"}`}>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={props.enabled} onChange={(e) => props.onToggle(e.target.checked)} />
        {props.name}
      </label>
      {props.enabled && <ChipField label="Searches" hint="add a search and press Enter" values={props.queries} onChange={props.onQueries} max={LIMITS.queries} />}
    </div>
  );
}

/** A list of short strings shown as removable chips, with a box to add more (Enter or leaving the box adds). */
function ChipField({ label: text, hint, values, onChange, max }: { label: string; hint: string; values: string[]; onChange: (v: string[]) => void; max?: number }) {
  const [input, setInput] = useState("");
  const full = max !== undefined && values.length >= max;
  function add() {
    const v = input.trim();
    if (v && !full && !values.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...values, v]);
    setInput("");
  }
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      add();
    } else if (e.key === "Backspace" && !input && values.length) {
      onChange(values.slice(0, -1));
    }
  }
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span>{text}</span>
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-background p-1.5">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full bg-border/60 py-0.5 pr-1 pl-2.5">
            {v}
            <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))} className="rounded-full px-1 text-muted hover:text-foreground">
              ×
            </button>
          </span>
        ))}
        {!full && (
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            onBlur={add}
            placeholder={values.length ? "add…" : hint}
            aria-label={`Add to ${text}`}
            className="min-w-32 flex-1 bg-transparent px-1.5 py-1 outline-none"
          />
        )}
      </div>
      {full && <span className="text-xs text-muted">Up to {max}; remove one to add another.</span>}
    </div>
  );
}

function NumberField({ label: text, value, limits, onChange }: { label: string; value: number; limits: { min: number; max: number }; onChange: (n: number) => void }) {
  return (
    <label className={label}>
      {text}
      <input
        type="number"
        min={limits.min}
        max={limits.max}
        value={Number.isNaN(value) ? "" : value}
        onChange={(e) => onChange(e.target.value === "" ? Number.NaN : Number(e.target.value))}
        className={field}
      />
    </label>
  );
}
