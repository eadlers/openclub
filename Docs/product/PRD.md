# club-manager — Product Requirements Document

*Project codename: **openclub** (repo, package, and internal doc references). "club-manager" is the working product title; final brand TBD.*

**Version:** 2.0
**Status:** Draft for review
**Supersedes:** PRD v1 (dogfood prototype — mock club, founder + friends over the Meta dev test number; English; invite-only; no payments, no multi-tenancy, no web UI)
**Key changes from v1:** Repositioned from a dogfood prototype to a **commercial product for real padel clubs**, launch market set to **Lima, Peru**, language changed from English to **Peruvian Spanish**, payments (anchored to **Yape/Plin**), multi-tenancy, and an owner dashboard promoted from non-goals to **P0**, invite-only access replaced by **first-contact registration**, group-chat booking dropped (replaced by "falta uno" open-match fill at P1), and module priorities re-sequenced around no-show reduction and court occupancy.

---

## 1. Overview & Vision

**One-liner:** The AI receptionist that runs a padel club's WhatsApp — bookings, payments, and full courts, 24/7.

**Problem.** Small and mid-sized padel clubs in Peru run their entire operation through a personal WhatsApp number, Instagram DMs, and a spreadsheet (or a paper notebook). The result is a daily grind of double bookings, unanswered messages at night, unverified "ya te yapeé" payment screenshots, no-shows on prime-time slots, empty courts in valley hours, and zero visibility into occupancy or revenue. Existing software (Playtomic, TPC Matchpoint, Resasports) asks the club to change its members' behavior — download an app, create an account — and in Playtomic's case, hands the member relationship to a marketplace where competing clubs are one tap away.

**Solution.** club-manager keeps the club's existing WhatsApp number as the front door and puts a conversational AI agent behind it, backed by a deterministic booking and payments engine. Members book exactly the way they already do — by texting the club — except the reply arrives in seconds, at any hour, payment is requested and verified automatically, and the schedule can never double-book. The club owner gets an operations system; the members notice nothing except that the club got faster.

**Vision.** Become the operating system for the long tail of racquet clubs in Latin America — starting with padel in Lima — by being the only platform that is (a) conversational-first on the channel LatAm actually uses, (b) club-owned rather than marketplace-owned, and (c) AI-native in operations (filling courts, recovering cancellations, reactivating lapsed players), not just a booking calendar.

**Product principle (non-negotiable):** *The LLM interprets; the engine decides.* The agent never mutates state directly. All bookings, holds, payments, and cancellations execute through typed tools against a deterministic core that enforces invariants (no double-booking, payment state machine, policy rules). Every tool call is logged and reversible by the owner.

---

## 2. Market Context & Timing

*(Snapshot as of mid-2026; refresh quarterly. Sources: Gestión, limapadel.pe, FPP.)*

