# openclub — Product Requirements (V1)

## Context

openclub is an AI-native club management product for racket sports, starting with Padel. The premise is that the operational surface of a club — bookings, lessons, programs, member communication — has long been handled with clunky web UIs and call/text-the-front-desk workarounds. A conversational agent reachable on WhatsApp can collapse most of that into "just text the club."

V1 is a **dogfood prototype**, not a live launch. The founder and friends will play the role of members and pros at a mock Padel club, using WhatsApp end-to-end. The goal is to validate the conversational experience, the underlying data model, and the AI tool-use architecture before approaching a real pilot club.

## Vision

- **AI-native, not AI-bolted-on.** Phase 1: members and pros interact with the club via a Claude-class conversational agent over WhatsApp. Phase 2: the same agent drives ops — smart scheduling, retention messaging, pro assignment, utilization insight.
- **WhatsApp-first.** No mobile app. No member web UI. Members text the club like a human.
- **Group-aware.** Padel is a 4-player sport. The agent works inside group chats: it identifies registered members in a group and books for the whole group from a single request.

## V1 Goals

1. A working WhatsApp agent that the founder and friends can use, end-to-end, to:
   - Book a court at a mock Padel club
   - Book a 1:1 lesson with a pro
   - Register for a program (open play, clinic, event)
   - Cancel any of the above
   - Do all of the above from inside a WhatsApp group (group-booking flow)
2. A backend data model that cleanly supports those flows and is extensible to V1.next (admin UI) without rework.
3. An agent architecture that uses Claude tool-use against backend tools, persists conversation state, and is observable enough to debug failed turns.

## Success Criteria (V1)

- Founder + invited friends can complete each flow above, reliably, over WhatsApp.
- Group booking works for 3–4 friends in a real WhatsApp group.
- Qualitative dogfood feedback is positive enough to justify approaching a real pilot club.
- No quantitative KPI in V1.

## User Roles

- **Member** — phone-identified person allowed to book. Interacts only via WhatsApp.
- **Pro** — phone-identified coach. Interacts only via WhatsApp. Receives lesson requests; accepts/declines; can create lessons with specific members.
- **Admin** — not a user in V1. The founder configures the mock club directly via DB seed / code. Becomes a real role in V1.next (admin web UI).

A single phone number may belong to both a member and a pro.

## Core Concepts

- **Club** — single venue. One in V1 (the mock club).
- **Court** — bookable physical resource with operating hours.
- **Court Booking** — reservation of one court for a time window. No pro, no program. The default Padel booking.
- **Lesson** — coaching session with a pro and one or more members. Pro-driven.
- **Program** — scheduled, capacity-bound group offering. Three flavors:
  - **Open Play** — admin-created drop-in slot on one court, fixed capacity (e.g., 4 spots), pro hosting but not coaching. Members reserve individual spots.
  - **Clinic** — group lesson with a pro. Capacity-bound.
  - **Event** — special programming (mixers, tournaments-light, etc.). Capacity-bound.

## V1 Functional Requirements

### Member — WhatsApp flows
- Book a court: pick day, time, duration; agent confirms availability and creates the booking.
- Book a lesson: pick a pro, day, time; agent sends a request to the pro; member is notified when the pro accepts or declines.
- Register for a program: agent lists upcoming programs; member picks; capacity is checked and decremented.
- List my upcoming reservations.
- Cancel a reservation (court / lesson / program registration). Free, any time before start.
- Ask open-ended questions: "what's available Tuesday evening," "any clinics this weekend," "who are the pros."

### Group chat flow (in a WhatsApp group)
- The club (business number) creates the group and invites members via link — the
  WhatsApp Cloud API cannot join member-created groups, and groups cap at 8
  participants (see `Docs/technical/technical-requirements.md`, platform constraints).
- Agent resolves each participant's phone number against the member database.
- A member in the group can request a booking that covers multiple participants ("us four, court Tuesday 7pm").
- Agent creates the court booking and links each registered participant to it.
- For participants in the group who are not registered members, the agent flags them in the reply and asks the requester to handle out-of-band. (No inline onboarding in V1; invite-only.)

