import { ConnectorError } from "./types";

export interface FetchJsonOptions {
  provider: string;
  init?: RequestInit;
  timeoutMs?: number;
  retries?: number;
  /**
   * "all": retry 429, 5xx and network/timeout errors (free, idempotent reads).
   * "rateLimitOnly": retry only 429, for paid calls where a timed-out request may still have been billed.
   */
  retryOn?: "all" | "rateLimitOnly";
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Strip anything that looks like a credential from a URL before it can reach an error message or log. */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const k of ["key", "token", "api_key", "apikey"]) if (u.searchParams.has(k)) u.searchParams.set(k, "REDACTED");
    return u.toString();
  } catch {
    return "<invalid url>";
  }
}

/**
 * GET/POST JSON with a timeout and bounded retries.
 * Errors never include credentials (query-string keys are redacted).
 */
export async function fetchJson<T>(url: string, opts: FetchJsonOptions): Promise<T> {
  const { provider, init, timeoutMs = 30_000, retries = 2, retryOn = "all", fetchImpl = fetch, sleep = defaultSleep } = opts;
  let lastError: ConnectorError | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(500 * 2 ** (attempt - 1));
    let res: Response;
    let text: string;
    try {
      res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      text = await res.text();
    } catch (err) {
      const reason = err instanceof Error ? err.name : "network error";
      lastError = new ConnectorError(provider, `request failed (${reason}) for ${redactUrl(url)}`, undefined, retryOn === "all");
      if (retryOn === "all") continue;
      break;
    }

    if (res.ok) {
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new ConnectorError(provider, `invalid JSON from ${redactUrl(url)}`, res.status);
      }
    }

    const retryable = res.status === 429 || (retryOn === "all" && res.status >= 500);
    const { message, reason } = parseErrorBody(text);
    lastError = new ConnectorError(provider, `HTTP ${res.status}: ${message}`, res.status, retryable, reason);
    if (!retryable) break;
  }
  throw lastError ?? new ConnectorError(provider, "request failed");
}

/** Pull a short message and, when present, a machine-readable reason out of an error body (Google, ScrapeCreators, Apify shapes). */
export function parseErrorBody(body: string): { message: string; reason?: string } {
  try {
    const j = JSON.parse(body);
    const msg =
      j?.error?.message ??
      j?.error?.errors?.[0]?.message ??
      (typeof j?.error === "string" ? j.error : undefined) ??
      j?.message;
    const reason = j?.error?.errors?.[0]?.reason ?? j?.error?.type ?? undefined;
    if (typeof msg === "string") return { message: msg.slice(0, 300), reason: typeof reason === "string" ? reason : undefined };
  } catch {
    // not JSON
  }
  return { message: body.slice(0, 300) || "empty response" };
}
