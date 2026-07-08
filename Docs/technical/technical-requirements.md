# Technical Requirements — openclub (PRD v2)

Tech stack, architecture decisions, and anything related to the technologies used to
build this app live in this `technical/` folder. **This document tracks the current stack
direction.** Development has started (see the Progress table in
[implementation-plan.md](../product/implementation-plan.md)); choices already built are
settled, the rest remain changeable. Where other docs disagree on stack, treat this one
as the most current.

Related: [agent-stack.md](./agent-stack.md) (cost analysis + LLM strategy),
[../product/PRD.md](../product/PRD.md) (product scope — PRD v2, Lima padel),
[../product/implementation-plan.md](../product/implementation-plan.md) (build order).

**Product principle that shapes the whole architecture (PRD §1): the LLM interprets;
the engine decides.** The agent never mutates state directly. Bookings, holds, payments,
and cancellations execute through typed tools against a deterministic core that enforces
invariants (no double-booking, payment-state machine, policy rules). Every tool call is
logged and owner-reversible.

## Current stack direction (working, not locked)

| Layer | Direction | Rationale |
|---|---|---|
| Language / runtime | TypeScript on Node.js (`strict: true`) | One language end-to-end, including the owner dashboard; first-class typing across tool schemas. |
| Web framework | Express | Most widely used Node framework — largest ecosystem, lowest learning curve. `pino` for structured logging. |
| ORM / migrations | Drizzle + drizzle-kit | Lightweight, SQL-like, no heavy runtime engine. Raw-SQL escape hatch for `EXCLUDE`/GIST. |
| Database | Neon Postgres (managed) | Native `timestamptz`, `btree_gist` + GIST exclusion constraints for no-double-booking, partial unique indexes. Free tier covers development; paid tier is small next to revenue per club. |
| Multi-tenancy | Single database, tenant-keyed rows (P0, PRD FR-12) | Every table carries the tenant key; all queries tenant-scoped at the data-access layer; tenant-isolation tests in CI. No single-tenant shortcuts. |
| Background jobs | Postgres-backed job runner — **pg-boss or graphile-worker** (decide in the jobs story) | Hold-TTL expiry, 24h/2h reminders, weekly digests, and dunning are all timer-driven. Postgres-backed keeps it one datastore, no Redis. (Supersedes the PRD-v1-era "in-process worker, no queue" decision.) |
| Payments | Pluggable gateway adapter — **Mercado Pago first**; Culqi/Izipay behind the same interface | Yape/Plin + cards via payment links; idempotent webhooks. Plus a gateway-free **manual-yapeo** flow (QR + one-tap staff confirm). See PRD §4.3/FR-4. |
| Hosting | Railway (simplest) or Fly.io | Always-on so the WhatsApp webhook is reachable any time. Reversible. |
| LLM | **Anthropic API direct** (`@anthropic-ai/sdk`) | No gateway layer, strongest agentic tool use, first-class prompt caching. |
| Model | Claude Sonnet 4.6 (`claude-sonnet-4-6`), configurable via env | Best reasoning for multi-constraint booking dialogue in es-PE. Haiku router is the cost lever once pilot volume is real — see [agent-stack.md](./agent-stack.md). |
| Messaging | Meta WhatsApp Cloud API direct | Dev test number for development and the internal shakeout; business verification + a real number path before the design partner (see constraints below). |
| Owner dashboard | Stack TBD at story time | Basic + mobile-first in MVP (PRD FR-8). Open choice: minimal server-rendered (Express + templates/HTMX) vs. small SPA. The weekly WhatsApp digest ships regardless. |
| Cache / Redis | None | Postgres covers jobs and state; nothing needs a separate cache. |
| Tests | Vitest + supertest | Fast, ESM-native. Includes concurrent-hold simulations and tenant-isolation tests. |
| Package manager | pnpm | Faster installs, strict by default. |
| Lint / format | Biome | Chosen in US-01 — single fast toolchain. |
| Locale | es-PE, `America/Lima`, PEN (S/) | Agent output, templates, evals, and formatting are Peruvian-Spanish-first. English mirrored only if the member writes in English. |

## LLM strategy notes

- **Why direct, not a gateway/model-agnostic:** model-agnosticism (OpenRouter, Vercel AI
  Gateway, LiteLLM) was considered and dropped — an extra layer for switching flexibility
  we don't need. Direct is simpler and gives first-class prompt caching. If neutrality
  ever matters, swapping to a gateway is a base-URL change.
- **Cost guardrail (PRD §7):** LLM + WhatsApp template cost per completed booking
  **< S/0.50**, instrumented from the first agent story and alerting when exceeded.
  See [agent-stack.md](./agent-stack.md) for the per-booking cost model and the Haiku
  router lever.
- **Prompt caching:** mark the static system prompt + tool definitions with
  `cache_control: { type: 'ephemeral' }` (5-min TTL).
- **Degraded mode (PRD FR-2):** if the LLM provider is down, core booking falls back to
  structured WhatsApp interactive lists/buttons driven directly by the engine — bookings
  must not depend on LLM availability.

## Identity, registration, and abuse guard

