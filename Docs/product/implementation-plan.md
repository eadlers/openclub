# openclub — Implementation Plan (PRD v2)

This plan turns the [PRD](./PRD.md) (v2 — Lima padel, "club-manager") into an ordered
series of user stories. Following them top-to-bottom builds the app along the natural
dependency graph: foundation → deterministic engine → jobs → transport → identity →
agent core → booking tools → payments → lifecycle messaging → owner surface →
resilience + evals → shakeout → design-partner pilot.

**Scope: PRD P0 only.** P1/P2 items (waitlist cascade, falta-uno, turno fijo,
reactivation promos, academy, tournaments, Instagram DM, full analytics) are listed at
the bottom, not planned here.

> **History note:** this plan replaces the PRD-v1 plan (dogfood prototype: lessons,
> programs, group-chat booking, invite-only — see git history). US-01 was completed
> under the old plan and carries over unchanged. Surviving insights from the
> [pre-development review](../technical/pre-development-review.md): the chat simulator,
> the unified occupancy table, webhook idempotency, and confirm-before-write.

## Progress

| Story | Status |
|---|---|
| US-01 Scaffold | ✅ Done (under the v1 plan; scope-neutral) |
| US-02 Data model | Next — needs a Postgres instance (Neon or local Docker) |
| US-03 → US-22 | Not started |

## Stack decisions baked into the plan

| Area | Choice | Rationale (details in [technical-requirements.md](../technical/technical-requirements.md)) |
|---|---|---|
| Language / runtime | TypeScript on Node.js | Thin webhook + agent loop + engine in one typed codebase; first-class Anthropic SDK. |
| HTTP framework | Express + pino | Widely used, mature; structured logs. |
| ORM / DB | Drizzle + Neon Postgres | Typed SQL; GIST exclusion constraints; partial unique indexes. |
| Multi-tenancy | Tenant-keyed rows, single DB (P0, FR-12) | Isolation enforced at the data layer + CI tests. |
| Background jobs | pg-boss **or** graphile-worker (decided in US-05) | Hold TTLs, reminders, digests — Postgres-backed, no Redis. |
| Payments | Gateway adapter, Mercado Pago first + manual yapeo | Yape/Plin + cards; zero-fee manual mode (FR-4). |
| LLM | Anthropic direct, Sonnet (`claude-sonnet-4-6`, env-configurable), prompt caching | See [agent-stack.md](../technical/agent-stack.md); guardrail < S/0.50/booking. |
| Messaging | Meta WhatsApp Cloud API direct | Dev test number for dev + shakeout; business verification before the pilot. |
| Locale | es-PE, `America/Lima`, PEN | Templates and evals Spanish-first. |
| Tests / tooling | Vitest + supertest, pnpm, Biome, GitHub Actions CI | Already in place from US-01. |

## How to read each story

Each story has: **Description** (what slice it delivers), **Depends on**,
**Requirements**, and **Acceptance criteria**. Stories are sized to ship in a sitting
or two with green tests before moving on.

## Sequencing rationale

1. **US-01 → US-03 (Foundation):** scaffold, tenant-first schema, seed.
2. **US-04 → US-05 (Engine + jobs):** the deterministic core — "the LLM interprets;
   the engine decides" means the engine exists and is fully tested *before* any LLM
   touches it. Jobs next because holds expire on timers.
3. **US-06 → US-09 (Transport + identity):** hosting, webhook round-trip, the chat
   simulator (the single biggest velocity decision), first-contact registration.
4. **US-10 → US-12 (Agent core):** history, tool loop with cost telemetry,
   observability — after these, every feature is "add a tool."
5. **US-13 → US-15 (Booking + payments):** the headline flow — book, hold, pay,
   confirm — plus cierre de caja.
6. **US-16 → US-18 (Lifecycle + owner surface):** reminders/no-shows, owner ops +
   digest, onboarding wizard + minimal dashboard.
7. **US-19 → US-20 (Resilience + quality):** degraded button mode, Spanish eval
   harness.
8. **US-21 → US-22 (Shakeout + pilot):** internal end-to-end run, then business
   verification and the first design partner.

---

## US-01 — Repository scaffold and developer tooling ✅

**Description.** TypeScript backend skeleton: Express + `GET /health`, Zod-validated
env config, Biome, Vitest, pnpm scripts, `.env.example`, CI. Completed 2026-07;
scope-neutral across the PRD pivot.

