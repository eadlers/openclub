# Technical Requirements — openclub V1

Tech stack, architecture decisions, and anything related to the technologies used to
build this app live in this `technical/` folder. **This document tracks the current stack
direction for V1.** Development has started (see the Progress table in
[implementation-plan.md](../product/implementation-plan.md)); choices already built are
settled, the rest remain changeable. Where other docs disagree on stack, treat this one
as the most current.

Related: [agent-stack.md](./agent-stack.md) (cost analysis + LLM strategy),
[../product/PRD.md](../product/PRD.md) (product scope),
[../product/implementation-plan.md](../product/implementation-plan.md) (build order).

## Current stack direction (working, not locked)

| Layer | Direction | Rationale |
|---|---|---|
| Language / runtime | TypeScript on Node.js (`strict: true`) | One language end-to-end, including the V1.next admin web UI; first-class typing across tool schemas. |
| Web framework | Express | Most widely used Node framework — largest ecosystem and deepest pool of tutorials/examples, which lowers the learning curve. Add `pino` for structured logging. |
| ORM / migrations | Drizzle + drizzle-kit | Lightweight, SQL-like (also teaches SQL), no heavy runtime engine, cheapest to run. Raw-SQL escape hatch for `EXCLUDE`/GIST. |
| Database | Neon Postgres (managed, free always-on tier) | Native `timestamptz`, `btree_gist` + GIST exclusion constraints for no-double-booking, partial unique indexes. |
| Hosting | Railway (simplest) or Fly.io | Always-on so the WhatsApp webhook is reachable any time; ~$0–5/mo. Reversible. |
| LLM | **Anthropic API direct** (`@anthropic-ai/sdk`) | Not model-agnostic by choice: at ~1-to-few users, cost is a rounding error, so optimize for effectiveness + simplicity. Direct = no gateway layer, strongest agentic tool use, first-class prompt caching. |
| Model | Claude Sonnet 4.6 (`claude-sonnet-4-6`), configurable via env | Best reasoning for the hard task (group-chat participant resolution + multi-tool booking). Haiku 4.5 is the cost lever if volume ever grows. |
| Messaging | Meta WhatsApp Cloud API direct, dev test number | Free + official; the 5-tester limit covers the founder + friends dogfood. |
| Background work | In-process worker (no queue) | Webhook returns 200 fast, dispatches processing in-process. |
| Cache / Redis | None | Nothing in scope needs a cache, session store, or durable queue. |
| Tests | Vitest + supertest | Fast, ESM-native. |
| Package manager | pnpm | Faster installs, strict by default. |
| Lint / format | Biome | Chosen in US-01 — single fast toolchain. |

## LLM strategy notes

- **Why direct, not a gateway/model-agnostic:** model-agnosticism (OpenRouter, Vercel AI
  Gateway, LiteLLM) was considered and dropped. It buys switching flexibility we don't need
  at this scale, at the cost of an extra layer. Going direct is simpler and gives first-class
  prompt caching. If neutrality ever matters again, swapping to a gateway is a base-URL change.
- **Cost is not the deciding factor at this scale.** ~1-to-few users ≈ a few dollars/month on
  Sonnet with caching. Effectiveness and simplicity win. See [agent-stack.md](./agent-stack.md)
  for the full cost model and the Haiku router lever (only interesting past ~1,000 conv/month).
- **Prompt caching:** mark the static system prompt + tool definitions with
  `cache_control: { type: 'ephemeral' }` (5-min TTL).

## WhatsApp platform constraints (checked 2026-07-02; re-verify at build)

Two Cloud API rules materially shape the design:

1. **Groups are business-created, not joined.** Meta's Groups API (GA for Official
   Business Accounts since June 2026) lets the business **create** a WhatsApp group and
   invite members via link. A business number **cannot be added to an existing
   member-created group**. Limits: max 8 participants, one business number per group,
   requires an Official Business Account (OBA). It is unclear whether the **dev test
   number** supports the Groups API — validate this as a spike before building the group
   flow (US-17). If it doesn't, either the dogfood needs a verified business number
   earlier than planned, or the group flow slips to V1.next.
2. **Free-form outbound only inside the 24h service window.** The business can send
   free-form messages to a user only within 24h of that user's last inbound message.
   Outside the window, every business-initiated message must be a **pre-approved
   template** (utility category). This affects every notification flow: lesson requests
   to pros, accept/decline notices to members, cancellation notices. Plan a small set of
   utility templates (e.g. `lesson_request`, `lesson_status_update`,
   `cancellation_notice`) and submit them for approval early — approval takes time.

## Architecture

```
WhatsApp user
   ↓ inbound webhook (HTTPS)
Meta WhatsApp Cloud API
   ↓
openclub backend (Express on Node, hosted on Railway/Fly)
   ├─ verify X-Hub-Signature-256 (raw body HMAC)
   ├─ identify sender by phone (Neon Postgres) — invite-only gate
   ├─ load conversation history (Postgres)
   ├─ Claude agent loop ⇄ backend tools (Anthropic tool use)
   ├─ persist turn + per-turn telemetry
   └─ send reply via WhatsApp Cloud API
```

## Environment variables (expected)

Secrets live only on the host, never committed. `.env.example` lists every var.

- `DATABASE_URL` — Neon Postgres connection string
- `ANTHROPIC_API_KEY` — Anthropic API key
- `ANTHROPIC_MODEL` — default model id (e.g. `claude-sonnet-4-6`)
- `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`
- `WEBHOOK_VERIFY_TOKEN` — Meta webhook verification
- `ADMIN_BEARER_TOKEN` — protects `/admin/*` routes

## Deferred (deliberately not in V1)

- Model-agnostic gateway (OpenRouter / Vercel AI Gateway / LiteLLM) — revisit only if
  vendor neutrality becomes a real requirement.
- Kubernetes / Docker orchestration — a separate learning side-project, not V1.
- Haiku/cheaper-model router — revisit past ~1,000 conversations/month.
- WhatsApp Business verification — required before a real pilot, not for the 5-tester dogfood.
