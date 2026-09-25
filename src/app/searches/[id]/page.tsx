import Link from "next/link";
import { notFound } from "next/navigation";

import { usdPerCredit } from "@/connectors/reddit";
import { flatten } from "@/lib/catalog";
import { catalogStats, getCatalog } from "@/lib/catalogs";
import { loadPlan, progress } from "@/lib/collect";
import { getSearch } from "@/lib/searches";

import { CatalogCard, type CatalogSummary } from "./catalog-card";
import { PlanWorkspace } from "./plan-workspace";

export const dynamic = "force-dynamic";

export default async function SearchPage({ params }: PageProps<"/searches/[id]">) {
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const search = await getSearch(id);
  if (!search) notFound();
  const latest = await loadPlan(id);
  if (!latest) notFound();

  const { plan, version } = latest;
  const prog = await progress(id);
  // Paused steps belong to the current run and keep its plan, so edits wait until they are resumed and finished.
  const locked = !prog.finished || prog.jobs.waiting > 0;
  const catalog = search.catalogId ? await catalogSummary(search.catalogId, id) : null;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-1">
        <Link href="/" className="text-sm text-muted underline">
          ← Home
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{search.query}</h1>
        <p className="text-sm text-muted">
          {plan.intent === "question" ? "Question" : "Topic"} · {plan.subject}
        </p>
        {plan.question && <p className="mt-1">“{plan.question}”</p>}
        {plan.notes && <p className="mt-1 text-sm text-muted">{plan.notes}</p>}
      </header>

      <PlanWorkspace searchId={id} plan={plan} version={version} usdPerCredit={usdPerCredit()} initialProgress={prog} locked={locked} />
      <CatalogCard searchId={id} catalog={catalog} postCount={prog.totalPosts} />
    </main>
  );
}

/** The search's catalog with this search's counts (from SQL) and its three most mentioned models. */
async function catalogSummary(catalogId: number, searchId: number): Promise<CatalogSummary | null> {
  const found = await getCatalog(catalogId);
  if (!found) return null;
  const stats = await catalogStats(catalogId, searchId);
  const top = flatten(found.tree)
    .filter((n) => n.level === "model")
    .map((n) => ({ name: n.name, posts: stats.byNode[n.id] ?? 0 }))
    .filter((m) => m.posts > 0)
    .sort((a, b) => b.posts - a.posts)
    .slice(0, 3);
  return { id: catalogId, name: found.catalog.name, status: found.catalog.status, posts: stats.posts, postsNamingProduct: stats.postsNamingProduct, top };
}
