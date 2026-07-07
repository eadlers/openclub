# openclub

AI-native club management for racket sports, starting with Padel. Members and pros interact with the club through a Claude-powered conversational agent over WhatsApp — no member-facing web UI or app. V1 is a **dogfood prototype** (founder + friends at a mock club), not a live pilot.

## Current state

Pre-code; docs only. Development follows the ordered user stories in `Docs/product/implementation-plan.md` (US-01 → US-19).

## Doc map

When docs disagree on stack choices, `technical-requirements.md` wins.

- `Docs/technical/technical-requirements.md` — current stack direction (authoritative), architecture, env vars, WhatsApp platform constraints
- `Docs/technical/agent-stack.md` — LLM provider decision + cost model
- `Docs/product/PRD.md` — V1 scope, flows, data model sketch, non-goals
- `Docs/product/implementation-plan.md` — build order, user stories with acceptance criteria
- `Docs/product/brainstorm.md`, `Docs/product/project.md` — early notes, superseded by the PRD

## Stack (decided, not locked)

TypeScript on Node (`strict: true`), Express + pino, Drizzle + Neon Postgres, Anthropic SDK direct (`claude-sonnet-4-6` with prompt caching, no framework/gateway), Meta WhatsApp Cloud API (dev test number), Vitest, pnpm, Biome. Hosting: Railway or Fly.io.

## Key constraints & conventions

- **Cost is a primary driver** of stack decisions; V1 target ≈ $0–5/month total.
- **Invite-only**: unknown phone numbers get a templated rejection and never reach the LLM.
- **No PII in the repo**: tester names/phones live in gitignored `seed.config.json`.
- **Secrets live only on the host**; `.env.example` documents every variable.
- **WhatsApp platform limits** (see technical-requirements.md): the business must *create* groups (can't be added to member groups, max 8 participants); free-form outbound only within the 24h service window — otherwise pre-approved utility templates.
- Double-booking prevention is enforced at the DB level (GIST exclusion constraint on court + time range).
