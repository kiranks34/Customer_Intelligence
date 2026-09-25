# Pulse

Search-driven customer intelligence from public data. Type a product,
category or audience question. Get an evidence-backed report and a live
customer journey map, verified post by post with Jev.

**Status:** Phase 1, step 3: type a topic or a question, review Claude's plan, and collect posts from YouTube and Reddit. Classification and reports come next.

| Doc | What it covers |
|---|---|
| [PRD](docs/PRD.md) | Goal, users, use cases, principles, success metrics |
| [Architecture](docs/ARCHITECTURE.md) | Pipeline, Claude vs Jev roles, tech stack, data model |
| [Jev](docs/JEV.md) | What Jev does here and the confidence policy |
| [Evaluation](docs/EVALUATION.md) | Spot-check, feasibility gates, integrity checks, tests |
| [Roadmap](docs/ROADMAP.md) | Phases and gates |
| [Design](docs/DESIGN.md) | Screens and the journey map |
| [Decisions](docs/DECISIONS.md) | Decisions made and open questions |

## Run it locally

```bash
npm install
cp .env.example .env.local   # fill in PULSE_PASSCODE and PULSE_SESSION_SECRET at least
npm run dev                   # http://localhost:3000
```

Checks: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.

## Deploy on Vercel (Hobby)

1. On vercel.com: **Add New → Project**, then import this GitHub repo. Keep the defaults.
2. **Storage → Create Database → Neon (Postgres)** and connect it to the project. This sets `DATABASE_URL`.
3. **Settings → Environment Variables**: add `PULSE_PASSCODE`, `PULSE_SESSION_SECRET`, `AUTHOR_HASH_SALT`
   (see `.env.example`).
   Neon's integration must use the prefix `DATABASE` so the app finds `DATABASE_URL`.
4. Create the tables: open Neon → SQL Editor (branch `main`, database `neondb`), paste all of
   `drizzle/editor/0000_init.sql` and click Run. The last query should list 12 tables.
5. Redeploy and open the site. You'll be asked for your passcode. The spend meter should read $0.00.

## Database changes

When a pull request adds a migration, it also adds `drizzle/editor/<name>.sql`. After merging, paste that file
into Neon's SQL Editor once, the same way as step 4. (`npm run db:generate` creates both files.)