---

## US-02 — Tenant-first data model and migrations

**Description.** Implement the PRD v2 data model in Drizzle with the invariants that
keep the engine honest: tenant isolation, DB-level no-double-booking, payment-state
machine, idempotent inbound messages.

**Depends on.** US-01.

**Requirements.**
- Every domain table carries `tenant_id` (the club); all data access goes through a
  tenant-scoped query layer — no raw cross-tenant queries (FR-12).
- Tables: `tenants` (club config: name, timezone, currency, policies, payment mode,
  agent config), `courts` (operating hours, slot durations), `members` (keyed on
  `(tenant_id, phone)`; name, level, opt-ins, tags), `staff` (owner/admin/coach roles,
  phone-identified, scoped permissions), `bookings` (court, range, price, status,
  payment state), `holds` (booking-shaped, TTL expiry timestamp),
  `court_occupancies` — **everything that occupies a court** (confirmed bookings,
  active holds, maintenance blocks; classes later) writes a row here with
  `EXCLUDE USING gist (court_id WITH =, range WITH &&)`, making no-double-booking
  DB-level for every combination.
- `pricing_rules` (peak/valley by day+hour, member/non-member, promo overrides).
- Payment tables: `payments` with the state machine
  `unpaid → held → paid | failed | expired | refunded` (enum + guarded transitions),
  `wallet_entries` (append-only credit ledger per member), `no_show_records`.
- Conversation tables: `conversation_turns` (per `(tenant_id, phone)` thread; JSONB
  Anthropic-compatible blocks), `agent_turns` (per-LLM-call telemetry incl. token
  counts and cost), unique index on `wa_message_id` (Meta redelivers webhooks).
- All timestamps `timestamptz`; ranges `tstzrange`; money as integer céntimos.
- **Tenant-isolation test in CI:** a test that seeds two tenants and proves the query
  layer cannot read across them.
- A short `Docs/technical/data-model.md` documenting tables, FKs, and invariants.

**Acceptance criteria.**
- `pnpm db:migrate` applies cleanly to a fresh database.
- Overlapping occupancy rows for the same court are rejected at the DB level —
  booking×booking, booking×hold, and booking×maintenance-block all tested.
- An invalid payment-state transition (e.g. `expired → paid`) is rejected.
- Duplicate `wa_message_id` inserts are rejected at the DB level.
- The tenant-isolation CI test passes (and fails if the scoping is removed).

---

## US-03 — Demo club seed (Lima)

**Description.** Deterministic seed of a realistic Lima demo club so any contributor
can reset the DB into a usable state, and the shakeout has a believable club.

**Depends on.** US-02.

**Requirements.**
- `pnpm db:seed` creates: 1 tenant (timezone `America/Lima`, currency PEN, es-PE
  copy), 4 courts (07:00–23:00, 90-min default slots), peak/valley pricing rules
  (e.g. valley S/80, peak S/120), cancellation policy (>12h → wallet credit), 1 owner
  + 1 admin + 1 coach, 6–8 members with levels.
- Real tester names/phones come from gitignored `seed.config.json` — no PII in the
  repo; the seed falls back to obviously-fake fixtures when the file is absent.
- Idempotent (upsert by `(tenant, phone)`; deterministic ids for courts/rules).
- A second tiny tenant is seeded too, purely to keep tenant-isolation honest in dev.

**Acceptance criteria.**
- After `pnpm db:seed`, the demo club exists with courts, prices, staff, and members.
- Re-running the seed twice creates no duplicates.
- Both tenants exist and the isolation test passes against seeded data.

---

## US-04 — Deterministic booking engine

**Description.** The core of the product: a pure, fully-tested service layer that owns
availability, pricing, holds, bookings, and policy. No LLM anywhere in this story.

**Depends on.** US-02, US-03.

**Requirements.**
- `searchAvailability({ date, earliest?, latest?, duration? })` → candidate slots with
  computed prices, respecting operating hours, occupancies, and pricing rules.
- `priceSlot(...)` — peak/valley + member status + promo overrides; single source of
  price truth.
- `acquireHold({ court, range, member })` → hold row + occupancy row + payment row in
  `unpaid`, with TTL (default 15 min, per-tenant configurable). Serializable /
  constraint-backed so two concurrent holds on the last slot cannot both succeed.
