"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { buildCatalogAction } from "../../catalogs/actions";

export interface CatalogSummary {
  id: number;
  name: string;
  status: "draft" | "approved";
  posts: number;
  postsNamingProduct: number;
  top: { name: string; posts: number }[];
}

/** The search's product catalog: build it once collection has posts, then review it on its own page. */
export function CatalogCard({ searchId, catalog, postCount }: { searchId: number; catalog: CatalogSummary | null; postCount: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function build() {
    setMessage(null);
    startTransition(async () => {
      const r = await buildCatalogAction(searchId);
      if (r.ok) router.push(`/catalogs/${r.catalogId}`);
      else setMessage(r.message);
    });
  }

  return (
    <section aria-labelledby="catalog-heading" className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
      <h2 id="catalog-heading" className="text-lg font-medium">
        Product catalog
      </h2>
      {catalog ? (
        <>
          <p className="text-sm">
            <span className="font-medium">{catalog.name}</span>{" "}
            <span className="text-muted">
              · {catalog.status === "approved" ? "approved" : "draft, not reviewed yet"} · {catalog.postsNamingProduct} of {catalog.posts} posts here name a
              series or model
            </span>
          </p>
          {catalog.top.length > 0 && (
            <p className="text-sm text-muted">Most mentioned: {catalog.top.map((m) => `${m.name} (${m.posts})`).join(", ")}</p>
          )}
          <Link href={`/catalogs/${catalog.id}`} className="self-start rounded-lg border border-border px-4 py-2 text-sm font-medium hover:border-accent">
            {catalog.status === "approved" ? "Open catalog" : "Review catalog"}
          </Link>
        </>
      ) : (
        <>
          <p className="text-sm text-muted">
            Lists the family&apos;s series and models, and links each post to the models it names. Drafted once per family from the model names in
            these posts (about $0.02), then shared by later searches.
          </p>
          <button
            type="button"
            onClick={build}
            disabled={pending || postCount === 0}
            className="self-start rounded-lg bg-accent px-5 py-2 font-medium text-white disabled:opacity-60"
          >
            {pending ? "Drafting… (up to a minute)" : "Build product catalog"}
          </button>
          {postCount === 0 && <p className="text-xs text-muted">Run a collection first.</p>}
        </>
      )}
      {message && (
        <p role="alert" className="text-sm text-critical">
          {message}
        </p>
      )}
    </section>
  );
}
