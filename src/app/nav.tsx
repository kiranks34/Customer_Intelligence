import Link from "next/link";

import { getComparison } from "@/lib/compare";
import { getSearch } from "@/lib/searches";

import { ui } from "./ui";

/**
 * Where you are and how you got there (D47). Pages below Studies or Products show their path (every part but the
 * last is a link, named as in the top bar), and a page reached from the other section shows "← Back to …".
 */

export interface Crumb {
  label: string;
  href?: string;
}

export function Crumbs({ path }: { path: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 flex-wrap items-center gap-1.5 text-[13px] text-muted">
      {path.map((c, i) => (
        <span key={i} className="flex min-w-0 items-center gap-1.5">
          {i > 0 && (
            <span aria-hidden className="text-faint">
              ›
            </span>
          )}
          {c.href ? (
            <Link href={c.href} className="underline decoration-border underline-offset-[3px] hover:text-foreground">
              {c.label}
            </Link>
          ) : (
            <span aria-current="page" className="truncate font-semibold text-foreground">
              {c.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}

/** Where a link came from, carried as `?from=`: a study, a comparison, or New study on the home page. */
export type From = `study-${number}` | `compare-${number}` | "new";

export interface Back {
  href: string;
  label: string;
  /** The study's name, shown on hover (the label stays short, D47). */
  title?: string;
  from: From;
}

export async function backFor(raw: unknown): Promise<Back | null> {
  if (raw === "new") return { href: "/", label: "Back to New study", from: "new" };
  const c = typeof raw === "string" ? /^compare-(\d{1,9})$/.exec(raw) : null;
  if (c) {
    const id = Number(c[1]);
    const pair = await getComparison(id).catch(() => null);
    return pair ? { href: `/compare/${id}`, label: "Back to comparison", title: pair.title, from: `compare-${id}` } : null;
  }
  const m = typeof raw === "string" ? /^study-(\d{1,9})$/.exec(raw) : null;
  if (!m) return null;
  const id = Number(m[1]);
  const study = await getSearch(id).catch(() => null);
  return study ? { href: `/searches/${id}`, label: "Back to study", title: study.query, from: `study-${id}` } : null;
}

export function BackLink({ back }: { back: Back }) {
  return (
    <Link
      href={back.href}
      title={back.title}
      className={ui.back}
    >
      ← {back.label}
    </Link>
  );
}

/** Adds `from` to a link, keeping where you came from as you move within the section. */
export function withFrom(href: string, from: From | null | undefined): string {
  if (!from) return href;
  return `${href}${href.includes("?") ? "&" : "?"}from=${from}`;
}
