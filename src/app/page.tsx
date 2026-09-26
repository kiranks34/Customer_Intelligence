import { usdPerCredit } from "@/connectors/reddit";
import { claudeModel } from "@/lib/ai";
import { catalogStats, getCatalog, listFamilies } from "@/lib/catalogs";
import { monthToDate } from "@/lib/cost";
import { studyRows, type StudyRow } from "@/lib/studies";
import { PERIOD_CHOICES, type PeriodChoice, type SourceId } from "@/lib/study-setup";

import { AllStudies } from "./all-studies";
import { AppShell } from "./app-shell";
import { NewStudy, type NewStudyDefaults } from "./new-study";
import type { ListFamily } from "./picker-data";

export const dynamic = "force-dynamic";

/** Studies (home): start a study, and pick up the ones you have. */
export default async function Home({ searchParams }: PageProps<"/">) {
  const { catalog } = await searchParams;
  const spend = await monthToDate();
  const ok = spend.state === "ok";
  const [families, rows] = ok ? await Promise.all([pickerFamilies().catch(() => []), studyRows().catch(() => null)]) : [[], null];
  const left = ok ? Math.max(0, spend.status.budgetUsd - spend.status.spentUsd) : null;

  return (
    <AppShell active="studies">
      {!ok && (
        <p role="alert" className="text-sm text-critical">
          {spend.state === "unconfigured" ? "The database isn't connected." : "Couldn't read this month's spend, so nothing can start. Check the database connection."}
        </p>
      )}
      <NewStudy families={families} defaults={defaultsFor(families, rows ?? [], Number(catalog) || null)} leftUsd={left} usdPerCredit={usdPerCredit()} claudeModel={claudeModel()} />
      {rows === null ? (
        <p role="alert" className="text-sm text-critical">
          Couldn&apos;t load your studies. If you just updated Pulse, run the newest SQL file from drizzle/editor/ in Neon.
        </p>
      ) : (
        <AllStudies rows={rows} />
      )}
    </AppShell>
  );
}

/** New study starts from your last study's choices (or the family you came from in Products). */
function defaultsFor(families: ListFamily[], rows: StudyRow[], catalogId: number | null): NewStudyDefaults {
  const last = rows.find((r) => r.target && families.some((f) => f.id === r.target!.catalogId));
  const sources = (last?.sources ?? ["YouTube", "Reddit"]).map((s) => s.toLowerCase()).filter((s): s is SourceId => s === "youtube" || s === "reddit");
  const period = (PERIOD_CHOICES.find((p) => p.label === last?.period)?.id ?? "1y") as PeriodChoice;
  const fromProducts = catalogId && families.some((f) => f.id === catalogId) ? catalogId : null;
  const pick = fromProducts ? { catalogId: fromProducts, nodeId: null } : last?.target ?? { catalogId: families[0]?.id ?? 0, nodeId: null };
  return { ...pick, sources: sources.length ? sources : ["youtube", "reddit"], period };
}

/**
 * Every family with its active (not retired) series and models, and the posts collected so far for each (counted in
 * SQL across all studies), for the product picker.
 */
async function pickerFamilies(): Promise<ListFamily[]> {
  const families = await listFamilies();
  const loaded = await Promise.all(families.map(async (f) => Promise.all([getCatalog(f.id), catalogStats(f.id)])));
  return loaded
    .filter(([found]) => found !== null)
    .map(([found, stats]) => {
      const { catalog, tree } = found!;
      return {
        id: catalog.id,
        name: catalog.name,
        posts: stats.postsNamingProduct,
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
