"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { CODEBOOK_LIMITS, keyFor, type Code, type Codebook, type Theme } from "@/lib/codebook";

import { aboutUsd } from "../../format";
import { ui } from "../../ui";
import { proposeCodebookAction, saveCodebookAction } from "../analysis-actions";

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

const input = "rounded-md border border-border bg-background px-2 py-1 text-sm";

/**
 * Categories: the themes, journey stages, touchpoints, user types and competitors Jev sorts posts into, each with its
 * rule (what counts, what doesn't). "Improve rules" asks Claude for clearer rules from the posts and the answers
 * Accuracy found wrong; "Edit myself" opens the form. Either way nothing changes until you save, which makes a new
 * version; Re-analyze in the study bar applies it. Product knowledge lives with the product family and is kept as is.
 */
export function CodebookEditor({
  searchId,
  codebook,
  improveUsd,
  wrong,
}: {
  searchId: number;
  codebook: Codebook;
  /** About what one "Improve rules" call costs. */
  improveUsd: number;
  /** Sure answers Accuracy judged wrong, which Claude's rules fix. */
  wrong: number;
}) {
  const router = useRouter();
  const initial = withDefaults(codebook);
  const [draft, setDraft] = useState<Required<Codebook>>(initial);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [asking, setAsking] = useState(false);
  const [editing, setEditing] = useState(false);
  const changed = JSON.stringify(draft) !== JSON.stringify(initial);

  /** Claude's sharper definitions (from posts about the product and your spot-check corrections) land here unsaved. */
  function improve() {
    // One paid call at a time.
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
        setEditing(true);
      }
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
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[10px] border border-border bg-surface-2 px-4 py-3 text-sm">
        <span className="min-w-56 flex-1">
          <b className="font-semibold">Clearer rules for each theme, stage and touchpoint</b> (what counts and what doesn&apos;t). Claude suggests them from the
          posts{wrong > 0 ? ` and the ${wrong} ${wrong === 1 ? "answer" : "answers"} marked wrong in Accuracy` : ""} ({aboutUsd(improveUsd)}); nothing changes
          until you save.
        </span>
        <button type="button" disabled={pending} onClick={improve} className={ui.secondarySm}>
          {asking ? "Asking Claude…" : "Improve rules"}
        </button>
        {!editing && (
          <button type="button" onClick={() => setEditing(true)} className={ui.plainSm}>
            Edit myself
          </button>
        )}
      </div>
      <div className="flex flex-col gap-5">
        {editing ? (
          <>
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
                  <button type="button" onClick={() => add(list)} className={`${ui.link} self-start text-sm`}>
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
                      <span className="font-semibold">{c.label}</span>
                      {list === "themes" && <span className="text-xs text-muted"> · {(c as Theme).kind}</span>}
                      <span className="block text-muted">
                        Counts when: {(c.counts || c.definition).replace(/\.$/, "")}.{c.excludes && <> Not when: {c.excludes.replace(/\.$/, "")}.</>}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
        {(changed || note || editing || asking) && (
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
            <button type="button" disabled={!changed || pending} onClick={save} className={ui.primarySm}>
              {pending && !asking ? "Saving…" : "Save changes"}
            </button>
            {(changed || editing) && (
              <button
                type="button"
                onClick={() => {
                  setDraft(initial);
                  setEditing(false);
                }}
                className={ui.plainSm}
              >
                {changed ? "Undo changes" : "Close editing"}
              </button>
            )}
            {asking && <span className="text-sm text-muted">Claude is writing clearer rules…</span>}
            {note && <span className={`text-sm ${note.ok ? "text-muted" : "text-critical"}`}>{note.text}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
