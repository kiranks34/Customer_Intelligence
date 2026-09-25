// Writes a paste-ready SQL file per migration for the Neon SQL Editor (drizzle/editor/<tag>.sql).
// Each file applies the migration and records it in drizzle.__drizzle_migrations, exactly like `drizzle-kit migrate`.
// No BEGIN/COMMIT: Neon's editor manages the transaction itself (an explicit one did not persist in practice).
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
mkdirSync("drizzle/editor", { recursive: true });
for (const { tag, when } of journal.entries) {
  const sql = readFileSync(`drizzle/${tag}.sql`, "utf8");
  const hash = createHash("sha256").update(sql).digest("hex");
  const out = `-- Pulse migration ${tag}. Paste ALL of this into Neon > SQL Editor (branch: main, database: neondb) and click Run.
-- Run each file once, in order. The last query lists the tables so you can confirm it worked.

${sql.replaceAll("--> statement-breakpoint", "")}

CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('${hash}', ${when});

SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
`;
  writeFileSync(`drizzle/editor/${tag}.sql`, out);
  console.log(`wrote drizzle/editor/${tag}.sql`);
}
