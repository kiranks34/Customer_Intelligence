import Link from "next/link";

import { monthToDate } from "@/lib/cost";
import { recentSearches } from "@/lib/searches";

import { SearchForm } from "./search-form";
import { SpendMeter } from "./spend-meter";

export const dynamic = "force-dynamic";

export default async function Home() {
  const spend = await monthToDate();
  const recent = spend.state === "ok" ? await recentSearches().catch(() => []) : [];

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-4 py-12">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Pulse</h1>
          <p className="text-muted">What customers say in public, verified post by post.</p>
        </div>
        <SpendMeter spend={spend} />
      </header>

      <section aria-labelledby="search-heading" className="flex flex-col gap-3">
        <h2 id="search-heading" className="sr-only">
          New search
        </h2>
        <SearchForm />
      </section>

      <nav aria-label="Tools" className="text-sm">
        <Link href="/sources" className="underline">
          Test data sources →
        </Link>
      </nav>

      <section aria-labelledby="recent-heading">
        <h2 id="recent-heading" className="mb-2 text-lg font-medium">
          Recent searches
        </h2>
        {recent.length === 0 ? (
          <p className="text-sm text-muted">None yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
            {recent.map((s) => (
              <li key={s.id}>
                <Link href={`/searches/${s.id}`} className="flex justify-between gap-4 px-4 py-3 hover:bg-surface">
                  <span>{s.query}</span>
                  <span className="shrink-0 text-sm text-muted">{s.createdAt.toISOString().slice(0, 10)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
