import Link from "next/link";
import { notFound } from "next/navigation";

import { usdPerCredit } from "@/connectors/reddit";
import { analysisState, analysisSummary, latestCodebook, needsLook, resultsVersion } from "@/lib/analysis";
import { referenceFor } from "@/lib/catalog-references";
import { catalogStats, ensureCatalogForSearch, getCatalog, waitingCount } from "@/lib/catalogs";
import { loadPlan, progress } from "@/lib/collect";
import { getSearch } from "@/lib/searches";

import { AnalysisPanel } from "./analysis-panel";
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
  // Older searches get linked to their family's catalog the first time they're opened (no AI, no cost).
  const catalogId = search.catalogId ?? (await ensureCatalogForSearch(id, plan.subject).catch(() => null));
  const catalog = catalogId ? await catalogLine(catalogId, id) : null;
  const [analysis, shown, codebook] = await Promise.all([analysisState(id), resultsVersion(id), latestCodebook(id)]);
  const [summary, look] = shown ? await Promise.all([analysisSummary(id, shown), needsLook(id, shown)]) : [null, []];

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
      {prog.totalPosts > 0 && (
        <AnalysisPanel key={`${analysis.version}-${analysis.status}`} searchId={id} subject={plan.subject} initial={analysis} summary={summary} look={look} codebook={codebook} ready={prog.finished} />
      )}
      {catalog && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-border bg-surface px-5 py-3 text-sm">
          <span className="text-muted">Products:</span>
          <Link href={`/catalogs/${catalog.id}`} className="font-medium underline hover:text-accent">
            {catalog.name} catalog
          </Link>
          <span className="text-muted">
            · {catalog.models} models{catalog.checkedAt && ` (checked against HP on ${catalog.checkedAt})`} · {catalog.named} of {catalog.posts} posts here name a
            model
          </span>
          {catalog.waiting > 0 && (
            <Link href={`/catalogs/${catalog.id}`} className="rounded-full bg-warning/20 px-2.5 py-0.5 font-medium hover:bg-warning/30">
              {catalog.waiting} new {catalog.waiting === 1 ? "model" : "models"} found → Review
            </Link>
          )}
        </p>
      )}
    </main>
  );
}

/** One line about the search's product catalog: size, how many of these posts name a model, and anything to review. */
async function catalogLine(catalogId: number, searchId: number) {
  const [found, stats, waiting] = await Promise.all([getCatalog(catalogId), catalogStats(catalogId, searchId), waitingCount(catalogId)]);
  if (!found) return null;
  const models = found.tree.children.filter((s) => !s.retired).reduce((n, s) => n + s.children.filter((m) => !m.retired).length, 0);
  return {
    id: catalogId,
    name: found.catalog.name.replace(/^HP\s+/i, ""),
    models,
    checkedAt: referenceFor(found.catalog.key)?.checkedAt ?? null,
    posts: stats.posts,
    named: stats.postsNamingProduct,
    waiting,
  };
}
