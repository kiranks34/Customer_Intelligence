"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type KeyboardEvent, type ReactNode } from "react";

import { automaticVariants, type TreeNode } from "@/lib/catalog";
import type { Source } from "@/lib/catalog-reference";
import type { Proposal } from "@/lib/catalogs";

import {
  addFamilyAction,
  addNameAction,
  addProductAction,
  applyReferenceAction,
  approveCatalogAction,
  approveProposalAction,
  rejectProposalAction,
  removeNameAction,
  setRetiredAction,
  updateCatalogAction,
} from "../actions";

export type ReferenceSource = Source & { page: string | null };

export interface ReferenceInfo {
  checkedAt: string;
  /** Sources and notes per node, by normalized node name. */
  sources: Record<string, ReferenceSource[]>;
  notes: Record<string, string>;
}

interface Props {
  catalogId: number;
  tree: TreeNode;
  status: "draft" | "approved";
  /** Posts per node (most specific) and per series (series or any of its models), counted in SQL. */
  byNode: Record<number, number>;
  bySeries: Record<number, number>;
  reference: ReferenceInfo | null;
  /** Every family (one catalog each), for the Family picker. */
  families: { id: number; name: string }[];
  /** Additions waiting for your approval (from "Update product catalog"). */
  proposals: Proposal[];
}

const ADD = "__add";
type Adding = null | "family" | "series" | "model";

const select = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";
const short = (name: string) => name.replace(/^HP\s+/i, "");
const key = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[-_/]+/g, " ").replace(/\s+/g, " ").trim();
const numberOf = (m: TreeNode) => Number(m.aliases.find((a) => /^\d{3,4}/.test(a))?.match(/^\d+/)?.[0] ?? Infinity);

/**
 * The product catalog as three pickers (family → series → model) and one card for what's picked. Name variants
 * and merges are handled by Pulse; here you only add a name it doesn't know yet, retire what's no longer sold,
 * and approve. Every action saves straight away.
 */
