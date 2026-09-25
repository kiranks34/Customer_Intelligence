import Link from "next/link";
import { notFound } from "next/navigation";

import { catalogStats, getCatalog, uncoveredMentions } from "@/lib/catalogs";

import { CatalogEditor } from "./catalog-editor";

export const dynamic = "force-dynamic";

export default async function CatalogPage({ params }: PageProps<"/catalogs/[id]">) {
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const found = await getCatalog(id);
  if (!found) notFound();
  const { catalog, tree } = found;
  const [stats, uncovered] = await Promise.all([catalogStats(id), uncoveredMentions(id, tree)]);
  const pct = stats.posts ? Math.round((stats.postsNamingProduct / stats.posts) * 100) : 0;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-1">
        <Link href="/" className="text-sm text-muted underline">
          ← Home
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{catalog.name} catalog</h1>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${catalog.status === "approved" ? "bg-accent/15 text-accent" : "bg-warning/20"}`}>
            {catalog.status === "approved" ? "Approved" : "Draft: review and approve"}
          </span>
        </div>
        <p className="text-sm text-muted">
          {stats.postsNamingProduct.toLocaleString()} of {stats.posts.toLocaleString()} posts ({pct}%) name a series or model, across {stats.searches}{" "}
          {stats.searches === 1 ? "search" : "searches"}. The rest talk about the family in general. Shared by every search of this family.
        </p>
      </header>
      <CatalogEditor key={catalog.updatedAt.toISOString()} catalogId={id} tree={tree} status={catalog.status} counts={stats.byNode} posts={stats.posts} uncovered={uncovered} />
    </main>
  );
}
