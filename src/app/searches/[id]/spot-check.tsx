"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { Accuracy, CheckItem } from "@/lib/analysis";
import { NOT_STATED, OWNERSHIP, POST_TYPES, type Codebook } from "@/lib/codebook";

import { autoCheckAction, saveSpotCheckAction } from "../analysis-actions";

const SENTIMENTS = ["positive", "negative", "mixed", "neutral"];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const SOURCE_LABELS: Record<string, string> = { youtube: "YouTube", reddit: "Reddit" };
/** Target from docs/EVALUATION.md: 18 of 20 right. */
const TARGET = 0.9;

/**
 * The accuracy check (docs/EVALUATION.md §1): 20 counted posts with Jev's answers, pre-filled. Change what's wrong
 * and save; the score shows how often Jev's sure answers match yours, per question.
 */
export function SpotCheck(props: { searchId: number; version: number; codebook: Codebook; items: CheckItem[]; accuracy: Accuracy }) {
  const { items, accuracy, searchId } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const claudeRan = items.some((i) => i.claude);
  // Where Claude and Jev differ on a sure answer and you haven't decided: the only posts that need you.
  // Per question: a post you checked before a question existed can still be disputed on that question.
  const disputed = items.filter(
    (i) => i.claude && Object.entries(i.claude).some(([q, a]) => !(i.person && q in i.person) && (i.jev[q]?.confidence ?? 0) >= 0.8 && i.jev[q]?.answer !== a),
  );
  const shown = !claudeRan || all ? items : disputed;
  const open = accuracy.questions.reduce((n, q) => n + q.open, 0);

  function autoCheck() {
    setNote(null);
    startTransition(async () => {
      const r = await autoCheckAction(searchId);
      setNote(r.message);
      if (r.ok) router.refresh();
    });
  }

  return (
    <details className="rounded-lg border border-border px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium">
        Check accuracy{" "}
        <span className="font-normal text-muted">
          · {claudeRan ? `${disputed.length} ${disputed.length === 1 ? "post needs" : "posts need"} your call` : "measures how often Jev is right"}
        </span>
      </summary>
      <div className="mt-4 flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3 rounded-md bg-accent/5 px-3 py-2 text-sm">
          <button type="button" disabled={pending} onClick={autoCheck} className="rounded-md border border-accent px-3 py-1 font-medium text-accent disabled:opacity-50">
            {pending ? "Claude is checking…" : claudeRan ? "Run the auto-check again" : "Auto-check with Claude"}
          </button>
          <span className="text-xs text-muted">
            Claude answers the same questions for {items.length} posts (a few cents). You only decide where it disagrees with Jev; your answer always wins.
          </span>
        </div>
        {note && <p className="text-sm text-muted">{note}</p>}
        <Score accuracy={accuracy} open={open} />
        {claudeRan && (
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">{all ? `All ${items.length} posts` : `${disputed.length} posts where Claude and Jev disagree`}</span>
            <button type="button" onClick={() => setAll((v) => !v)} className="text-xs text-muted underline">
              {all ? "Show only disagreements" : `Show all ${items.length}`}
            </button>
          </div>
        )}
        {shown.length === 0 ? (
          <p className="text-sm text-muted">Nothing needs your call. Claude and Jev agree on every sure answer.</p>
        ) : (
          <ol className="flex flex-col divide-y divide-border">
            {shown.map((item) => (
              <CheckRow key={item.id} n={items.indexOf(item) + 1} item={item} {...props} />
            ))}
          </ol>
        )}
      </div>
    </details>
  );
}

function Score({ accuracy, open }: { accuracy: Accuracy; open: number }) {
  if (accuracy.checked === 0) return <p className="text-sm text-muted">Not checked yet. The target is 18 of 20 right for journey stage and sentiment.</p>;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted">
        Judged by you on {accuracy.byYou} {accuracy.byYou === 1 ? "post" : "posts"} and by Claude on the rest
        {open > 0 ? `; ${open} disagreements still count as Jev wrong until you decide` : ""}.
      </p>
    <ul className="grid gap-2 sm:grid-cols-2">
      {accuracy.questions.map((q) => {
        const share = q.sure ? q.right / q.sure : 0;
        const good = q.sure > 0 && share >= TARGET;
        return (
          <li key={q.key} className="rounded-md border border-border px-3 py-2 text-sm">
            <span className="font-medium">{q.label}</span>
            <span className="float-right tabular-nums">
              {q.sure === 0 ? (
                <span className="text-muted">no sure answers checked yet</span>
              ) : (
                <>
                  {q.right} of {q.sure} right <span className={good ? "text-[#2f9e6e]" : "text-critical"}>{good ? "✓ on target" : "below target"}</span>
                </>
              )}
            </span>
            {q.notSure > 0 && (
              <p className="text-xs text-muted">
                {q.notSure} {q.notSure === 1 ? "answer" : "answers"} Jev wasn&apos;t sure of (not counted in the report)
              </p>
            )}
          </li>
        );
      })}
    </ul>
    </div>
  );
}

