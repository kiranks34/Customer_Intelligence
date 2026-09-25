"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type KeyboardEvent, type ReactNode } from "react";

import { automaticVariants, type TreeNode } from "@/lib/catalog";
import type { Source } from "@/lib/catalog-reference";
import type { Proposal, Unlisted as Unverified } from "@/lib/catalogs";

import { defaultPick, FamilyTabs, ProductLists, type ListFamily, type Pick } from "../../product-lists";

import {
  addFamilyAction,
  addNameAction,
  addProductAction,
  approveProposalAction,
  keepAction,
  rejectProposalAction,
  removeUnlistedAction,
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
  /** Posts per node (most specific) and per series (series or any of its models), counted in SQL. */
  byNode: Record<number, number>;
  bySeries: Record<number, number>;
  /** Posts that name any series or model of the family. */
  familyPosts: number;
  reference: ReferenceInfo | null;
  /** Every family (one catalog each), for the Family picker. */
  families: { id: number; name: string }[];
  /** New products found after a collection or by "Check for new models", waiting for Add or Skip. */
  proposals: Proposal[];
  /** Products in the catalog that HP's verified list doesn't have (e.g. from an old AI draft), waiting for Keep or Remove. */
  unverified: Unverified[];
}

type Adding = null | "series" | "model";

const select = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";
const short = (name: string) => name.replace(/^HP\s+/i, "");
const key = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[-_/]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * The product catalog: family tabs, the same series and model lists as the home page, and one card for what's
 * picked. Name variants and merges are handled by Pulse; here you only add a name it doesn't know yet, retire what's
 * no longer sold, and add or skip new products Pulse found. Every action saves straight away.
 */