- `confirmBooking(hold, paymentEvidence)` — transitions payment per the state machine
  and converts hold → confirmed booking.
- `releaseHold(hold)` / hold expiry — frees the occupancy, marks payment `expired`.
- `cancelBooking(booking, at)` — applies the policy engine (>12h → full wallet
  credit; <12h → per-club policy), frees the slot.
- `rescheduleBooking(...)` — atomic move (new hold + cancel old on confirm).
- Staff parity: manual bookings, overrides, and maintenance blocks go through the same
  engine functions (FR-1).
- Wallet ledger operations (credit, debit, no-show fee capture) — append-only.
- **Concurrent-hold simulation test** (NFR): N parallel attempts on one slot → exactly
  one succeeds, zero double-bookings, run in CI.

**Acceptance criteria.**
- Unit tests cover availability edges (operating hours, overlapping holds, maintenance
  blocks), pricing (peak/valley/member/promo), and every payment-state transition.
- The concurrency simulation passes repeatedly in CI.
- Cancelling >12h before start credits the wallet; <12h follows the seeded policy.
- No function in the engine imports anything LLM-related (enforced by a lint boundary
  or a simple dependency test).

---

## US-05 — Background jobs

**Description.** A Postgres-backed job runner for everything timer-driven: hold
expiry now; reminders, digests, and dunning later.

**Depends on.** US-02, US-04.

**Requirements.**
- Choose **pg-boss or graphile-worker** (spike both briefly; record the decision and
  rationale in `technical-requirements.md`).
- Job types this story ships: `expire-hold` (scheduled at hold creation for TTL) and a
  recurring sweeper as backstop.
- Jobs are tenant-aware, idempotent (safe on retry/duplicate), and logged.
- Worker runs in-process with the server for now; the boundary is clean enough to
  split into a separate process at deploy time if needed.

**Acceptance criteria.**
- An unpaid hold auto-releases after its TTL: occupancy freed, payment `expired`.
- A hold confirmed just before expiry is not released by the pending job.
- Killing and restarting the worker loses no scheduled expiries (persistence test).

---

## US-06 — Hosting, Meta app, secrets, and the payment-gateway spike

**Description.** Public HTTPS deployment, WhatsApp Cloud API dev app, secret
management — plus the one de-risking spike this plan has: verify the payments
assumption before building on it.

**Depends on.** US-01 (deployable scaffold); US-02 for migrations on deploy.

**Requirements.**
- Deploy to Railway or Fly.io (decide here): HTTPS, stable subdomain, health check,
  migrations on deploy, logs streaming.
- Neon Postgres provisioned; secrets only on the host: `DATABASE_URL`,
  `ANTHROPIC_API_KEY`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
  `WHATSAPP_APP_SECRET`, `WEBHOOK_VERIFY_TOKEN`, `ADMIN_BEARER_TOKEN`.
- Meta developer account + WhatsApp Cloud API app; dev test number; tester phones
  added (founder + friends — enough for the US-21 shakeout).
- **Spike: Mercado Pago sandbox for Peru** — can a PE account create payment links
  that accept Yape/Plin? What do the webhooks look like (idempotency keys, states)?
  Does the S/500 Yape cap surface per-transaction? Record findings in
  `technical-requirements.md`; if Mercado Pago can't do Yape for PE, evaluate
  Culqi/Izipay behind the same adapter interface *now*, not in US-14.
- **Draft the first utility templates in Spanish** (booking reminder with
  Confirmar/Cancelar buttons, payment nudge, cancellation notice) and submit for
  approval — approval takes time; US-16 needs them.
- Deploy/rollback documented in `Docs/technical/operations.md`.

**Acceptance criteria.**
- `curl https://<host>/health` returns 200 publicly; migrations applied.
- Meta dashboard shows the app + test number + testers.
- Spike findings written down with a go/adjust decision on the gateway.
- Templates submitted (approval status tracked, not necessarily granted yet).

---

## US-07 — WhatsApp inbound webhook and chat simulator

**Description.** Accept, verify, dedupe, and normalize inbound messages — and expose
the identical pipeline through an admin endpoint so agent development never requires a
phone. The simulator is the project's biggest velocity decision.

**Depends on.** US-06.

