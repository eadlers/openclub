# openclub V1 — Implementation Plan

This plan turns the [V1 PRD](./PRD.md) into an ordered series of user stories that each take V1 a meaningful step forward. Following them top-to-bottom builds the app along the natural dependency graph: foundation → transport → agent core → member flows → pro flows → group chat → polish → dogfood.

## Progress

| Story | Status |
|---|---|
| US-01 Scaffold | ✅ Done |
| US-02 Data model | Next — needs a Postgres instance (Neon or local Docker) |
| US-03 → US-19 | Not started |

## Stack decisions baked into the plan

| Area | Choice | Rationale |
|---|---|---|
| Language / runtime | TypeScript on Node.js | Strong fit for thin webhook + Claude agent loop; first-class Anthropic SDK; tight types across tool schemas. |
| HTTP framework | Express | Most widely used Node framework; deepest tutorial/example base to learn from; mature. Add `pino` for structured logs. |
| ORM / migrations | Drizzle + drizzle-kit | Typed Postgres without Prisma's runtime weight; raw-SQL escape hatch when needed. |
| Database | Neon Postgres (managed, free tier) | Always-on, cheap, native Postgres features (timestamptz, GIST exclusion). |
| Hosting | Railway (or Fly.io) for the API | Always-on so testers can text any time; small footprint keeps cost ≈ $0. |
| LLM | Anthropic Claude Sonnet 4.6 direct, with prompt caching | Per [technical-requirements.md](../technical/technical-requirements.md) + [agent-stack.md](../technical/agent-stack.md): direct (not model-agnostic) for simplicity + strongest tool use; caching cuts ~43% cost. |
| Messaging | Meta WhatsApp Cloud API direct, dev test number | Free + official; the 5-tester limit covers the dogfood exactly. |
| Tests | Vitest (+ supertest) | Fast, ESM-native, fine for unit + integration. |
| Lint / format | Biome | Chosen in US-01 — single fast toolchain. |
| Package manager | pnpm | Faster installs, strict by default. |

## How to read each story

Each story has:
- **Description** — what slice of V1 it delivers.
- **Depends on** — prior stories that must be in place.
- **Requirements** — what the implementation must include.
- **Acceptance criteria** — concrete checks that prove it's done.

Stories are intentionally sized so you can ship one in a sitting and have a green test on it before moving on.

## Sequencing rationale

1. **US-01 → US-03 (Foundation):** scaffold, schema, seed. Nothing user-facing yet, but every later story builds on this.
2. **US-04 → US-07 (Transport + identity):** make round-trip WhatsApp messages work and enforce invite-only.
3. **US-08 → US-10 (Agent core):** persistent history, tool-using Claude loop, observability — once these are in, every new feature is "add a tool."
4. **US-11 → US-14 (Member flows):** the headline V1 capabilities for members.
5. **US-15 → US-16 (Lesson lifecycle):** the trickiest member↔pro async flow.
6. **US-17 (Group chat):** the V1 differentiator — last because it builds on every prior story.
7. **US-18 → US-19 (Polish + dogfood):** behavior tightening and the actual dogfood run.

---

## US-01 — Repository scaffold and developer tooling

**Description.** Stand up the TypeScript backend skeleton with the minimum tooling needed to develop and ship V1.

**Depends on.** —

**Requirements.**
- TypeScript with `strict: true`.
- Express HTTP server on Node.js with a `GET /health` route returning 200.
- Environment loading via Zod-validated config (fail fast on boot if a required var is missing).
- Biome for lint/format.
- Vitest for tests.
- pnpm scripts: `dev`, `build`, `start`, `test`, `lint`, `typecheck`, `db:generate`, `db:migrate`, `db:seed`.
- `.env.example` listing every variable used by the app.
- README section: "How to run locally."

