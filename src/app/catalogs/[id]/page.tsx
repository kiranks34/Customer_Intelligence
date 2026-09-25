import Link from "next/link";
import { notFound } from "next/navigation";

import { normalize } from "@/lib/catalog";
import { modelNote, sourcesByName } from "@/lib/catalog-reference";
import { referenceFor } from "@/lib/catalog-references";
import { catalogStats, getCatalog } from "@/lib/catalogs";

import { CatalogBrowser } from "./catalog-browser";

export const dynamic = "force-dynamic";

export default async function CatalogPage({ params }: PageProps<"/catalogs/[id]">) {
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const found = await getCatalog(id);
  if (!found) notFound();
  const { catalog, tree } = found;
  const stats = await catalogStats(id);
  const pct = stats.posts ? Math.round((stats.postsNamingProduct / stats.posts) * 100) : 0;
  const ref = referenceFor(catalog.key);
  const reference = ref
    ? {
        checkedAt: ref.checkedAt,
        sources: sourcesByName(ref),
        notes: Object.fromEntries(ref.series.flatMap((s) => s.models.map((m) => [normalize(m.name), modelNote(m)]))),
      }
    : null;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-1">
        <Link href="/" className="text-sm text-muted underline">
          ← Home
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Product catalog</h1>
        <p className="text-sm text-muted">
          {stats.postsNamingProduct.toLocaleString()} of {stats.posts.toLocaleString()} posts ({pct}%) name a series or model, across {stats.searches}{" "}
          {stats.searches === 1 ? "search" : "searches"}.
        </p>
      </header>
      <CatalogBrowser key={catalog.updatedAt.toISOString()} catalogId={id} tree={tree} status={catalog.status} byNode={stats.byNode} bySeries={stats.bySeries} reference={reference} />
    </main>
  );
}
