# openclub

AI receptionist for padel clubs (working product title: **club-manager**, see `Docs/product/PRD.md`). The club keeps its existing WhatsApp number; a Claude-powered agent behind it handles bookings, payments, and member messaging in Peruvian Spanish, backed by a deterministic booking engine. Launch market: Lima, Peru. Current phase: build toward a design-partner pilot with 1–2 real Lima clubs (internal founder+friends shakeout first).

**Product principle (non-negotiable): the LLM interprets; the engine decides.** The agent never mutates state directly — all bookings, holds, payments, and cancellations go through typed tools against a deterministic core that enforces invariants. Every tool call is logged and owner-reversible.

## Current state

In development, following the ordered user stories in `Docs/product/implementation-plan.md`. The plan's "Progress" section at the top tracks which stories are done. US-01 (scaffold) is complete; the data-model story is next and needs a Postgres instance (Neon or local).

## Commands

- `pnpm dev` — run locally with reload (http://localhost:3000, `GET /health`)
- `pnpm test` / `pnpm typecheck` / `pnpm lint` — all must pass before a story is done
- `pnpm build && pnpm start` — compiled production run
- `pnpm db:generate` / `db:migrate` / `db:seed` — stubs until the data-model + seed stories

## Code layout

- `src/config.ts` — Zod-validated env; every new env var goes here **and** in `.env.example`
- `src/logger.ts` — pino factory (pretty in dev, silent in tests)
- `src/app.ts` — Express app factory (keep it port-free so tests can use supertest)
- `src/index.ts` — boot: load config → create logger → listen
- `tests/` — Vitest + supertest

## Doc map

When docs disagree on stack choices, `technical-requirements.md` wins.

- `Docs/technical/technical-requirements.md` — current stack direction (authoritative), architecture, env vars, WhatsApp platform constraints
- `Docs/technical/agent-stack.md` — LLM provider decision + cost model
- `Docs/product/PRD.md` — PRD v2: scope, flows, FR priorities (P0/P1/P2), NFRs, out-of-scope
- `Docs/product/implementation-plan.md` — build order, user stories with acceptance criteria
- `Docs/technical/pre-development-review.md` — historical (written against PRD v1); surviving items folded into the plan
- `Docs/product/brainstorm.md`, `Docs/product/project.md` — early notes, superseded

## Stack (decided, not locked)

TypeScript (strict, NodeNext ESM) on Node ≥ 22, Express 5 + pino, Zod 4, Drizzle + Neon Postgres, Anthropic SDK direct (`claude-sonnet-4-6` with prompt caching, no framework/gateway), Meta WhatsApp Cloud API (dev test number for development; business verification before the pilot), Postgres-backed job runner for timers (pg-boss or graphile-worker — decided in the jobs story), pluggable payment-gateway adapter (Mercado Pago first) plus a manual-yapeo flow, Vitest + supertest, pnpm, Biome. Hosting: Railway or Fly.io (undecided until the hosting story).

## Key constraints & conventions

- **Locale**: agent speaks es-PE; timezone `America/Lima`; currency PEN (S/). Templates and eval prompts are written in Spanish from the start.
- **Multi-tenant from day one** (PRD FR-12): every table keyed by tenant; no single-tenant shortcuts; tenant-isolation tests in CI.
- **Double-booking prevention is DB-level**: a unified court-occupancy table (bookings, holds, maintenance blocks, classes) carries a GIST exclusion constraint on court + time range.
- **Payment-state machine**: `unpaid → held → paid/failed/expired/refunded`; holds have a TTL and auto-release; screenshots are never trusted as payment proof.
- **First-contact registration** (invite-only is gone): unknown numbers can register via chat — so per-number rate limits and cost caps guard the LLM path.
- **Unit-economics guardrail**: track LLM + WhatsApp template cost per completed booking; target < S/0.50. Instrument from the first agent story.
- **No PII in the repo**: tester/member names and phones live in gitignored config (e.g. `seed.config.json`).
- **Secrets live only on the host**; `.env.example` documents every variable.
- **WhatsApp platform limits** (see technical-requirements.md): free-form outbound only within the 24h service window — everything business-initiated (reminders, waitlist offers, promos, digests, dunning) needs pre-approved utility templates, opt-in, and honored opt-outs. A number registered on the Cloud API can no longer be used in the consumer WhatsApp app.