export function CatalogBrowser({ catalogId, tree, status, byNode, bySeries, reference, families, proposals }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const activeSeries = useMemo(
    () => tree.children.filter((s) => !s.retired && s.id !== null).sort((a, b) => (bySeries[b.id!] ?? 0) - (bySeries[a.id!] ?? 0) || a.name.localeCompare(b.name)),
    [tree, bySeries],
  );
  const retiredSeries = tree.children.filter((s) => s.retired);
  const [seriesId, setSeriesId] = useState<number | null>(activeSeries[0]?.id ?? null);
  const [modelId, setModelId] = useState<number | "all">("all");
  const [adding, setAdding] = useState<Adding>(null);

  // A retired series or model drops out of the pickers, so the selection falls back to what's still active.
  const series = activeSeries.find((s) => s.id === seriesId) ?? activeSeries[0] ?? null;
  const models = (series?.children ?? []).filter((m) => !m.retired).sort((a, b) => numberOf(a) - numberOf(b) || a.name.localeCompare(b.name));
  const retiredModels = (series?.children ?? []).filter((m) => m.retired);
  const model = modelId === "all" ? null : (models.find((m) => m.id === modelId) ?? null);
  const maxModel = Math.max(1, ...models.map((m) => byNode[m.id!] ?? 0));

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    setNote(null);
    startTransition(async () => {
      const r = await action();
      setNote({ ok: r.ok, text: r.message });
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        {status === "approved" ? (
          <span className="rounded-full bg-accent/15 px-3 py-1 text-sm font-medium text-accent">Approved</span>
        ) : (
          <>
            <span className="rounded-full bg-warning/20 px-3 py-1 text-sm font-medium">Draft</span>
            <button type="button" disabled={pending} onClick={() => run(() => approveCatalogAction(catalogId))} className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-60">
              Approve catalog
            </button>
          </>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => updateCatalogAction(catalogId))}
          className="rounded-lg border border-border px-4 py-1.5 text-sm font-medium hover:border-accent disabled:opacity-60"
          title="Look for series and models the catalog is missing, in HP's verified list and in your collected posts"
        >
          {pending ? "Working…" : "Update product catalog"}
        </button>
        {reference && (
          <span className="text-sm text-muted">
            Verified against HP&apos;s own data on {reference.checkedAt} ·{" "}
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (window.confirm("Replace the catalog with HP's verified list? Links from posts to the same models are kept.")) run(() => applyReferenceAction(catalogId));
              }}
              className="underline hover:text-accent"
            >
              Update from verified sources
            </button>
          </span>
        )}
      </div>

      {note && (
        <p role="status" className={`-mt-3 text-sm ${note.ok ? "text-muted" : "text-critical"}`}>
          {note.text}
        </p>
      )}

      {proposals.length > 0 && (
        <Proposals
          proposals={proposals}
          series={activeSeries}
          pending={pending}
          onApprove={(p, name, seriesId) => run(() => approveProposalAction(catalogId, p.id, name, seriesId))}
          onReject={(p) => run(() => rejectProposalAction(catalogId, p.id))}
        />
      )}

      <section aria-label="Find a product" className="grid gap-3 rounded-xl border border-border bg-surface p-5 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          Family
          <select
            className={select}
            value={catalogId}
            onChange={(e) => {
              if (e.target.value === ADD) return setAdding("family");
              router.push(`/catalogs/${e.target.value}`);
            }}
          >
            {families.map((f) => (
              <option key={f.id} value={f.id}>
                {short(f.name)}
              </option>
            ))}
            <option value={ADD}>+ Add family…</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Series
          <select
            className={select}
            value={series?.id ?? ""}
            onChange={(e) => {
              if (e.target.value === ADD) return setAdding("series");
              setSeriesId(Number(e.target.value));
              setModelId("all");
            }}
          >
            {activeSeries.map((s) => (
              <option key={s.id} value={s.id!}>
                {short(s.name)} · {bySeries[s.id!] ?? 0} posts
              </option>
            ))}
            <option value={ADD}>+ Add series…</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Model
          <select className={select} value={model?.id ?? "all"} onChange={(e) => (e.target.value === ADD ? setAdding("model") : setModelId(e.target.value === "all" ? "all" : Number(e.target.value)))}>
            <option value="all">All models ({models.length})</option>
            {models.map((m) => (
              <option key={m.id} value={m.id!}>
                {short(m.name)} · {byNode[m.id!] ?? 0} posts
              </option>
            ))}
            {series && <option value={ADD}>+ Add model…</option>}
          </select>
        </label>
        {adding && (
          <AddForm
            kind={adding}
            seriesName={series ? short(series.name) : ""}
            pending={pending}
            onCancel={() => setAdding(null)}
            onAdd={(name, number) => {
              if (adding === "family") {
                setNote(null);
                startTransition(async () => {
                  const r = await addFamilyAction(name);
                  setNote({ ok: r.ok, text: r.message });
                  if (r.ok) router.push(`/catalogs/${r.catalogId}`);
                });
              } else {
                run(() => addProductAction(catalogId, adding, name, series?.id ?? null, number));
              }
              setAdding(null);
            }}
          />
        )}
      </section>

      {series && !model && (
        <Card
          title={short(series.name)}
          subtitle={`${bySeries[series.id!] ?? 0} posts name this series or one of its models`}
          sources={<SourceLine sources={reference?.sources[key(series.name)]} />}
        >
          <ul className="flex flex-col gap-1">
            {models.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => setModelId(m.id!)} className="grid w-full grid-cols-[minmax(0,1fr)_6rem_3rem] items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-border/40">
                  <span className="truncate">{short(m.name)}</span>
                  <span className="h-1.5 rounded-full bg-border">
                    <span className="block h-1.5 rounded-full bg-accent" style={{ width: `${((byNode[m.id!] ?? 0) / maxModel) * 100}%` }} />
                  </span>
                  <span className="text-right tabular-nums text-muted">{byNode[m.id!] ?? 0}</span>
                </button>
              </li>
            ))}
          </ul>
          <Retired items={retiredModels} pending={pending} onRestore={(id) => run(() => setRetiredAction(catalogId, id, false))} label="models" />
          <div className="flex justify-end border-t border-border pt-3">
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (window.confirm(`Retire ${short(series.name)} and all its models? They leave the pickers and new reports; past posts stay linked.`)) {
                  run(() => setRetiredAction(catalogId, series.id!, true));
                }
              }}
              className="text-sm text-muted underline hover:text-critical"
            >
              Retire this series
            </button>
          </div>
        </Card>
      )}

      {series && model && (
        <Card
          title={short(model.name)}
          subtitle={`${byNode[model.id!] ?? 0} posts name this model · ${short(series.name)}`}
          sources={<SourceLine sources={reference?.sources[key(model.name)]} note={reference?.notes[key(model.name)]} />}
        >
          <Names
            names={model.aliases}
            automatic={automaticVariants(model, tree)}
            pending={pending}
            onAdd={(name) => run(() => addNameAction(catalogId, model.id!, name))}
            onRemove={(name) => run(() => removeNameAction(catalogId, model.id!, name))}
          />
          <div className="flex justify-between gap-3 border-t border-border pt-3">
            <button type="button" onClick={() => setModelId("all")} className="text-sm text-muted underline">
              ← All models in {short(series.name)}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (window.confirm(`Retire ${short(model.name)}? It leaves the pickers and new reports; past posts stay linked.`)) run(() => setRetiredAction(catalogId, model.id!, true));
              }}
              className="text-sm text-muted underline hover:text-critical"
            >
              Retire this model
            </button>
          </div>
        </Card>
      )}

      <Retired items={retiredSeries} pending={pending} onRestore={(id) => run(() => setRetiredAction(catalogId, id, false))} label="series" />
    </div>
  );
}

