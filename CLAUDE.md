@AGENTS.md

# Pulse: working notes for Claude

- Plan and decisions live in `docs/`. Read `docs/PRD.md` and `docs/DECISIONS.md` before changing behaviour.
- Principles that code must keep: numbers come from SQL (never from an LLM); quotes are pulled verbatim by post ID;
  Jev confidence decides what counts (`src/lib/confidence.ts`); dedupe by author + text hash; author handles are pseudonymized;
  keys only in environment variables, never logged or stored.
- Every paid API call records a row via `recordCost` (`src/lib/cost.ts`).
- Pipeline work runs as small resumable steps (`jobs` table) to fit Vercel Hobby limits.
- UI follows `docs/DESIGN-SYSTEM.md`: styles only from `ui` (`src/app/ui.ts`) and the colour tokens; a new pattern is
  added to `ui` and to the /design page first. `src/app/design-system.test.ts` enforces the basics.
- Checks before pushing: `npm run lint && npm run typecheck && npm test && npm run build`.
- Review your own work with `/code-review` (the code-review skill) before every PR, and fix what it finds.
- Schema changes: edit `src/db/schema.ts`, then `npm run db:generate` and commit the new file in `drizzle/`.
