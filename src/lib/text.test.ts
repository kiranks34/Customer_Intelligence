import { describe, expect, it } from "vitest";

import { normalizeText, pseudonymize, textHash } from "./text";

describe("normalizeText", () => {
  it("lowercases, strips punctuation and collapses whitespace", () => {
    expect(normalizeText("  Great   printer!!  Ink lasts... ")).toBe("great printer ink lasts");
  });
  it("keeps CJK and accented letters", () => {
    expect(normalizeText("打印机很好！")).toBe("打印机很好");
    expect(normalizeText("Impresora Económica")).toBe("impresora económica");
  });
  it("folds full-width characters (NFKC)", () => {
    expect(normalizeText("ＨＰ ５１０１")).toBe("hp 5101");
  });
});

describe("textHash", () => {
  it("treats the same review repeated across variants as one", () => {
    expect(textHash("Great!", "Setup took 5 minutes.")).toBe(textHash("great", "setup took 5 minutes"));
  });
  it("does not merge different emoji-only posts", () => {
    expect(textHash("", "👍👍")).not.toBe(textHash("", "🔥🔥🔥"));
    expect(textHash("", "❤️")).toBe(textHash("", " ❤️ "));
  });
  it("distinguishes different reviews", () => {
    expect(textHash("", "Love it")).not.toBe(textHash("", "Hate it"));
  });
});

describe("pseudonymize", () => {
  it("is stable, case-insensitive and does not contain the handle", () => {
    const a = pseudonymize("PrinterFan42", "salt");
    expect(a).toBe(pseudonymize(" printerfan42 ", "salt"));
    expect(a).not.toContain("printerfan");
    expect(a).toHaveLength(16);
  });
  it("changes with the salt", () => {
    expect(pseudonymize("x", "a")).not.toBe(pseudonymize("x", "b"));
  });
  it("returns null for missing authors and refuses an empty salt", () => {
    expect(pseudonymize(null, "salt")).toBeNull();
    expect(pseudonymize("  ", "salt")).toBeNull();
    expect(() => pseudonymize("x", "")).toThrow();
  });
});