- Phone number is the identity: WhatsApp sender phone → tenant-scoped member lookup.
- **First-contact registration** (PRD §4.2 — replaces PRD v1's invite-only gate): an
  unknown number gets a short registration exchange (name, optional level) and a member
  profile keyed on phone. No forms, no links, no app.
- Because unknown numbers now reach the LLM, the webhook path carries an **abuse guard**:
  per-number rate limits, per-tenant spend caps, and a cheap pre-LLM triage for obvious
  spam. Rejections are logged with a salted phone hash, not the raw phone.
- Staff roles (owner / admin / coach) are phone-identified too, with scoped permissions
  enforced in the tool dispatcher (a member can never reach owner tools).

## WhatsApp platform constraints (checked 2026-07-08; re-verify at build)

1. **Free-form outbound only inside the 24h service window.** The business can send
   free-form messages to a user only within 24h of that user's last inbound message.
   Outside the window, every business-initiated message must be a **pre-approved
   template**. This governs almost every lifecycle flow in PRD v2: 24h/2h booking
   reminders, waitlist auto-offers, reactivation and valley-hour promos, weekly owner
   digests, academy dunning. Implications:
   - **Template lifecycle management is a product feature (FR-3):** create, submit,
     and track approval status **per tenant**, in Spanish. Submit early — approval
     takes time.
   - Opt-in required for proactive categories; opt-outs honored instantly; frequency
     caps enforced; **per-message template cost tracked** (feeds the S/0.50 guardrail).
2. **Number onboarding is a one-way door (FR-3).** A phone number registered on the
   Cloud API **can no longer be used in the consumer WhatsApp app**. Clubs choose:
   a **new dedicated number**, or **migrating their existing number** (losing app access
   to it). The onboarding wizard must make this explicit and support both paths.
3. **Dev test number scope.** Meta's dev test number (free, up to 5 tester phones) covers
   development and the internal founder+friends shakeout. **Business verification** and a
   real number are required before the design-partner pilot.
4. **Interactive messages** (buttons, lists) and media (QR images, location pins) are
   available and load-bearing: one-tap yapeo confirmation for staff, reminder
   Confirm/Cancel buttons, and the degraded no-LLM booking mode.

> PRD v1's group-chat booking flow (and the Groups API constraints that shaped it) was
> dropped in PRD v2 — see git history of this file if "falta uno" ever grows toward
> group features.

## Architecture

```
WhatsApp user (member / owner / admin / coach)
   ↓ inbound webhook (HTTPS)
Meta WhatsApp Cloud API
   ↓
openclub backend (Express on Node, hosted on Railway/Fly)
   ├─ verify X-Hub-Signature-256 (raw body HMAC) + dedupe on wa_message_id
   ├─ resolve tenant + sender (member / staff / unknown → registration; abuse guard)
   ├─ load conversation history (Postgres) — human-takeover pause honored
   ├─ Claude agent loop ⇄ typed tools ⇄ deterministic engine
   │     engine: availability, pricing, holds (TTL), bookings,
   │     policy rules, wallet ledger, payment-state machine
   ├─ persist turn + per-turn telemetry (tokens, cost, tool spans)
   └─ send reply via WhatsApp Cloud API (free-form in-window / template outside)

Postgres (Neon, tenant-keyed)
   ├─ job runner (pg-boss / graphile-worker): hold expiry, reminders,
   │     waitlist cascade, weekly digest, dunning
   └─ GIST exclusion on court occupancies (bookings, holds, blocks, classes)

Payment gateway (Mercado Pago adapter) → idempotent webhooks → payment-state machine
Owner dashboard (basic web, mobile-first) — reads the same engine/data
```

## Non-functional requirements (from PRD §7)

- **Agent latency:** first substantive reply < 5s p50 / < 10s p95.
- **Booking integrity:** zero double-bookings — GIST exclusion at the DB plus
  serializable hold/booking writes, proven by concurrent-hold simulation tests;
  idempotent payment webhooks; at-least-once inbound delivery with `wa_message_id`
  dedupe.
- **Availability:** 99.5% for the booking core; degraded button-menu mode when the LLM
  is down.
- **Compliance:** Peru personal-data law (**Ley N° 29733**) — consent records, data
  minimization, deletion on request; WhatsApp Business/commerce policy (opt-ins,
  honored opt-outs); payment credentials never stored outside the gateway.
- **Security:** tenant-isolation tests in CI; webhook signature verification; PII
  redaction in logs; least-privilege staff roles.
- **Observability:** full conversation traces with tool-call spans; per-tenant error
  dashboards; booking-funnel analytics (inquiry → hold → paid); per-booking cost
  attribution.
- **Data ownership:** club data exportable as CSV (members, bookings, payments —
  SUNAT-friendly); contractual and technical.

## Environment variables (expected)

Secrets live only on the host, never committed. `.env.example` lists every var.

- `DATABASE_URL` — Neon Postgres connection string
- `ANTHROPIC_API_KEY` — Anthropic API key
- `ANTHROPIC_MODEL` — default model id (e.g. `claude-sonnet-4-6`)
- `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`
- `WEBHOOK_VERIFY_TOKEN` — Meta webhook verification
- `ADMIN_BEARER_TOKEN` — protects `/admin/*` routes (simulator, ops endpoints)
- Payment gateway credentials (names fixed when the Mercado Pago adapter lands, e.g.
  `MERCADOPAGO_ACCESS_TOKEN`, webhook secret)

## Deferred (deliberately out of MVP)

- Instagram DM channel (P2 — same agent, second front door). SMS: explicitly never.
- Tournaments & leagues (P2), academy module (P1), falta-uno matching (P1), waitlist
  cascade (P1) — see PRD FR priorities.
- Model-agnostic gateway — revisit only if vendor neutrality becomes a real requirement.
- Kubernetes / Docker orchestration — a separate learning side-project.
- Haiku router — revisit when pilot conversation volume is real (see agent-stack.md).
- Hardware integrations (door access, court lights) — future partner integrations.
