import { describe, expect, it } from "vitest";

import type { TreeNode } from "./catalog";
import { applyReference, isListed, listedNames, modelNote, readablePage, ReferenceSchema, sourcesByName, treeFromReference } from "./catalog-reference";

const src = (url: string, quote: string) => ({ url, title: "HP page", quote });
const raw = {
  family: "HP Smart Tank",
  key: "hp smart tank",
  checkedAt: "2026-09-25",
  familyAliases: ["Smart Tank"],
  series: [
    {
      name: "HP Smart Tank 7300 All-in-One Printer series",
      sources: [src("https://support.hp.com/us-en/product/x", "HP Smart Tank 7300 All-in-One Printer series")],
      models: [
        {
          name: "HP Smart Tank 7301",
          number: "7301",
          aliases: ["Smart Tank 7301"],
          regions: ["US", "CA"],
          retailerExclusive: null,
          discontinued: false,
          sources: [src("https://www.hp.com/us-en/shop/pdp/hp-smart-tank-7301", "HP Smart Tank 7301 All-in-One Printer")],
        },
        {
          name: "HP Smart Tank 7001",
          number: "7001",
          aliases: [],
          regions: ["US"],
          retailerExclusive: "Amazon",
          discontinued: false,
          sources: [src("https://www.amazon.com/dp/B000", "HP Smart Tank 7001 Wireless All-in-One")],
        },
      ],
    },
  ],
};

describe("ReferenceSchema", () => {
  it("accepts a well-formed reference", () => {
    expect(ReferenceSchema.safeParse(raw).success).toBe(true);
  });
  it("rejects sources that aren't https pages on the maker's or a major retailer's site", () => {
    const bad = structuredClone(raw);
    bad.series[0].models[0].sources[0].url = "https://some-blog.example/hp-7301";
    expect(ReferenceSchema.safeParse(bad).success).toBe(false);
    bad.series[0].models[0].sources[0].url = "http://www.hp.com/x";
    expect(ReferenceSchema.safeParse(bad).success).toBe(false);
    bad.series[0].models[0].sources[0].url = "https://hp.com.evil.example/x";
    expect(ReferenceSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects a model without a source, or whose source doesn't mention its number", () => {
    const none = structuredClone(raw);
    none.series[0].models[0].sources = [];
    expect(ReferenceSchema.safeParse(none).success).toBe(false);
    const wrong = structuredClone(raw);
    wrong.series[0].models[0].sources = [{ url: "https://www.hp.com/x", title: "HP page", quote: "HP Smart Tank 5101" }];
    expect(ReferenceSchema.safeParse(wrong).success).toBe(false);
  });
});

const ref = ReferenceSchema.parse(raw);

describe("using a reference", () => {
  it("builds a fully verified tree with the bare number as another name", () => {
    const t = treeFromReference(ref);
    expect(t.children[0].verified).toBe(true);
    expect(t.children[0].children[0]).toMatchObject({ name: "HP Smart Tank 7301", aliases: ["7301", "Smart Tank 7301"], verified: true });
  });
  it("labels how a model is sold and finds sources by name", () => {
    expect(modelNote(ref.series[0].models[1])).toBe("Amazon only · US");
    expect(sourcesByName(ref)["hp smart tank 7001"][0].url).toContain("amazon.com");
  });
  it("applyReference keeps ids of the same products and reports what couldn't be verified", () => {
    const current: TreeNode = {
      id: 1,
      level: "family",
      name: "HP Smart Tank",
      aliases: [],
      verified: true,
      children: [
        {
          id: 2,
          level: "series",
          name: "Smart Tank 7000 series",
          aliases: [],
          verified: false,
          children: [
            { id: 3, level: "model", name: "Smart Tank 7301", aliases: ["7301"], verified: true, children: [] },
            { id: 4, level: "model", name: "Smart Tank 7999", aliases: ["7999"], verified: false, children: [] },
          ],
        },
      ],
    };
    const { tree, removed } = applyReference(current, ref);
    expect(tree.id).toBe(1);
    expect(tree.children[0].id).toBeNull(); // HP's series name differs: a new node
    expect(tree.children[0].children.map((m) => [m.name, m.id])).toEqual([
      ["HP Smart Tank 7301", 3],
      ["HP Smart Tank 7001", null],
    ]);
    expect(removed).toEqual(["Smart Tank 7000 series", "Smart Tank 7999"]);
  });
});

it("links HP's normal support page when the evidence is its product-data endpoint", () => {
  const data = { url: "https://support.hp.com/wcc-services/productdata/version/us-en?seriesid=2100178736", title: "", quote: "" };
  expect(readablePage(data, "HP Smart Tank 7300 series")).toBe("https://support.hp.com/us-en/product/details/hp-smart-tank-7300-series/2100178736");
  expect(readablePage({ url: "https://www.hp.com/us-en/shop/pdp/x", title: "", quote: "" }, "x")).toBeNull();
});

describe("listedNames / isListed", () => {
  it("matches by name, model number or other name, ignoring case and spacing", async () => {
    const { referenceFor } = await import("./catalog-references");
    const listed = listedNames(referenceFor("hp smart tank")!);
    expect(isListed(listed, "hp smarttank 7301")).toBe(true);
    expect(isListed(listed, "Some odd name", ["7301"])).toBe(true);
    expect(isListed(listed, "Smart Tank 9999", ["9999"])).toBe(false);
  });
});
