"use client";

import { useActionState } from "react";

import { runSourceTest, type SourceKey, type TestResult } from "./actions";
import { DEFAULT_QUERY } from "./constants";

interface Props {
  source: SourceKey;
  title: string;
  via: string;
  costNote: string;
  missing: string[];
  takesQuery: boolean;
}

export function SourceCard({ source, title, via, costNote, missing, takesQuery }: Props) {
  const configured = missing.length === 0;
  const [result, action, pending] = useActionState<TestResult | null, FormData>(runSourceTest.bind(null, source), null);

  return (
    <section className="rounded-xl border border-border bg-surface p-5" aria-labelledby={`${source}-title`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={`${source}-title`} className="text-lg font-medium">
            {title}
          </h2>
          <p className="text-sm text-muted">
            via {via} · {costNote}
          </p>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-xs ${configured ? "border-border" : "border-critical text-critical"}`}>
          {configured ? "✓ Key set" : `⚠ Missing ${missing.join(", ")}`}
        </span>
      </div>

      <form action={action} className="mt-4 flex flex-col gap-2 sm:flex-row">
        {takesQuery && (
          <input
            name="query"
            defaultValue={DEFAULT_QUERY}
            aria-label={`${title} test query`}
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
        )}
        <button
          type="submit"
          disabled={!configured || pending}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Testing…" : "Run test"}
        </button>
      </form>

      {result && (
        <div role="status" className="mt-4 text-sm">
          <p className={result.ok ? "" : "text-critical"}>
            <span className="font-medium">{result.ok ? "✓ OK: " : "✗ Failed: "}</span>
            {result.message}
          </p>
          {result.details?.map((d) => (
            <p key={d} className="text-muted">
              {d}
            </p>
          ))}
          {result.samples && result.samples.length > 0 && (
            <ul className="mt-2 flex flex-col gap-2">
              {result.samples.map((s, i) => (
                <li key={i} className="rounded-lg border border-border p-2">
                  <p>{s.text}</p>
                  <p className="mt-1 text-xs text-muted">
                    {s.postedAt?.slice(0, 10)}
                    {s.url && (
                      <>
                        {" · "}
                        <a href={s.url} target="_blank" rel="noreferrer" className="underline">
                          open source
                        </a>
                      </>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
