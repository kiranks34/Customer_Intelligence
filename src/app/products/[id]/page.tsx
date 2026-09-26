import Link from "next/link";
import { notFound } from "next/navigation";

import { normalize } from "@/lib/catalog";
import { modelNote, sourcesByName } from "@/lib/catalog-reference";
import { referenceFor } from "@/lib/catalog-references";
import { catalogStats, getCatalog, listProposals, unverifiedNodes } from "@/lib/catalogs";
import { familyKnowledge, familyStudies } from "@/lib/product-knowledge";

import { AppShell } from "../../app-shell";
import { BackLink, backFor, Crumbs, withFrom } from "../../nav";
import { ui } from "../../ui";
import { CheckModels } from "./check-models";
import { KnowledgeTab } from "./knowledge-tab";
import { ModelsTab } from "./models-tab";

export const dynamic = "force-dynamic";

/** One product family: its series and models, and what Pulse knows about how it works. */
export default async function FamilyPage({ params, searchParams }: PageProps<"/products/[id]">) {
  const { id: raw } = await params;
  const { tab, from } = await searchParams;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const found = await getCatalog(id);
  if (!found) notFound();
  const { catalog, tree } = found;
  const ref = referenceFor(catalog.key);
  const [stats, proposals, unverified, knowledge, back, users] = await Promise.all([
    catalogStats(id),
    listProposals(id),
    unverifiedNodes(id),
    familyKnowledge(id),
    backFor(from),
    familyStudies(id),
  ]);
  const go = (href: string) => withFrom(href, back?.from);
  const onKnowledge = tab === "knowledge";
  const series = tree.children.filter((s) => !s.retired);
  const models = series.reduce((n, s) => n + s.children.filter((m) => !m.retired).length, 0);
  const facts = knowledge ? knowledge.knowledge.facts.filter((f) => f.status === "current").length : 0;
  const reference = ref
    ? {
        checkedAt: ref.checkedAt,
        sources: sourcesByName(ref),
        notes: Object.fromEntries(ref.series.flatMap((s) => s.models.map((m) => [normalize(m.name), modelNote(m)]))),
      }
    : null;
  const tabLink = (href: string, label: string, on: boolean) => (
    <Link href={href} aria-current={on ? "page" : undefined} className={on ? ui.tabOn : ui.tab}>
      {label}
    </Link>
  );

  return (
    <AppShell active="products">
      {back && <BackLink back={back} />}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Crumbs path={[{ label: "Products", href: go("/products") }, { label: catalog.name }]} />
          <h1 className={ui.pageTitle}>{catalog.name}</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
            {ref ? (
              <span className={ui.badgeGood}>✓ Verified on {ref.makerDomains[0] ?? "the maker's site"}</span>
            ) : (
              <span className={ui.badgeWarn}>Not verified yet</span>
            )}
            <span>
              {series.length} series · {models} models · {stats.postsNamingProduct.toLocaleString()} posts name one
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <CheckModels catalogId={id} />
          <Link href={`/?catalog=${id}`} className={ui.secondarySm}>
            Start a study →
          </Link>
        </div>
      </div>
      <section className={ui.card}>
        <nav aria-label="Family sections" className="flex gap-1 border-b border-border px-4 sm:px-6">
          {tabLink(go(`/products/${id}`), `Models · ${models}`, !onKnowledge)}
          {tabLink(go(`/products/${id}?tab=knowledge`), `Product knowledge · ${facts}`, onKnowledge)}
        </nav>
        {onKnowledge ? (
          knowledge && <KnowledgeTab data={knowledge} users={users} />
        ) : (
          <ModelsTab
            key={catalog.updatedAt.toISOString()}
            catalogId={id}
            tree={tree}
            byNode={stats.byNode}
            bySeries={stats.bySeries}
            reference={reference}
            proposals={proposals}
            unverified={unverified}
          />
        )}
      </section>
    </AppShell>
  );
}
