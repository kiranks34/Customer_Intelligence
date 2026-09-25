import { describe, expect, it } from "vitest";

import { estimateTokens, jevUsd, keyFor, NOT_STATED, orderOf, questionsFor, readAnswers, stateFor, themeQuestion, validateCodebook, type Codebook } from "./codebook";

const codebook: Codebook = {
  stages: [
    { key: "buy", label: "Buy", definition: "Buying or just bought it." },
    { key: "use", label: "Everyday use", definition: "Using it day to day." },
  ],
  segments: [{ key: "home_office", label: "Home office", definition: "Works from home." }],
  themes: [
    { key: "wifi", label: "Wi-Fi setup", definition: "Connecting it to Wi-Fi or losing connection.", kind: "pain" },
    { key: "ink_cost", label: "Ink cost", definition: "What ink costs over time.", kind: "topic" },
    { key: "print_quality", label: "Print quality", definition: "How prints look.", kind: "delight" },
  ],
};

describe("validateCodebook", () => {
  it("accepts a valid codebook", () => {
    expect(validateCodebook(codebook)).toEqual({ ok: true, codebook });
  });
  it("rejects duplicate keys, duplicate names and the reserved key", () => {
    const dupKey = { ...codebook, themes: [...codebook.themes, { ...codebook.themes[0], label: "Other" }] };
    expect(validateCodebook(dupKey)).toMatchObject({ ok: false });
    const dupLabel = { ...codebook, themes: [...codebook.themes, { ...codebook.themes[0], key: "wifi_2" }] };
    expect(validateCodebook(dupLabel)).toMatchObject({ ok: false });
    const reserved = { ...codebook, stages: [...codebook.stages, { key: NOT_STATED, label: "Not stated", definition: "Nothing said." }] };
    expect(validateCodebook(reserved)).toMatchObject({ ok: false });
  });
  it("rejects too few themes or bad keys", () => {
    expect(validateCodebook({ ...codebook, themes: codebook.themes.slice(0, 2) })).toMatchObject({ ok: false });
    expect(validateCodebook({ ...codebook, themes: [{ ...codebook.themes[0], key: "Wi Fi" }, ...codebook.themes.slice(1)] })).toMatchObject({ ok: false });
  });
});

describe("keyFor", () => {
  it("makes a snake_case key that is unique in its list", () => {
    expect(keyFor("Wi-Fi setup", [])).toBe("wi_fi_setup");
    expect(keyFor("Wi-Fi setup", ["wi_fi_setup"])).toBe("wi_fi_setup_2");
    expect(keyFor("5G", [])).toBe("n5g");
    expect(keyFor("!!", [])).toBe("item");
    expect(keyFor("Not stated", [])).toBe("not_stated_2");
  });
});

describe("questionsFor", () => {
  const q = questionsFor(codebook, "HP Smart Tank 7301");
  it("asks relevance, sentiment, stage, segment and one yes/no per theme in one call", () => {
    expect(Object.keys(q)).toEqual(["relevant", "sentiment", "stage", "segment", "theme:wifi", "theme:ink_cost", "theme:print_quality"]);
    expect(q.relevant.type).toBe("boolean");
    expect(q.relevant.instructions).toContain("HP Smart Tank 7301");
    expect(q[themeQuestion("wifi")]).toMatchObject({ type: "boolean" });
  });
  it("offers 'not stated' for stage and segment", () => {
    expect(q.stage).toMatchObject({ type: "choice" });
    expect(Object.keys((q.stage as { criteria: object }).criteria)).toEqual(["buy", "use", NOT_STATED]);
  });
  it("leaves out the segment question when there are no segments", () => {
    expect(questionsFor({ ...codebook, segments: [] }, "x").segment).toBeUndefined();
  });
});

describe("readAnswers", () => {
  it("turns yes/no probabilities into an answer with its confidence", () => {
    expect(readAnswers({ relevant: { type: "boolean", probability: 0.9 } })).toEqual([{ question: "relevant", answer: "yes", confidence: 0.9 }]);
    expect(readAnswers({ relevant: { type: "boolean", probability: 0.1 } })).toEqual([{ question: "relevant", answer: "no", confidence: 0.9 }]);
  });
  it("keeps the chosen option's probability, or 0.5 when Jev gives none", () => {
    expect(readAnswers({ sentiment: { type: "choice", choice: "negative", probabilities: { negative: 0.7, positive: 0.3 } } })).toEqual([
      { question: "sentiment", answer: "negative", confidence: 0.7 },
    ]);
    expect(readAnswers({ sentiment: { type: "choice", choice: "positive" } })).toEqual([{ question: "sentiment", answer: "positive", confidence: 0.5 }]);
  });
  it("clamps bad numbers instead of storing them", () => {
    expect(readAnswers({ relevant: { type: "boolean", probability: Number.NaN } })[0].confidence).toBe(0.5);
    expect(readAnswers({ relevant: { type: "boolean", probability: 1.4 } })[0]).toEqual({ question: "relevant", answer: "yes", confidence: 1 });
  });
});

describe("stateFor", () => {
  it("names the channel and cuts very long posts", () => {
    expect(stateFor({ source: "youtube", title: "", text: "Great" })).toEqual({ channel: "YouTube comment", post: "Great" });
    const long = stateFor({ source: "reddit", title: "T", text: "a".repeat(5000) });
    expect(long.post.length).toBe(3001);
    expect(long.title).toBe("T");
  });
});

describe("cost", () => {
  it("prices Jev per million input tokens and estimates generously", () => {
    expect(jevUsd(1_000_000)).toBeCloseTo(0.042);
    const tokens = estimateTokens(400, codebook, "HP Smart Tank");
    expect(tokens).toBeGreaterThan(100);
    // 300 posts stay far under a cent per post.
    expect(jevUsd(tokens * 300)).toBeLessThan(0.1);
  });
});

describe("orderOf", () => {
  it("orders stages as written, with 'not stated' last", () => {
    const o = orderOf(codebook.stages);
    expect([NOT_STATED, "use", "buy"].sort((a, b) => o.get(a)! - o.get(b)!)).toEqual(["buy", "use", NOT_STATED]);
  });
});