function CheckRow({ n, item, searchId, version, codebook }: { n: number; item: CheckItem; searchId: number; version: number; codebook: Codebook }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  // Without an answer from Jev the list starts on a real option, so what you see is what gets saved.
  const initial = (q: string, fallback: string) => item.person?.[q] ?? item.jev[q]?.answer ?? fallback;
  const [sentiment, setSentiment] = useState(initial("sentiment", "neutral"));
  const [stage, setStage] = useState(initial("stage", NOT_STATED));
  const [segment, setSegment] = useState(initial("segment", NOT_STATED));
  const [postType, setPostType] = useState(initial("post_type", "other"));
  const [ownership, setOwnership] = useState(initial("ownership", NOT_STATED));
  const [themes, setThemes] = useState<Set<string>>(
    new Set(codebook.themes.filter((t) => (item.person ? item.person[`theme:${t.key}`] : item.jev[`theme:${t.key}`]?.answer) === "yes").map((t) => t.key)),
  );
  const sure = (q: string) => (item.jev[q]?.confidence ?? 0) >= 0.8;
  const jevSays = (q: string, label: (a: string) => string) => {
    const jev = item.jev[q] ? `Jev: ${label(item.jev[q].answer)}${sure(q) ? "" : " (not sure)"}` : "Jev: no answer";
    const claude = item.claude?.[q];
    return claude && claude !== item.jev[q]?.answer ? `${jev} · Claude: ${label(claude)}` : jev;
  };
  const typeLabel = (k: string) => POST_TYPES.find((t) => t.key === k)?.label ?? "Other";
  const ownLabel = (k: string) => OWNERSHIP.find((o) => o.key === k)?.label ?? "Not stated";
  const stageLabel = (k: string) => codebook.stages.find((s) => s.key === k)?.label ?? (k === NOT_STATED ? "Not stated" : k);
  const segmentLabel = (k: string) => codebook.segments.find((s) => s.key === k)?.label ?? (k === NOT_STATED ? "Not stated" : k);

  function save() {
    const answers: Record<string, string> = { sentiment, stage, post_type: postType, ownership, ...(codebook.segments.length ? { segment } : {}) };
    for (const t of codebook.themes) answers[`theme:${t.key}`] = themes.has(t.key) ? "yes" : "no";
    setNote(null);
    startTransition(async () => {
      const r = await saveSpotCheckAction(searchId, version, item.id, answers);
      setNote(r.ok ? "Saved" : r.message);
      if (r.ok) router.refresh();
    });
  }

  const select = "rounded-md border border-border bg-background px-2 py-1 text-sm";
  return (
    <li className="flex flex-col gap-3 py-4">
      <div className="text-sm">
        <p className="mb-1 text-xs text-muted">
          {n}. {SOURCE_LABELS[item.source] ?? item.source}
          {item.thread && ` · under “${item.thread}”`}
          {item.url && (
            <>
              {" · "}
              <a href={item.url} target="_blank" rel="noreferrer noopener" className="underline">
                open ↗
              </a>
            </>
          )}
          {item.person && <span className="ml-2 text-[#2f9e6e]">✓ checked</span>}
        </p>
        {item.title && <p className="font-medium">{item.title}</p>}
        <p className="break-words whitespace-pre-line">{item.text.length > 700 ? `${item.text.slice(0, 700)}…` : item.text}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Sentiment · {jevSays("sentiment", cap)}
          <select value={sentiment} onChange={(e) => setSentiment(e.target.value)} className={select}>
            {SENTIMENTS.map((s) => (
              <option key={s} value={s}>
                {cap(s)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Journey stage · {jevSays("stage", stageLabel)}
          <select value={stage} onChange={(e) => setStage(e.target.value)} className={select}>
            {[...codebook.stages.map((s) => s.key), NOT_STATED].map((k) => (
              <option key={k} value={k}>
                {stageLabel(k)}
              </option>
            ))}
          </select>
        </label>
        {codebook.segments.length > 0 && (
          <label className="flex flex-col gap-1 text-xs text-muted">
            Who is posting · {jevSays("segment", segmentLabel)}
            <select value={segment} onChange={(e) => setSegment(e.target.value)} className={select}>
              {[...codebook.segments.map((s) => s.key), NOT_STATED].map((k) => (
                <option key={k} value={k}>
                  {segmentLabel(k)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          What the post does · {jevSays("post_type", typeLabel)}
          <select value={postType} onChange={(e) => setPostType(e.target.value)} className={select}>
            {[...POST_TYPES.map((t) => t.key), "other"].map((k) => (
              <option key={k} value={k}>
                {typeLabel(k)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          How long they&apos;ve had it · {jevSays("ownership", ownLabel)}
          <select value={ownership} onChange={(e) => setOwnership(e.target.value)} className={select}>
            {[...OWNERSHIP.map((o) => o.key), NOT_STATED].map((k) => (
              <option key={k} value={k}>
                {ownLabel(k)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-xs text-muted">
          Themes it mentions (ticked = Jev&apos;s picks{item.claude ? "; ◆ = Claude's picks" : ""}; change what&apos;s wrong)
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {codebook.themes.map((t) => {
            const on = themes.has(t.key);
            return (
              <button
                key={t.key}
                type="button"
                aria-pressed={on}
                onClick={() => setThemes((s) => (s.has(t.key) ? new Set([...s].filter((k) => k !== t.key)) : new Set([...s, t.key])))}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? "border-accent bg-accent/10 text-accent" : "border-border text-muted"}`}
              >
                {on ? "✓ " : ""}
                {t.label}
                {item.claude?.[`theme:${t.key}`] === "yes" ? " ◆" : ""}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="flex items-center gap-3">
        <button type="button" disabled={pending} onClick={save} className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-white disabled:opacity-50">
          {item.person ? "Save again" : "Save"}
        </button>
        {note && <span className="text-xs text-muted">{note}</span>}
      </div>
    </li>
  );
}
