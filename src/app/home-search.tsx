"use client";

import { useActionState, useState } from "react";

import { createSearchAction, type ActionState } from "./searches/actions";

export interface PickerFamily {
  id: number;
  name: string;
  series: { id: number; name: string; models: { id: number; name: string }[] }[];
}

const FREE = "free";
const ALL = "all";
const field = "w-full rounded-lg border border-border bg-surface px-3 py-2.5";
const short = (name: string) => name.replace(/^HP\s+/i, "");

/**
 * Home page search: pick a family → series → model from the catalog (or "Anything else" to type a topic), and
 * optionally ask a question about it. Claude drafts a plan for exactly what was picked.
 */
export function HomeSearch({ families }: { families: PickerFamily[] }) {
  const [state, action, pending] = useActionState<ActionState | null, FormData>(createSearchAction, null);
  const [familyId, setFamilyId] = useState<string>(families[0] ? String(families[0].id) : FREE);
  const [seriesId, setSeriesId] = useState<string>(ALL);
  const [modelId, setModelId] = useState<string>(ALL);

  const family = families.find((f) => String(f.id) === familyId) ?? null;
  const series = family?.series.find((s) => String(s.id) === seriesId) ?? null;
  const free = family === null;
  const nodeId = modelId !== ALL ? modelId : seriesId !== ALL ? seriesId : "";
  const picked = series ? (series.models.find((m) => String(m.id) === modelId)?.name ?? series.name) : family?.name;

  return (
    <div className="flex flex-col gap-3">
      <form action={action} className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor="pick-family">Family</label>
            <select
              id="pick-family"
              className={field}
              value={familyId}
              onChange={(e) => {
                setFamilyId(e.target.value);
                setSeriesId(ALL);
                setModelId(ALL);
              }}
            >
              {families.map((f) => (
                <option key={f.id} value={f.id}>
                  {short(f.name)}
                </option>
              ))}
              <option value={FREE}>Anything else (type it)</option>
            </select>
          </div>
          {!free && (
            <>
              <div className="flex flex-col gap-1 text-sm">
                <label htmlFor="pick-series">Series</label>
                <select
                  id="pick-series"
                  className={field}
                  value={seriesId}
                  onChange={(e) => {
                    setSeriesId(e.target.value);
                    setModelId(ALL);
                  }}
                >
                  <option value={ALL}>All series ({family!.series.length})</option>
                  {family!.series.map((s) => (
                    <option key={s.id} value={s.id}>
                      {short(s.name)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1 text-sm">
                <label htmlFor="pick-model">Model</label>
                <select id="pick-model" className={field} value={modelId} onChange={(e) => setModelId(e.target.value)} disabled={!series}>
                  <option value={ALL}>{series ? `All models (${series.models.length})` : "Pick a series first"}</option>
                  {series?.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {short(m.name)}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>

        {!free && <input type="hidden" name="catalogId" value={family!.id} />}
        {!free && <input type="hidden" name="nodeId" value={nodeId} />}

        <div className="flex flex-col gap-3 sm:flex-row">
          <label htmlFor="q" className="sr-only">
            {free ? "A product, family, audience or a question" : "Your question (optional)"}
          </label>
          <input
            id="q"
            name="q"
            required={free}
            minLength={free ? 3 : undefined}
            maxLength={300}
            placeholder={free ? "A product, family, audience, or a question…" : `Ask about ${short(picked ?? "")} (optional), e.g. connectivity issues last month`}
            className="flex-1 rounded-lg border border-border bg-surface px-4 py-3"
          />
          <button type="submit" disabled={pending} className="rounded-lg bg-accent px-5 py-3 font-medium text-white disabled:opacity-60">
            {pending ? "Planning…" : "Plan search"}
          </button>
        </div>
      </form>
      {state && !state.ok && (
        <p role="alert" className="text-sm text-critical">
          {state.message}
        </p>
      )}
      <p className="text-sm text-muted">
        Claude drafts a plan for exactly what you picked (a few cents); nothing is collected until you review it and press Run. Leave the question
        empty for a general overview.
      </p>
    </div>
  );
}
