"use client";

import { useActionState } from "react";

import { createSearchAction, type ActionState } from "./searches/actions";

const EXAMPLES = [
  "HP Smart Tank printers",
  "How did Smart Tank 5000 series perform last month?",
  "How many people talked about connectivity issues last week?",
];

export function SearchForm() {
  const [state, action, pending] = useActionState<ActionState | null, FormData>(createSearchAction, null);
  return (
    <div className="flex flex-col gap-3">
      <form action={action} className="flex flex-col gap-3 sm:flex-row">
        <label htmlFor="q" className="sr-only">
          Search a product, family, audience, or ask a question
        </label>
        <input
          id="q"
          name="q"
          required
          minLength={3}
          maxLength={300}
          placeholder="A product, family, audience, or a question…"
          className="flex-1 rounded-lg border border-border bg-surface px-4 py-3"
        />
        <button type="submit" disabled={pending} className="rounded-lg bg-accent px-5 py-3 font-medium text-white disabled:opacity-60">
          {pending ? "Planning…" : "Plan search"}
        </button>
      </form>
      {state && !state.ok && (
        <p role="alert" className="text-sm text-critical">
          {state.message}
        </p>
      )}
      <p className="text-sm text-muted">
        Claude drafts a plan (a few cents); nothing is collected until you review it and press Run. Examples:{" "}
        {EXAMPLES.map((e, i) => (
          <span key={e}>
            {i > 0 && " · "}“{e}”
          </span>
        ))}
      </p>
    </div>
  );
}
