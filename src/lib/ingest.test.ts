import { describe, expect, it } from "vitest";

import { toPostRow } from "./ingest";
import { textHash } from "./text";

const base = { source: "reddit" as const, sourceId: "t1_a", text: "Great printer", author: "Alice" };

describe("toPostRow", () => {
  it("pseudonymizes the author and computes the dedupe key", () => {
    const row = toPostRow({ ...base, title: " Title " }, 7, "salt")!;
    expect(row.searchId).toBe(7);
    expect(row.authorHash).toHaveLength(16);
    expect(row.authorHash).not.toContain("Alice");
    expect(row.title).toBe("Title");
    expect(row.textHash).toBe(textHash("Title", "Great printer"));
  });
  it("drops empty and deleted posts but keeps titled posts with no body", () => {
    expect(toPostRow({ ...base, text: "   " }, 1, "s")).toBeNull();
    expect(toPostRow({ ...base, text: "[deleted]" }, 1, "s")).toBeNull();
    expect(toPostRow({ ...base, text: "", title: "Which tank printer?" }, 1, "s")).not.toBeNull();
    const removed = toPostRow({ ...base, text: "[removed]", title: "Smart Tank leaking?" }, 1, "s")!;
    expect(removed.text).toBe("");
    expect(removed.textHash).toBe(toPostRow({ ...base, text: "", title: "Smart Tank leaking?" }, 1, "s")!.textHash);
  });
  it("nulls invalid dates and missing optionals", () => {
    const row = toPostRow({ ...base, postedAt: new Date("nope") }, 1, "s")!;
    expect(row.postedAt).toBeNull();
    expect(row.rating).toBeNull();
    expect(row.url).toBeNull();
  });
});
