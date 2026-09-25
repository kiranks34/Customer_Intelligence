# Pulse

Search-driven customer intelligence from public data. Type a product,
category or audience question. Get an evidence-backed report and a live
customer journey map, verified post by post with Jev.

**Status:** Phase 1, step 1: app skeleton (login, database schema, cost meter). No searches yet.

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
4. Create the tables once from your machine: `DATABASE_URL=<value from Vercel> npm run db:migrate`.
5. Redeploy and open the site. You'll be asked for your passcode.
