# Pre-Development Review — 7 Things to Get Right (2026-07-02)

> **Status (2026-07-08):** written against **PRD v1** (dogfood prototype), which PRD v2
> (Lima padel pivot) has since replaced. Kept as historical record. What survives into
> the v2 plan: **§2** (chat simulator), **§3** (unified occupancy table with the GIST
> constraint — now also covering holds and maintenance blocks), **§4** (webhook
> idempotency), **§5** (confirm-before-write time resolution), **§6** (CI, already
> done). **§1** (group chat) is moot — v2 dropped group flows entirely. **§7** is
> superseded by PRD v2 §9's quantitative success metrics.

An advisory review of the V1 scope taken after US-01 (scaffold) and before US-02 (data
model). Ordered by how much each item hurts if ignored. Each has a concrete landing spot
in the [implementation plan](../product/implementation-plan.md).

## 1. The group-chat premise has a product crack, not just a technical one

The Cloud API forbids exactly the organic behavior the PRD imagined: a bot joining a
group that friends *already have*. Business-created groups (the only kind the API
allows) may feel sterile — real foursomes won't move their banter into one.

**Actions:**
- Treat **multi-member booking by name in a 1:1 chat** ("book for me, Alex, and Sam
  Tuesday 7pm") as the core differentiator. It delivers ~80% of the group value with
  zero Groups API risk — `create_court_booking` already accepts `member_phones[]`, so
  it's nearly free. The group chat becomes the experiment, not the load-bearing feature.
- The US-04 spike must verify not just "can we create a group" but **whether group
  webhooks expose participant phone numbers** — participant resolution dies without that.
- Make "does a club-created group feel natural or dead?" an explicit US-19 dogfood
  question with its own written answer.

**Lands in:** US-04 (spike scope), US-11 (multi-member DM booking promoted), US-17
(demoted to experiment), US-19 (dogfood question).

## 2. Build a chat simulator before building the agent

Almost every acceptance criterion from US-09 onward is "send a WhatsApp message and
check." That loop is brutal: webhook → public URL → deploy/tunnel → thumb-typing on a
phone → read logs.

**Action:** put a transport interface between the message pipeline and Meta, and add an
admin endpoint or CLI that injects fake inbound messages through the *identical* code
path. Agent iteration gets ~10x faster, the US-18 eval harness gets its substrate for
free, and demos need no phone.

This is the single biggest velocity decision in the project.

**Lands in:** US-05/US-06 (transport interface), new story or US-08 requirement
(simulator endpoint).

## 3. Programs must participate in the no-double-booking constraint

US-02 as written puts the GIST exclusion constraint on `court_bookings` only. An open
play *program* occupies a court too — nothing at the DB level would stop a member
booking over it. Only the availability tool's goodwill would, and LLM-driven writes
deserve DB-level backstops.

**Action:** design the schema so **everything that occupies a court lives in one
occupancy table** carrying the exclusion constraint (programs create an occupancy row
just like bookings do). One design decision now; a painful migration later.

**Lands in:** US-02.

## 4. Webhook idempotency is missing from the plan

Meta redelivers webhooks on timeout/retry. Without deduplication, a redelivered "book
it" message books the court twice.

**Action:** unique index on `wa_message_id`; the handler skips already-seen messages
before any processing.

**Lands in:** US-02 (index), US-05 (guard).

## 5. The agent confirms resolved times before any write

"Tuesday 7pm" is where booking agents actually fail — wrong week, wrong AM/PM, DST
edges.

**Action:** system-prompt policy: before calling any tool that writes, the agent echoes
the absolute resolved datetime ("That's Tuesday **July 8, 7:00pm**, Court 2 —
confirm?") and waits for a yes. The #1 error trap, and better UX. Cheap now, hard to
bolt onto a hardened prompt later.

**Lands in:** US-09 (prompt policy), US-11 (booking flow), US-18 (eval cases for time
resolution).

## 6. Add CI now

A solo dev with an AI writing most of the code has no reviewer. A ~20-line GitHub
Actions workflow running `pnpm test && pnpm typecheck && pnpm lint` on push is the
safety net, and everything it needs already exists.

**Lands in:** immediately (no story needed).

## 7. Define dogfood success before the dogfood

The V1 success criterion is "qualitative feedback positive enough to justify a pilot."
Friends are nice — they'll say it's cool. Without pre-written falsifiable signals,
US-19 will confirm whatever was hoped.

**Action:** before the dogfood starts, write kill/go signals into `dogfood-notes.md`,
e.g.:
- Testers initiate bookings unprompted after week 1.
- Zero wrong-time bookings across the run.
- The group flow (or DM multi-member booking) is used more than once without prompting.

**Lands in:** US-19 (pre-flight requirement).

---

**Meta-advice:** items 1 and 2 change what gets built next — resolve them before US-02.
Items 3–5 are edits to story requirements. Items 6–7 are cheap insurance.
