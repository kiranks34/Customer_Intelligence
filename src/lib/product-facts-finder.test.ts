import { beforeEach, describe, expect, it, vi } from "vitest";

const generateText = vi.fn();
vi.mock("ai", async (orig) => ({ ...(await orig<typeof import("ai")>()), generateText: (...a: unknown[]) => generateText(...a) }));

const { knowledgeStep } = await import("./product-facts-finder");

const page = { url: "https://support.hp.com/us-en/document/ish_1", title: "Install the printheads", snippet: "Install the printheads during setup." };
const earlier = [{ id: "a", text: "Printheads go in at setup.", url: page.url, topic: "setup" as const, source: "maker" as const, status: "current" as const, since: "2026-09-25" }];

beforeEach(() => {
  process.env.AI_GATEWAY_API_KEY = "test";
  process.env.PULSE_CLAUDE_MODEL = "anthropic/claude-sonnet-5";
  generateText.mockReset();
});

describe("knowledgeStep", () => {
  it("searches only the maker's sites for the given topics, sends earlier facts, and returns the pages found", async () => {
    generateText.mockResolvedValue({
      steps: [{ toolCalls: [{}], content: [{ type: "tool-call" }, { type: "tool-result", output: { results: [page] } }] }, { toolCalls: [], content: [] }],
      totalUsage: { inputTokens: 10_000, outputTokens: 1_000 },
      output: { checked: [{ id: "a", status: "same", text: null, url: page.url, quote: "Install the printheads" }], found: [{ topic: "setup", text: "x", url: page.url, quote: "y", models: null }] },
    });
    const r = await knowledgeStep("HP Smart Tank", ["hp.com"], ["setup", "parts"], earlier);
    expect(r.pages).toEqual([page]);
    expect(r.checked).toHaveLength(1);
    expect(r.found[0]).toMatchObject({ topic: "setup", models: undefined });
    const call = generateText.mock.calls[0][0];
    expect(Object.keys(call.tools)).toEqual(["search"]);
    expect(call.prompt).toContain("hp.com");
    expect(call.prompt).toContain("- a [setup] Printheads go in at setup.");
    expect(call.prompt).toContain("- parts:");
    expect(call.prompt).not.toContain("- warranty:");
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
    await expect(knowledgeStep("HP Smart Tank", ["hp.com"], ["setup"], [])).rejects.toMatchObject({ name: "FactsError", cost: { units: { searches: 2 } } });
    generateText.mockRejectedValue(new Error("The operation was aborted due to timeout"));
    await expect(knowledgeStep("HP Smart Tank", ["hp.com"], ["setup"], [])).rejects.toMatchObject({ cost: { units: { searches: 4 } } });
  });
  it("won't run without the maker's sites", async () => {
    await expect(knowledgeStep("Acme", [], ["setup"], [])).rejects.toThrow("official website");
    expect(generateText).not.toHaveBeenCalled();
  });
});
