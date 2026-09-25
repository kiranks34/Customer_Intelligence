const BASE = "http://pulse.invalid";

/**
 * Only allow same-site relative paths, so a `next` parameter can't redirect to another site.
 * Parsing with the URL parser (rather than prefix checks) also catches tricks like "/\t/evil.example".
 */
export function safeNext(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/")) return "/";
  try {
    const url = new URL(next, BASE);
    if (url.origin !== BASE) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
