"use client";

import { useState, type KeyboardEvent } from "react";

import type { TreeNode } from "@/lib/catalog";
import type { Source } from "@/lib/catalog-reference";
import type { Proposal, Unlisted as Unverified } from "@/lib/catalogs";

import { ui } from "../../ui";

export type ReferenceSource = Source & { page: string | null };

export interface ReferenceInfo {
  checkedAt: string;
  /** Sources and notes per node, by normalized node name. */
  sources: Record<string, ReferenceSource[]>;
  notes: Record<string, string>;
}

const select = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";
export const short = (name: string) => name.replace(/^HP\s+/i, "");
export const nodeKey = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[-_/]+/g, " ").replace(/\s+/g, " ").trim();

/** The names Pulse matches for a model: stored ones (removable), a box to add one, and what's matched automatically. */
export function Names(props: { names: string[]; automatic: string[]; pending: boolean; onAdd: (n: string) => void; onRemove: (n: string) => void }) {
  const [input, setInput] = useState("");
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && input.trim()) {
      e.preventDefault();
      props.onAdd(input.trim());
      setInput("");
    }
  }
  return (
    <div className="flex flex-col gap-2 text-sm">
      <span className="font-medium">Names people use</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {props.names.map((n) => (
          <span key={n} className="inline-flex items-center gap-1 rounded-full bg-border/60 py-0.5 pr-1 pl-2.5">
            {n}
            <button type="button" disabled={props.pending} aria-label={`Remove ${n}`} onClick={() => props.onRemove(n)} className="rounded-full px-1 text-muted hover:text-foreground">
              ×
            </button>
          </span>
        ))}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          disabled={props.pending}
          placeholder="Add a name… (Enter)"
          aria-label="Add a name people use"
          className="min-w-44 flex-1 rounded-md border border-border bg-background px-2 py-1"
        />
      </div>
      {props.automatic.length > 0 && (
        <p className="text-xs text-muted">Also recognised automatically, in any capitalisation: {props.automatic.join(", ")}.</p>
      )}
    </div>
  );
}

