import { describe, expect, it } from "vitest";

import { criterion, estimateTokens, QUESTION_SET, jevUsd, keyFor, NOT_STATED, orderOf, questionsFor, readAnswers, stateFor, themeQuestion, validateCodebook, type Codebook } from "./codebook";

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
    expect(validateCodebook(codebook)).toEqual({ ok: true, codebook: { ...codebook, competitors: [], touchpoints: [] } });
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

describe("criterion", () => {
  it("gives Jev the definition, then the rules and a real example when there are any", () => {
    expect(criterion({ key: "setup", label: "Set up", definition: "Getting it working." })).toBe("Getting it working.");
    expect(criterion({ key: "setup", label: "Set up", definition: "Getting it working.", counts: "first days", excludes: "fails after working", example: "heads won't align" })).toBe(
      "Getting it working. Counts when: first days Not when: fails after working Example: “heads won't align”",
    );
  });
  it("puts a theme's exclusions on the 'no' side", () => {
    const q = questionsFor({ ...codebook, themes: [{ ...codebook.themes[0], counts: "offline", excludes: "Ethernet only", example: "keeps dropping" }, ...codebook.themes.slice(1)] }, "x");
    expect(q["theme:wifi"]).toMatchObject({ type: "boolean", criteria: { false: "Not when: Ethernet only" } });
    expect(JSON.stringify(q["theme:wifi"])).toContain("keeps dropping");
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
  it("asks the kind of post, sentiment, stage, segment and one yes/no per theme in one call", () => {
    expect(Object.keys(q)).toEqual([
      "about:subject",
      "about:competitor",
      "about:chat",
      "post_type",
      "ownership",
      "first_hand",
      "severity",
      "recommend",
      "sentiment",
      "stage",
      "segment",
      "theme:wifi",
      "theme:ink_cost",
      "theme:print_quality",
    ]);
    expect(q["about:subject"]).toMatchObject({ type: "boolean" });
    expect(JSON.stringify(q["about:subject"])).toContain("HP Smart Tank 7301");
    expect(q.severity).toMatchObject({ type: "score" });
    expect(Object.keys((q.post_type as { criteria: object }).criteria)).toEqual(["question", "complaint", "praise", "advice", "comparison", "decision", "other"]);
    expect(q[themeQuestion("wifi")]).toMatchObject({ type: "boolean" });
  });
  it("offers 'not stated' for stage and segment", () => {
    expect(q.stage).toMatchObject({ type: "choice" });
    expect(Object.keys((q.stage as { criteria: object }).criteria)).toEqual(["buy", "use", NOT_STATED]);
  });
  it("asks which competitor and how the writer feels about it, only with a competitor list", () => {
    expect(q.competitor).toBeUndefined();
    const withBrands = questionsFor({ ...codebook, competitors: [{ key: "epson", label: "Epson EcoTank", definition: "Epson EcoTank printers." }] }, "HP Smart Tank");
    expect(Object.keys((withBrands.competitor as { criteria: object }).criteria)).toEqual(["epson", "other_brand", "no_brand"]);
    expect(withBrands["competitor:feeling"]).toMatchObject({ type: "choice" });
  });
  it("asks one yes/no per touchpoint, and judges the stage by the writer's situation", () => {
    const withTouch = questionsFor({ ...codebook, touchpoints: [{ key: "hp_app", label: "HP Smart app", definition: "The HP Smart app." }] }, "HP Smart Tank");
    expect(withTouch["touch:hp_app"]).toMatchObject({ type: "boolean" });
    expect(withTouch.stage.instructions).toContain("not by which part or topic");
  });
  it("sends the product notes with every post", () => {
    expect(stateFor({ source: "youtube", title: "", text: "x", productNotes: "Printheads can be replaced later." })).toMatchObject({ how_the_product_works: "Printheads can be replaced later." });
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
  it("works out the kind of post from three yes/no answers; a comparison is about the product and names a competitor", () => {
    const rows = readAnswers({
      "about:subject": { type: "boolean", probability: 0.9 },
      "about:competitor": { type: "boolean", probability: 0.95 },
      "about:chat": { type: "boolean", probability: 0.05 },
    });
    expect(rows).toContainEqual({ question: "about", answer: "product", confidence: 0.9 });
    expect(rows).toContainEqual({ question: "about:product", answer: QUESTION_SET, confidence: 0.9 });
    const chat = readAnswers({ "about:subject": { type: "boolean", probability: 0.1 }, "about:competitor": { type: "boolean", probability: 0.1 }, "about:chat": { type: "boolean", probability: 0.9 } });
    expect(chat).toContainEqual({ question: "about", answer: "chat", confidence: 0.9 });
    const offTopic = readAnswers({ "about:subject": { type: "boolean", probability: 0.1 }, "about:competitor": { type: "boolean", probability: 0.2 }, "about:chat": { type: "boolean", probability: 0.3 } });
    expect(offTopic).toContainEqual({ question: "about", answer: "off_topic", confidence: 0.7 });
  });
  it("stores a score as its position with the most likely level's probability", () => {
    expect(readAnswers({ severity: { type: "score", score: 2.64, probabilities: { "2": 0.5, "3": 0.4, "1": 0.1 } } })).toEqual([{ question: "severity", answer: "2.64", confidence: 0.5 }]);
    expect(readAnswers({ recommend: { type: "score", score: 1 } })).toEqual([{ question: "recommend", answer: "1.00", confidence: 0.5 }]);
  });
  it("stores how likely a post is product feedback next to its kind", () => {
    expect(readAnswers({ about: { type: "choice", choice: "chat", probabilities: { product: 0.1, competitor: 0.05, chat: 0.8, unclear: 0.05 } } })).toEqual([
      { question: "about", answer: "chat", confidence: 0.8 },
      { question: "about:product", answer: QUESTION_SET, confidence: 0.1 },
    ]);
    // Without a distribution, "product" keeps its own probability and anything else is unknown (0.5).
    expect(readAnswers({ about: { type: "choice", choice: "chat" } })[1].confidence).toBe(0.5);
  });
  it("clamps bad numbers instead of storing them", () => {
    expect(readAnswers({ relevant: { type: "boolean", probability: Number.NaN } })[0].confidence).toBe(0.5);
    expect(readAnswers({ relevant: { type: "boolean", probability: 1.4 } })[0]).toEqual({ question: "relevant", answer: "yes", confidence: 1 });
  });
});

describe("stateFor", () => {
  it("gives comments their video or thread and the products they name", () => {
    expect(stateFor({ source: "youtube", title: "", text: "Can't get black cartridge in", thread: "HP Smart Tank 5000 setup", isComment: true, names: "HP Smart Tank 5000" })).toEqual({
      channel: "YouTube comment",
      context: "Comment on the YouTube video “HP Smart Tank 5000 setup”",
      products_named: "HP Smart Tank 5000",
      post: "Can't get black cartridge in",
    });
    expect(stateFor({ source: "reddit", title: "", text: "Same here", thread: "Printhead error", isComment: true })).toMatchObject({
      channel: "Reddit comment",
      context: "Reply in the Reddit thread “Printhead error”",
    });
  });
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
