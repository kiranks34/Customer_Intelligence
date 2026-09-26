import Link from "next/link";
import { count, eq, and, isNull } from "drizzle-orm";

import { requireDb } from "@/db/client";
import { searches } from "@/db/schema";
import { referenceFor } from "@/lib/catalog-references";
import { catalogStats, getCatalog, listFamilies } from "@/lib/catalogs";
import { familyKnowledge } from "@/lib/product-knowledge";

import { AppShell } from "../app-shell";
import { SourceCard } from "../sources/source-card";
import { ui } from "../ui";
import { AddFamily } from "./add-family";
import { LocalTime } from "../local-time";

export const dynamic = "force-dynamic";

const SOURCES = [
  { source: "youtube" as const, title: "YouTube", via: "YouTube Data API", costNote: "free (daily quota)", env: ["YOUTUBE_API_KEY"], takesQuery: true },
  { source: "reddit" as const, title: "Reddit", via: "ScrapeCreators", costNote: "1 credit ≈ $0.002 per test", env: ["SCRAPECREATORS_API_KEY"], takesQuery: true },
];

/** Products: the families Pulse listens for (their models and product knowledge), and the sources it reads. */
export default async function ProductsPage({ searchParams }: PageProps<"/products">) {
  const { tab } = await searchParams;
  const onSources = tab === "sources";
  const families = onSources ? [] : await familyCards();
  const tabLink = (href: string, label: string, on: boolean) => (
    <Link href={href} aria-current={on ? "page" : undefined} className={`-mb-px border-b-2 px-3.5 py-3 text-sm font-semibold ${on ? "border-accent text-foreground" : "border-transparent text-muted hover:text-foreground"}`}>
      {label}
    </Link>
  );

  return (
    <AppShell active="products">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Products</h1>
          <p className="text-[13px] text-muted">The products Pulse listens for, and what it knows about them.</p>
        </div>
        {!onSources && families.length > 0 && <AddFamily compact />}
      </div>
      <nav aria-label="Products sections" className="-mt-2 flex gap-1 border-b border-border">
        {tabLink("/products", "Product families", !onSources)}
        {tabLink("/products?tab=sources", "Sources", onSources)}
      </nav>

      {onSources ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">Where Pulse collects posts. Each test makes one tiny real request with your keys and shows what came back.</p>
          {SOURCES.map(({ env, ...s }) => (
            <SourceCard key={s.source} {...s} missing={env.filter((e) => !process.env[e])} />
          ))}
        </div>
      ) : families.length === 0 ? (
        <section className={`${ui.card} flex flex-col items-center gap-4 px-6 py-14 text-center`}>
          <h2 className="text-lg font-bold">Add the first product family</h2>
          <p className="max-w-md text-sm text-muted">Type the family name, e.g. HP Smart Tank. You then add its series and models, and Pulse learns how it works from the maker&apos;s support pages.</p>
          <AddFamily />
        </section>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {families.map((f) => (
            <section key={f.id} className={`${ui.card} flex flex-col gap-4 px-6 py-5`}>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[17px] font-bold">
                  <Link href={`/products/${f.id}`} className="hover:underline">
                    {f.name}
                  </Link>
                </h2>
                {f.verified ? (
                  <span className="inline-flex h-[22px] items-center rounded-full border border-good/60 px-2 text-xs font-semibold text-good">✓ Verified</span>
                ) : (
                  <span className="inline-flex h-[22px] items-center rounded-full border border-warning/60 px-2 text-xs font-semibold text-warning">Not verified yet</span>
                )}
              </div>
              <div className="flex flex-wrap gap-x-7 gap-y-2 text-[13px] text-muted">
                {[
                  [f.series, "series"],
                  [f.models, "models"],
                  [f.facts, "facts"],
                  [f.posts.toLocaleString(), "posts name one"],
                ].map(([v, l]) => (
                  <span key={l}>
                    <b className="block text-lg text-foreground">{v}</b>
                    {l}
                  </span>
                ))}
              </div>
              <p className={ui.meta}>
                {f.checkedAt ? (
                  <>
                    Product knowledge updated <LocalTime iso={f.checkedAt} />
                  </>
                ) : (
                  "No product knowledge yet"
                )} · {f.studies === 1 ? "1 study" : `${f.studies} studies`}
              </p>
              {!f.checkedAt && f.canUpdate && (
                <div className={ui.noticeWarn}>
                  <span className="min-w-48 flex-1">Studies of {f.name} are read without product knowledge.</span>
                  <Link href={`/products/${f.id}?tab=knowledge`} className={ui.secondarySm}>
                    Update from {f.site} →
                  </Link>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/products/${f.id}`} className={ui.plainSm}>
                  Models
                </Link>
                <Link href={`/products/${f.id}?tab=knowledge`} className={ui.plainSm}>
                  Product knowledge
                </Link>
                <span className="flex-1" />
                <Link href={`/?catalog=${f.id}`} className={ui.secondarySm}>
                  Start a study →
                </Link>
              </div>
            </section>
          ))}
        </div>
      )}
    </AppShell>
  );
}

async function familyCards() {
  const list = await listFamilies().catch(() => []);
  const db = requireDb();
  const rows = await Promise.all(
    list.map(async (f) => {
      const [found, stats, knowledge, [used]] = await Promise.all([
        getCatalog(f.id),
        catalogStats(f.id),
        familyKnowledge(f.id, 0).catch(() => null),
        db.select({ n: count() }).from(searches).where(and(eq(searches.catalogId, f.id), isNull(searches.hiddenAt))),
      ]);
      if (!found) return null;
      const series = found.tree.children.filter((s) => !s.retired);
      return {
        id: f.id,
        name: found.catalog.name,
        verified: referenceFor(found.catalog.key) !== null,
        series: series.length,
        models: series.reduce((n, s) => n + s.children.filter((m) => !m.retired).length, 0),
        facts: knowledge ? knowledge.knowledge.facts.filter((x) => x.status === "current").length : 0,
        posts: stats.postsNamingProduct,
        checkedAt: knowledge?.knowledge.checkedAt ?? null,
        canUpdate: (knowledge?.domains.length ?? 0) > 0,
        site: knowledge?.domains[0] ?? "",
        studies: used?.n ?? 0,
      };
    }),
  );
  return rows.filter((r) => r !== null);
}