function Card({ title, subtitle, sources, children }: { title: string; subtitle: string; sources: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-medium">{title}</h2>
        <p className="text-sm text-muted">{subtitle}</p>
        {sources}
      </div>
      {children}
    </section>
  );
}

/** The names Pulse matches for a model: stored ones (removable), a box to add one, and what's matched automatically. */
function Names(props: { names: string[]; automatic: string[]; pending: boolean; onAdd: (n: string) => void; onRemove: (n: string) => void }) {
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

function Retired({ items, pending, onRestore, label }: { items: TreeNode[]; pending: boolean; onRestore: (id: number) => void; label: string }) {
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
            <button type="button" disabled={pending} onClick={() => onRestore(n.id!)} className="text-accent underline">
              Restore
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Where a product was verified: HP's readable support page and the data it came from, plus sale notes. */
function SourceLine({ sources, note }: { sources?: ReferenceSource[]; note?: string }) {
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
function AddForm(props: { kind: "family" | "series" | "model"; seriesName: string; pending: boolean; onAdd: (name: string, number: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const label = props.kind === "family" ? "New family" : props.kind === "series" ? "New series" : `New model in ${props.seriesName}`;
  const hint = props.kind === "family" ? "e.g. HP DeskJet" : props.kind === "series" ? "e.g. HP Smart Tank 8000 series" : "e.g. HP Smart Tank 8001";
  return (
    <form
      className="flex flex-wrap items-end gap-2 border-t border-border pt-3 sm:col-span-3"
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
      <button type="submit" disabled={props.pending || !name.trim()} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
        Add
      </button>
      <button type="button" onClick={props.onCancel} className="px-2 py-2 text-sm text-muted underline">
        Cancel
      </button>
    </form>
  );
}

/** Additions found by "Update product catalog", each with its evidence, waiting for approve or reject. */
function Proposals(props: {
  proposals: Proposal[];
  series: TreeNode[];
  pending: boolean;
  onApprove: (p: Proposal, name: string, seriesId: number | null) => void;
  onReject: (p: Proposal) => void;
}) {
  const proposedSeries = props.proposals.filter((p) => p.level === "series");
  const waitingOn = new Map(proposedSeries.map((p) => [p.id, p.name]));
  return (
    <section aria-labelledby="review-heading" className="flex flex-col gap-3 rounded-xl border border-warning/60 bg-warning/5 p-5">
      <h2 id="review-heading" className="text-lg font-medium">
        To review ({props.proposals.length})
      </h2>
      <p className="-mt-2 text-sm text-muted">Found by “Update product catalog”. Nothing is used until you approve it; rejected items aren&apos;t proposed again.</p>
      <ul className="flex flex-col divide-y divide-border">
        {props.proposals.map((p) => (
          <ProposalRow
            key={p.id}
            p={p}
            series={props.series}
            waitingOn={p.parentId !== null ? waitingOn.get(p.parentId) : undefined}
            pending={props.pending}
            onApprove={props.onApprove}
            onReject={props.onReject}
          />
        ))}
      </ul>
    </section>
  );
}

function ProposalRow(props: {
  p: Proposal;
  series: TreeNode[];
  waitingOn?: string;
  pending: boolean;
  onApprove: (p: Proposal, name: string, seriesId: number | null) => void;
  onReject: (p: Proposal) => void;
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
            <span className="text-xs text-muted">in {short(props.waitingOn)} (approve the series first)</span>
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
          onClick={() => props.onApprove(p, name, seriesId === "" ? null : seriesId)}
          className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
        >
          Approve
        </button>
        <button type="button" disabled={props.pending} onClick={() => props.onReject(p)} className="px-2 py-1 text-sm text-muted underline hover:text-critical">
          Reject
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
