import Link from "next/link";
import { notFound } from "next/navigation";

import { usdPerCredit } from "@/connectors/reddit";
import { loadPlan, progress } from "@/lib/collect";
import { estimatePlan } from "@/lib/plan";
import { getSearch } from "@/lib/searches";

import { CollectionPanel } from "./collection-panel";
import { PlanEditor } from "./plan-editor";

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
  const est = estimatePlan(plan, usdPerCredit());
  const prog = await progress(id);
  const locked = !prog.finished;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-1">
        <Link href="/" className="text-sm text-muted underline">
          ← Home
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{search.query}</h1>
        <p className="text-sm text-muted">
          {plan.intent === "question" ? "Question" : "Topic"} · {plan.subject} · {plan.timeWindow.label} · plan v{version}
        </p>
        {plan.question && <p className="mt-1">“{plan.question}”</p>}
        {plan.notes && <p className="mt-1 text-sm text-muted">{plan.notes}</p>}
      </header>

      <section aria-labelledby="estimate-heading" className="rounded-xl border border-border bg-surface p-5">
        <h2 id="estimate-heading" className="text-lg font-medium">
          Estimate for this plan
        </h2>
        <dl className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted">Up to posts</dt>
            <dd className="text-xl font-semibold tabular-nums">{est.maxPosts}</dd>
          </div>
          <div>
            <dt className="text-muted">Reddit credits (max)</dt>
            <dd className="text-xl font-semibold tabular-nums">{est.redditCredits}</dd>
          </div>
          <div>
            <dt className="text-muted">Collection cost (max)</dt>
            <dd className="text-xl font-semibold tabular-nums">${est.usd.toFixed(3)}</dd>
          </div>
          <div>
            <dt className="text-muted">YouTube quota units</dt>
            <dd className="text-xl font-semibold tabular-nums">{est.youtubeQuotaUnits}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-muted">YouTube is free up to 10,000 units a day. Posts are only counted inside the period above.</p>
      </section>

      <CollectionPanel searchId={id} initial={prog} />

      <section aria-labelledby="plan-heading" className="rounded-xl border border-border bg-surface p-5">
        <h2 id="plan-heading" className="mb-3 text-lg font-medium">
          Plan
        </h2>
        <PlanEditor searchId={id} plan={plan} version={version} locked={locked} />
      </section>
    </main>
  );
}
