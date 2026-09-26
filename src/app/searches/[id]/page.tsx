import Link from "next/link";
import { notFound } from "next/navigation";

import { usdPerCredit } from "@/connectors/reddit";
import { claudeModel } from "@/lib/ai";
import { analysisState, analysisSummary, journeyQuotes, latestCodebook, needsLook, resultsVersion, spotCheckAccuracy, spotCheckItems, type AnalysisSummary } from "@/lib/analysis";
import { factKey } from "@/lib/knowledge";
import { ensureCatalogForSearch, getCatalog, waitingCount } from "@/lib/catalogs";
import { loadPlan, progress } from "@/lib/collect";
import { knowledgeForSearch } from "@/lib/product-knowledge";
import { getSearch } from "@/lib/searches";
import { periodText, saveHeadline } from "@/lib/studies";

import { AppShell } from "../../app-shell";
import { dot, ui } from "../../ui";
import { Improve } from "./improve";
import { PlanWorkspace } from "./plan-workspace";
import { Results } from "./results";
import { StudyActions } from "./study-actions";
import { StudyRunner } from "./study-runner";
import { LocalTime } from "../../local-time";

export const dynamic = "force-dynamic";

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

  // Open work only moves while this page drives it (`?run=1` starts that); otherwise it waits for Resume.
  const unfinished = !prog.finished || analysis.status === "running";
  const status =
    prog.jobs.waiting > 0 || analysis.status === "paused" || analysis.status === "failed" || (unfinished && run !== "1")
      ? { tone: "muted" as const, text: "Paused" }
      : unfinished
        ? { tone: "info" as const, text: !prog.finished ? "Collecting" : "Reading posts" }
      : summary
        ? open > 0
          ? { tone: "warn" as const, text: "To review" }
          : { tone: "good" as const, text: "Ready" }
        : { tone: "muted" as const, text: "Not analyzed" };
  const inStudy = new Set([...(codebook?.codebook.productFacts ?? []).map((f) => factKey(f.text.replace(/ \([^)]*\)$/, ""))), ...(codebook?.codebook.productNotes ?? "").split("\n").map(factKey)]);
  const familyFacts = knowledge ? knowledge.knowledge.facts.filter((f) => f.status === "current") : [];

  return (
    <AppShell active="studies">
      <div className="flex flex-col gap-2">
        <Link href="/" className="text-[13px] text-muted hover:text-foreground">
          All studies ›
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="text-[26px] leading-tight font-bold tracking-tight">{search.query}</h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
              <span className="flex gap-1">
                {SOURCE_BADGES(plan).map((s) => (
                  <span key={s} className="inline-flex h-[22px] items-center rounded-md border border-border bg-surface-2 px-1.5 text-[11px] font-bold">
                    {s}
                  </span>
                ))}
              </span>
              <span>{periodText(plan)}</span>
              <span className="h-3.5 w-px bg-border" aria-hidden />
              <span>Started <LocalTime iso={search.createdAt.toISOString()} /></span>
              {family && (
                <>
                  <span className="h-3.5 w-px bg-border" aria-hidden />
                  <Link href={`/products/${family.id}`} className="underline underline-offset-2 hover:text-foreground">
                    {family.name}
                  </Link>
                  {family.waiting > 0 && (
                    <Link href={`/products/${family.id}`} className="font-semibold text-accent underline underline-offset-2">
                      {family.waiting} new {family.waiting === 1 ? "model" : "models"} found →
                    </Link>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-2 text-[13px] font-semibold">
              <span className={`h-2 w-2 rounded-full ${dot[status.tone]}`} aria-hidden />
              {status.text}
            </span>
            <StudyActions id={id} title={search.query} busy={unfinished} />
          </div>
        </div>
        {plan.question && <p className="rounded-r-[10px] border-l-[3px] border-accent bg-surface px-3.5 py-2.5 text-sm">“{plan.question}”</p>}
      </div>

      {summary && (
        <nav aria-label="On this page" className="sticky top-0 z-10 -my-2 flex flex-wrap gap-1.5 border-b border-border bg-background py-2.5">
          {[
            ["overview", "Overview"],
            ["journey", "Journey"],
            ["themes", "Themes"],
            ["touchpoints", "Touchpoints"],
            ["competitors", "Competitors"],
            ["improve", "Improve results"],
          ].map(([anchor, label]) => (
            <a key={anchor} href={`#${anchor}`} className="inline-flex h-[30px] items-center rounded-full border border-border px-3 text-[13px] text-muted hover:text-foreground">
              {label}
            </a>
          ))}
        </nav>
      )}

      {prog.totalPosts > 0 || !prog.finished ? (
        <StudyRunner key={`${analysis.version}-${analysis.status}-${prog.finished}`} searchId={id} progress={prog} analysis={analysis} autorun={run === "1"} />
      ) : (
        <section className={`${ui.card} px-6 py-8 text-center text-sm text-muted`}>No posts collected yet. Press Run again to collect.</section>
      )}

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
          knowledge={
            knowledge
              ? {
                  catalogId: knowledge.catalogId,
                  facts: familyFacts.length,
                  updatedAt: knowledge.knowledge.checkedAt,
                  newSince: familyFacts.filter((f) => !inStudy.has(factKey(f.text))).length,
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
          <PlanWorkspace searchId={id} plan={plan} version={version} usdPerCredit={usdPerCredit()} initialProgress={prog} locked={locked} />
        </div>
      </details>
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