**Requirements.**
- `GET /whatsapp/webhook`: Meta `hub.challenge` verification.
- `POST /whatsapp/webhook`: validate `X-Hub-Signature-256` (raw-body HMAC) against
  `WHATSAPP_APP_SECRET`; 401 on mismatch.
- Parse payloads into a normalized `IncomingMessage`: `{ tenant_id, sender_phone
  (E.164), wa_message_id, kind: 'text' | 'button_reply' | 'list_reply' | 'media',
  text?, reply_id?, timestamp }`. Interactive replies (buttons/lists) are first-class
  — reminders and degraded mode depend on them.
- Return 200 within 5s regardless of downstream work; processing dispatched async.
- **Idempotency:** skip messages whose `wa_message_id` was already seen (US-02 index).
- **Transport-agnostic pipeline:** the pipeline consumes `IncomingMessage` behind an
  interface; the Meta webhook is one producer. `POST /admin/simulate-message`
  (bearer-protected) injects an `IncomingMessage` through the *identical* path — the
  substrate for development, demos, and the US-20 eval harness.
- Unsupported media (audio, stickers, images) get a polite es-PE "solo texto por
  ahora" reply and skip the agent.
- Every inbound is logged before processing (replayable failures).

**Acceptance criteria.**
- Meta webhook subscription verified; a text from a tester phone produces a parsed
  `IncomingMessage` in logs.
- Tampered signature → 401. Redelivered payload → processed exactly once.
- `POST /admin/simulate-message` produces identical downstream behavior to a real
  delivery, including button replies.

---

## US-08 — WhatsApp outbound delivery

**Description.** Send replies out — free-form text within the 24h window, approved
templates outside it, and interactive messages (buttons, lists, media) — with retries
and rate limiting.

**Depends on.** US-06.

**Requirements.**
- Thin client on `POST graph.facebook.com/v…/messages` supporting: text, utility
  **template sends** (with variables), **interactive buttons/lists**, and media (QR
  image for yapeo, location pin).
- Window tracking: per-recipient last-inbound timestamp decides free-form vs
  template; sending free-form outside the window is refused by the client with a
  structured error (so bugs surface loudly, not as silent Meta 4xxs).
- Retry on 5xx (max 2, backoff); structured 4xx errors; per-conversation outbound
  rate limit (e.g. 6 msgs/60s) to contain loop bugs.
- Per-message cost tracking hook: template sends record category + country for the
  guardrail telemetry (US-12 aggregates it).
- `POST /admin/ping` (bearer-protected) sends a test message to a named phone.

**Acceptance criteria.**
- `/admin/ping` delivers a WhatsApp message to a tester.
- Round-trip "hola" → hard-coded reply works end-to-end (no agent yet).
- An interactive button message renders on a real phone and the button reply comes
  back through the US-07 pipeline.
- Free-form send to an out-of-window recipient is blocked client-side.

---

## US-09 — Identity: first-contact registration, roles, and abuse guard

**Description.** Resolve every sender to a member or staff identity; register unknown
numbers conversationally (PRD §4.2); protect the LLM path from abuse now that it's
open to strangers.

**Depends on.** US-03, US-07, US-08.

**Requirements.**
- On every inbound: resolve `(tenant, phone)` against `members` and `staff`; attach
  `Identity { member?, staff_roles?: ('owner'|'admin'|'coach')[] }`.
- **Unknown number → registration flow:** agent (or, pre-US-11, a scripted exchange)
  asks for name and optionally level in es-PE; creates the member profile keyed on
  phone; continues the original request ("¿tienen cancha mañana?") without making the
  user repeat it.
- **Abuse guard:** per-number rate limit (e.g. max N inbound/hour for unregistered
  numbers), per-tenant daily LLM spend cap with alerting, and a cheap pre-LLM triage
  that drops obvious spam. Rejections logged with a salted phone hash, not raw PII.
- Consent record at registration (Ley N° 29733): store what the member agreed to and
  when; opt-in flags for proactive message categories default per PRD (transactional
  yes, promos opt-in).

**Acceptance criteria.**
- A seeded member's message reaches the agent path with a populated `Identity`.
- An unknown number gets the registration exchange and ends up as a member; their
  original question is then answered.
- The 100th message in an hour from one unregistered number is rate-limited without
  an LLM call.
- Staff numbers resolve with their roles attached.

---

## US-10 — Conversation history and human takeover

**Description.** Persist every turn and replay history so the agent loop stays
stateless; pause the agent when a human staff member steps into a thread (PRD §4.9).