**Acceptance criteria.**
- Fresh clone → `pnpm install && pnpm dev` boots the server and `curl localhost:3000/health` returns 200.
- `pnpm test`, `pnpm typecheck`, and `pnpm lint` all pass on the empty scaffold.
- Booting the server with a required env var missing exits with a clear error.

---

## US-02 — Data model and migrations

**Description.** Implement the PRD's data model in Drizzle with the constraints needed to keep V1 honest.

**Depends on.** US-01.

**Requirements.**
- Tables: `clubs`, `courts`, `members`, `pros`, `court_bookings`, `court_booking_members` (M:N), `lessons`, `lesson_members` (M:N), `programs`, `program_registrations`, `conversation_turns`, `agent_turns` (per-LLM-call telemetry — used in US-10).
- `clubs.timezone` (IANA string). All timestamps stored as `timestamptz`.
- `members.phone` and `pros.phone` are E.164 strings; both unique; a phone may exist in both tables (a person who is both a member and a pro).
- `court_bookings`: enforce no-overlap-per-court using a `tstzrange` column plus a GIST exclusion constraint (`EXCLUDE USING gist (court_id WITH =, range WITH &&)`). Generated column or trigger maintains `range` from `start_at`/`end_at`.
- `program_registrations`: unique `(program_id, member_id)` excluding cancelled rows (partial unique index).
- Enums: `program_type` ∈ {`open_play`, `clinic`, `event`}; `booking_status` ∈ {`pending`, `confirmed`, `cancelled`, `declined`}.
- A short `Docs/technical/data-model.md` summarizing the schema and the key invariants.

**Acceptance criteria.**
- `pnpm db:migrate` applies cleanly to a fresh Neon database.
- Inserting an overlapping `court_bookings` row for the same court is rejected at the DB level.
- Re-registering the same member for the same program (non-cancelled) is rejected at the DB level.
- All FK relationships and on-delete behaviors documented in `data-model.md`.

---

## US-03 — Mock club seed

**Description.** Populate the dogfood scenario deterministically so any contributor can reset the DB and have a usable club.

**Depends on.** US-02.

**Requirements.**
- `pnpm db:seed` creates: 1 club (with timezone, e.g., `America/New_York`), 3 courts with operating hours (e.g., 07:00–23:00 local), 5–6 members (founder + friends), 2 pros, ≥ 6 upcoming programs spanning all three types across the next 14 days.
- Phone numbers and tester names come from a local `seed.config.json` (gitignored) — no PII in the repo.
- Seed is idempotent (upsert by phone for people; deterministic ID for programs).
- One member also exists as a pro (to exercise the dual-role case).

**Acceptance criteria.**
- After `pnpm db:seed`, `select * from members` contains the configured testers with E.164 phone numbers.
- At least two of each program type exist in the next 14 days.
- Re-running seed twice does not create duplicates.

---

## US-04 — Hosting, Meta dev app, and secrets

**Description.** Get the backend reachable on a public HTTPS URL, with the WhatsApp Cloud API dev app provisioned and secrets managed securely.

**Depends on.** US-01.