export function Retired({ items, pending, onRestore, label }: { items: TreeNode[]; pending: boolean; onRestore: (id: number) => void; label: string }) {
  if (items.length === 0) return null;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted">
        Retired {label} ({items.length}): hidden from pickers and new reports
      </summary>
      <ul className="mt-2 flex flex-col gap-1">
        {items.map((n) => (
          <li key={n.id} className="flex items-center justify-between gap-3 px-2">
            <span className="text-muted">{short(n.name)}</span>
            <button type="button" disabled={pending} onClick={() => onRestore(n.id!)} className={ui.plainSm}>
              Restore
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Where a product was verified: HP's readable support page and the data it came from, plus sale notes. */
export function SourceLine({ sources, note }: { sources?: ReferenceSource[]; note?: string }) {
  if (!sources?.length) return null;
  const host = (url: string) => new URL(url).hostname.replace(/^www\./, "");
  const pages = [...new Set(sources.map((s) => s.page).filter((p): p is string => p !== null))];
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
      <span>✓ Verified:</span>
      {pages.map((p) => (
        <a key={p} href={p} target="_blank" rel="noreferrer noopener" className="underline hover:text-accent">
          HP support page ↗
        </a>
      ))}
      {sources
        .filter((s, i, all) => !s.page && all.findIndex((o) => !o.page && host(o.url) === host(s.url)) === i)
        .map((s) => (
          <a key={s.url} href={s.url} target="_blank" rel="noreferrer noopener" title={`“${s.quote}”`} className="underline hover:text-accent">
            {host(s.url)} ↗
          </a>
        ))}
      {note && <span>· {note}</span>}
    </p>
  );
}

/** A one-line form under the pickers to add a family, series or model by hand. */
export function AddForm(props: { kind: "series" | "model"; seriesName: string; pending: boolean; onAdd: (name: string, number: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const label = props.kind === "series" ? "New series" : `New model in ${props.seriesName}`;
  const hint = props.kind === "series" ? "e.g. HP Smart Tank 8000 series" : "e.g. HP Smart Tank 8001";
  return (
    <form
      className="flex flex-wrap items-end gap-2 border-t border-border px-4 py-4 sm:px-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) props.onAdd(name, number);
      }}
    >
      <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm">
        {label}
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={hint} className={select} />
      </label>
      {props.kind === "model" && (
        <label className="flex w-32 flex-col gap-1 text-sm">
          Model number
          <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="8001" className={select} />
        </label>
      )}
      <button type="submit" disabled={props.pending || !name.trim()} className={ui.primarySm}>
        Add
      </button>
      <button type="button" onClick={props.onCancel} className={ui.plainSm}>
        Cancel
      </button>
    </form>
  );
}

/**
 * One card for everything that needs a decision: new products Pulse found (Add or Skip) and products HP's verified
 * list doesn't have (Keep or Remove). Nothing here is used until you add or keep it.
 */
export function Review(props: {
  proposals: Proposal[];
  unverified: Unverified[];
  series: TreeNode[];
  pending: boolean;
  onAdd: (p: Proposal, name: string, seriesId: number | null) => void;
  onSkip: (p: Proposal) => void;
  onKeep: (n: Unverified) => void;
  onRemove: (n: Unverified) => void;
}) {
  const waitingOn = new Map(props.proposals.filter((p) => p.level === "series").map((p) => [p.id, p.name]));
  const n = props.proposals.length;
  return (
    <section aria-labelledby="review-heading" className="flex flex-col gap-3 rounded-xl border border-warning/60 bg-warning/5 p-4 sm:p-5">
      <h2 id="review-heading" className="text-lg font-medium">
        {n > 0 ? `${n} new ${n === 1 ? "product" : "products"} found` : "Check these products"}
      </h2>
      {n > 0 && (
        <>
          <p className="-mt-2 text-sm text-muted">Add the ones that are real products. Skipped ones aren&apos;t suggested again.</p>
          <ul className="flex flex-col divide-y divide-border">
            {props.proposals.map((p) => (
              <ProposalRow
                key={p.id}
                p={p}
                series={props.series}
                waitingOn={p.parentId !== null ? waitingOn.get(p.parentId) : undefined}
                pending={props.pending}
                onAdd={props.onAdd}
                onSkip={props.onSkip}
              />
            ))}
          </ul>
        </>
      )}
      {props.unverified.length > 0 && (
        <>
          <h3 className="text-sm font-medium">Not in the verified list ({props.unverified.length})</h3>
          <p className="-mt-2 text-sm text-muted">Keep it if you know it&apos;s real; Remove retires it (past posts stay linked).</p>
          <ul className="flex flex-col divide-y divide-border">
            {props.unverified.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="rounded-full bg-border/60 px-2 py-0.5 text-xs">{u.level}</span>
                <span className="flex-1">{short(u.name)}</span>
                <button type="button" disabled={props.pending} onClick={() => props.onKeep(u)} className={ui.secondarySm}>
                  Keep
                </button>
                {u.holdsListed ? (
                  <span className="px-2 py-1 text-xs text-muted" title="It holds models from HP's verified list">
                    holds HP models
                  </span>
                ) : (
                  <button type="button" disabled={props.pending} onClick={() => props.onRemove(u)} className={ui.plainSm}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function ProposalRow(props: {
  p: Proposal;
  series: TreeNode[];
  waitingOn?: string;
  pending: boolean;
  onAdd: (p: Proposal, name: string, seriesId: number | null) => void;
  onSkip: (p: Proposal) => void;
}) {
  const { p } = props;
  const [name, setName] = useState(p.name);
  const [seriesId, setSeriesId] = useState<number | "">(p.parentId !== null && props.series.some((s) => s.id === p.parentId) ? p.parentId : "");
  const ev = p.evidence;
  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-border/60 px-2 py-0.5 text-xs">{p.level}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" className="min-w-40 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm" />
        {p.level === "model" &&
          (props.waitingOn ? (
            <span className="text-xs text-muted">in {short(props.waitingOn)} (add the series first)</span>
          ) : (
            <select
              value={seriesId}
              onChange={(e) => setSeriesId(e.target.value ? Number(e.target.value) : "")}
              aria-label="Series"
              className="max-w-56 rounded-md border border-border bg-background px-2 py-1 text-sm"
            >
              <option value="">Choose series…</option>
              {props.series.map((s) => (
                <option key={s.id} value={s.id!}>
                  {short(s.name)}
                </option>
              ))}
            </select>
          ))}
        <button
          type="button"
          disabled={props.pending || !name.trim() || (p.level === "model" && (seriesId === "" || !!props.waitingOn))}
          onClick={() => props.onAdd(p, name, seriesId === "" ? null : seriesId)}
          className={ui.primarySm}
        >
          Add
        </button>
        <button type="button" disabled={props.pending} onClick={() => props.onSkip(p)} className={ui.plainSm}>
          Skip
        </button>
      </div>
      {ev?.source === "reference" && (
        <p className="text-xs text-muted">
          In HP&apos;s verified list
          {ev.url && (
            <>
              {" · "}
              <a href={ev.url} target="_blank" rel="noreferrer noopener" className="underline">
                source ↗
              </a>
            </>
          )}
        </p>
      )}
      {ev?.source === "posts" && (
        <div className="text-xs text-muted">
          Named in {ev.posts} collected posts. Not verified by HP.
          {ev.examples?.map((x) => (
            <p key={x} className="mt-1 italic">
              “{x}”
            </p>
          ))}
        </div>
      )}
    </li>
  );
}
