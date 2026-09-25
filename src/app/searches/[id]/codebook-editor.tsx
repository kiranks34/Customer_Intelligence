"use client";

import { useRouter } from "next/navigation";
import { useImperativeHandle, useRef, useState, useTransition, type Ref } from "react";

import { CODEBOOK_LIMITS, keyFor, type Code, type Codebook, type Theme } from "@/lib/codebook";

import { productFactsAction, proposeCodebookAction, saveCodebookAction } from "../analysis-actions";

type List = "themes" | "stages" | "segments" | "competitors" | "touchpoints";
const LISTS: List[] = ["themes", "stages", "touchpoints", "segments", "competitors"];
const TITLES: Record<List, string> = {
  themes: "Themes",
  stages: "Journey stages (in order)",
  touchpoints: "Touchpoints (app, support, website, store…)",
  segments: "Who is posting",
  competitors: "Competitors (brands people compare with)",
};
const KINDS: Theme["kind"][] = ["pain", "delight", "need", "topic"];
/** Lists and notes that older codebooks may not have, filled in so the form can edit them. */
const withDefaults = (c: Codebook): Required<Codebook> => ({
  ...c,
  competitors: c.competitors ?? [],
  touchpoints: c.touchpoints ?? [],
  productNotes: c.productNotes ?? "",
  productFacts: c.productFacts ?? [],
});

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
};

export interface EditorHandle {
  improve: () => void;
}

const input = "rounded-md border border-border bg-background px-2 py-1 text-sm";

/**
 * What Jev looks for: the themes, journey stages, touchpoints, user types and competitors Claude drafted. Shown
 * read-only (nothing is needed from you); "Edit" opens the form. Saving makes a new version; posts are re-read with
 * it when you press Analyze (a few cents). `handle.improve()` is how the accuracy check asks for Claude's fixes.
 */
