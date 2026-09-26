import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Keeps pages on the design system (docs/DESIGN-SYSTEM.md): styles come from `ui` (src/app/ui.ts) and the colour
 * tokens in globals.css, not from one-off classes. Each rule names the fix. A new pattern belongs in `ui` first.
 */

const ROOT = join(process.cwd(), "src/app");
const SKIP = ["zz", "ui.ts", "design-system.test.ts"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.includes(name)) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) && !name.endsWith(".test.ts") ? [path] : [];
  });
}

/** Font sizes in use: Tailwind's xs–2xl plus these exact ones (see the type scale). */
const SIZES = new Set(["11px", "13px", "15px", "26px"]);

const RULES: { name: string; fix: string; find: (src: string) => string[] }[] = [
  {
    name: "raw colour",
    fix: "use a colour token (text-good, bg-violet, …) or add one to globals.css",
    find: (src) => [...src.matchAll(/\b(?:text|bg|border|fill|stroke|from|to)-\[#[0-9a-fA-F]{3,8}\]/g)].map((m) => m[0]),
  },
  {
    name: "home-made button",
    fix: "use ui.primary / ui.primarySm (or secondary / plain)",
    find: (src) => [...src.matchAll(/"[^"\n]*\bbg-accent\b[^"\n]*\btext-white\b[^"\n]*"|"[^"\n]*\btext-white\b[^"\n]*\bbg-accent\b[^"\n]*"/g)].map((m) => m[0]),
  },
  {
    name: "home-made link",
    fix: "use ui.link",
    find: (src) => [...src.matchAll(/"[^"\n]*\btext-(?:accent|muted)\b[^"\n]*\b(?:hover:)?underline\b[^"\n]*"/g)].map((m) => m[0]).filter((c) => !c.includes("decoration-")),
  },
  {
    name: "font size off the scale",
    fix: `use text-xs/sm/base/lg/xl or one of ${[...SIZES].join(", ")}`,
    find: (src) => [...src.matchAll(/\btext-\[(\d+px)\]/g)].filter((m) => !SIZES.has(m[1])).map((m) => m[0]),
  },
];

describe("design system", () => {
  const all = files(ROOT);
  it("scans the app", () => expect(all.length).toBeGreaterThan(20));
  for (const rule of RULES) {
    it(`has no ${rule.name}`, () => {
      const hits = all.flatMap((f) => rule.find(readFileSync(f, "utf8")).map((h) => `${relative(process.cwd(), f)}: ${h.slice(0, 100)}`));
      expect(hits, `${rule.name}: ${rule.fix}`).toEqual([]);
    });
  }
});
