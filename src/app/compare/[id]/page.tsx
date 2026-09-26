import Link from "next/link";
import { notFound } from "next/navigation";

import { draftUsd, latestCodebook, spotCheckAccuracy } from "@/lib/analysis";
import { getComparison } from "@/lib/compare";
import { factsNotUsed } from "@/lib/knowledge";
import { knowledgeForSearch } from "@/lib/product-knowledge";
import { periodText } from "@/lib/studies";
import { loadSide, type Side } from "@/lib/study-side";

import { AppShell } from "../../app-shell";
import { LocalTime } from "../../local-time";
import { Crumbs, withFrom } from "../../nav";
import { ui } from "../../ui";
import { HeaderStep, StudyBar, StudyControl, StudyProgress, type StudyFacts } from "../../searches/[id]/study-control";
import { CompareImprove, type ImproveSide } from "./compare-improve";
import { CompareResults, SideName } from "./compare-results";

export const dynamic = "force-dynamic";

/** Posts about the product below this, and a side's numbers are a rough guide only. */
const THIN = 30;

/**
 * A comparison study (D48): both products' progress in one bar, then their results side by side. Each side stays a
 * study of its own (its answers, settings and product knowledge), reached from here.
 */
export default async function ComparePage({ params, searchParams }: PageProps<"/compare/[id]">) {
  const { id: raw } = await params;
  const { run } = await searchParams;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const pair = await getComparison(id);
  if (!pair) notFound();
  const [a, b] = await Promise.all([loadSide(pair.a), loadSide(pair.b)]);
  if (!a || !b) notFound();
  const sides: [Side, Side] = [a, b];

  const facts: StudyFacts = { kind: "comparison", id, title: pair.title, autorun: run === "1", sides: [a.facts, b.facts] };
  const both = a.summary && b.summary ? ([a, b] as const) : null;
  const plan = a.plan;
  const sources = [plan.youtube.enabled && "YouTube", plan.reddit.enabled && "Reddit"].filter((x): x is string => !!x);
  const from = `compare-${id}` as const;

  const improveSides: ImproveSide[] = await Promise.all(
    sides.map(async (s) => {
      const [accuracy, knowledge, codebook] = await Promise.all([
        s.shown ? spotCheckAccuracy(s.facts.searchId, s.shown) : null,
        knowledgeForSearch(s.facts.searchId),
        latestCodebook(s.facts.searchId),
      ]);
      const sure = accuracy ? accuracy.questions.reduce((t, q) => t + q.sure, 0) : 0;
      const right = accuracy ? accuracy.questions.reduce((t, q) => t + q.right, 0) : 0;
      return {
        searchId: s.facts.searchId,
        label: s.facts.label,
        needsLook: s.summary?.relevance.needsLook ?? 0,
        answers: s.facts.openAnswers,
        agrees: accuracy && accuracy.checked > 0 && sure ? Math.round((right / sure) * 100) : null,
        knowledge: knowledge
          ? {
              href: withFrom(`/products/${knowledge.catalogId}?tab=knowledge`, from),
              facts: knowledge.knowledge.facts.filter((f) => f.status === "current").length,
              notUsed: codebook ? factsNotUsed(knowledge.knowledge, codebook.codebook) : 0,
            }
          : null,
      };
    }),
  );
  const shared = await latestCodebook(a.facts.searchId);
  const thin = both ? sides.filter((s) => (s.summary?.relevance.counted ?? 0) < THIN) : [];

  return (
    <AppShell active="studies">
      <StudyControl facts={facts}>
        <div className="flex flex-col gap-2">
          <Crumbs path={[{ label: "Studies", href: "/" }, { label: pair.title }]} />
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
            <div className="flex min-w-0 flex-col gap-2">
              <h1 id="study-title" className={ui.pageTitle}>
                {pair.title}
              </h1>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
                <span>Comparison</span>
                <span className="flex gap-1">
                  {sources.map((s) => (
                    <span key={s} className={ui.sourceBadge}>
                      {s}
                    </span>
                  ))}
                </span>
                <span>
                  {periodText(plan)} · Started <LocalTime iso={pair.createdAt.toISOString()} />
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
                {sides.map((s, i) => (
                  <Link key={i} href={`/searches/${s.facts.searchId}?from=${from}`} className="inline-flex items-center gap-1.5 hover:text-foreground">
                    <SideName i={i} label={s.facts.label} />
                    <span className={ui.link}>its study →</span>
                  </Link>
                ))}
              </div>
            </div>
            <HeaderStep />
          </div>
          {plan.question && <p className="mt-1 rounded-r-[10px] border-l-[3px] border-accent bg-surface px-3.5 py-2.5 text-sm">“{plan.question}”</p>}
        </div>

        <StudyBar
          sections={
            both
              ? [
                  ["overview", "Overview"],
                  ["themes", "Themes"],
                  ["journey", "Journey"],
                  ["touchpoints", "Touchpoints"],
                  ["competitors", "Competitors"],
                  ["people", "People"],
                  ["improve", "Improve results"],
                ]
              : []
          }
        />
        <div className="flex flex-col gap-6">
          <StudyProgress />
          {both && (
            <>
              <div className={ui.noticeInfo}>
                <span className="min-w-56 flex-1">
                  <b>Same rules for both:</b> sources, period, search depth and categories. Numbers are shares of each side&apos;s own posts about it
                  {` (${a.summary!.relevance.counted} and ${b.summary!.relevance.counted}).`}
                  {thin.length > 0 && ` ${thin.map((s) => s.facts.label).join(" and ")}: fewer than ${THIN} posts, so a rough guide.`}
                </span>
              </div>
              <CompareResults
                sides={[
                  { searchId: a.facts.searchId, label: a.facts.label, summary: a.summary!, quotes: a.quotes },
                  { searchId: b.facts.searchId, label: b.facts.label, summary: b.summary!, quotes: b.quotes },
                ]}
              />
              <CompareImprove
                compareId={id}
                sides={improveSides}
                codebook={shared ? { searchId: a.facts.searchId, codebook: shared.codebook, version: shared.version } : null}
                improveUsd={draftUsd()}
              />
            </>
          )}
        </div>
      </StudyControl>
    </AppShell>
  );
}
