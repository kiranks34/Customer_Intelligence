import Link from "next/link";
import { notFound } from "next/navigation";

import { usdPerCredit } from "@/connectors/reddit";
import { claudeModel } from "@/lib/ai";
import { analysisState, draftUsd, analysisSummary, journeyQuotes, latestCodebook, needsLook, resultsVersion, spotCheckAccuracy, spotCheckItems, type AnalysisSummary } from "@/lib/analysis";
import { jevUsd } from "@/lib/codebook";
import { factsNotUsed } from "@/lib/knowledge";
import { estimatePlan } from "@/lib/plan";
import { ensureCatalogForSearch, getCatalog, waitingCount } from "@/lib/catalogs";
import { loadPlan, progress } from "@/lib/collect";
import { knowledgeForSearch } from "@/lib/product-knowledge";
import { getSearch } from "@/lib/searches";
import { periodText, saveHeadline } from "@/lib/studies";

import { AppShell } from "../../app-shell";
import { LocalTime } from "../../local-time";
import { Crumbs, withFrom } from "../../nav";
import { ui } from "../../ui";
import { Improve } from "./improve";
import { PlanWorkspace } from "./plan-workspace";
import { Results } from "./results";
import { HeaderStep, StudyBar, StudyControl, StudyProgress } from "./study-control";

export const dynamic = "force-dynamic";

/** Jev's input per post, typical (post, context and questions), for the Collect new posts estimate. */
const JEV_TOKENS_PER_POST = 1_400;

const SOURCE_BADGES = (plan: { youtube: { enabled: boolean }; reddit: { enabled: boolean } }) =>
  [plan.youtube.enabled && "YouTube", plan.reddit.enabled && "Reddit"].filter((x): x is string => !!x);

