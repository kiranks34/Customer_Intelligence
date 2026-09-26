import { describe, expect, it } from "vitest";

import { onDomains, pagesFrom } from "./product-facts";

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

describe("pagesFrom", () => {
  it("reads search results and skips errors and other outputs", () => {
    expect(pagesFrom([{ results: [page, { url: 5 }] }, { error: "rate_limit", message: "x" }, null, "text"])).toEqual([page]);
  });
});
