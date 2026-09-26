/**
 * Facts about how a product works, from the maker's official pages (D44). Claude searches only the maker's sites and
 * must quote the page for every fact; a fact is kept only when its page was in the search results and its quote is
 * really on that page, so nothing comes from Claude's memory. Pure: no DB, no network.
 */
import { normalize } from "./catalog";
import { PRODUCT_FACTS_MAX, type ProductFact } from "./codebook";

/** A page the search returned: its address, title and the text the search read from it. */
export interface SearchPage {
  url: string;
  title: string;
  snippet: string;
}

/** What Claude proposes: a fact, the page and a phrase copied from that page. */
export interface DraftFact {
  text: string;
  url: string;
  quote: string;
}

/** The facts stored with a catalog: shared by every search of that family. */
export interface CatalogFacts {
  facts: ProductFact[];
  /** When they were looked up (ISO date). */
  checkedAt: string;
  domains: string[];
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

/** The same page, whatever the fragment or a trailing slash. */
const samePage = (url: string) => url.replace(/#.*$/, "").replace(/\/+$/, "");

/**
 * Keeps the facts that are backed by a page the search returned (on the maker's domains) and whose quote appears on
 * it; drops repeats; at most PRODUCT_FACTS_MAX.
 */
export function verifiedFacts(drafts: DraftFact[], pages: SearchPage[], domains: string[]): ProductFact[] {
  const byUrl = new Map(pages.filter((p) => onDomains(p.url, domains)).map((p) => [samePage(p.url), p]));
  const seen = new Set<string>();
  const out: ProductFact[] = [];
  for (const d of drafts) {
    const page = byUrl.get(samePage(d.url));
    const text = d.text.trim().replace(/\s+/g, " ");
    const quote = normalize(d.quote);
    if (!page || !text || quote.length < 8 || !normalize(`${page.title} ${page.snippet}`).includes(quote)) continue;
    const key = normalize(text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text: text.slice(0, 300), url: page.url, ...(page.title ? { title: page.title.slice(0, 200) } : {}) });
    if (out.length === PRODUCT_FACTS_MAX) break;
  }
  return out;
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
