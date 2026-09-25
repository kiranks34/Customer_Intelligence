import Link from "next/link";
import { notFound } from "next/navigation";

import { usdPerCredit } from "@/connectors/reddit";
import { loadPlan, progress } from "@/lib/collect";
import { getSearch } from "@/lib/searches";

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
    </main>
  );
}