/** A study (D46): progress while it runs, then its results and the optional ways to improve them. */
export default async function StudyPage({ params, searchParams }: PageProps<"/searches/[id]">) {
  const { id: raw } = await params;
  const { run } = await searchParams;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const search = await getSearch(id);
  if (!search) notFound();
  const latest = await loadPlan(id);
  if (!latest) notFound();
  const { plan, version } = latest;

  const prog = await progress(id);
  const locked = !prog.finished || prog.jobs.waiting > 0;
  const catalogId = search.catalogId ?? (await ensureCatalogForSearch(id, plan.subject).catch(() => null));
  const [analysis, shown, codebook, knowledge, family] = await Promise.all([
    analysisState(id),
    resultsVersion(id),
    latestCodebook(id),
    knowledgeForSearch(id),
    catalogId ? familyLine(catalogId) : null,
  ]);
  const [summary, look, checkItems, accuracy, quotes] = shown
    ? await Promise.all([analysisSummary(id, shown), needsLook(id, shown), spotCheckItems(id, shown), spotCheckAccuracy(id, shown), journeyQuotes(id, shown)])
    : [null, [], [], null, []];
  const open = accuracy ? accuracy.questions.reduce((n, q) => n + q.open, 0) : 0;
  if (summary) await saveHeadline(id, headlineOf(summary, open)).catch(() => undefined);

  const notUsed = knowledge && codebook ? factsNotUsed(knowledge.knowledge, codebook.codebook) : 0;
  const est = estimatePlan(plan, usdPerCredit());
  const facts = {
    searchId: id,
    title: search.query,
    progress: prog,
    analysis,
    autorun: run === "1",
    hasResults: shown !== null,
    newerCategories: shown !== null && analysis.version !== null && analysis.version > shown ? analysis.version : null,
    factsNotUsed: notUsed,
    openAnswers: open,
    collectUsd: est.usd + jevUsd(est.maxPosts * JEV_TOKENS_PER_POST),
  };
  const familyFacts = knowledge ? knowledge.knowledge.facts.filter((f) => f.status === "current") : [];
  const from = `study-${id}` as const;

  return (
    <AppShell active="studies">
      <StudyControl facts={facts}>
      <div className="flex flex-col gap-2">
        <Crumbs path={[{ label: "Studies", href: "/" }, { label: search.query }]} />
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-col gap-2">
            <h1 id="study-title" className={ui.pageTitle}>
              {search.query}
            </h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
              <span className="flex gap-1">
                {SOURCE_BADGES(plan).map((s) => (
                  <span key={s} className={ui.sourceBadge}>
                    {s}
                  </span>
                ))}
              </span>
              <span>
                {periodText(plan)} · Started <LocalTime iso={search.createdAt.toISOString()} />
              </span>
            </div>
            {family && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
                <span>
                  Product family:{" "}
                  <Link href={withFrom(`/products/${family.id}`, from)} className={ui.link}>
                    {family.name} →
                  </Link>
                </span>
                {family.waiting > 0 && (
                  <Link href={withFrom(`/products/${family.id}`, from)} className={ui.link}>
                    {family.waiting} new {family.waiting === 1 ? "model" : "models"} found →
                  </Link>
                )}
              </div>
            )}
          </div>
          <HeaderStep />
        </div>
        {plan.question && <p className="mt-1 rounded-r-[10px] border-l-[3px] border-accent bg-surface px-3.5 py-2.5 text-sm">“{plan.question}”</p>}
      </div>

        <StudyBar
          sections={
            summary
              ? [
                  ["overview", "Overview"],
                  ["journey", "Journey"],
                  ["themes", "Themes"],
                  ["touchpoints", "Touchpoints"],
                  ["competitors", "Competitors"],
                  ["improve", "Improve results"],
                ]
              : []
          }
        />
        <div className="flex flex-col gap-6">
          <StudyProgress />

          {summary && <Results summary={summary} subject={plan.subject} quotes={quotes} />}

          {summary && shown && (
            <Improve
              searchId={id}
              version={shown}
              look={look}
              lookTotal={summary.relevance.needsLook}
              check={accuracy ? { items: checkItems, accuracy } : null}
              summaryCodebook={summary.codebook}
              codebook={codebook}
              claudeModel={claudeModel()}
              improveUsd={draftUsd()}
              knowledge={
                knowledge
                  ? {
                      href: withFrom(`/products/${knowledge.catalogId}?tab=knowledge`, from),
                      facts: familyFacts.length,
                      site: knowledge.domains[0] ?? null,
                      notUsed,
                    }
                  : null
              }
            />
          )}

          <details id="settings" className={`${ui.card} group`}>
            <summary className="cursor-pointer px-6 py-4 text-sm font-bold select-none">
              Search settings <span className="font-normal text-muted">· what Pulse searches for, and how much it collects</span>
            </summary>
            <div className="flex flex-col gap-6 border-t border-border px-4 py-5 sm:px-6">
              <PlanWorkspace searchId={id} plan={plan} version={version} usdPerCredit={usdPerCredit()} locked={locked} />
            </div>
          </details>
        </div>
      </StudyControl>
      <p className="text-xs text-muted">
        Jev reads every post. Claude ({claudeModel()}
        {process.env.PULSE_CLAUDE_MODEL?.trim() ? ", from your PULSE_CLAUDE_MODEL setting" : ", the default; set PULSE_CLAUDE_MODEL to change it"}) drafts the
        categories and runs the auto-check.
      </p>
    </AppShell>
  );
}

/** The one-line result All studies shows (counted base, never all collected posts). */
function headlineOf(s: AnalysisSummary, toReview: number) {
  const counted = s.relevance.counted;
  const n = (key: string) => s.sentiment.find((t) => t.key === key)?.counted ?? 0;
  const pain = [...s.themes].filter((t) => t.kind === "pain" && t.counted > 0).sort((a, b) => b.counted - a.counted)[0];
  return {
    counted,
    negativePct: counted ? Math.round((n("negative") / counted) * 100) : 0,
    positivePct: counted ? Math.round((n("positive") / counted) * 100) : 0,
    topPain: pain ? pain.label : null,
    toReview,
  };
}

async function familyLine(catalogId: number) {
  const [found, waiting] = await Promise.all([getCatalog(catalogId), waitingCount(catalogId)]);
  return found ? { id: catalogId, name: found.catalog.name, waiting } : null;
}