export function CodebookEditor({
  searchId,
  codebook,
  version,
  handle,
  facts,
}: {
  searchId: number;
  codebook: Codebook;
  version: number;
  handle?: Ref<EditorHandle>;
  /** Where official facts come from (the maker's sites), when Pulse knows them for this family. */
  facts: { domains: string[]; checkedAt: string | null } | null;
}) {
  const router = useRouter();
  const initial = withDefaults(codebook);
  const [draft, setDraft] = useState<Required<Codebook>>(initial);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [finding, setFinding] = useState(false);
  const box = useRef<HTMLDetailsElement>(null);
  const changed = JSON.stringify(draft) !== JSON.stringify(initial);

  useImperativeHandle(handle, () => ({
    improve() {
      setOpen(true);
      box.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      improve();
    },
  }));

  /** Claude's sharper definitions (from posts about the product and your spot-check corrections) land here unsaved. */
  function improve() {
    // Also reached from the accuracy check's button, which isn't disabled while a call runs: one paid call at a time.
    if (pending || asking) return;
    if (changed && !window.confirm("Replace your unsaved edits with Claude's proposal? (Save them first to keep them.)")) return;
    setNote(null);
    setAsking(true);
    startTransition(async () => {
      const r = await proposeCodebookAction(searchId);
      setAsking(false);
      setNote({ ok: r.ok, text: r.message });
      if (r.ok) {
        setDraft(withDefaults(r.codebook));
        setOpen(true);
        setEditing(true);
      }
    });
  }

  /** The family's official facts into the draft (looked up with Claude when there are none yet, or `fresh`). */
  function fillFacts(fresh: boolean) {
    if (pending || asking || finding) return;
    setNote(null);
    setFinding(true);
    startTransition(async () => {
      const r = await productFactsAction(searchId, fresh);
      setFinding(false);
      setNote({ ok: r.ok, text: r.message });
      if (r.ok && r.facts) setDraft((d) => ({ ...d, productFacts: r.facts! }));
      if (r.ok && fresh) router.refresh();
    });
  }

  function update<L extends List>(list: L, index: number, patch: Partial<Required<Codebook>[L][number]>) {
    setDraft((d) => ({ ...d, [list]: d[list].map((c, i) => (i === index ? { ...c, ...patch } : c)) }));
  }
  function remove(list: List, index: number) {
    setDraft((d) => ({ ...d, [list]: d[list].filter((_, i) => i !== index) }));
  }
  function add(list: List) {
    setDraft((d) => {
      const item: Code = { key: "", label: "", definition: "" };
      return { ...d, [list]: [...d[list], list === "themes" ? { ...item, kind: "pain" } : item] };
    });
  }
  function save() {
    // New items get a key from their label; existing ones keep theirs, so past answers still line up.
    const withKeys = Object.fromEntries(
      LISTS.map((list) => {
        const taken = draft[list].map((c) => c.key).filter(Boolean);
        return [
          list,
          draft[list].map((c) => {
            if (c.key) return { ...c, label: c.label.trim(), definition: c.definition.trim() };
            const key = keyFor(c.label, taken);
            taken.push(key);
            return { ...c, key, label: c.label.trim(), definition: c.definition.trim() || c.label.trim() };
          }),
        ];
      }),
    ) as unknown as Codebook;
    const notes = draft.productNotes.trim();
    const withNotes: Codebook = { ...withKeys, ...(notes ? { productNotes: notes } : {}), ...(draft.productFacts.length ? { productFacts: draft.productFacts } : {}) };
    setNote(null);
    startTransition(async () => {
      const r = await saveCodebookAction(searchId, withNotes);
      setNote({ ok: r.ok, text: r.message });
      if (r.ok) router.refresh();
    });
  }

  return (
    <details ref={box} open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="rounded-lg border border-border px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium">
        What Jev looks for <span className="font-normal text-muted">· drafted by Claude from the posts, nothing needed from you · version {version}</span>
      </summary>
      <div className="mt-4 flex flex-col gap-5">
        <section className="flex flex-col gap-2 text-sm">
          <h3 className="font-medium">Teach Pulse about the product</h3>
          <p className="text-xs text-muted">
            The more Pulse knows about how the product works, the more accurately Jev and Claude read posts. Uploading manuals and video links comes
            later.
          </p>
          {facts && (
            <div className="flex flex-wrap items-center gap-3 rounded-md bg-accent/5 px-3 py-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => fillFacts(draft.productFacts.length > 0)}
                className="rounded-md border border-accent px-3 py-1 font-medium text-accent disabled:opacity-50"
              >
                {finding ? "Reading the official pages…" : draft.productFacts.length ? "Look again" : `Fill from ${facts.domains.join(", ")}`}
              </button>
              <span className="text-xs text-muted">
                Claude reads only {facts.domains.join(", ")} and keeps a fact only when its page says it (a few cents
                {facts.checkedAt ? `; last looked ${facts.checkedAt}` : ""}). You review before saving.
              </span>
            </div>
          )}
          {draft.productFacts.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {draft.productFacts.map((f, i) => (
                <li key={`${f.url}-${i}`} className="flex items-start justify-between gap-3">
                  <span>
                    {f.text}{" "}
                    <a href={f.url} target="_blank" rel="noreferrer noopener" className="text-xs whitespace-nowrap text-muted underline">
                      {hostOf(f.url)} ↗
                    </a>
                  </span>
                  <button
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, productFacts: d.productFacts.filter((_, j) => j !== i) }))}
                    aria-label="Remove this fact"
                    className="px-2 text-muted hover:text-critical"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Your notes (optional)</span>
          <span className="text-xs text-muted">Anything else Jev and Claude should know, e.g. “Printheads are installed during setup and can be replaced later if damaged.”</span>
          <textarea
            value={draft.productNotes}
            onChange={(e) => setDraft((d) => ({ ...d, productNotes: e.target.value }))}
            maxLength={1500}
            rows={3}
            className={`${input} min-h-20`}
          />
        </label>
        {editing ? (
          <>
            <div className="flex flex-wrap items-center gap-3 rounded-md bg-accent/5 px-3 py-2 text-sm">
              <button type="button" disabled={pending} onClick={improve} className="rounded-md border border-accent px-3 py-1 font-medium text-accent disabled:opacity-50">
                {asking ? "Asking Claude…" : "Improve with Claude"}
              </button>
              <span className="text-xs text-muted">
                Sharper definitions with “counts when / not when” and real examples, fixing mistakes the accuracy check found. A few cents; you review
                before saving.
              </span>
            </div>
            {LISTS.map((list) => (
              <fieldset key={list} className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium">{TITLES[list]}</legend>
                {draft[list].map((c, i) => (
                  <div key={`${list}-${i}`} className="grid gap-2 border-b border-border/60 pb-2 sm:grid-cols-[12rem_minmax(0,1fr)_auto_auto]">
                    <input value={c.label} onChange={(e) => update(list, i, { label: e.target.value })} aria-label="Name" placeholder="Name" maxLength={60} className={input} />
                    <input
                      value={c.definition}
                      onChange={(e) => update(list, i, { definition: e.target.value })}
                      aria-label="What a post must mention"
                      placeholder="What a post must mention to count"
                      maxLength={240}
                      className={input}
                    />
                    {list === "themes" ? (
                      <select value={(c as Theme).kind} onChange={(e) => update("themes", i, { kind: e.target.value as Theme["kind"] })} aria-label="Kind" className={input}>
                        {KINDS.map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="hidden sm:block" />
                    )}
                    <button type="button" onClick={() => remove(list, i)} aria-label={`Remove ${c.label}`} className="px-2 text-muted hover:text-critical">
                      ×
                    </button>
                    <div className="grid gap-2 sm:col-span-4 sm:grid-cols-2 sm:pl-[12.5rem]">
                      <input
                        value={c.counts ?? ""}
                        onChange={(e) => update(list, i, { counts: e.target.value })}
                        aria-label="Counts when"
                        placeholder="Counts when… (optional)"
                        maxLength={240}
                        className={`${input} text-xs`}
                      />
                      <input
                        value={c.excludes ?? ""}
                        onChange={(e) => update(list, i, { excludes: e.target.value })}
                        aria-label="Not when"
                        placeholder="Not when… (optional)"
                        maxLength={240}
                        className={`${input} text-xs`}
                      />
                      {c.example && <p className="text-xs text-muted italic sm:col-span-2">Example from a post: “{c.example}”</p>}
                    </div>
                  </div>
                ))}
                {draft[list].length < CODEBOOK_LIMITS[list] && (
                  <button type="button" onClick={() => add(list)} className="self-start text-sm font-medium text-accent hover:underline">
                    + Add
                  </button>
                )}
              </fieldset>
            ))}
          </>
        ) : (
          <>
            {LISTS.filter((list) => draft[list].length > 0).map((list) => (
              <section key={list} className="flex flex-col gap-1.5">
                <h3 className="text-sm font-medium">{TITLES[list]}</h3>
                <ul className="flex flex-col gap-1.5">
                  {draft[list].map((c) => (
                    <li key={c.key || c.label} className="text-sm">
                      <span className="font-medium">{c.label}</span>
                      {list === "themes" && <span className="text-xs text-muted"> · {(c as Theme).kind}</span>}
                      <span className="text-muted"> · {c.definition}</span>
                      {(c.counts || c.excludes) && (
                        <span className="block text-xs text-muted">
                          {c.counts && <>Counts when: {c.counts}. </>}
                          {c.excludes && <>Not when: {c.excludes}.</>}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <button type="button" onClick={() => setEditing(true)} className="self-start text-sm font-medium text-accent hover:underline">
              Edit definitions
            </button>
          </>
        )}
        {(changed || note || editing || asking) && (
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
            <button type="button" disabled={!changed || pending} onClick={save} className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
              {pending && !asking ? "Saving…" : "Save changes"}
            </button>
            {(changed || editing) && (
              <button
                type="button"
                onClick={() => {
                  setDraft(initial);
                  setEditing(false);
                }}
                className="text-sm text-muted underline"
              >
                {changed ? "Undo changes" : "Close editing"}
              </button>
            )}
            {asking && <span className="text-sm text-muted">Claude is improving the definitions…</span>}
            {note && <span className={`text-sm ${note.ok ? "text-muted" : "text-critical"}`}>{note.text}</span>}
          </div>
        )}
      </div>
    </details>
  );
}
