"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { CATALOG_LIMITS, mergeModel, modelFromMention, normalize, type Mention, type ModelPath, type TreeNode } from "@/lib/catalog";

import { ChipField } from "../../chip-field";
import { saveCatalogAction } from "../actions";

interface Props {
  catalogId: number;
  tree: TreeNode;
  status: "draft" | "approved";
  /** Posts per saved node id (counted in SQL). */
  counts: Record<number, number>;
  posts: number;
  uncovered: Mention[];
}

const input = "rounded-md border border-border bg-background px-2 py-1.5 text-sm";

/**
 * Review screen for a product catalog: the family → series → model tree with how many posts name each one.
 * Everything is edited in place; Save re-links posts to the models, Approve also marks the catalog reviewed.
 */
export function CatalogEditor({ catalogId, tree, status, counts, posts, uncovered }: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState(tree);
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [addTo, setAddTo] = useState(0);
  const dirty = JSON.stringify(draft) !== JSON.stringify(tree);

  const maxCount = Math.max(1, ...Object.values(counts));
  const count = (n: TreeNode) => (n.id !== null ? (counts[n.id] ?? 0) : null);
  const top = useMemo(
    () =>
      draft.children
        .flatMap((s) => s.children.map((m) => ({ name: m.name, n: m.id !== null ? (counts[m.id] ?? 0) : 0 })))
        .filter((m) => m.n > 0)
        .sort((a, b) => b.n - a.n)
        .slice(0, 10),
    [draft, counts],
  );
  // Suggestions already added in this session (named like the mention) disappear right away.
  const names = new Set(draft.children.flatMap((s) => s.children.flatMap((m) => [m.name, ...m.aliases].map(normalize))));
  const suggestions = uncovered.filter((m) => !names.has(normalize(m.text)));
  const models = draft.children.flatMap((s, si) => s.children.map((m, mi) => ({ label: `${m.name} (${s.name})`, path: [si, mi] as ModelPath })));

  const setFamily = (patch: Partial<TreeNode>) => setDraft((d) => ({ ...d, ...patch }));
  const setSeries = (si: number, patch: Partial<TreeNode>) => setDraft((d) => ({ ...d, children: d.children.map((s, i) => (i === si ? { ...s, ...patch } : s)) }));
  const setModel = (si: number, mi: number, patch: Partial<TreeNode>) =>
    setSeries(si, { children: draft.children[si].children.map((m, i) => (i === mi ? { ...m, ...patch } : m)) });
  const removeSeries = (si: number) => {
    const s = draft.children[si];
    if (s.children.length && !window.confirm(`Remove ${s.name} and its ${s.children.length} models?`)) return;
    setDraft((d) => ({ ...d, children: d.children.filter((_, i) => i !== si) }));
  };
  const removeModel = (si: number, mi: number) => setSeries(si, { children: draft.children[si].children.filter((_, i) => i !== mi) });
  const addModel = (si: number, m: TreeNode = { id: null, level: "model", name: "", aliases: [], verified: true, children: [] }) =>
    setSeries(si, { children: [...draft.children[si].children, m] });
  const addSeries = () =>
    setDraft((d) => ({ ...d, children: [...d.children, { id: null, level: "series", name: "", aliases: [], verified: true, children: [] }] }));

  function save(approve: boolean) {
    setNote(null);
    startTransition(async () => {
      const r = await saveCatalogAction(catalogId, draft, approve);
      setNote({ ok: r.ok, text: r.message });
      if (r.ok) router.refresh();
    });
  }

  const modelCount = draft.children.reduce((n, s) => n + s.children.length, 0);
  const unverified = draft.children.reduce((n, s) => n + (s.verified ? 0 : 1) + s.children.filter((m) => !m.verified).length, 0);

  return (
    <div className="flex flex-col gap-6">
      {top.length > 0 && (
        <section aria-labelledby="top-heading" className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-5">
          <h2 id="top-heading" className="text-lg font-medium">
            Most mentioned models
          </h2>
          <ul className="flex flex-col gap-1.5">
            {top.map((m) => (
              <li key={m.name} className="grid grid-cols-[minmax(0,10rem)_1fr_3rem] items-center gap-3 text-sm sm:grid-cols-[14rem_1fr_3rem]">
                <span className="truncate">{m.name}</span>
                <span className="h-2 rounded-full bg-border">
                  <span className="block h-2 rounded-full bg-accent" style={{ width: `${(m.n / maxCount) * 100}%` }} />
                </span>
                <span className="text-right tabular-nums">{m.n}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">Posts that name the model (out of {posts.toLocaleString()}). Counts update when you save.</p>
        </section>
      )}

      <section aria-labelledby="tree-heading" className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="tree-heading" className="text-lg font-medium">
            Family, series and models
          </h2>
          <span className="text-xs text-muted">
            {draft.children.length} series · {modelCount} models{unverified > 0 && ` · ${unverified} unverified`}
          </span>
        </div>

        <fieldset disabled={pending} className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
            <label className="flex flex-col gap-1 text-sm">
              Family
              <input value={draft.name} onChange={(e) => setFamily({ name: e.target.value })} className={input} />
            </label>
            <ChipField label="Other names" hint="e.g. Smart Tank, SmartTank" values={draft.aliases} onChange={(aliases) => setFamily({ aliases })} />
          </div>

          {draft.children.map((s, si) => (
            <div key={s.id ?? `new-${si}`} className="flex flex-col gap-3 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <input value={s.name} onChange={(e) => setSeries(si, { name: e.target.value })} placeholder="Series name" aria-label="Series name" className={`${input} min-w-0 flex-1 font-medium`} />
                <Verified value={s.verified} onChange={(verified) => setSeries(si, { verified })} />
                {count(s) !== null && <span className="text-xs text-muted tabular-nums">{count(s)} posts name only the series</span>}
                <button type="button" onClick={() => removeSeries(si)} aria-label={`Remove ${s.name}`} className="rounded-md px-2 py-1 text-muted hover:text-critical">
                  ×
                </button>
              </div>
              <ChipField label="Series other names" hint="e.g. 7000 series" values={s.aliases} onChange={(aliases) => setSeries(si, { aliases })} />

              <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
                {s.children.map((m, mi) => {
                  const n = count(m);
                  return (
                    <li key={m.id ?? `new-${si}-${mi}`} className="flex flex-col gap-2 p-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <input value={m.name} onChange={(e) => setModel(si, mi, { name: e.target.value })} placeholder="Model name" aria-label="Model name" className={`${input} min-w-0 flex-1`} />
                        <span className="flex w-24 items-center gap-2" title="Posts that name this model">
                          <span className="h-1.5 flex-1 rounded-full bg-border">
                            <span className="block h-1.5 rounded-full bg-accent" style={{ width: `${((n ?? 0) / maxCount) * 100}%` }} />
                          </span>
                          <span className="w-8 text-right text-xs tabular-nums">{n ?? "new"}</span>
                        </span>
                        <Verified value={m.verified} onChange={(verified) => setModel(si, mi, { verified })} />
                        <select
                          value=""
                          onChange={(e) => {
                            const into = models[Number(e.target.value)]?.path;
                            if (into) setDraft((d) => mergeModel(d, [si, mi], into));
                          }}
                          aria-label={`Merge ${m.name} into another model`}
                          className="max-w-32 rounded-md border border-border bg-background px-1 py-1 text-xs text-muted"
                        >
                          <option value="">Merge into…</option>
                          {models.map((o, oi) => (o.path[0] === si && o.path[1] === mi ? null : <option key={oi} value={oi}>{o.label}</option>))}
                        </select>
                        <button type="button" onClick={() => removeModel(si, mi)} aria-label={`Remove ${m.name}`} className="rounded-md px-2 py-1 text-muted hover:text-critical">
                          ×
                        </button>
                      </div>
                      <ChipField label="How people write it" hint="e.g. 7301, ST 7301" values={m.aliases} onChange={(aliases) => setModel(si, mi, { aliases })} />
                    </li>
                  );
                })}
              </ul>
              {s.children.length < CATALOG_LIMITS.modelsPerSeries ? (
                <button type="button" onClick={() => addModel(si)} className="self-start text-sm text-accent hover:underline">
                  + Add model
                </button>
              ) : (
                <p className="text-xs text-muted">This series has the maximum of {CATALOG_LIMITS.modelsPerSeries} models; merge or remove some to add more.</p>
              )}
            </div>
          ))}
          {draft.children.length < CATALOG_LIMITS.series && (
            <button type="button" onClick={addSeries} className="self-start text-sm text-accent hover:underline">
              + Add series
            </button>
          )}
        </fieldset>
      </section>

      {suggestions.length > 0 && draft.children.length > 0 && (
        <section aria-labelledby="missing-heading" className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="missing-heading" className="text-lg font-medium">
              Mentioned but not in the catalog
            </h2>
            <label className="flex items-center gap-2 text-sm">
              Add to
              <select value={addTo} onChange={(e) => setAddTo(Number(e.target.value))} className="rounded-md border border-border bg-background px-2 py-1 text-sm">
                {draft.children.map((s, si) => (
                  <option key={si} value={si}>
                    {s.name || "(unnamed series)"}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <ul className="flex flex-wrap gap-2">
            {suggestions.map((m) => (
              <li key={m.text}>
                <button
                  type="button"
                  disabled={pending || (draft.children[Math.min(addTo, draft.children.length - 1)]?.children.length ?? 0) >= CATALOG_LIMITS.modelsPerSeries}
                  onClick={() => addModel(Math.min(addTo, draft.children.length - 1), modelFromMention(m.text))}
                  className="rounded-full border border-border px-3 py-1 text-sm hover:border-accent"
                >
                  + {m.text} <span className="text-muted">· {m.posts}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">Found by pattern in the posts; some may be typos or other products. Adding one creates an unverified model.</p>
        </section>
      )}

      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-border bg-background/95 py-3 backdrop-blur">
        <button type="button" onClick={() => save(true)} disabled={pending} className="rounded-lg bg-accent px-5 py-2 font-medium text-white disabled:opacity-60">
          {pending ? "Saving…" : status === "approved" && !dirty ? "Approved ✓" : "Approve catalog"}
        </button>
        <button type="button" onClick={() => save(false)} disabled={pending || !dirty} className="rounded-lg border border-border px-4 py-2 text-sm font-medium disabled:opacity-50">
          Save without approving
        </button>
        <button type="button" onClick={() => setDraft(tree)} disabled={pending || !dirty} className="text-sm text-muted underline disabled:opacity-50">
          Undo changes
        </button>
        {note && (
          <span role="status" className={`text-sm ${note.ok ? "text-muted" : "text-critical"}`}>
            {note.text}
          </span>
        )}
      </div>
    </div>
  );
}

function Verified({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      aria-pressed={value}
      title={value ? "Checked. Click to mark unverified." : "Claude wasn't sure this exists. Click once you've checked it."}
      className={`rounded-full border px-2 py-0.5 text-xs ${value ? "border-border text-muted" : "border-warning bg-warning/15"}`}
    >
      {value ? "verified" : "unverified"}
    </button>
  );
}