**Requirements.**
- Backend deployed to Fly.io (or Railway) with HTTPS, a stable subdomain, and a health check.
- Neon Postgres provisioned; `DATABASE_URL` configured on the host; migrations run on every deploy.
- Meta developer account + WhatsApp Cloud API app created. Test phone number provisioned. Up to 5 tester phone numbers added (founder + friends).
- Secrets stored only on the host (`ANTHROPIC_API_KEY`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WEBHOOK_VERIFY_TOKEN`, `DATABASE_URL`, `ADMIN_BEARER_TOKEN`). Never committed.
- **Spike: validate the Groups API on the dev test number** (can it create a group and receive group messages?). This de-risks US-17 now instead of at the end. Record the finding in `Docs/technical/technical-requirements.md`.
- **Submit utility templates for approval** (`lesson_request`, `lesson_status_update`, `cancellation_notice`) — needed by US-13/US-15 for notifications outside the 24h service window; approval takes time, so start it here.
- Deploy and rollback documented in `Docs/technical/operations.md`.

**Acceptance criteria.**
- `curl https://<host>/health` returns 200 publicly.
- Migrations applied to the prod DB.
- Meta dev dashboard shows the app with the test number and the tester phones added.
- `.env.example` updated to list every var the app expects.

---

## US-05 — WhatsApp inbound webhook

**Description.** Accept and parse messages from Meta's WhatsApp Cloud API, with authenticity verification and a normalized internal shape.

**Depends on.** US-04.

**Requirements.**
- `GET /whatsapp/webhook`: Meta's `hub.challenge` verification against `WEBHOOK_VERIFY_TOKEN`.
- `POST /whatsapp/webhook`: validate `X-Hub-Signature-256` against `WHATSAPP_APP_SECRET`; reject mismatches with 401.
- Parse inbound payloads into an internal `IncomingMessage`: `{ sender_phone (E.164), wa_message_id, channel: 'dm' | 'group', group_id?, text, timestamp }`.
- Non-text messages (image, audio, sticker, etc.): for V1, send a one-line "I can only read text in V1" reply and skip the agent loop.
- Webhook handler returns 200 within 5s regardless of downstream work; processing dispatched to an in-process worker.
- Every inbound logged before processing (so we can replay failures).

**Acceptance criteria.**
- Meta dashboard shows the webhook subscription as verified.
- Sending a text from a tester phone produces a parsed `IncomingMessage` in logs and a row in `conversation_turns` (after US-08; for this story, log only).
- A request with a tampered signature is rejected with 401.
- An image message triggers the "text only in V1" reply and no LLM call.

---

## US-06 — WhatsApp outbound delivery

**Description.** Send replies back into WhatsApp — to 1:1 chats and into groups — with sane error handling.

**Depends on.** US-04.

**Requirements.**
- Thin client around `POST graph.facebook.com/v.../messages` using `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_TOKEN`.
- Routes a reply back to either an individual `wa_id` or the originating group thread.
- Supports both free-form text sends (valid only within the recipient's 24h service window) and **template sends** (pre-approved utility templates from US-04) for business-initiated notifications outside the window. The client picks template vs free-form based on whether the recipient has messaged within 24h.
- Retry on 5xx (max 2 retries, exponential backoff); surface 4xx as structured errors.
- Per-conversation rate limit (e.g., max 6 outbound messages / 60s) to contain agent-loop bugs.
- Internal admin-only `POST /admin/ping` (bearer-token-protected) that sends a test message to a given phone — useful for smoke-testing without going through the agent loop.

**Acceptance criteria.**
- Hitting `/admin/ping` with a valid token delivers a WhatsApp message to the named tester.
- A round-trip "hello" → fixed "hi back" reply works end-to-end (still no agent loop yet; this story can hard-code the reply).
- Forcing the WhatsApp API to return 500 retries up to 2 times then logs an error.

---

## US-07 — Identity gate (invite-only)

**Description.** Enforce invite-only access before any LLM call. Unknown phones get a templated rejection; known phones are tagged with member, pro, or both.

**Depends on.** US-03, US-05, US-06.

**Requirements.**
- On every inbound, look up the sender phone in `members` and `pros`.
- If neither exists: send the templated `UNKNOWN_USER_REPLY` ("Hi, you don't have access yet. Contact the club to be added.") and stop. No `conversation_turns` row. No Anthropic call.
- If known: attach `Identity { member?, pro?, role: 'member' | 'pro' | 'both' }` to the message context for downstream handlers.
- Log the rejection with a salted hash of the phone (not the phone itself) so we can spot spam without storing PII.
- Group chats: each sender resolved independently per their own phone; the agent is invoked only when a known user speaks.

**Acceptance criteria.**
- An unknown number sending "hi" receives the templated rejection; no rows in `conversation_turns`; no Anthropic API call.
- A seeded member sending "hi" reaches the agent code path with a populated `Identity`.
- The dual-role tester (member + pro) is tagged `role: 'both'`.

---

## US-08 — Conversation history persistence

**Description.** Persist every turn (user, assistant, tool) and replay history on each new turn so the agent loop can stay stateless.

**Depends on.** US-02, US-07.

**Requirements.**
- `conversation_turns` columns: `id`, `conversation_id` (sender phone for DMs, group id for groups), `participant_phone`, `role` ∈ {`user`, `assistant`, `tool`}, `content` (JSONB — Anthropic-compatible blocks), `tool_use_id?`, `created_at`.
- On each inbound: append the `user` turn; load the last 20 turns for the same `conversation_id`; build the Anthropic message array.
- For V1, do **not** summarize older turns — accept the trim at 20.
- Conversations are keyed per phone in DMs and per group thread in groups; do not bleed between contexts.

**Acceptance criteria.**
- After 5 back-and-forth user/assistant exchanges, ≥ 10 rows exist in `conversation_turns` with the right roles and order.
- Two separate testers' conversations stay isolated.
- Replay produces a message array that round-trips through Anthropic without schema errors.

---

## US-09 — Claude agent loop with tool use and prompt caching

**Description.** The core stateless agent loop: assemble a cached system prompt, call Claude Sonnet 4.6 with the tool registry, execute returned tool calls, loop until the model emits `end_turn`, send the final text to WhatsApp.

**Depends on.** US-06, US-08.

**Requirements.**
- `@anthropic-ai/sdk`, model `claude-sonnet-4-6` (from `ANTHROPIC_MODEL`).
- System prompt built per turn from: club name, timezone, courts + operating hours, current upcoming programs (≤ 14 days), pro roster, policies, persona/style, group-chat rules.
- Mark the system prompt and the tool definitions with `cache_control: { type: 'ephemeral' }` (5-minute TTL).
- Tool registry pattern: each tool has `name`, `description`, Zod input schema (converted to JSON Schema for Anthropic), and an async `handler(input, ctx)`. `ctx` carries `Identity`, `conversation_id`, db handle, and the outbound WhatsApp client.
- Agent loop: call API → if `stop_reason === 'tool_use'`, execute returned tool calls in parallel, append `tool_result` blocks, loop. Stop at `end_turn`, on max iterations (6), or on wall-clock timeout (30s).
- Tool errors are returned to the model as `tool_result` with `is_error: true` so it can recover gracefully.
- Final assistant text sent via the outbound client; assistant + tool turns persisted to `conversation_turns`.
- One toy tool wired in for this story: `whoami()` returning the caller's identity.

**Acceptance criteria.**
- A member sending "hello" gets a contextual greeting that mentions the club name.
- `whoami` is callable end-to-end through WhatsApp; the model can summarize the result back to the user.
- The Anthropic API response shows `input_tokens_cache_read > 0` on the second turn within 5 minutes.
- A tool that always throws returns a friendly fallback reply within the loop's iteration / time limits.

---

## US-10 — Per-turn observability

**Description.** Capture enough telemetry per LLM call to debug failed conversations and to spot-check cost.

**Depends on.** US-09.

**Requirements.**
- `agent_turns` columns: `id`, `conversation_id`, `created_at`, `latency_ms`, `model`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `tool_calls` (JSONB array of `{ name, input, latency_ms, error? }`), `error?`.
- One `agent_turns` row per Anthropic API call (so multiple per user message during a tool-use loop).
- `GET /admin/turns?conversation_id=…&limit=100` returns the most recent turns as JSON, protected by `ADMIN_BEARER_TOKEN`.
- Structured console logs in dev; logs streamed to the host's log system in prod.

**Acceptance criteria.**
- After a single court-booking conversation, `/admin/turns` shows ≥ 2 rows with token counts, cache hit info, tool calls, and latencies.
- A turn that errored shows `error` populated and the user received a friendly "Something went wrong" reply (no raw stack traces).

---

## US-11 — Court availability and booking tools

**Description.** Two tools that together enable the headline member flow: "is X free?" and "book it."

**Depends on.** US-09.

**Requirements.**
- Tool `search_court_availability({ date, earliest_start?, latest_start?, duration_minutes? })`: returns up to N candidate slots across courts that fit the constraints, respecting operating hours and existing `court_bookings`/`programs`.
- Tool `create_court_booking({ court_id, start_at, duration_minutes, member_phones? })`: creates a `confirmed` court booking, links the requesting member (and any additional `member_phones` — used by group flow in US-17), rejects on conflict.
- Default duration: **90 minutes** (per PRD assumption). Agent should ask for confirmation if the user requests a non-standard duration.
- Time parsing in the club's timezone.
- Successful reply includes date (formatted in club tz), start time, court name, duration, and participants.

**Acceptance criteria.**
- "Book a court Tuesday at 7pm" → agent creates a 90-minute booking starting Tuesday 19:00 club-local on one of the available courts and confirms by name.
- A conflicting request returns a tool error; the agent suggests alternative slots in the same reply.
- A request outside operating hours is refused with a clear message.
- The resulting `court_bookings` row has the requesting member linked via `court_booking_members`.

---

## US-12 — List my upcoming reservations

**Description.** A single tool that returns the user's upcoming items across court bookings, lessons, and program registrations.

**Depends on.** US-11.

**Requirements.**
- Tool `list_my_upcoming_reservations()`: returns the next 30 days of non-cancelled items as a chronological array of `{ type: 'court' | 'lesson' | 'program', id, start_at, end_at, court?, pro?, program_name?, status, co_participants[] }`.
- Pending lessons are included with `status: 'pending'`.
- Co-participants on group court bookings are listed by name.

**Acceptance criteria.**
- After making one court booking, one lesson request, and one program registration, "what's on my calendar?" returns all three in chronological order.
- Cancelled items do not appear.
- Declined lesson requests do not appear.

---

## US-13 — Cancel a reservation

**Description.** One tool to cancel any reservation type, with the necessary side effects (free capacity, notify pros).

**Depends on.** US-11, US-12.

**Requirements.**
- Tool `cancel_reservation({ type, id })`: validates the caller is on the booking and that `start_at > now`; sets status to `cancelled`.
- Program cancellations free capacity (the registration is `cancelled`; `spots_remaining` is computed from non-cancelled registrations).
- Lesson cancellations send an outbound WhatsApp message to the pro: "[Member] cancelled the lesson on [date/time]."
- For group court bookings, V1 cancels the whole booking when any participant cancels (simpler; documented as a limitation to revisit in V1.next).
- Reject cancellations of past or non-owned reservations with a clear tool error.

**Acceptance criteria.**
- Cancelling a court booking removes it from `list_my_upcoming_reservations`.
- Cancelling a confirmed lesson sends a WhatsApp notice to the pro.
- Cancelling a program registration restores `spots_remaining` and lets another member register up to capacity again.
- Cancelling a stranger's booking is refused.

---

## US-14 — Programs: listing and registration

**Description.** Tools to discover and join upcoming programs.

**Depends on.** US-09.

**Requirements.**
- Tool `list_programs({ type?, date_range? })`: returns upcoming programs with type, start/end, pro (if any), capacity, `spots_remaining`, price (if any).
- Tool `register_for_program({ program_id })`: registers the caller if `spots_remaining > 0`; structured errors on full or already-registered.
- The capacity check is transactional (use `SELECT … FOR UPDATE` or rely on the partial unique index + count + insert) so two simultaneous requests for the last spot can't both succeed.

**Acceptance criteria.**
- "Any clinics this weekend?" returns the seeded clinics in the next 7 days with `spots_remaining`.
- Registering for an open-play decrements `spots_remaining` by one.
- Registering for a full program returns a clear tool error surfaced to the user.
- A second register call from the same member is rejected.

---

## US-15 — Lessons: member request and pro accept/decline

**Description.** A member requests a lesson with a specific pro; the pro receives a WhatsApp message and replies in natural language; status updates propagate back to the member.

**Depends on.** US-09, US-12.

**Requirements.**
- Tool `list_pros()`: returns pros (name only in V1 — bios deferred).
- Tool `request_lesson({ pro_phone, start_at, duration_minutes? })`: creates a `lessons` row with `status: 'pending'`, links the requesting member, and triggers an outbound WhatsApp to the pro: "Hi [Pro], [Member] is requesting a lesson on [date/time]. Reply yes or no."
- Notifications to the pro (and back to the member) are business-initiated: if the recipient hasn't messaged within 24h, send via the approved utility template (US-04/US-06) instead of free-form text.
- The pro's conversation context exposes two additional tools (gated to `role: 'pro' | 'both'`): `accept_lesson_request({ lesson_id })` and `decline_lesson_request({ lesson_id })`. The agent figures out which to call from the pro's natural-language reply ("yes please" → accept, "can't, sorry" → decline, ambiguous → ask).
- On accept: status → `confirmed`; outbound message to the member confirming.
- On decline: status → `declined`; outbound message to the member.
- Pending lessons appear in the member's upcoming list with status; the member may cancel a pending lesson (cancels notify the pro too, per US-13).

**Acceptance criteria.**
- Member: "lesson with [pro] Tuesday at 7" → member sees "request sent"; pro receives a WhatsApp message naming the member and slot.
- Pro: "yes" → lesson is `confirmed`; member receives a confirmation.
- Pro: "no" → lesson is `declined`; member receives a polite decline.
- Member cancels a pending lesson → pro receives the cancellation notice.

---

## US-16 — Pro tools: schedule and create lesson

**Description.** Affordances for pros to see their schedule and to create lessons directly for named members.

**Depends on.** US-15.

**Requirements.**
- Tool `pro_schedule({ date_range? })` (pro/both only): returns the pro's confirmed lessons in the range with member names; default range = next 7 days.
- Tool `create_lesson({ member_phones[], start_at, duration_minutes? })` (pro/both only): creates a `confirmed` lesson with the requesting pro and the listed members; sends each member an outbound WhatsApp: "Your pro [Name] booked you for a lesson on [date/time]."
- All listed `member_phones` must resolve to known members; otherwise the tool fails with a clear error.
- Tool authorization enforced in the tool dispatcher (a member calling these is refused at the registry level).

**Acceptance criteria.**
- Pro: "what's my schedule this week?" → returns confirmed lessons with member names.
- Pro: "book a lesson with Alex and Sam Wednesday 6pm" → both members get a WhatsApp message; lesson exists with both linked; both members see it in their own `list_my_upcoming_reservations`.
- A member attempting to call `create_lesson` via prompt injection sees a refusal — the tool is not exposed in the member's context and the dispatcher double-checks the role.

---

## US-17 — Group chat: participant resolution and group court booking

**Description.** The V1 differentiator. The club creates a WhatsApp group via the Groups API and invites the testers; inside it, the agent resolves each participant against the member DB and supports "book for all of us" requests.

**Platform reality (see technical-requirements.md):** the Cloud API cannot be added to member-created groups — the business must create the group (invite via link, max 8 participants, one business number per group). Whether the dev test number supports the Groups API is validated by the US-04 spike; if it doesn't, this story needs a verified business number or slips to V1.next.

**Depends on.** US-08, US-11, US-13, and the US-04 Groups API spike.

**Requirements.**
- Create the dogfood group programmatically via the Groups API and send testers the invite link (an admin-only `POST /admin/groups` route is fine).
- Detect that an inbound message came from a group via the Meta payload (confirm exact field shape during implementation; expose it on `IncomingMessage.channel === 'group'` and `group_id`).
- On each group invocation, resolve the participants Meta surfaces against `members`; build a per-group `GroupContext` with `known_members[]` and `unknown_phones[]`.
- The system prompt for a group conversation includes the known participants by name and the unresolved phones.
- `create_court_booking` accepts `member_phones[]` (up to 4); all listed must be known members; the booking is linked to each member.
- Replies in groups name the included members ("Booked Tuesday 7pm for Alex, Sam, Jess, and Mia").
- If unknown phones are present in the group and the requester says "us four", the agent books for the known members and flags the unknown ones in the reply: "Couldn't include +1-555… — invite-only. Ask the club to add them."

**Acceptance criteria.**
- In a business-created group with 4 known testers, asking "court Tuesday 7pm for us four" creates one booking linked to all four; the reply confirms by name.
- In a group with one unknown number, the booking still completes for the 3 known members and the reply names the unknown number and instructs the requester.
- The same booking appears in every linked member's `list_my_upcoming_reservations` when they ask in a 1:1 chat.
- Group conversation history is stored under the group's id and does not appear in any member's DM history.

---

## US-18 — Open-ended Q&A polish and minimal eval

**Description.** Tighten agent behavior on broad questions so it reliably uses the right tools instead of hallucinating.

**Depends on.** US-11, US-14, US-15.

**Requirements.**
- System prompt explicitly enumerates the tool catalog and when to use which.
- Few-shot examples in the system prompt for 3+ broad patterns: availability sweep, "any [type] this weekend?", "who are the pros?".
- When the agent lists options to the user, it ends with a soft follow-up ("Want me to book one?").
- Minimal eval harness: 10–15 hand-picked prompts in `evals/prompts.json` with the expected first tool call. `pnpm eval` runs each against the live agent loop in a sandbox conversation and reports pass/fail.

**Acceptance criteria.**
- ≥ 80% of eval prompts produce the expected first tool call.
- "Who are the pros?" returns the seeded pros and does not invent names.
- "What's available Tuesday evening?" returns slots anchored to the club's timezone.

---

## US-19 — Dogfood acceptance run

**Description.** Validate V1 end-to-end with the founder + ≥ 3 friends over a one-week window. This is the V1 success gate.

**Depends on.** All prior stories.

**Requirements.**
- Pre-flight checklist: members and pros seeded; Meta dev test number live with 5 testers added; logs streaming; `/admin/turns` reachable; rollback documented.
- Scripted scenario covering every PRD flow: book a court (1:1), book a lesson (request + pro accept), register for each program type, list reservations, cancel each type, group booking for 4.
- `Docs/product/dogfood-notes.md` started — tracking bugs, surprises, qualitative impressions.

**Acceptance criteria.**
- Founder + ≥ 3 friends each complete all five PRD member flows over WhatsApp.
- One group-chat booking completed in a live WhatsApp group of 3–4 friends.
- Cancellations correctly notify pros and free program capacity.
- A short written summary lands in `dogfood-notes.md` with a yes/no recommendation on approaching a real pilot club — i.e., the PRD's success criterion.

---

## What's explicitly NOT in this plan

These are deferred to V1.next or later (matching PRD's Non-Goals):

- Admin web UI (V1.next — the trigger for approaching a real pilot club).
- Pro and member web UIs, mobile apps.
- Payments / monetization.
- Proactive AI ops (retention nudges, smart scheduling, auto pro assignment, utilization insight).
- Multi-club / multi-tenant.
- Multi-language.
- Tournaments / leagues / ladders.
- Public marketing or booking website.
- Conversation history summarization beyond a 20-turn rolling window (revisit when context cost matters).
- Per-participant cancellation of group bookings (V1 cancels the whole booking).
- Business verification of the WhatsApp number (required before a real pilot, not for the 5-tester dogfood).
