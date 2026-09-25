import Link from "next/link";

import { monthToDate } from "@/lib/cost";
import { catalogStats, getCatalog, listFamilies, waitingCount } from "@/lib/catalogs";
import { recentSearches } from "@/lib/searches";

import { RecentSearches } from "./recent-searches";
import { HomeSearch } from "./home-search";
import type { ListFamily } from "./product-lists";
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
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 py-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Pulse</h1>
          <p className="text-muted">What customers say in public, verified post by post.</p>
        </div>
        <SpendMeter spend={spend} />
      </header>

      <HomeSearch families={families} />

      {recentError ? (
        <p role="alert" className="text-sm text-critical">
          {recentError}
        </p>
      ) : (
        <RecentSearches items={recent} />
      )}

      <nav aria-label="Tools" className="text-sm text-muted">
        <Link href="/sources" className="underline hover:text-foreground">
          Test data sources →
        </Link>
      </nav>
    </main>
  );
}

/**
 * Every family with its active (not retired) series and models, and the posts collected so far for each (counted
 * in SQL across all searches), for the home page lists.
 */
async function pickerFamilies(): Promise<ListFamily[]> {
  const families = await listFamilies();
  const loaded = await Promise.all(families.map(async (f) => Promise.all([getCatalog(f.id), catalogStats(f.id), waitingCount(f.id)])));
  return loaded
    .filter(([found]) => found !== null)
    .map(([found, stats, waiting]) => {
      const { catalog, tree } = found!;
      return {
        id: catalog.id,
        name: catalog.name,
        posts: stats.postsNamingProduct,
        waiting,
        series: tree.children
          .filter((s) => !s.retired && s.id !== null)
          .map((s) => ({
            id: s.id!,
            name: s.name,
            posts: stats.bySeries[s.id!] ?? 0,
            models: s.children.filter((m) => !m.retired && m.id !== null).map((m) => ({ id: m.id!, name: m.name, posts: stats.byNode[m.id!] ?? 0 })),
          })),
      };
    });
}
