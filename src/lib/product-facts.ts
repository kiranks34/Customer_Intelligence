/**
 * Helpers for reading the maker's official pages (D44, D45): which pages count as the maker's, and the pages a search
 * returned. The rules for keeping a fact are in knowledge.ts. Pure: no DB, no network.
 */

/** A page the search returned: its address, title and the text the search read from it. */
export interface SearchPage {
  url: string;
  title: string;
  snippet: string;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
};

/** An https page on one of the domains (or a subdomain, e.g. support.hp.com for hp.com). */
export function onDomains(url: string, domains: string[]): boolean {
  const host = hostOf(url);
  return url.startsWith("https://") && host !== null && domains.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Pages found in the search tool's results (the gateway's Perplexity search), whatever else the steps hold. */
export function pagesFrom(outputs: unknown[]): SearchPage[] {
  const pages: SearchPage[] = [];
  for (const o of outputs) {
    const results = (o as { results?: unknown })?.results;
    if (!Array.isArray(results)) continue;
    for (const r of results) {
      const { url, title, snippet } = (r ?? {}) as Record<string, unknown>;
      if (typeof url === "string") pages.push({ url, title: typeof title === "string" ? title : "", snippet: typeof snippet === "string" ? snippet : "" });
    }
  }
  return pages;
}