### Pro — WhatsApp flows
- Receive an incoming lesson request from the agent; reply yes/no in chat.
- Ask the agent "what's my schedule today / this week."
- Create a lesson with specific named members at a specific time.
- Get notified when a member cancels a lesson with them.

### Admin (V1: founder, via DB seed / code)
- Define the club, its courts, and operating hours.
- Pre-load members (name + WhatsApp phone number). Invite-only access enforced by this list.
- Pre-load pros (name + WhatsApp phone number).
- Create programs (open play / clinic / event) with date, time, capacity, optional pro, optional price.

### Onboarding
- Invite-only. Unknown phone → "Hi, you don't have access yet. Contact the club to be added."
- Once admin adds a phone, that person can message immediately and be recognized.

### Cancellation
- Free cancellation any time before slot start, via the agent.
- Cancelling a lesson notifies the pro automatically.
- Cancelling a program registration frees the spot for someone else.

## Technical Approach

### Architecture

```
WhatsApp user
   ↓
Meta WhatsApp Cloud API (webhook)
   ↓
openclub backend
   ├─ identify sender by phone (member? pro? unknown?)
   ├─ load conversation history
   ├─ Claude agent loop ⇄ backend tools
   │     (search_availability, create_court_booking, list_programs,
   │      register_for_program, request_lesson, list_pros,
   │      list_my_bookings, cancel_booking, …)
   ├─ persist conversation turn
   └─ send reply via WhatsApp Cloud API
```

### WhatsApp
- **Meta WhatsApp Cloud API direct.** Cheaper, more control, official.
- For V1, use Meta's dev test phone number — messaging up to 5 testers without going through Business verification. Perfect for the founder + friends dogfood scope.
- Plan Business verification before any real pilot.
- **Two platform constraints shape the flows** (details in `Docs/technical/technical-requirements.md`): groups must be business-created (agent can't be added to member groups; max 8 participants; Groups API support on the dev test number is unverified — spike early), and business-initiated notifications (lesson requests to pros, status/cancellation notices) outside the 24h service window require pre-approved utility templates.

### Agent
- **Claude API + native tool use** as the working assumption. Final selection (model tier, router pattern, framework or none) is decided in the separate cost-driven document `Docs/technical/agent-stack.md`.
- Stateless tool-calling loop. Conversation history stored in Postgres, replayed each turn.
- System prompt holds the static club context (courts, hours, current programs, pro roster, policies); prompt caching enabled.

### Identity & Auth
- Phone number is the identity. WhatsApp sender phone → DB lookup → member and/or pro record.
- Invite-only access enforced at webhook level: unknown phone → templated rejection, no LLM call.
- Group chat: each sender resolved independently via their own phone.

### Data Model (sketch)
- `Club` (one row in V1)
- `Court` (belongs to club; has operating hours)
- `Member` (phone PK, name, club_id)
- `Pro` (phone PK, name, club_id)
- `CourtBooking` (court, start, end, member(s), status)
- `Lesson` (pro, member(s), start, end, status)
- `Program` (club, type ∈ {open_play, clinic, event}, court_id?, pro_id?, start, end, capacity, price?)
- `ProgramRegistration` (program, member, status)
- `ConversationTurn` (phone, role ∈ {user, assistant, tool}, content, created_at)

## Non-Goals (V1)

- No payment processing.
- No admin web UI. No pro web UI. No member web UI. No mobile app.
- No proactive AI ops — no retention nudges, no smart scheduling, no auto pro assignment, no utilization dashboards.
- No multi-tenant / multi-club support.
- No multi-language. English only.
- No tournament / league / ladder features.
- No public marketing or booking website.

## V1.next (immediate next milestone after V1)

**Admin web UI.** Move admin off the DB seed onto a real dashboard for: creating programs, viewing the schedule, managing members and pros, reading booking data. Unlocks approaching a real pilot club.

## Deferred / Open

- Monetization model (decided when a real pilot club is in view).
- Final agent stack selection — see `Docs/technical/agent-stack.md`.
- AI ops scope and rollout (post-V1.next).
- Slot duration conventions — assume 90-minute Padel slots unless contradicted.
- Concurrency / double-booking strategy — assume DB-level uniqueness constraints on `(court, time-range)` for V1; revisit at scale.
