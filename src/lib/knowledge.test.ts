import { describe, expect, it } from "vitest";

import { applyUpdate, factsForReading, factsNotUsed, readKnowledge, type Knowledge } from "./knowledge";

const page = { url: "https://support.hp.com/doc/1", title: "Install the printheads", snippet: "Install the printheads during setup. You can replace a printhead later if it is damaged." };
const appPage = { url: "https://www.hp.com/app", title: "HP app", snippet: "The HP app replaces HP Smart. Sign in for full functionality." };
const empty: Knowledge = { facts: [], checkedAt: null, domains: ["hp.com"], dismissed: [] };

describe("readKnowledge", () => {
  it("reads the first version's facts (no ids, topics or status)", () => {
    const k = readKnowledge({ facts: [{ text: "Printheads go in at setup.", url: page.url }, { text: "" }], checkedAt: "2026-09-26", domains: ["hp.com"] });
    expect(k.facts).toEqual([{ id: expect.any(String), text: "Printheads go in at setup.", url: page.url, topic: "other", source: "maker", status: "current", since: "2026-09-26" }]);
    expect(readKnowledge(null)).toEqual({ facts: [], checkedAt: null, domains: [], dismissed: [] });
  });
});

describe("applyUpdate", () => {
  it("adds new facts only with a checked quote from an allowed page", () => {
    const { knowledge, changes } = applyUpdate(
      empty,
      ["setup", "parts"],
      [],
      [
        { topic: "parts", text: "A printhead can be replaced later if damaged.", url: page.url, quote: "replace a printhead later", models: "" },
        { topic: "parts", text: "From memory", url: page.url, quote: "not on the page at all" },
        { topic: "parts", text: "Other site", url: "https://hp.com.deals.net/x", quote: "replace a printhead later" },
        { topic: "app", text: "Out of scope topic", url: appPage.url, quote: "The HP app replaces HP Smart" },
      ],
      [page, appPage, { ...page, url: "https://hp.com.deals.net/x" }],
      ["hp.com"],
      "2026-09-27",
    );
    expect(knowledge.facts.map((f) => f.text)).toEqual(["A printhead can be replaced later if damaged."]);
    expect(knowledge.facts[0]).toMatchObject({ topic: "parts", source: "maker", status: "current", since: "2026-09-27" });
    expect(changes).toEqual([{ kind: "new", text: "A printhead can be replaced later if damaged.", url: page.url, topic: "parts" }]);
  });

  it("keeps confirmed facts, rewrites changed ones, marks the rest not found, and never touches yours", () => {
    const before: Knowledge = {
      ...empty,
      facts: [
        { id: "a", text: "Printheads go in at setup.", url: page.url, topic: "setup", source: "maker", status: "current", since: "2026-09-25" },
        { id: "b", text: "HP Smart is the printer app.", url: appPage.url, topic: "app", source: "maker", status: "current", since: "2026-09-25" },
        { id: "c", text: "Hold Resume to prime the tubes.", url: page.url, topic: "setup", source: "maker", status: "current", since: "2026-09-25" },
        { id: "d", text: "Mine lasted two years.", topic: "setup", source: "you", status: "current", since: "2026-09-25" },
      ],
    };
    const { knowledge, changes } = applyUpdate(
      before,
      ["setup", "app"],
      [
        { id: "a", status: "same", url: page.url, quote: "Install the printheads during setup" },
        { id: "b", status: "changed", text: "The HP app replaces HP Smart.", url: appPage.url, quote: "The HP app replaces HP Smart" },
        { id: "c", status: "same", url: page.url, quote: "hold resume for three seconds" },
      ],
      [],
      [page, appPage],
      ["hp.com"],
      "2026-09-27",
    );
    expect(knowledge.facts.map((f) => [f.id, f.text, f.status])).toEqual([
      ["a", "Printheads go in at setup.", "current"],
      ["b", "The HP app replaces HP Smart.", "current"],
      ["c", "Hold Resume to prime the tubes.", "not_found"],
      ["d", "Mine lasted two years.", "current"],
    ]);
    expect(changes.map((c) => [c.kind, c.text, c.was])).toEqual([
      ["changed", "The HP app replaces HP Smart.", "HP Smart is the printer app."],
      ["not_found", "Hold Resume to prime the tubes.", undefined],
    ]);
    // A fact already not found isn't reported again.
    expect(applyUpdate(knowledge, ["setup"], [], [], [], ["hp.com"], "2026-09-28").changes.filter((c) => c.text.startsWith("Hold"))).toEqual([]);
  });

  it("never re-adds a fact you removed or one already known", () => {
    const before: Knowledge = { ...empty, dismissed: ["a printhead can be replaced later if damaged"] };
    const n = { topic: "parts" as const, text: "A printhead can be replaced later if damaged.", url: page.url, quote: "replace a printhead later" };
    expect(applyUpdate(before, ["parts"], [], [n], [page], ["hp.com"], "2026-09-27").knowledge.facts).toEqual([]);
    const once = applyUpdate(empty, ["parts"], [], [n, n], [page], ["hp.com"], "2026-09-27");
    expect(once.knowledge.facts).toHaveLength(1);
  });
});

describe("factsForReading", () => {
  it("gives searches the current maker facts and yours", () => {
    const k: Knowledge = {
      ...empty,
      facts: [
        { id: "a", text: "Printheads go in at setup.", url: page.url, topic: "setup", models: "510 series", source: "maker", status: "current", since: "x" },
        { id: "b", text: "Old", url: page.url, topic: "setup", source: "maker", status: "not_found", since: "x" },
        { id: "c", text: "Mine", topic: "setup", source: "you", status: "current", since: "x" },
      ],
    };
    expect(factsForReading(k)).toEqual({ maker: [{ text: "Printheads go in at setup. (510 series)", url: page.url }], yours: ["Mine"] });
  });
});

describe("factsNotUsed", () => {
  const k: Knowledge = {
    ...empty,
    facts: [
      { id: "a", text: "Printheads go in at setup.", url: page.url, topic: "setup", models: "510 series", source: "maker", status: "current", since: "x" },
      { id: "b", text: "Old", url: page.url, topic: "setup", source: "maker", status: "not_found", since: "x" },
      { id: "c", text: "Mine", topic: "setup", source: "you", status: "current", since: "x" },
    ],
  };
  it("counts the family's current facts a study's categories don't carry", () => {
    expect(factsNotUsed(k, { productFacts: [], productNotes: "" })).toBe(2);
    expect(factsNotUsed(k, { productFacts: [{ text: "Printheads go in at setup. (510 series)" }], productNotes: "Mine" })).toBe(0);
    expect(factsNotUsed(k, { productFacts: [{ text: "printheads go in at setup (510 series)" }] })).toBe(1);
  });
  it("is zero before a study has categories (its first analysis takes the latest)", () => {
    expect(factsNotUsed(k, null)).toBe(0);
  });
});
