import { describe, expect, it } from "vitest";

import { cleanTree, compileMatcher, familyKey, familyTerms, findMentions, flatten, isCovered, mergeModel, treeLimitError, modelFromMention, normalize, treeFromDraft, type FlatNode, type TreeNode } from "./catalog";

describe("familyKey and familyTerms", () => {
  it("gives searches of one family the same key", () => {
    expect(familyKey("HP Smart Tank printers")).toBe("hp smart tank");
    expect(familyKey("hp smart-tank printer family")).toBe("hp smart tank");
    expect(familyKey("HP Smart Tank 5000 series")).toBe("hp smart tank 5000");
  });
  it("drops the brand to get the words people use", () => {
    expect(familyTerms(["HP Smart Tank", "SmartTank", "HP"])).toEqual(["smart tank", "smarttank"]);
  });
  it("normalizes case, dashes and spaces", () => {
    expect(normalize("Smart-Tank   7301")).toBe("smart tank 7301");
  });
});

describe("findMentions", () => {
  it("counts posts (not occurrences) per model mention, with or without spaces and 'plus'", () => {
    const texts = [
      "My Smart Tank 7301 jams. The smart tank 7301 is loud.",
      "smarttank 7301 wifi keeps dropping",
      "Smart Tank Plus 555 vs Smart Tank 580",
      "I paid $500 for a printer in 2023",
    ];
    expect(findMentions(texts, ["smart tank"])).toEqual([
      { text: "smart tank 7301", posts: 2 },
      { text: "smart tank 580", posts: 1 },
      { text: "smart tank plus 555", posts: 1 },
    ]);
  });
});

const tree: TreeNode = {
  id: 1,
  level: "family",
  name: "HP Smart Tank",
  aliases: ["Smart Tank", "SmartTank"],
  verified: true,
  children: [
    {
      id: 2,
      level: "series",
      name: "Smart Tank 7000 series",
      aliases: ["7000 series"],
      verified: true,
      children: [
        { id: 3, level: "model", name: "Smart Tank 7301", aliases: ["7301"], verified: true, children: [] },
        { id: 4, level: "model", name: "Smart Tank 7602", aliases: ["7602"], verified: true, children: [] },
      ],
    },
    {
      id: 5,
      level: "series",
      name: "Smart Tank 500 series",
      aliases: [],
      verified: true,
      children: [{ id: 6, level: "model", name: "Smart Tank 580", aliases: ["580"], verified: false, children: [] }],
    },
  ],
};

describe("compileMatcher", () => {
  const nodes = flatten(tree);
  const match = compileMatcher(nodes);
  it("links a post to the most specific nodes it names", () => {
    expect(match("My 7301 keeps jamming")).toEqual([3]);
    expect(match("Smart Tank 7301 vs 7602 — which one?")).toEqual([3, 4]);
    expect(match("Anyone own the 7000 series?")).toEqual([2]);
    expect(match("my smart tank is great")).toEqual([1]);
    expect(match("the SmartTank-7602 is quiet")).toEqual([4]);
  });
  it("needs a family word before short numbers, and ignores numbers inside other numbers", () => {
    expect(match("printed 580 pages")).toEqual([]);
    expect(match("I have the smart tank 580")).toEqual([6]);
    expect(match("order 173012 shipped")).toEqual([]);
  });
  it("knows when a mention is already covered by a model", () => {
    expect(isCovered("smart tank 7301", match, nodes)).toBe(true);
    expect(isCovered("smart tank 750", match, nodes)).toBe(false);
  });
});

describe("cleanTree and treeFromDraft", () => {
  it("drops empty names, merges duplicate series, dedupes aliases and removes the node's own name", () => {
    const messy: TreeNode = {
      id: null,
      level: "family",
      name: " HP  Smart Tank ",
      aliases: ["Smart Tank", "smart-tank", "HP Smart Tank"],
      verified: true,
      children: [
        { id: null, level: "series", name: "7000 series", aliases: [], verified: true, children: [{ id: null, level: "model", name: "7301", aliases: [], verified: true, children: [] }] },
        { id: null, level: "series", name: "7000 Series", aliases: ["ST 7000"], verified: true, children: [{ id: null, level: "model", name: "7602", aliases: [], verified: true, children: [] }] },
        { id: null, level: "series", name: "  ", aliases: [], verified: true, children: [] },
      ],
    };
    const t = cleanTree(messy);
    expect(t.name).toBe("HP Smart Tank");
    expect(t.aliases).toEqual(["Smart Tank"]);
    expect(t.children).toHaveLength(1);
    expect(t.children[0].aliases).toEqual(["ST 7000"]);
    expect(t.children[0].children.map((m) => m.name)).toEqual(["7301", "7602"]);
  });
  it("builds a tree from Claude's draft", () => {
    const t = treeFromDraft({
      family: { name: "HP Smart Tank", aliases: ["Smart Tank"] },
      series: [{ name: "Smart Tank 5000 series", aliases: [], verified: true, models: [{ name: "Smart Tank 5101", aliases: ["5101"], verified: false }] }],
      notes: "",
    });
    expect(t.children[0].children[0]).toMatchObject({ id: null, level: "model", name: "Smart Tank 5101", verified: false });
  });
});

it("flatten skips unsaved nodes", () => {
  const withNew: TreeNode = { ...tree, children: [...tree.children, { id: null, level: "series", name: "New", aliases: [], verified: true, children: [] }] };
  expect(flatten(withNew).map((n: FlatNode) => n.id)).toEqual([1, 2, 3, 4, 5, 6]);
});

describe("editing helpers", () => {
  it("mergeModel moves the name and other names into the target and removes the duplicate", () => {
    const t = mergeModel(tree, [0, 1], [0, 0]);
    expect(t.children[0].children).toHaveLength(1);
    expect(t.children[0].children[0].aliases).toEqual(["7301", "Smart Tank 7602", "7602"]);
    expect(mergeModel(tree, [0, 0], [0, 0])).toBe(tree);
    expect(mergeModel(tree, [9, 0], [0, 0])).toBe(tree);
  });
  it("modelFromMention names the model and keeps the number as another name", () => {
    expect(modelFromMention("smart tank plus 555")).toEqual({ id: null, level: "model", name: "Smart Tank Plus 555", aliases: ["555"], verified: false, children: [] });
  });
});

describe("cleanTree duplicates and limits", () => {
  const m = (name: string, aliases: string[] = []): TreeNode => ({ id: null, level: "model", name, aliases, verified: true, children: [] });
  const series = (name: string, children: TreeNode[]): TreeNode => ({ id: null, level: "series", name, aliases: [], verified: true, children });
  const fam = (children: TreeNode[]): TreeNode => ({ id: null, level: "family", name: "HP Smart Tank", aliases: [], verified: true, children });
  it("merges models that meet when same-named series merge", () => {
    const t = cleanTree(fam([series("7000 series", [m("Smart Tank 7301", ["7301"])]), series("7000 Series", [m("smart tank 7301", ["ST 7301"]), m("7602")])]));
    expect(t.children[0].children.map((x) => [x.name, x.aliases])).toEqual([
      ["Smart Tank 7301", ["7301", "ST 7301"]],
      ["7602", []],
    ]);
  });
  it("treeLimitError refuses too many models instead of dropping them", () => {
    const many = Array.from({ length: 31 }, (_, i) => m(`Model ${i}`));
    expect(treeLimitError(fam([series("Big", many)]))).toMatch(/more than 30 models/);
    expect(treeLimitError(fam([series("Ok", many.slice(0, 30))]))).toBeNull();
  });
});
