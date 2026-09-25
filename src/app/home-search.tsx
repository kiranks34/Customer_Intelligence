"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";

import { addFamilyAction } from "./catalogs/actions";
import { CatalogLinks, defaultPick, FamilyTabs, ProductLists, shortName, Step, type ListFamily, type Pick } from "./product-lists";
import { createSearchAction, type ActionState } from "./searches/actions";

const SUGGESTIONS = ["Top complaints", "What people like", "Setup and first use", "Running cost"];

/**
 * Home page: 1 · pick a product from the catalog (most discussed first; "All models" of the top series is picked, so
 * Plan search always works), 2 · ask an optional question. "Other topic" is for anything outside the catalog.
 */
export function HomeSearch({ families }: { families: ListFamily[] }) {
  const router = useRouter();
  const [state, action, planning] = useActionState<ActionState | null, FormData>(createSearchAction, null);
  const [adding, startAdding] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | "other">(families[0]?.id ?? "other");
  const [picks, setPicks] = useState<Record<number, Pick>>({});
  const [question, setQuestion] = useState("");

  // A family added a moment ago is selected before the refreshed list arrives: show the first family until then,
  // never "Other topic", so a search planned meanwhile still uses the catalog.
  const family = selected === "other" ? null : (families.find((f) => f.id === selected) ?? families[0] ?? null);
  const other = family === null;
  const pick = family ? (picks[family.id] ?? defaultPick(family)) : null;
  const series = family?.series.find((s) => s.id === pick?.seriesId) ?? null;
  const model = series?.models.find((m) => m.id === pick?.modelId) ?? null;
  const nodeId = model?.id ?? series?.id ?? "";

  const picked = !family
    ? null
    : model
      ? { label: model.name, posts: model.posts }
      : series
        ? { label: `${series.name} · all ${series.models.length} models`, posts: series.posts }
        : { label: `${family.name} · all ${family.series.length} series`, posts: family.posts };

  function addFamily(name: string) {
    setNote(null);
    startAdding(async () => {
      const r = await addFamilyAction(name);
      if (!r.ok) return setNote(r.message);
      setSelected(r.catalogId);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-10">
      {/* Only the question card is a form: Enter in the finder or the "+ Family" box never starts a search. */}
      <section aria-labelledby="step-product">
        <Step n={1} id="step-product" title="Product catalog" hint="pick what to search" />
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <FamilyTabs
            families={families}
            selected={family?.id ?? "other"}
            onSelect={setSelected}
            onAddFamily={addFamily}
            other
            pending={adding}
            right={family && <CatalogLinks family={family} />}
          />
          {note && (
            <p role="alert" className="px-5 pt-3 text-sm text-critical">
              {note}
            </p>
          )}
          {family && pick ? (
            family.series.length > 0 ? (
              <ProductLists key={family.id} family={family} pick={pick} onPick={(p) => setPicks((all) => ({ ...all, [family.id]: p }))} />
            ) : (
              <p className="px-5 py-6 text-sm text-muted">
                No series in {family.name} yet. Add them in <span className="font-medium">Manage catalog</span>, or search the whole family below.
              </p>
            )
          ) : (
            <p className="px-5 py-6 text-sm text-muted">Type any product, audience or question below, e.g. “Gen Z and home printing”.</p>
          )}
        </div>
      </section>

      <section aria-labelledby="step-ask">
        <Step n={2} id="step-ask" title="Ask a question" hint={other ? "required for other topics" : "optional"} />
        <form action={action} className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
          {picked && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="text-muted">Searching:</span>
              <span className="rounded-full bg-accent/10 px-3 py-1 font-medium text-accent">{picked.label}</span>
              {picked.posts > 0 && <span className="text-muted">{picked.posts.toLocaleString()} posts already collected</span>}
            </p>
          )}
          {family && <input type="hidden" name="catalogId" value={family.id} />}
          {family && <input type="hidden" name="nodeId" value={nodeId} />}
          <div className="flex flex-col gap-3 sm:flex-row">
            <label htmlFor="q" className="sr-only">
              {other ? "A product, audience or question" : "Your question (optional)"}
            </label>
            <input
              id="q"
              name="q"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              required={other}
              minLength={other ? 3 : undefined}
              maxLength={300}
              placeholder={other ? "A product, audience or question…" : `e.g. What do people say about ${model ? shortName(model.name, family!.name) : "setup and Wi-Fi"}?`}
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-4 py-3"
            />
            <button type="submit" disabled={planning} className="rounded-lg bg-accent px-6 py-3 font-medium text-white disabled:opacity-60">
              {planning ? "Planning…" : "Plan search"}
            </button>
          </div>
          {!other && (
            <div className="flex flex-wrap gap-2" aria-label="Suggested questions">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setQuestion(s)}
                  className={`rounded-full border px-3 py-1 text-sm ${question === s ? "border-accent text-accent" : "border-border text-muted hover:border-foreground/40"}`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          {state && !state.ok && (
            <p role="alert" className="text-sm text-critical">
              {state.message}
            </p>
          )}
          <p className="text-sm text-muted">
            {other ? "" : "Leave it empty for a general overview. "}Claude drafts a plan (a few cents). Nothing is collected until you press Run.
          </p>
        </form>
      </section>
    </div>
  );
}
