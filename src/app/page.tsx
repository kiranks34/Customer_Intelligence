import { monthToDate } from "@/lib/cost";

import { SpendMeter } from "./spend-meter";

export const dynamic = "force-dynamic";

const EXAMPLES = ["HP Smart Tank printers", "HP Sprocket", "What Gen Z says about printers"];

export default async function Home() {
  const spend = await monthToDate();

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
        <form className="flex flex-col gap-3 sm:flex-row">
          <input
            name="q"
            placeholder="Search a product, family or audience…"
            disabled
            className="flex-1 rounded-lg border border-border bg-surface px-4 py-3 disabled:opacity-60"
          />
          <button type="submit" disabled className="rounded-lg bg-accent px-5 py-3 font-medium text-white opacity-60">
            Search
          </button>
        </form>
        <p className="text-sm text-muted">
          Search is switched on in Phase 1, step 3. Examples: {EXAMPLES.join(" · ")}
        </p>
      </section>

      <section aria-labelledby="recent-heading">
        <h2 id="recent-heading" className="mb-2 text-lg font-medium">
          Recent searches
        </h2>
        <p className="text-sm text-muted">None yet.</p>
      </section>
    </main>
  );
}