export function CatalogBrowser({ catalogId, tree, byNode, bySeries, familyPosts, reference, families, proposals, unverified }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [adding, setAdding] = useState<Adding>(null);

  const list: ListFamily = useMemo(
    () => ({
      id: catalogId,
      name: tree.name,
      posts: familyPosts,
      waiting: proposals.length,
      series: tree.children
        .filter((s) => !s.retired && s.id !== null)
        .map((s) => ({
          id: s.id!,
          name: s.name,
          posts: bySeries[s.id!] ?? 0,
          models: s.children.filter((m) => !m.retired && m.id !== null).map((m) => ({ id: m.id!, name: m.name, posts: byNode[m.id!] ?? 0 })),
        })),
    }),
    [catalogId, tree, byNode, bySeries, familyPosts, proposals.length],
  );
  const activeSeries = tree.children.filter((s) => !s.retired && s.id !== null);
  const retiredSeries = tree.children.filter((s) => s.retired);
  const [chosen, setPick] = useState<Pick>(() => defaultPick(list));
  // A retired series or model drops out of the lists, so the pick falls back to what's still active.
  const series = activeSeries.find((s) => s.id === chosen.seriesId) ?? null;
  const model = series?.children.find((m) => m.id === chosen.modelId && !m.retired) ?? null;
  const pick: Pick = { seriesId: series?.id ?? null, modelId: model?.id ?? null };
  const retiredModels = (series?.children ?? []).filter((m) => m.retired);

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    setNote(null);
    startTransition(async () => {
      const r = await action();
      setNote({ ok: r.ok, text: r.message });
      if (r.ok) router.refresh();
    });
  }

  function addFamily(name: string) {
    setNote(null);
    startTransition(async () => {
      const r = await addFamilyAction(name);
      setNote({ ok: r.ok, text: r.message });
      if (r.ok) router.push(`/catalogs/${r.catalogId}`);
    });
  }

  const addLink = (what: "series" | "model") => (
    <button type="button" onClick={() => setAdding(what)} className="font-medium text-accent hover:underline">
      + Add {what}
    </button>
  );

  return (
    <div className="flex flex-col gap-6">
      {(proposals.length > 0 || unverified.length > 0) && (
        <Review
          proposals={proposals}
          unverified={unverified}
          series={activeSeries}
          pending={pending}
          onAdd={(p, name, seriesId) => run(() => approveProposalAction(catalogId, p.id, name, seriesId))}
          onSkip={(p) => run(() => rejectProposalAction(catalogId, p.id))}
          onKeep={(n) => run(() => keepAction(catalogId, n.id))}
          onRemove={(n) => run(() => removeUnlistedAction(catalogId, n.id))}
        />
      )}

      <section aria-label="Products" className="overflow-hidden rounded-xl border border-border bg-surface">
        <FamilyTabs
          families={families}
          selected={catalogId}
          onSelect={(id) => id !== catalogId && router.push(`/catalogs/${id}`)}
          onAddFamily={addFamily}
          pending={pending}
          right={
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => updateCatalogAction(catalogId))}
              className="font-medium text-accent hover:underline disabled:opacity-60"
              title="Look for series and models this catalog is missing, in HP's verified list and in your collected posts"
            >
              {pending ? "Checking…" : "Check for new models"}
            </button>
          }
        />
        {note && (
          <p role="status" className={`px-5 pt-3 text-sm ${note.ok ? "text-muted" : "text-critical"}`}>
            {note.text}
          </p>
        )}
        <ProductLists
          family={list}
          pick={pick}
          onPick={(p) => {
            setPick(p);
            setAdding(null);
          }}
          seriesAction={addLink("series")}
          modelAction={series ? addLink("model") : undefined}
          modelHint=""
        />
        {adding && (
          <AddForm
            kind={adding}
            seriesName={series ? short(series.name) : ""}
            pending={pending}
            onCancel={() => setAdding(null)}
            onAdd={(name, number) => {
              run(() => addProductAction(catalogId, adding, name, series?.id ?? null, number));
              setAdding(null);
            }}
          />
        )}
      </section>

      {series && !model && (
        <Card
          title={short(series.name)}
          subtitle={`${(bySeries[series.id!] ?? 0).toLocaleString()} posts collected name this series or one of its models`}
          sources={<SourceLine sources={reference?.sources[key(series.name)]} />}
        >
          <Retired items={retiredModels} pending={pending} onRestore={(id) => run(() => setRetiredAction(catalogId, id, false))} label="models" />
          <div className="flex justify-end border-t border-border pt-3">
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (window.confirm(`Retire ${short(series.name)} and all its models? They leave the lists and new reports; past posts stay linked.`)) {
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
          subtitle={`${(byNode[model.id!] ?? 0).toLocaleString()} posts collected name this model · ${short(series.name)}`}
          sources={<SourceLine sources={reference?.sources[key(model.name)]} note={reference?.notes[key(model.name)]} />}
        >
          <Names
            names={model.aliases}
            automatic={automaticVariants(model, tree)}
            pending={pending}
            onAdd={(name) => run(() => addNameAction(catalogId, model.id!, name))}
            onRemove={(name) => run(() => removeNameAction(catalogId, model.id!, name))}
          />
          <div className="flex justify-end border-t border-border pt-3">
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (window.confirm(`Retire ${short(model.name)}? It leaves the lists and new reports; past posts stay linked.`)) run(() => setRetiredAction(catalogId, model.id!, true));
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
function AddForm(props: { kind: "series" | "model"; seriesName: string; pending: boolean; onAdd: (name: string, number: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const label = props.kind === "series" ? "New series" : `New model in ${props.seriesName}`;
  const hint = props.kind === "series" ? "e.g. HP Smart Tank 8000 series" : "e.g. HP Smart Tank 8001";
  return (
    <form
      className="flex flex-wrap items-end gap-2 border-t border-border px-5 py-4"
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

/**
 * One card for everything that needs a decision: new products Pulse found (Add or Skip) and products HP's verified
 * list doesn't have (Keep or Remove). Nothing here is used until you add or keep it.
 */
function Review(props: {
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
    <section aria-labelledby="review-heading" className="flex flex-col gap-3 rounded-xl border border-warning/60 bg-warning/5 p-5">
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
          <h3 className="text-sm font-medium">Not in HP&apos;s verified list ({props.unverified.length})</h3>
          <p className="-mt-2 text-sm text-muted">Keep it if you know it&apos;s real; Remove retires it (past posts stay linked).</p>
          <ul className="flex flex-col divide-y divide-border">
            {props.unverified.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="rounded-full bg-border/60 px-2 py-0.5 text-xs">{u.level}</span>
                <span className="flex-1">{short(u.name)}</span>
                <button type="button" disabled={props.pending} onClick={() => props.onKeep(u)} className="rounded-md border border-border px-3 py-1 font-medium hover:border-accent disabled:opacity-50">
                  Keep
                </button>
                {u.holdsListed ? (
                  <span className="px-2 py-1 text-xs text-muted" title="It holds models from HP's verified list">
                    holds HP models
                  </span>
                ) : (
                  <button type="button" disabled={props.pending} onClick={() => props.onRemove(u)} className="px-2 py-1 text-muted underline hover:text-critical">
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
          className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
        >
          Add
        </button>
        <button type="button" disabled={props.pending} onClick={() => props.onSkip(p)} className="px-2 py-1 text-sm text-muted underline hover:text-critical">
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
