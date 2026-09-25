/** Examples in the codebook are always verbatim from a real post (docs/CLAUDE principle: quotes are never invented). */

const EXAMPLE_CHARS = 160;

/**
 * The example for a code, copied from the post Claude pointed at: its quote when that really is in the post (in the
 * post's own words and casing), otherwise the post's opening words.
 */
export function exampleFrom(post: string | undefined, quote: string | null): string | undefined {
  if (!post) return undefined;
  const text = post.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  const wanted = (quote ?? "").replace(/\s+/g, " ").trim();
  if (wanted.length >= 8) {
    const at = text.toLowerCase().indexOf(wanted.toLowerCase());
    if (at >= 0) return text.slice(at, at + Math.min(wanted.length, 200));
  }
  return text.length > EXAMPLE_CHARS ? `${text.slice(0, EXAMPLE_CHARS).replace(/\s+\S*$/, "")}…` : text;
}
