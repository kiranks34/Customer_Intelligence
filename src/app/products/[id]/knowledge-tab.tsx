"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { TOPICS, topicLabel, type Change, type KnowledgeFact } from "@/lib/knowledge";
import type { FamilyKnowledge, FamilyStudy } from "@/lib/product-knowledge";

import { shortDay as day } from "../../format";
import { ui } from "../../ui";
import { addFactAction, removeFactAction, updateKnowledgeStepAction } from "../actions";
import { LocalTime } from "../../local-time";

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
};

/**
 * A family's product knowledge (D45): what Pulse knows, grouped by the fixed topics, what the last update changed,
 * and the facts you added. "Update from <site>" runs in two steps of five topics; nothing runs by itself.
 */
export function KnowledgeTab({ data, users }: { data: FamilyKnowledge; users: FamilyStudy[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [text, setText] = useState("");
  const { knowledge, domains, runs, catalogId } = data;
  const last = runs[0] ?? null;
  const site = domains[0] ?? "";
  const maker = knowledge.facts.filter((f) => f.source === "maker");
  const yours = knowledge.facts.filter((f) => f.source === "you");
  const covered = TOPICS.filter((t) => maker.some((f) => f.topic === t.key && f.status === "current")).length;
  const latest = new Map((last?.changes ?? []).filter((c) => c.kind !== "not_found").map((c) => [c.text, c.kind]));
  const busy = pending || progress !== null;

  async function update() {
    setNote(null);
    let runId: number | null = null;
    let step = 0;
    try {
      for (; step < 2; step++) {
        setProgress(`Reading ${site} · ${step * 5} of 10 topics`);
        const r = await updateKnowledgeStepAction(catalogId, step, runId);
        if (!r.ok) {
          setNote({ ok: false, text: step > 0 ? `${r.message} The first 5 topics were saved.` : r.message });
          return;
        }
        runId = r.runId;
      }
      setNote({ ok: true, text: "Updated. See what changed below." });
    } catch {
      // A dropped connection or a timed-out function: whatever finished was saved.
      setNote({ ok: false, text: `The update stopped (connection lost or it took too long).${step > 0 ? " The first 5 topics were saved." : ""} Try again.` });
    } finally {
      setProgress(null);
      router.refresh();
    }
  }

  function run(action: () => Promise<{ ok: boolean; message: string }>, after?: () => void) {
    setNote(null);
    startTransition(async () => {
      const r = await action();
      if (!r.ok) setNote({ ok: false, text: r.message });
      else after?.();
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-wrap gap-x-8 gap-y-2 text-[13px] text-muted">
          <Stat value={maker.filter((f) => f.status === "current").length + yours.length} label="facts" />
          <Stat value={`${covered} of ${TOPICS.length}`} label="topics covered" />
          <Stat value={knowledge.checkedAt ? <LocalTime iso={knowledge.checkedAt} /> : "Never"} label="last updated" />
        </div>
        {domains.length > 0 ? (
          <div className="flex flex-col items-end gap-1">
            <button type="button" disabled={busy} onClick={update} className={ui.primary}>
              {progress ? "Updating…" : `↻ Update from ${site}`}
            </button>
            <span className={ui.meta}>{progress ?? `About a minute · about $0.05 · only ${domains.join(", ")}`}</span>
          </div>
        ) : (
          <p className="max-w-xs text-right text-sm text-muted">Pulse doesn&apos;t know this family&apos;s official website yet, so it can&apos;t update from it. You can add facts yourself below.</p>
        )}
      </div>
      {note && (
        <p role="status" className={`text-sm ${note.ok ? "text-muted" : "text-critical"}`}>
          {note.text}
        </p>
      )}

      {users.length > 0 && <UsedBy users={users} />}

      {last && <WhatChanged run={last} older={runs.slice(1)} />}

      <details className="rounded-xl border border-border px-4 py-3 text-sm">
        <summary className="cursor-pointer font-semibold">How an update works</summary>
        <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5 text-muted">
          <li>The same {TOPICS.length} topics every time: {TOPICS.map((t) => t.label.toLowerCase()).join(", ")}.</li>
          <li>Only the maker&apos;s own pages{domains.length ? ` (${domains.join(", ")})` : ""}; any other site is ignored.</li>
          <li>Every fact quotes its page, and Pulse checks the quote is really there. Nothing comes from memory.</li>
          <li>Every earlier fact is checked again: still there, changed, or not found this time. Your own facts are never changed.</li>
        </ol>
      </details>

      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Topics" className="hidden flex-col gap-0.5 lg:flex">
          {TOPICS.map((t) => {
            const n = maker.filter((f) => f.topic === t.key).length;
            return (
              <a key={t.key} href={`#topic-${t.key}`} className="flex justify-between rounded-lg px-3 py-1.5 text-sm hover:bg-surface-2">
                <span className={n ? "" : "text-muted"}>{t.label}</span>
                <span className="text-muted tabular-nums">{n}</span>
              </a>
            );
          })}
          <a href="#topic-yours" className="mt-2 flex justify-between rounded-lg px-3 py-1.5 text-sm hover:bg-surface-2">
            <span>Added by you</span>
            <span className="text-muted tabular-nums">{yours.length}</span>
          </a>
        </nav>
        <div className="flex flex-col divide-y divide-border rounded-xl border border-border">
          {[...TOPICS.map((t) => t.key), "other" as const].map((key) => {
            const facts = maker.filter((f) => f.topic === key);
            if (key === "other" && facts.length === 0) return null;
            return (
              <section key={key} id={`topic-${key}`} className="px-4 py-3">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-[15px] font-bold">{topicLabel(key)}</h3>
                  <span className={ui.meta}>{facts.length ? `${facts.length} ${facts.length === 1 ? "fact" : "facts"}` : "Nothing found yet"}</span>
                </div>
                <ul className="flex flex-col">
                  {facts.map((f) => (
                    <Fact key={f.id} f={f} mark={latest.get(f.text)} pending={busy} onRemove={() => run(() => removeFactAction(catalogId, f.id))} />
                  ))}
                </ul>
              </section>
            );
          })}
          <section id="topic-yours" className="px-4 py-3">
            <div className="flex items-baseline justify-between">
              <h3 className="text-[15px] font-bold">Added by you</h3>
              <span className={ui.meta}>Updates never change these</span>
            </div>
            <ul className="flex flex-col">
              {yours.map((f) => (
                <Fact key={f.id} f={f} pending={busy} onRemove={() => run(() => removeFactAction(catalogId, f.id))} />
              ))}
            </ul>
            <form
              className="mt-2 flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim()) run(() => addFactAction(catalogId, text), () => setText(""));
              }}
            >
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={300}
                placeholder="Add a fact Pulse should know, e.g. from a manual"
                aria-label="Add a fact"
                className={`${ui.input} min-w-56 flex-1`}
              />
              <button type="submit" disabled={busy || text.trim().length < 3} className={ui.secondary}>
                Add
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <span>
      <b className="block text-lg text-foreground">{value}</b>
      {label}
    </span>
  );
}

function Fact({ f, mark, pending, onRemove }: { f: KnowledgeFact; mark?: Change["kind"]; pending: boolean; onRemove: () => void }) {
  const gone = f.status === "not_found";
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-t border-dashed border-border py-2.5 first:border-t-0">
      <div className="flex flex-col gap-1">
        <p className={gone ? "text-muted" : ""}>{f.text}</p>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted">
          {mark === "new" && <Tag tone="good">New</Tag>}
          {mark === "changed" && <Tag tone="warn">Changed</Tag>}
          {gone && <Tag tone="bad">Not found last update</Tag>}
          {f.source === "you" ? <Tag tone="info">You</Tag> : <Tag>{f.models ? f.models : "Whole family"}</Tag>}
          {f.url && (
            <a href={f.url} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2 hover:text-accent">
              {host(f.url)} ↗
            </a>
          )}
          <span>since {day(f.since)}</span>
        </div>
      </div>
      <button type="button" disabled={pending} onClick={onRemove} aria-label="Remove this fact" className={ui.icon}>
        ×
      </button>
    </li>
  );
}

const TONES = { good: "border-good/60 text-good", warn: "border-warning/60 text-warning", bad: "border-critical/60 text-critical", info: "border-accent/60 text-accent" };
function Tag({ tone, children }: { tone?: keyof typeof TONES; children: React.ReactNode }) {
  return <span className={`inline-flex h-5 items-center rounded-full border px-2 text-[11px] font-semibold ${tone ? TONES[tone] : "border-border"}`}>{children}</span>;
}

function WhatChanged({ run, older }: { run: FamilyKnowledge["runs"][number]; older: FamilyKnowledge["runs"] }) {
  const { summary, changes } = run;
  const nothing = changes.length === 0;
  return (
    <section className="rounded-xl border border-border bg-surface-2 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-bold">What changed on <LocalTime iso={run.at} /></h3>
        <span className={ui.meta}>
          {summary.new} new · {summary.changed} changed · {summary.notFound} not found
        </span>
      </div>
      {nothing ? (
        <p className="mt-2 text-sm text-muted">Nothing changed: every fact was found again.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2 text-sm">
          {changes.slice(0, 12).map((c, i) => (
            <li key={i} className="grid grid-cols-[84px_minmax(0,1fr)] gap-3">
              <span>{c.kind === "new" ? <Tag tone="good">New</Tag> : c.kind === "changed" ? <Tag tone="warn">Changed</Tag> : <Tag tone="bad">Not found</Tag>}</span>
              <span className={c.kind === "not_found" ? "text-muted" : ""}>
                {c.text}
                {c.was && <span className="block text-[13px] text-muted line-through">{c.was}</span>}
              </span>
            </li>
          ))}
          {changes.length > 12 && <li className={ui.meta}>+ {changes.length - 12} more, marked in the list below</li>}
        </ul>
      )}
      {summary.emptyTopics.length > 0 && <p className="mt-2 text-xs text-muted">Nothing found for: {summary.emptyTopics.map(topicLabel).join(", ")}.</p>}
      {older.length > 0 && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-muted">Earlier updates ({older.length})</summary>
          <ul className="mt-1 flex flex-col gap-1 text-[13px] text-muted">
            {older.map((r) => (
              <li key={r.id}>
                <LocalTime iso={r.at} />: {r.summary.new} new, {r.summary.changed} changed, {r.summary.notFound} not found
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/**
 * Which studies read with these facts. A study applies new facts only when you re-analyze it from its own page, so
 * nothing here spends money on studies you aren't looking at (D47).
 */
function UsedBy({ users }: { users: FamilyStudy[] }) {
  const behind = users.filter((u) => u.notUsed > 0);
  const n = (k: number) => (k === 1 ? "1 study" : `${k} studies`);
  return (
    <div className={behind.length ? ui.noticeInfo : "text-[13px] text-muted"}>
      <span className="min-w-56 flex-1">
        <b className="font-semibold">Used by {n(users.length)}.</b>{" "}
        {behind.length === 0 ? (
          "All of them read with the latest facts."
        ) : (
          <>
            {behind.length === 1 ? "1 doesn't" : `${behind.length} don't`} use the latest facts yet; re-analyze from the study&apos;s page:{" "}
            {behind.slice(0, 3).map((u, i) => (
              <span key={u.id}>
                {i > 0 && ", "}
                <Link href={`/searches/${u.id}`} className={ui.link}>
                  {u.title} →
                </Link>
              </span>
            ))}
            {behind.length > 3 && ` and ${behind.length - 3} more`}
          </>
        )}
      </span>
    </div>
  );
}
