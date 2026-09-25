import Link from "next/link";

import { SourceCard } from "./source-card";

export const dynamic = "force-dynamic";

const has = (name: string) => Boolean(process.env[name]);

export default function SourcesPage() {
  const sources = [
    {
      source: "youtube" as const,
      title: "YouTube",
      via: "YouTube Data API",
      costNote: "free (daily quota)",
      env: ["YOUTUBE_API_KEY"],
      takesQuery: true,
    },
    {
      source: "reddit" as const,
      title: "Reddit",
      via: "ScrapeCreators",
      costNote: "1 credit ≈ $0.002 per test",
      env: ["SCRAPECREATORS_API_KEY"],
      takesQuery: true,
    },
    {
      source: "apify" as const,
      title: "Amazon (Apify)",
      via: "Apify",
      costNote: "free account check",
      env: ["APIFY_TOKEN"],
      takesQuery: false,
    },
  ];

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-12">
      <header>
        <Link href="/" className="text-sm text-muted underline">
          ← Home
        </Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Test sources</h1>
        <p className="text-muted">
          Each test makes one tiny real request with your keys and shows what came back. Nothing is saved except the cost.
        </p>
      </header>
      {sources.map(({ env, ...s }) => {
        const missing = env.filter((e) => !has(e));
        return <SourceCard key={s.source} {...s} missing={missing} />;
      })}
    </main>
  );
}