**Depends on.** US-02, US-09.

**Requirements.**
- Append user turns; load last 20 turns per `(tenant, phone)` thread; build the
  Anthropic message array. No summarization in MVP.
- Threads never bleed across tenants or phones.
- **Human takeover:** an outbound message sent by staff from the business number
  (detected via Meta's echo webhooks, or toggled via `/admin` + later the dashboard)
  pauses the agent on that thread; `"/agente on"` from staff or 60 min of staff
  inactivity resumes it. Paused-thread inbounds are stored (nothing lost) and
  surfaced to staff.

**Acceptance criteria.**
- 5 exchanges → ≥ 10 correctly ordered rows; two testers' threads stay isolated.
- Replay round-trips through the Anthropic API without schema errors.
- While paused, the agent sends nothing on that thread; resume works via both paths.

---

## US-11 — Claude agent loop (es-PE, cached, confirm-before-write)

**Description.** The stateless tool-calling loop: cached per-tenant system prompt,
Sonnet with the tool registry, execute tool calls, loop to `end_turn`, reply in
Peruvian Spanish.

**Depends on.** US-08, US-10.

**Requirements.**
- `@anthropic-ai/sdk`; model from `ANTHROPIC_MODEL` (default `claude-sonnet-4-6`).
- System prompt assembled per tenant: club name/courts/hours, pricing summary,
  policies, es-PE persona (§5: warm, brief, lightly emoji'd, "tú"), grounding rules
  (only state availability/prices/policies returned by tools; on tool failure, say so
  and offer a human), escalation rules (complaints, refund disputes, incidents,
  aggression, 2 consecutive failed interpretations → ping staff with context).
- `cache_control: { type: 'ephemeral' }` on system prompt + tool definitions; static
  content first, volatile content after the cache breakpoint.
- Tool registry: `name`, `description` (es-friendly), Zod input schema → JSON Schema,
  async `handler(input, ctx)`; `ctx` carries `Identity`, tenant, thread, db, outbound
  client. **Role-gating enforced in the dispatcher** (member vs staff tools).
- Loop: execute tool calls (parallel), append `tool_result` (errors as
  `is_error: true`), stop on `end_turn`, max 6 iterations, 30s wall clock.
- **Confirm-before-write:** before any tool that books, holds, cancels, or charges,
  the agent echoes the absolute resolved datetime, court, and price ("Jue 09/07,
  8:00–9:30pm, Cancha 2, S/120 — ¿confirmo?") and waits for a yes. Relative-time
  resolution in `America/Lima` is the #1 failure mode; evals in US-20 cover it.
- First tool: `whoami()`. Assistant + tool turns persisted.

**Acceptance criteria.**
- A member's "hola" gets a contextual es-PE greeting naming the club.
- `input_tokens_cache_read > 0` on the second turn within 5 minutes.
- A tool that throws produces a friendly es-PE fallback within loop limits.
- A member cannot invoke a staff-gated tool (dispatcher refuses, prompt-injection
  test included).

---

## US-12 — Observability and cost guardrail telemetry

**Description.** Per-LLM-call telemetry, per-booking cost attribution, and the
admin surface to debug failed conversations.

**Depends on.** US-11.

**Requirements.**
- One `agent_turns` row per API call: latency, model, token counts (incl. cache),
  tool calls JSONB, error. Computed cost per turn from current pricing.
- **Per-booking attribution:** turns and template sends link to the booking they
  produced (or the conversation, when no booking results), yielding LLM+template cost
  per completed booking — the < S/0.50 guardrail (PRD §7). Alert (log/notify) when a
  rolling average exceeds it.
- `GET /admin/turns?thread=…` and `GET /admin/costs?tenant=…` (bearer-protected).
- Booking-funnel events: inquiry → hold → paid → completed, queryable per tenant.

**Acceptance criteria.**
- After one simulated booking conversation, `/admin/turns` shows the turns with
  tokens, cache hits, tool calls, latencies; `/admin/costs` shows a per-booking cost.
- An errored turn shows `error` populated; the user saw a friendly es-PE message.

---

## US-13 — Booking tools: the headline flow

**Description.** The MVP intents as tools against the US-04 engine: check
availability, book (hold → confirm), cancel, reschedule, my bookings, prices/hours.
Payment in this story is per-club "cash/pay-at-club" mode; US-14/15 complete it.

**Depends on.** US-04, US-05, US-11.

**Requirements.**
- Tools: `search_availability`, `create_hold` (returns hold + price + expiry),
  `confirm_booking` (cash mode: books as "unpaid — at risk" per club policy),
  `cancel_booking` (policy applied, wallet credited), `reschedule_booking`,
  `list_my_bookings`, `get_club_info` (prices/hours/location).
- Agent proposes at most 2–3 alternatives when the requested slot is full (§4.1).
- Hold expiry notifies the member ("se venció tu reserva, ¿la retomamos?") via the
  US-05 job + US-08 client.
- All writes behind confirm-before-write; all times formatted in `America/Lima`;
  prices in S/.
- Staff can do the same by name ("resérvale a Marco jueves 6pm, paga en cancha").

**Acceptance criteria.**
- Simulator: "¿tienen cancha mañana 7pm?" → real availability with prices; "resérvala"
  → echo + confirm → hold created; cash-mode confirm books it.
- A conflicting request gets alternatives in the same reply, not an error dump.
- An unpaid hold expires on TTL and the member is notified.
- Cancelling >12h out credits the wallet and frees the slot for rebooking.
- Reschedule moves the booking atomically (no window where both or neither exist).

---

## US-14 — Payments I: gateway adapter (Mercado Pago)

**Description.** Payment links that auto-confirm bookings: pluggable gateway
interface, Mercado Pago implementation, idempotent webhooks.

**Depends on.** US-06 (spike findings), US-13.

**Requirements.**
- `PaymentGateway` interface (create link for a hold, parse/verify webhook, refund);
  Mercado Pago adapter first; credentials per tenant.
- Booking flow: hold → agent sends payment link → gateway webhook (signature-verified,
  idempotent) → payment `held → paid` → booking confirmed → es-PE confirmation
  message with the cancellation-policy line.
- Failure/expiry paths: failed payment keeps the hold ticking with a nudge; hold
  expiry marks the payment `expired` and voids the link where the gateway allows.
- Yape S/500 per-operation cap: amounts above it get split-payment instructions or
  card fallback per the US-06 spike findings.
- Fees pass-through or absorbed per tenant setting (recorded on the payment row).

**Acceptance criteria.**
- Sandbox end-to-end: hold → link → sandbox payment → webhook → confirmed booking →
  WhatsApp confirmation, with the payment row walking `unpaid → held → paid`.
- Replayed webhook does not double-confirm (idempotency test).
- A >S/500 booking triggers the cap handling.

---

## US-15 — Payments II: manual yapeo, cash, and cierre de caja

**Description.** The zero-fee path most clubs start on: club's Yape QR + one-tap
staff confirmation; plus the daily reconciliation report.

**Depends on.** US-13, US-08.

**Requirements.**
- Manual-yapeo flow (§4.3): agent sends the club's Yape/Plin QR image + number;
  member replies "ya pagué"; **staff get an interactive one-tap Confirmar/Rechazar
  message**; hold timer keeps running until confirmed; screenshots are never treated
  as proof (prompt rule + no image parsing).
- Staff confirm → `paid` + booking confirmed; reject → member notified, hold
  continues to TTL.
- Cash-on-arrival per club policy: booking "unpaid — at risk", counted in no-show
  stats.
- **Cierre de caja** (§4.9): end-of-day job builds a summary reconciling every
  booking to a payment method (gateway / yapeo / cash / unpaid) with discrepancies
  flagged; delivered to the owner on WhatsApp (template) and via `/admin`.
- SUNAT-friendly CSV export of payment records (FR-4).

**Acceptance criteria.**
- Simulator + real phone: yapeo flow end-to-end including the staff one-tap confirm.
- Unconfirmed yapeo hold expires normally at TTL.
- Cierre de caja for a seeded day lists every booking with its payment method and
  flags a deliberately-mismatched one.
- CSV export downloads with the day's payments.

---

## US-16 — Reminders and no-shows

**Description.** Template reminders at 24h and 2h with Confirm/Cancel buttons, and
the no-show ledger with configurable sanctions (§4.7).

**Depends on.** US-05, US-08, US-13; templates approved (US-06).

**Requirements.**
- Jobs schedule 24h and 2h reminders per confirmed booking using approved utility
  templates with Confirmar / Cancelar buttons; button replies flow through the
  normal pipeline (cancel applies the policy engine).
- Reminder sends respect opt-outs and are recorded with cost (guardrail telemetry).
- No-show recording: staff mark no-shows (via WhatsApp ops or `/admin`); record on
  the member profile; configurable sanctions per tenant — wallet fee, prepay-only
  flag, temporary block after N strikes — enforced on the next booking attempt.
- Booking-confirmed and cancellation notices (already sent in US-13/14/15) switch to
  templates automatically when outside the 24h window.

**Acceptance criteria.**
- A confirmed booking gets both reminders (time-travel test via job runner clock).
- Tapping Cancelar in the 24h reminder cancels with policy applied.
- A member with N strikes is required to prepay on their next booking.
- Opted-out members receive no optional messages.

---

## US-17 — Owner surface I: WhatsApp ops and weekly digest

**Description.** Natural-language operations for owner/admin on WhatsApp, and the
weekly digest — the retention surface (FR-8 ships this even before the web dashboard
grows up).

**Depends on.** US-11, US-13; US-15 for revenue numbers.

**Requirements.**
- Staff-gated tools: `today_grid` ("¿cómo va hoy?" → occupancy grid + revenue),
  `block_court` ("bloquea cancha 1 mañana 9–11 por mantenimiento" → maintenance
  occupancy), `book_for_member` (by name), `member_lookup`, `mark_no_show`.
- **Weekly digest** job: occupancy %, revenue, no-shows charged, recovered
  cancellations (slots that re-booked after a cancel), new members, valley-hour
  trend; sent to the owner via approved template; content also available at
  `/admin/digest`.
- Escalations (from US-11 rules) ping staff with conversation context and a takeover
  hint.

**Acceptance criteria.**
- Owner: "¿cómo va hoy?" returns the real grid and revenue for the seeded day.
- "bloquea cancha 1 mañana 9–11" creates a maintenance block that availability
  respects (and the GIST constraint enforces).
- The digest job produces correct numbers for a seeded week and delivers on WhatsApp.
- A member cannot trigger any of these tools.

---

## US-18 — Owner surface II: onboarding wizard and minimal dashboard

**Description.** Same-day setup as a product requirement (FR-11): a wizard covering
courts, hours, prices, policies, payment mode, and WhatsApp number path — plus a
minimal mobile-first web dashboard.

**Depends on.** US-02; US-14/15 for payment-mode config.

**Requirements.**
- Decide the web stack here (server-rendered Express views/HTMX vs small SPA) —
  record in `technical-requirements.md`; mobile-first either way.
- Auth for staff (magic link or phone-code; no passwords to manage).
- Wizard: club basics → courts + hours → pricing rules → policies (cancellation
  window, hold TTL, no-show sanctions) → payment mode (gateway credentials or yapeo
  QR upload) → WhatsApp number path (dedicated vs migration, **with the "number
  can't stay in the consumer app" warning made explicit**, FR-3).
- Schedule import from CSV (existing bookings), so a club's current week survives
  the switch.
- Dashboard v0: today grid, week occupancy by hour/court, bookings list, member
  list with profile (history, wallet, no-shows), cierre de caja view.
- Roles enforced (owner/admin/coach scopes).

**Acceptance criteria.**
- A fresh tenant can be fully configured through the wizard in one sitting and
  immediately serve a simulated booking conversation.
- CSV import places existing bookings on the grid (and they occupy courts).
- Coach role sees schedules but cannot edit prices or payments.

---

## US-19 — Degraded mode: button-menu booking without the LLM

**Description.** If the LLM provider is down, core booking still works via WhatsApp
interactive lists/buttons driven directly by the engine (FR-2, availability NFR).

**Depends on.** US-07, US-08, US-13.

**Requirements.**
- Health-based switch (Anthropic API errors/timeouts past a threshold) plus a manual
  toggle; per-tenant.
- Scripted flow with interactive messages: pick day (list) → pick slot (list, with
  prices) → confirm (button) → hold + payment per club mode. Cancel via "mis
  reservas" list.
- Copy makes the mode invisible ("elige una opción") — no apology banners.
- Non-booking questions get a short es-PE "un humano te responde pronto" + staff ping.

**Acceptance criteria.**
- With the LLM stubbed to fail, a full booking completes via buttons in the
  simulator and on a real phone.
- Recovery flips back to the agent automatically.

---

## US-20 — Spanish eval harness and behavior polish

**Description.** Evals that keep the agent honest in es-PE, run against the live loop
through the simulator pipeline.

**Depends on.** US-13; ideally after US-14/15 so payment phrasing is real.

**Requirements.**
- `evals/prompts.json`: 20–30 es-PE prompts with expected first tool call and/or
  expected-behavior assertions; `pnpm eval` runs them through the simulator and
  reports pass/fail.
- Must-cover cases: relative time resolution in `America/Lima` ("mañana 7pm",
  "el martes" said on a Tuesday, "7" AM/PM ambiguity — expect clarifying question),
  grounding (never invent availability/prices — seeded-empty club answers honestly),
  peruanismos ("¿hay cancha pa' hoy?", "ya te yapeé"), escalation triggers, opt-out
  honoring, and one prompt-injection attempt at a staff tool.
- System-prompt polish driven by failures; few-shot examples for the top broad
  patterns.

**Acceptance criteria.**
- ≥ 85% of eval prompts pass; time-resolution cases 100% (correct absolute datetime
  or a clarifying question).
- "¿quiénes son los profesores?" (or any unseeded fact) does not invent an answer.

---

## US-21 — Internal shakeout (founder + friends)

**Description.** End-to-end validation on the Meta dev test number before any real
club: every P0 flow exercised by real humans on real phones for a week.

**Depends on.** All prior stories.

**Requirements.**
- Pre-flight: demo club seeded with testers; templates approved; logs + `/admin`
  reachable; rollback documented.
- Scripted scenario per tester: register as a new member (from an unknown number),
  book with gateway payment (sandbox), book with manual yapeo (a tester plays staff
  with the one-tap confirm), get reminders, cancel late and early, no-show once,
  trigger degraded mode once, owner runs "¿cómo va hoy?" and receives the digest.
- **Pre-committed pass signals written before the run** (spiritual heir of review
  §7): zero double-bookings or wrong-time bookings; ≥ 70% of scripted flows complete
  without human intervention; per-booking cost under the guardrail; median
  inquiry→confirmed time < 3 min.
- Bugs and impressions tracked in `Docs/product/shakeout-notes.md`.

**Acceptance criteria.**
- Every scripted flow completed by ≥ 3 testers; pass signals evaluated in writing.
- A go/fix-first decision recorded for proceeding to the design partner.

---

## US-22 — Business verification and design-partner onboarding

**Description.** The Phase 0 gate: a real Lima club live on the product under the
90-day design-partner deal (PRD §8), with its baseline measured.

**Depends on.** US-21 pass.

**Requirements.**
- Meta Business verification; production WhatsApp number per the club's chosen path
  (dedicated or migration); templates re-submitted under the production WABA.
- Production gateway credentials (or yapeo mode) configured via the wizard.
- **Baseline week instrumentation** (PRD §9): measure the club's current no-show
  rate, response time, and valley occupancy during onboarding week — success metrics
  are relative to this.
- Founder-led same-day setup at the club; concierge fallback plan (staff can always
  take over any thread).
- Ley 29733 checklist: consent copy in registration, data-deletion path, PII
  redaction in logs verified.
- Success-metric dashboards live: activation (first paid agent-booking < 24h),
  automation rate, no-show rate vs baseline, inquiry→booking time.

**Acceptance criteria.**
- The design-partner club takes its first real, paid, agent-completed booking within
  24h of setup (PRD activation metric).
- Baseline numbers recorded; weekly digest flowing to the real owner.
- A written 30-day check-in against PRD §9 metrics.

---

## What's explicitly NOT in this plan (PRD P1/P2)

- Waitlist + auto-offer cascade; "falta uno" open-match fill; turno fijo (FR-5, §4.5/4.6).
- Reactivation & valley promos; segments (FR-6/FR-7 P1 parts).
- Academy: groups, rosters, attendance, monthly billing/dunning (FR-9).
- Tournaments & leagues (FR-10). Instagram DM channel (P2). Photo-of-notebook import.
- Full analytics dashboard beyond v0 (FR-8 P1).
- Multi-country, English club UI, marketplace features, hardware integrations — out of
  scope entirely (PRD §11).
- Conversation summarization beyond the 20-turn window; the Haiku router (build when
  pilot telemetry justifies it — see agent-stack.md).
