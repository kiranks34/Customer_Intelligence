-- Pulse migration 0001_numerous_cammi. Paste ALL of this into Neon > SQL Editor (branch: main, database: neondb) and click Run.
-- Run each file once, in order. The last query lists the tables so you can confirm it worked.

ALTER TABLE "searches" ADD COLUMN "hidden_at" timestamp with time zone;

CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('e709f3477f75ef48ce1b4beecebcade0ce82767a4746c7063a754af6bb1df7df', 1790315626847);

SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
