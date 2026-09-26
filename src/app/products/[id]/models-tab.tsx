"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { automaticVariants, type TreeNode } from "@/lib/catalog";
import type { Proposal, Unlisted } from "@/lib/catalogs";

import {
  addNameAction,
  addProductAction,
  approveProposalAction,
  keepAction,
  rejectProposalAction,
  removeNameAction,
  removeUnlistedAction,
  setRetiredAction,
} from "../../catalogs/actions";
import { ui } from "../../ui";
import { AddForm, Names, nodeKey, Retired, Review, short, SourceLine, type ReferenceInfo } from "./catalog-parts";

interface Props {
  catalogId: number;
  tree: TreeNode;
  byNode: Record<number, number>;
  bySeries: Record<number, number>;
  reference: ReferenceInfo | null;
  proposals: Proposal[];
  unverified: Unlisted[];
}

const matches = (q: string, ...names: string[]) => names.some((n) => nodeKey(n).includes(q));

/**
 * The family's series and models as one list, most discussed first, with post counts. A series opens to its models;
 * ⋯ on a row opens its details (other names people use, where it was verified, retire). New products Pulse found
 * wait in a review card above the list. Every action saves straight away.
 */
export function ModelsTab({ catalogId, tree, byNode, bySeries, reference, proposals, unverified }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [details, setDetails] = useState<number | null>(null);
  const [adding, setAdding] = useState<{ kind: "series" | "model"; seriesId: number | null } | null>(null);

  const q = nodeKey(query);
  const active = useMemo(
    () => tree.children.filter((s) => !s.retired && s.id !== null).sort((a, b) => (bySeries[b.id!] ?? 0) - (bySeries[a.id!] ?? 0) || a.name.localeCompare(b.name, "en", { numeric: true })),
    [tree, bySeries],
  );
  const shown = q ? active.filter((s) => matches(q, s.name, ...s.children.map((m) => m.name))) : active;
  const max = Math.max(1, ...active.map((s) => bySeries[s.id!] ?? 0));

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    setNote(null);
    startTransition(async () => {
      const r = await action();
      setNote({ ok: r.ok, text: r.message });
      if (r.ok) router.refresh();
    });
  }
  const toggle = (id: number) => setOpen((s) => new Set(s.has(id) ? [...s].filter((x) => x !== id) : [...s, id]));

  return (
    <div className="flex flex-col">
      {(proposals.length > 0 || unverified.length > 0) && (
        <div className="px-4 pt-5 sm:px-6">
          <Review
            proposals={proposals}
            unverified={unverified}
            series={active}
            pending={pending}
            onAdd={(p, name, seriesId) => run(() => approveProposalAction(catalogId, p.id, name, seriesId))}
            onSkip={(p) => run(() => rejectProposalAction(catalogId, p.id))}
            onKeep={(n) => run(() => keepAction(catalogId, n.id))}
            onRemove={(n) => run(() => removeUnlistedAction(catalogId, n.id))}
          />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a series or model…" aria-label="Find a series or model" className={`${ui.input} max-w-md flex-1`} />
        <button type="button" onClick={() => setAdding({ kind: "series", seriesId: null })} className={ui.plainSm}>
          + Add series
        </button>
      </div>
      {note && (
        <p role="status" className={`px-4 pb-3 text-sm sm:px-6 ${note.ok ? "text-muted" : "text-critical"}`}>
          {note.text}
        </p>
      )}
      {adding?.kind === "series" && (
        <AddForm kind="series" seriesName="" pending={pending} onCancel={() => setAdding(null)} onAdd={(name, number) => (run(() => addProductAction(catalogId, "series", name, null, number)), setAdding(null))} />
      )}

      <div className="hidden grid-cols-[minmax(0,1fr)_110px_120px_44px_32px] gap-3 border-t border-border px-6 py-2 text-[11px] font-bold tracking-wider text-muted uppercase sm:grid">
        <span>Series · most discussed first</span>
        <span>Models</span>
        <span>Posts</span>
        <span />
        <span />
      </div>
      {shown.length === 0 && (
        <p className="border-t border-border px-6 py-8 text-center text-sm text-muted">{active.length === 0 ? "No series yet. Add one, or check for new models." : "Nothing matches."}</p>
      )}
      <ul>
        {shown.map((s) => {
          const models = s.children.filter((m) => !m.retired && m.id !== null && (!q || matches(q, m.name, s.name)));
          const expanded = open.has(s.id!) || (q.length > 0 && models.length > 0);
          const posts = bySeries[s.id!] ?? 0;
          return (
            <li key={s.id} className="border-t border-border">
              <Row
                name={short(s.name)}
                strong
                count={((n) => `${n} ${n === 1 ? "model" : "models"}`)(s.children.filter((m) => !m.retired).length)}
                posts={posts}
                max={max}
                expanded={expanded}
                onToggle={() => toggle(s.id!)}
                onMore={() => setDetails(details === s.id ? null : s.id!)}
              />
              {details === s.id && (
                <Details>
                  <SourceLine sources={reference?.sources[nodeKey(s.name)]} />
                  <Retired items={s.children.filter((m) => m.retired)} pending={pending} onRestore={(id) => run(() => setRetiredAction(catalogId, id, false))} label="models" />
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={ui.plainSm} onClick={() => setAdding({ kind: "model", seriesId: s.id })}>
                      + Add a model
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      className={ui.plainSm}
                      onClick={() => window.confirm(`Retire ${short(s.name)} and all its models? They leave the lists and new reports; past posts stay linked.`) && run(() => setRetiredAction(catalogId, s.id!, true))}
                    >
                      Retire series
                    </button>
                  </div>
                </Details>
              )}
              {adding?.kind === "model" && adding.seriesId === s.id && (
                <AddForm kind="model" seriesName={short(s.name)} pending={pending} onCancel={() => setAdding(null)} onAdd={(name, number) => (run(() => addProductAction(catalogId, "model", name, s.id, number)), setAdding(null))} />
              )}
              {expanded && (
                <ul>
                  {models.map((m) => (
                    <li key={m.id}>
                      <Row name={short(m.name)} posts={byNode[m.id!] ?? 0} max={max} onMore={() => setDetails(details === m.id ? null : m.id!)} indent />
                      {details === m.id && (
                        <Details>
                          <SourceLine sources={reference?.sources[nodeKey(m.name)]} note={reference?.notes[nodeKey(m.name)]} />
                          <Names
                            names={m.aliases}
                            automatic={automaticVariants(m, tree)}
                            pending={pending}
                            onAdd={(name) => run(() => addNameAction(catalogId, m.id!, name))}
                            onRemove={(name) => run(() => removeNameAction(catalogId, m.id!, name))}
                          />
                          <div>
                            <button
                              type="button"
                              disabled={pending}
                              className={ui.plainSm}
                              onClick={() => window.confirm(`Retire ${short(m.name)}? It leaves the lists and new reports; past posts stay linked.`) && run(() => setRetiredAction(catalogId, m.id!, true))}
                            >
                              Retire model
                            </button>
                          </div>
                        </Details>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <div className="border-t border-border px-4 py-4 sm:px-6">
        <Retired items={tree.children.filter((s) => s.retired)} pending={pending} onRestore={(id) => run(() => setRetiredAction(catalogId, id, false))} label="series" />
      </div>
    </div>
  );
}

function Row(props: { name: string; strong?: boolean; count?: string; posts: number; max: number; expanded?: boolean; onToggle?: () => void; onMore: () => void; indent?: boolean }) {
  const label = (
    <span className={`min-w-0 truncate ${props.strong ? "font-semibold" : ""}`}>
      {props.onToggle && <span className="mr-2 inline-block w-3 text-muted">{props.expanded ? "▾" : "▸"}</span>}
      {props.name}
    </span>
  );
  return (
    <div className={`grid min-h-12 grid-cols-[minmax(0,1fr)_44px_32px] items-center gap-3 px-4 py-1.5 sm:grid-cols-[minmax(0,1fr)_110px_120px_44px_32px] sm:px-6 ${props.indent ? "pl-10 sm:pl-12" : ""}`}>
      {props.onToggle ? (
        <button type="button" onClick={props.onToggle} aria-expanded={props.expanded} className="flex min-w-0 items-center text-left">
          {label}
        </button>
      ) : (
        label
      )}
      <span className="hidden text-xs text-muted sm:block">{props.count ?? ""}</span>
      <span className="hidden h-1.5 overflow-hidden rounded-full bg-border sm:block" aria-hidden>
        <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.round((props.posts / props.max) * 100)}%` }} />
      </span>
      <span className="text-right text-[13px] text-muted tabular-nums">{props.posts}</span>
      <button type="button" onClick={props.onMore} aria-label={`More about ${props.name}`} className={ui.icon}>
        ⋯
      </button>
    </div>
  );
}

function Details({ children }: { children: React.ReactNode }) {
  return <div className="mx-4 mb-3 flex flex-col gap-3 rounded-xl border border-border bg-surface-2 p-4 sm:mx-6">{children}</div>;
}
