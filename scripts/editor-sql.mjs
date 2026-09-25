// Writes a paste-ready SQL file per migration for the Neon SQL Editor (drizzle/editor/<tag>.sql).
// Each file applies the migration and records it in drizzle.__drizzle_migrations, exactly like `drizzle-kit migrate`.
// No BEGIN/COMMIT: Neon's editor manages the transaction itself (an explicit one did not persist in practice).
// From migration 0003 on, every statement is made safe to run twice (IF NOT EXISTS / duplicate guards), so a file
// that half-ran, or runs on a database that already has it (e.g. a preview branch), can simply be run again.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
mkdirSync("drizzle/editor", { recursive: true });
/** Rewrites drizzle's statements so re-running them is harmless. */
function idempotent(sql) {
  return sql
    .split("--> statement-breakpoint")
    .map((st) => {
      const s = st.trim();
      if (!s) return "";
      if (/^CREATE TYPE /i.test(s) || /ADD CONSTRAINT /i.test(s)) return `DO $$ BEGIN ${s} EXCEPTION WHEN duplicate_object THEN NULL; END $$;`;
      return s
        .replace(/^CREATE TABLE "/i, 'CREATE TABLE IF NOT EXISTS "')
        .replace(/^CREATE (UNIQUE )?INDEX "/i, (_, u) => `CREATE ${u ?? ""}INDEX IF NOT EXISTS "`)
        .replace(/^DROP INDEX "/i, 'DROP INDEX IF EXISTS "')
        .replace(/ADD COLUMN "/gi, 'ADD COLUMN IF NOT EXISTS "')
        .replace(/DROP COLUMN "/gi, 'DROP COLUMN IF EXISTS "')
        .replace(/ADD VALUE '/gi, "ADD VALUE IF NOT EXISTS '");
    })
    .filter(Boolean)
    .join("\n");
}

for (const [idx, { tag, when }] of journal.entries.entries()) {
  const sql = readFileSync(`drizzle/${tag}.sql`, "utf8");
  const hash = createHash("sha256").update(sql).digest("hex");
  const safe = idx >= 3;
  const out = `-- Pulse migration ${tag}. Paste ALL of this into Neon > SQL Editor (branch: main, database: neondb) and click Run.
-- ${safe ? "Safe to run more than once. If you also use the preview site, run it on the preview branch too." : "Run each file once, in order."} The last query lists the tables so you can confirm it worked.

${safe ? idempotent(sql) : sql.replaceAll("--> statement-breakpoint", "")}

CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
${
  safe
    ? `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) SELECT '${hash}', ${when} WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '${hash}');`
    : `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('${hash}', ${when});`
}

SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
`;
  writeFileSync(`drizzle/editor/${tag}.sql`, out);
  console.log(`wrote drizzle/editor/${tag}.sql`);
}
