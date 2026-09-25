"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { CODEBOOK_LIMITS, keyFor, type Code, type Codebook, type Theme } from "@/lib/codebook";

import { saveCodebookAction } from "../analysis-actions";

type List = "themes" | "stages" | "segments";
const TITLES: Record<List, string> = { themes: "Themes", stages: "Journey stages (in order)", segments: "Who is posting" };
const KINDS: Theme["kind"][] = ["pain", "delight", "need", "topic"];
const input = "rounded-md border border-border bg-background px-2 py-1 text-sm";

/**
 * The themes, journey stages and user types Jev answers about. Claude drafted them; here you rename, add or
 * remove. Saving makes a new version; posts are re-read with it when you press Analyze (a few cents).
 */
export function CodebookEditor({ searchId, codebook, version }: { searchId: number; codebook: Codebook; version: number }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Codebook>(codebook);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const changed = JSON.stringify(draft) !== JSON.stringify(codebook);

  function update<L extends List>(list: L, index: number, patch: Partial<Codebook[L][number]>) {
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
      (["themes", "stages", "segments"] as const).map((list) => {
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
    ) as Codebook;
    setNote(null);
    startTransition(async () => {
      const r = await saveCodebookAction(searchId, withKeys);
      setNote({ ok: r.ok, text: r.message });
      if (r.ok) router.refresh();
    });
  }

  return (
    <details className="rounded-lg border border-border px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium">
        Themes, stages and user types <span className="font-normal text-muted">· version {version}, drafted by Claude from a sample. Edit if something is missing or off.</span>
      </summary>
      <div className="mt-4 flex flex-col gap-5">
        {(["themes", "stages", "segments"] as const).map((list) => (
          <fieldset key={list} className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{TITLES[list]}</legend>
            {draft[list].map((c, i) => (
              <div key={`${list}-${i}`} className="grid gap-2 sm:grid-cols-[12rem_minmax(0,1fr)_auto_auto]">
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
              </div>
            ))}
            {draft[list].length < CODEBOOK_LIMITS[list] && (
              <button type="button" onClick={() => add(list)} className="self-start text-sm font-medium text-accent hover:underline">
                + Add
              </button>
            )}
          </fieldset>
        ))}
        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
          <button type="button" disabled={!changed || pending} onClick={save} className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            {pending ? "Saving…" : "Save changes"}
          </button>
          {changed && (
            <button type="button" onClick={() => setDraft(codebook)} className="text-sm text-muted underline">
              Undo changes
            </button>
          )}
          {note && <span className={`text-sm ${note.ok ? "text-muted" : "text-critical"}`}>{note.text}</span>}
        </div>
      </div>
    </details>
  );
}