- Peru has roughly **60–65 padel centers and ~250 courts**, with ~70% concentrated in Lima. Federation-estimated recurrent players spend **~S/1,000/month** on the sport.
- The **Federación Peruana de Pádel (FPP)** became operational in early 2026 and is formalizing the market: club/player affiliation requirements, a national ranking, and a 10-date annual calendar in which **half the tournaments are club-organized** — creating demand for tournament tooling.
- Regional trajectory: **Chile has ~250 centers / ~2,300 courts**; the FPP frames Peru as ~6 years behind and aims to close the gap in 4–5 years. Provincial expansion is underway (Trujillo's first club opened at 100% occupancy and is replicating in Chimbote and Chiclayo; new multi-court builds continue in Lima).
- **Implication:** dozens of new clubs will open in the next 36 months, mostly run by first-time operators with no ops stack. New-build clubs are the highest-conversion segment.

**Competitive landscape**

| Player | Model | Where they win | Where we win |
|---|---|---|---|
| Playtomic | Marketplace + club SaaS | Premium Lima clubs (Mad Padel, etc.); player discovery/community | Club owns the channel & data; no member app; no marketplace conflict; no per-booking commission |
| TPC Matchpoint / Resasports | Legacy club SaaS (Spain) | Feature depth for large clubs | Conversational-first; same-day onboarding; priced for 2–8 court clubs; es-PE + Yape-native |
| ReservaSimple & generic tools | Self-serve booking links (~US$14/mo) | Price anchor | We are staff replacement (AI agent + ops), not a calendar link |
| Status quo | WhatsApp + Instagram + spreadsheet | Zero cost, zero change | We keep the behavior, remove the chaos |

**Positioning statement:** *"Tu mismo WhatsApp, pero atiende solo."* Club-owned infrastructure on the club's own number — not a marketplace, not an app your members must download.

---

## 3. Target Users

**Ideal Customer Profile (buyer):** Independent padel club in Lima, **2–8 courts**, owner-operated, 1–3 staff, currently taking bookings via WhatsApp/Instagram/phone, accepting Yape/Plin/cash. Secondary ICP: new-build clubs pre-opening (Lima and provinces: Trujillo, Chiclayo, Arequipa).

**Personas**

1. **Owner (buyer & weekly user).** Cares about revenue, occupancy, and getting their evenings back. Success = fewer no-shows, fuller valley hours, a weekly summary they trust.
2. **Admin / recepcionista (daily user).** Currently the human router for every message. Success = the agent handles routine volume; they handle exceptions, walk-ins, and the front desk.
3. **Coach (light user).** Needs their class schedule, rosters, and attendance without asking the admin.
4. **Member / regular player (end user).** Books 1–4×/week, often a fixed weekly slot with the same group. Success = book in under 30 seconds without installing anything.
5. **Casual player (end user).** Found the club on Instagram/Google Maps. First-contact registration must be frictionless (name + level, keyed to phone number).

---

## 4. Core User Flows

All member-facing flows occur in WhatsApp, in Peruvian Spanish. Examples are illustrative, not final copy.

### 4.1 Booking (happy path)
> **Member:** "Hola! tienen cancha mañana 7pm?"
> **Agent:** "¡Hola Erik! Mañana jueves a las 7pm está lleno 😕 Tengo 6pm o 8pm en Cancha 2 (S/120, 90 min). ¿Te reservo alguna?"
> **Member:** "8pm"
> **Agent:** "Listo, te la separo por 15 minutos. Paga aquí para confirmar: [link] — o yapea al 9XX XXX XXX y me avisas."
> *(payment confirmed)* "✅ Confirmado: Jue 09/07, 8:00–9:30pm, Cancha 2. Cancelación gratis hasta 12h antes."

Rules: agent proposes at most 2–3 alternatives; a **hold** (default 15 min, configurable) freezes the slot; unpaid holds auto-release and notify the member.

### 4.2 First-time player registration
Unknown number → agent asks name and (optionally) level; creates member profile keyed on phone. No forms, no links, no app.

### 4.3 Payment
Two club-configurable modes, per booking type:
- **Auto-confirm (gateway):** payment link via gateway (Mercado Pago / Culqi / Izipay — pluggable) supporting Yape, Plin, and cards. Webhook confirms → booking confirmed. Fees pass through or absorbed per club setting.
- **Manual yapeo (zero-fee):** agent sends the club's Yape/Plin QR + number; member replies "ya pagué"; **owner/admin gets a one-tap confirm/reject prompt**; hold timer keeps running until confirmed. Screenshots are never trusted as proof.
- Handle Yape's per-operation cap (~S/500): split-payment instructions or gateway fallback for higher amounts.
- Cash-on-arrival allowed per club policy (booking marked "unpaid — at risk"; counts toward no-show stats).

### 4.4 Cancellation → waitlist resale
Member cancels → policy engine applies (e.g., >12h: full credit to wallet; <12h: per club policy) → slot released → **waitlist auto-offer**: agent messages the queue in order (approved utility template), first confirmed payment wins. Owner sees "recovered booking" in the digest.

### 4.5 "Falta uno" (open-match fill) — P1
> **Organizer:** "somos 3 para hoy 7pm, falta 1 intermedio"
> Agent posts the opening to opted-in players matching level + availability; first to confirm (and pay their share, if split pay is on) joins. Organizer notified.

### 4.6 Turno fijo (recurring booking)
Weekly fixed slot for a group; auto-charge or weekly confirm ("¿Confirmas tu cancha de los martes 8pm? Sí/No"); two consecutive no-confirms release the slot to waitlist.

### 4.7 Reminders & no-shows
Utility-template reminders at 24h and 2h with Confirm / Cancel buttons. No-show → recorded on profile; configurable sanctions (fee from wallet, prepay-only requirement, temporary block after N strikes).

### 4.8 Reactivation & valley promos — P1
"Hace 30 días que no juegas 🎾 — este jueves 3–5pm está a S/80" sent to inactive or valley-hour-affine segments. Strictly opt-in, frequency-capped.

### 4.9 Owner/admin flows
- **Natural-language ops on WhatsApp:** "¿cómo va hoy?" → today's grid + revenue; "bloquea cancha 1 mañana 9–11 por mantenimiento"; "resérvale a Marco jueves 6pm, paga en cancha."
- **Human takeover:** if staff replies inside a member conversation, the agent pauses on that thread until staff hands back ("/agente on") or 60 minutes of inactivity.
- **Daily cierre de caja:** end-of-day summary reconciling every booking to a payment method (gateway / yapeo confirmed / cash / unpaid), with discrepancies flagged.
- **Weekly digest (WhatsApp):** occupancy %, revenue, no-shows charged, recovered cancellations, reactivated members, valley-hour trend.

### 4.10 Academy — P1/P2
Class groups by level/day; enrollment and monthly billing via agent (with dunning: "tu mensualidad de la academia vence el 05/08 — paga aquí"); attendance tracked; classes consume court inventory like any booking.

### 4.11 Tournaments & leagues — P2
Americano/bracket formats; registration + payment via agent; automatic court blocking; results entry; FPP-affiliation-friendly exports. Rides the federation's club-organized tournament calendar.

---

## 5. Agent Behavior & Personality

- **Language:** Peruvian Spanish by default (voseo off, "tú"); mirrors the member if they write in English. Warm, brief, lightly emoji'd — like the club's best employee, not a bank bot.
- **Grounding:** the agent may only state availability, prices, and policies returned by tools. It never guesses. If a tool fails, it says so and offers to have a human follow up.
- **Confirmation before commitment:** any action that charges money or books/cancels a slot is echoed back for explicit confirmation.
- **Escalation to human (automatic):** complaints, refund disputes, payment discrepancies, injuries/incidents, aggressive tone, or two consecutive failed interpretations. Escalations ping staff with full context.
- **Session mechanics:** free-form replies within WhatsApp's 24-hour service window; all business-initiated messages (reminders, waitlist offers, promos, digests) use pre-approved templates with opt-in and opt-out honored instantly.
- **Auditability:** every tool call (who, what, when, conversation excerpt) is logged and visible to the owner; every booking action is owner-reversible.

---

## 6. Functional Requirements

Priorities: **P0 = MVP**, **P1 = fast follow (0–6 months post-launch)**, **P2 = later**.

### FR-1 Booking Core (deterministic engine) — P0
- Courts, operating hours, slot durations (60/90/120), maintenance blocks.
- Pricing rules: peak/valley by day+hour, member vs non-member, promo overrides.
- Slot **holds** with TTL; serializable writes; **zero double-booking invariant** enforced at the engine level (never by the LLM).
- Wallet/credit ledger per member (refunds-as-credit, no-show fees).
- Manual bookings and overrides by staff with full parity.

### FR-2 Conversational Agent — P0
- Intents (MVP): book, cancel, reschedule, check availability, check my bookings, prices/hours/location, register, pay, talk-to-human. (P1 adds: join waitlist, falta-uno, turno fijo management, academy billing.)
- Tool-call architecture against FR-1/FR-4 APIs; conversation context persistence; per-tenant config (tone, policies, prices).
- Human takeover/pause semantics (4.9); escalation rules (§5); full conversation + tool audit log.
- Degraded mode: if LLM is unavailable, fall back to structured interactive lists/buttons for core booking.

### FR-3 WhatsApp Channel — P0
- WhatsApp Business Cloud API integration; template lifecycle management (create, submit, track approval status per tenant).
- Interactive messages (buttons, lists), media (QR images, location pins).
- Number onboarding for both paths: **new dedicated number** or **migration of the club's existing number** (note: a number on the API can no longer be used in the consumer WhatsApp app — onboarding wizard must make this explicit and support either choice).
- Instagram DM channel — P2 (same agent, second front door).
- SMS — explicitly **not supported** (removed from v1 scope).

### FR-4 Payments & Reconciliation — P0
- Pluggable gateway adapter (Mercado Pago first; Culqi/Izipay behind the same interface) with Yape/Plin + cards; idempotent webhooks.
- Manual-yapeo flow with one-tap staff confirmation and hold-timer integration (4.3).
- Refund-to-wallet; no-show fee capture; split-payment support for falta-uno (P1).
- Daily cierre de caja report; per-booking payment-state machine (unpaid → held → paid/failed/expired/refunded).
- Yape per-operation cap handling; SUNAT-friendly export of payment records (CSV) — the club's accountant will ask.

### FR-5 Waitlist & Open Matches — P1
- Ordered waitlist per slot with auto-offer cascade on release.
- Falta-uno matching on level + opt-in + historical time affinity; frequency caps to avoid spam.
- (Deliberate constraint: matching stays **within a single club** — cross-club matching recreates the marketplace conflict we position against. Revisit only with explicit multi-club owner consent.)

### FR-6 Members & CRM — P0 (basic) / P1 (segments)
- Profile keyed on phone: name, level (self-declared → refined from match history), booking history, wallet, no-show record, tags, opt-ins.
- Segments for messaging (valley players, inactive 30d, academy students).
- Data export (CSV) — **the club owns its data**; make it contractual and technical.

### FR-7 Lifecycle Messaging — P0 (reminders) / P1 (reactivation, promos)
- 24h + 2h reminders with confirm/cancel; post-match review nudge; 30-day reactivation; valley-hour promos to segments. All template-based, opt-in, frequency-capped, with per-message cost tracking.

### FR-8 Owner Dashboard & Digest — P0 (digest + basic web) / P1 (full analytics)
- Web dashboard (mobile-first): today grid, occupancy by hour/court, revenue by period, no-show rate, cancellation recovery rate, member activity.
- Weekly WhatsApp digest (4.9) — this is the retention surface; ship it in MVP even if the web dashboard is minimal.

### FR-9 Academy — P1
- Groups, schedules consuming court inventory, rosters, attendance, coach assignment, monthly billing with automated dunning via the agent.

### FR-10 Tournaments & Leagues — P2
- Americano + bracket formats, registration/payment via agent, court blocking, standings, FPP-friendly exports.

### FR-11 Onboarding & Admin Panel — P0
- **Same-day setup is a product requirement, not a services promise:** wizard covering courts, hours, prices, policies, payment mode, WhatsApp number path; schedule import from spreadsheet/CSV (P1: photo-of-notebook import via vision).
- Roles: owner, admin, coach (scoped permissions).

### FR-12 Multi-tenancy — P0
- Full tenant isolation from day one (data, templates, agent config, payment credentials). No single-tenant shortcuts.

---

## 7. Non-Functional Requirements

- **Agent latency:** first substantive reply < 5s p50 / < 10s p95 (this is the demo; it must feel instant next to a human admin).
- **Booking integrity:** zero double-bookings (engine-enforced, tested with concurrent-hold simulations); idempotent payment webhooks; at-least-once message delivery with dedupe.
- **Availability:** 99.5% for booking core; degraded button-menu mode if LLM provider is down.
- **Locale:** timezone America/Lima; currency PEN (S/); language es-PE; date/number formatting localized.
- **Compliance:** Peru personal-data law (Ley N° 29733) — consent records, data minimization, deletion on request; WhatsApp Business/commerce policy compliance (opt-in for proactive messages, honored opt-outs); payment credentials never stored outside the gateway.
- **Unit economics guardrail:** track LLM + WhatsApp template cost per completed booking; alert if > S/0.50/booking (target; validate in pilot).
- **Observability:** full conversation traces with tool-call spans; per-tenant error dashboards; booking-funnel analytics (inquiry → hold → paid).
- **Security:** tenant isolation tests in CI; webhook signature verification; PII redaction in logs; least-privilege staff roles.

---

## 8. Business Model (context for product decisions)

- **Flat monthly subscription per club, tiered by court count. No per-booking commission** — this is a positioning pillar; the product must never require transaction fees to function (gateway fees are pass-through and optional via the manual-yapeo mode).
- Setup included (same-day, in person during founder-led phase).
- Price anchored against value, not tools: one shift of a receptionist per month / 3–4 recovered no-shows per month. Entry tier must clear the "one recovered prime-time booking pays for it" bar.
- Pilot motion: 90-day free design-partner deal for 1–2 Lima clubs in exchange for a public case study with before/after numbers (no-show rate, valley occupancy, response time).

---

## 9. Success Metrics

**Activation:** first agent-completed, paid booking within 24h of a club's setup.
**Automation rate:** ≥ 70% of bookings completed end-to-end with zero human involvement by day 60 per club.
**No-show rate:** ≥ 50% reduction vs. club's measured baseline (measure baseline during onboarding week).
**Occupancy:** +10 percentage points in valley hours within 90 days (waitlist + promos + falta-uno attach).
**Speed:** median inquiry→confirmed-booking time < 3 minutes (vs. hours today).
**Retention:** logo churn < 2%/month; weekly digest read/interaction as leading indicator.
**Pilot gate to scale:** 3 paying clubs post-pilot referencing the case study unprompted.

---

## 10. Rollout Phases

- **Phase 0 — Design partner (now):** 1–2 Lima clubs (start where the founder plays). P0 scope only. Manual concierge allowed behind the scenes; instrument everything.
- **Phase 1 — Lima long tail:** the ~40 non-Playtomic Lima clubs; founder-led, in-person sales; FR-5 + FR-9 land here.
- **Phase 2 — Provinces & new builds:** Trujillo/Chiclayo/Arequipa expansion wave; pre-opening packages for new clubs; FR-10 tournaments + FPP relationship.
- **Phase 3 — Regional:** Chile/Colombia/Ecuador evaluation (channel and wallet mix differ; re-validate payments layer per country).

---

## 11. Out of Scope (MVP)

- Native member-facing mobile app (WhatsApp *is* the app).
- Cross-club marketplace, discovery, or player network.
- SMS channel (removed); English-language club UI; countries beyond Peru.
- Hardware integrations (door access, court lights) — future partner integration.
- Sports beyond padel (schema stays sport-agnostic: `facility.type` remains generic so tennis/pickleball can be enabled later without migration).
- Retail POS / kiosk / bar inventory.
- Dynamic AI pricing (rules-based pricing only in MVP; learned pricing is P2+).

---

## 12. Open Questions

1. **Gateway choice & Yape auto-confirm depth:** Mercado Pago vs Culqi vs Izipay — compare Yape/Plin UX, fees, payout timing, API quality; is any deeper Yape Business integration (QR-level confirmation) feasible without a gateway?
2. **Number strategy default:** recommend clubs migrate their existing WhatsApp number (continuity, but leaves the consumer app) or start a dedicated bookings number (cleaner, but requires member education)? Pilot both.
3. **Sanctions defaults:** what no-show policy do Lima clubs actually enforce today? Set defaults from pilot interviews, not assumptions.
4. **Identity & level:** self-declared level vs. lightweight derivation from match outcomes — how much does falta-uno matching quality depend on it?
5. **FPP relationship:** affiliation-data integration, tournament-calendar partnership, or nothing — what does the federation actually want from software?
6. **LLM provider & agent runtime:** current direction is decided in [`Docs/technical/technical-requirements.md`](../technical/technical-requirements.md) (Express on Node, Anthropic direct with prompt caching, no provider abstraction) and costed in [`Docs/technical/agent-stack.md`](../technical/agent-stack.md); model id stays env-configurable. Remaining open sub-question: when pilot telemetry justifies the Haiku router.
7. **Concierge boundary:** during Phase 0, which failures get silently human-handled vs. surfaced, and how do we prevent concierge work from masking product gaps?

---

## 13. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Agent misbooks / hallucinates availability | Deterministic engine owns all state; agent restricted to tool outputs; confirmation step before commit; owner-visible audit + one-tap undo |
| WhatsApp API pricing/policy changes | Template cost tracking per tenant; degraded button-mode; Instagram DM as second channel (P2); avoid marketing-template dependence in core flows |
| Clubs won't pay (free-tool anchor) | Sell recovered revenue with pilot-measured numbers; flat pricing under the "one recovered booking" bar; no-commission positioning |
| Playtomic moves downmarket in Peru | Speed + channel ownership + es-PE/Yape depth; win the long tail and new builds before they look down |
| Manual-yapeo fraud (fake screenshots) | Never trust screenshots; staff one-tap confirm against their own bank app; gateway mode as the recommended default for prepaid slots |
| Single-founder bandwidth | P0 scope discipline (this document); concierge-with-instrumentation over feature breadth in Phase 0 |
| Seasonality / demand dips | Valley-hour promos, academies, and tournaments are counter-cyclical occupancy tools — prioritize FR-7/FR-9 accordingly |

---

## 14. Related Documents

*(This repo's doc layout; when docs disagree on stack choices, `technical-requirements.md` wins.)*

- [`Docs/technical/technical-requirements.md`](../technical/technical-requirements.md) — stack direction (authoritative), architecture, WhatsApp platform constraints, NFRs, env vars.
- [`Docs/technical/agent-stack.md`](../technical/agent-stack.md) — LLM provider decision + per-booking cost model against the S/0.50 guardrail.
- [`Docs/product/implementation-plan.md`](./implementation-plan.md) — build order (US-01 → US-22) with acceptance criteria; P0 scope of this PRD.
- [`Docs/technical/pre-development-review.md`](../technical/pre-development-review.md) — historical (PRD v1 era); surviving items folded into the plan.
- Glossary terms to keep consistent across docs and agent copy: *hold, turno fijo, falta uno, hora valle, cierre de caja, yapeo, template message, service window, tenant*.