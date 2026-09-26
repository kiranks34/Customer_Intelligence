import { beforeEach, describe, expect, it, vi } from "vitest";

const generateText = vi.fn();
vi.mock("ai", async (orig) => ({ ...(await orig<typeof import("ai")>()), generateText: (...a: unknown[]) => generateText(...a) }));

const { findProductFacts } = await import("./product-facts-finder");

const page = { url: "https://support.hp.com/us-en/document/ish_1", title: "Install the printheads", snippet: "Install the printheads during setup. You can replace a printhead later." };

beforeEach(() => {
  process.env.AI_GATEWAY_API_KEY = "test";
  process.env.PULSE_CLAUDE_MODEL = "anthropic/claude-sonnet-5";
  generateText.mockReset();
});

describe("findProductFacts", () => {
  it("searches only the maker's sites and keeps facts its pages confirm", async () => {
    generateText.mockResolvedValue({
      steps: [
        { toolCalls: [{}], content: [{ type: "tool-call" }, { type: "tool-result", output: { results: [page] } }] },
        { toolCalls: [], content: [] },
      ],
      totalUsage: { inputTokens: 10_000, outputTokens: 1_000 },
      output: {
        facts: [
          { text: "Printheads go in at setup and can be replaced later.", url: page.url, quote: "replace a printhead later" },
          { text: "It needs an HP account.", url: page.url, quote: "requires an HP account" },
        ],
      },
    });
    const r = await findProductFacts("HP Smart Tank", ["hp.com"]);
    expect(r.facts).toEqual([{ text: "Printheads go in at setup and can be replaced later.", url: page.url, title: page.title }]);
    const call = generateText.mock.calls[0][0];
    expect(Object.keys(call.tools)).toEqual(["search"]);
    expect(call.prompt).toContain("hp.com");
    // Sonnet 5: 10k in × $2/M + 1k out × $10/M, plus one search.
    expect(r.cost).toMatchObject({ operation: "facts", units: { searches: 1 } });
    expect(r.cost.usd).toBeCloseTo(0.02 + 0.01 + 0.005);
  });
  it("still reports what a failed call spent", async () => {
    generateText.mockResolvedValue({
      steps: [{ toolCalls: [{}, {}], content: [] }],
      totalUsage: { inputTokens: 5_000, outputTokens: 0 },
      get output() {
        throw new Error("No output generated.");
      },
    });
    await expect(findProductFacts("HP Smart Tank", ["hp.com"])).rejects.toMatchObject({ name: "FactsError", cost: { units: { searches: 2 } } });
    generateText.mockRejectedValue(new Error("The operation was aborted due to timeout"));
    await expect(findProductFacts("HP Smart Tank", ["hp.com"])).rejects.toMatchObject({ cost: { units: { searches: 4 } } });
  });
  it("won't run without the maker's sites", async () => {
    await expect(findProductFacts("Acme", [])).rejects.toThrow("official website");
    expect(generateText).not.toHaveBeenCalled();
  });
});
