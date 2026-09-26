import { describe, expect, it } from "vitest";

import { onDomains, pagesFrom, verifiedFacts } from "./product-facts";

const page = {
  url: "https://support.hp.com/us-en/document/ish_1",
  title: "HP Smart Tank - Install the printheads",
  snippet: "Install the printheads during setup. You can replace a printhead later if it is damaged.",
};

describe("onDomains", () => {
  it("accepts the maker's sites and their subdomains, over https only", () => {
    expect(onDomains("https://support.hp.com/x", ["hp.com"])).toBe(true);
    expect(onDomains("https://www.hp.com/x", ["hp.com"])).toBe(true);
    expect(onDomains("http://www.hp.com/x", ["hp.com"])).toBe(false);
    expect(onDomains("https://nothp.com/x", ["hp.com"])).toBe(false);
    expect(onDomains("not a url", ["hp.com"])).toBe(false);
  });
});

describe("verifiedFacts", () => {
  it("keeps a fact whose quote is on its page", () => {
    const facts = verifiedFacts([{ text: "Printheads are installed at setup and can be replaced later.", url: `${page.url}#step2`, quote: "replace a printhead later" }], [page], ["hp.com"]);
    expect(facts).toEqual([{ text: "Printheads are installed at setup and can be replaced later.", url: page.url, title: page.title }]);
  });
  it("drops facts from memory: unknown page, quote not on it, other sites, too short a quote", () => {
    const drafts = [
      { text: "A", url: "https://support.hp.com/other", quote: "Install the printheads" },
      { text: "B", url: page.url, quote: "needs no setup at all" },
      { text: "C", url: page.url, quote: "Install" },
    ];
    const other = { ...page, url: "https://example.com/p" };
    expect(verifiedFacts([...drafts, { text: "D", url: other.url, quote: "Install the printheads" }], [page, other], ["hp.com"])).toEqual([]);
  });
  it("drops repeats and caps the list", () => {
    const d = { text: "Printheads go in at setup.", url: page.url, quote: "Install the printheads" };
    expect(verifiedFacts([d, { ...d, text: "printheads go in at setup." }], [page], ["hp.com"])).toHaveLength(1);
    const many = Array.from({ length: 30 }, (_, i) => ({ ...d, text: `Fact ${i}` }));
    expect(verifiedFacts(many, [page], ["hp.com"])).toHaveLength(20);
  });
});

describe("pagesFrom", () => {
  it("reads search results and skips errors and other outputs", () => {
    expect(pagesFrom([{ results: [page, { url: 5 }] }, { error: "rate_limit", message: "x" }, null, "text"])).toEqual([page]);
  });
});
