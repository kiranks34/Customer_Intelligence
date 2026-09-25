import Link from "next/link";

import { monthToDate } from "@/lib/cost";
import { getCatalog, listFamilies } from "@/lib/catalogs";
import { recentSearches } from "@/lib/searches";

import { RecentSearches } from "./recent-searches";
import { HomeSearch, type PickerFamily } from "./home-search";
import { SpendMeter } from "./spend-meter";

export const dynamic = "force-dynamic";

export default async function Home() {
  const spend = await monthToDate();
  const families = spend.state === "ok" ? await pickerFamilies().catch(() => []) : [];
  let recent: Awaited<ReturnType<typeof recentSearches>> = [];
  let recentError: string | null = null;
  if (spend.state === "ok") {
    try {
      recent = await recentSearches();
    } catch {
      // Most likely a database migration hasn't been run yet (see drizzle/editor/).
      recentError = "Couldn't load recent searches. If you just updated Pulse, run the newest SQL file from drizzle/editor/ in Neon.";
    }
  }

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
        <HomeSearch families={families} />
      </section>

      <nav aria-label="Tools" className="text-sm">
        <Link href="/sources" className="underline">
          Test data sources →
        </Link>
      </nav>

      {recentError ? (
        <p role="alert" className="text-sm text-critical">
          {recentError}
        </p>
      ) : (
        <RecentSearches items={recent} />
      )}
    </main>
  );
}

/** Every family with its active (not retired) series and models, for the home page pickers. */
async function pickerFamilies(): Promise<PickerFamily[]> {
  const families = await listFamilies();
  const trees = await Promise.all(families.map((f) => getCatalog(f.id)));
  return trees
    .filter((t) => t !== null)
    .map(({ catalog, tree }) => ({
      id: catalog.id,
      name: catalog.name,
      series: tree.children
        .filter((s) => !s.retired && s.id !== null)
        .map((s) => ({ id: s.id!, name: s.name, models: s.children.filter((m) => !m.retired && m.id !== null).map((m) => ({ id: m.id!, name: m.name })) })),
    }));
}
