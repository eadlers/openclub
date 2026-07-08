# Agent Stack Recommendation (cost-driven)

> **Status note (2026-07-08, updated for PRD v2):** the recommendation below — **Anthropic
> direct, no framework/gateway, Sonnet default with prompt caching** — was made for the
> PRD-v1 dogfood and survives the pivot to real Lima clubs. What changed: the cost target
> is now the PRD's **unit-economics guardrail (< S/0.50 LLM + template cost per completed
> booking)**, volumes are real-club volumes from day one, the agent speaks es-PE, and the
> Haiku router moves from "someday" to "relevant at pilot scale". Model prices verified
> 2026-07-08. See [technical-requirements.md](./technical-requirements.md) for the current
> stack direction.

## Goal

Pick the LLM provider and agent-loop strategy for the WhatsApp agent. The primary driver
is **cost per completed booking**, weighed against reasoning quality on the hardest things
the agent has to do:

1. **Multi-constraint booking dialogue in Peruvian Spanish** — resolving relative dates,
   peak/valley pricing, hold-and-pay flows, and policy questions in natural es-PE chat.
2. **Tool orchestration** — chaining engine calls correctly in one turn (availability →
   price → hold → payment link → confirmation), while never inventing availability or
   prices (grounding requirement, PRD §5).

## Architecture invariants (same for every option)

These don't change based on which LLM you pick — and PRD v2 adds a structural one: **the
LLM interprets; the engine decides.** The model never computes availability or prices; it
calls typed tools against the deterministic booking engine.

```
WhatsApp user
   ↓ inbound webhook
Meta WhatsApp Cloud API
   ↓
backend
   ├─ tenant + sender resolution (Postgres) — free, ~ms
   ├─ load last N conversation turns
   ├─ LLM agent loop ⇄ deterministic engine tools   ← the variable cost
   ├─ persist turn + cost telemetry (per-booking attribution)
   └─ outbound WhatsApp send (free-form or template)  ← the other variable cost
```

WhatsApp template cost and LLM cost are the two per-booking variables; both count toward
the S/0.50 guardrail. DB and hosting are fixed.

### Meta WhatsApp cost (orthogonal to LLM; verify current rate card at build)

- **Service messages** (replies within the 24h window after a user's message) are free —
  the whole conversational booking flow costs nothing on the Meta side.
- **Business-initiated template messages** are billed per message, per country and
  category. For Peru, utility templates (reminders, waitlist offers, payment nudges) are
  on the order of **a few US cents each**; marketing templates (promos, reactivation)
  cost more. Exact rates change — pull Meta's current Peru rate card before modeling
  pilot economics, and track actual per-message cost in telemetry (NFR §7).
- Typical booking touches ~2 utility templates (24h + 2h reminders): roughly
  **US$0.02–0.06 ≈ S/0.10–0.20** per booking. This is why template cost is tracked per
  booking, not hand-waved: it's the same order of magnitude as the LLM.

## Options

| | **Claude direct** | **OpenAI direct** | **Framework (LangChain / Mastra / Vercel AI SDK)** |
|---|---|---|---|
| Multi-turn tool use | Strongest in class | Strong | Same as underlying model |
| Spanish conversational quality | Excellent | Excellent | Same as model |
| Prompt caching for static per-tenant prompt | First-class, ~90% off cached reads | Available, different mechanics | Depends on framework |
| Debuggability | High — you own the loop | High | Lower — extra layers |
| Velocity for *one* focused agent | High (~200 LOC loop) | High | Lower (framework setup) |
| Vendor portability | Low | Low | High |

## Cost model

### Per-turn token budget (working estimate)

A "turn" is one LLM call inside the agent loop. A booking conversation typically takes
2–4 LLM calls. es-PE output runs slightly heavier than English per sentence; the budget
below absorbs that.

| Component | Tokens | Notes |
|---|---:|---|
| System prompt (club context, policies, persona, es-PE style) | ~2,500 | **Cacheable** — static per tenant |
| Tool definitions (10–12 tools) | ~1,500 | **Cacheable** |
| Conversation history (last ~5 turns) | ~1,000 | Not cacheable |
| Current user message | ~50 | Not cacheable |
| **Input total** | **~5,050** | ~4,000 cacheable, ~1,050 fresh |
| Output (reply + tool calls) | ~450 | |

Note the per-tenant wrinkle: caching is keyed on the exact prompt prefix, so **each
tenant's system prompt is its own cache entry**. Within one busy club the 5-minute TTL
hits constantly; across clubs there's no sharing. Sonnet 4.6's minimum cacheable prefix
is 2,048 tokens — the ~4K static block clears it.

### Anthropic pricing (per MTok, verified 2026-07-08)

| Model | Input | Output | Cache write (5m, 1.25×) | Cache read (0.1×) |
|---|---:|---:|---:|---:|
| **Sonnet 4.6** (`claude-sonnet-4-6`) | $3.00 | $15.00 | $3.75 | $0.30 |
| **Haiku 4.5** (`claude-haiku-4-5`) | $1.00 | $5.00 | $1.25 | $0.10 |

Sonnet 5 (`claude-sonnet-5`) launched at the same $3/$15 sticker with intro pricing
($2/$10) through 2026-08-31; it uses a new tokenizer (~30% more tokens for the same
text). Worth evaluating before the pilot, but the model id stays env-configurable either
way. Opus-tier is out of scope — overkill for booking turns. The Message Batches API
(50% off) applies to offline jobs (digest generation, segment scoring), not chat.

### Cost per booking conversation (Sonnet 4.6, cached)

~3 turns: cache writes amortized ~$0.005, cache reads 12K × $0.30/M ≈ $0.004, fresh input
3K × $3/M ≈ $0.009, output 1.35K × $15/M ≈ $0.020 → **≈ $0.038 ≈ S/0.14** (at ≈ S/3.7
per US$; refresh the FX rate when modeling).

**Against the guardrail:** S/0.14 (LLM) + S/0.10–0.20 (templates) ≈ **S/0.25–0.35 per
completed booking** — inside the < S/0.50 target with headroom, but not by an order of
magnitude. Failed/abandoned conversations, escalations, and long back-and-forths eat the
margin, which is why per-booking cost attribution is instrumented from the first agent
story and alerts when the guardrail is exceeded (PRD §7).

**Haiku 4.5, cached:** ≈ $0.011 ≈ S/0.04 per booking — the router lever.

### Volume scenarios (real clubs from day one)

Working assumption: a 4-court Lima club ≈ 600 completed bookings/month, with total agent
conversations ≈ 2× bookings (inquiries, cancellations, questions).

| Scenario | Conversations/mo | Sonnet cached | Haiku cached | Router (~70/30) |
|---|---:|---:|---:|---:|
| Internal shakeout (founder + friends) | ~50 | ~$2 | ~$0.6 | — |
| 1 design-partner club | ~1,200 | ~$46 (≈ S/170) | ~$13 | ~$23 |
| 5 clubs (Phase 1) | ~6,000 | ~$230 | ~$65 | ~$115 |
| 20 clubs | ~24,000 | ~$920 | ~$260 | ~$460 |

Plus Meta template spend at roughly S/0.10–0.20 × bookings. Both scale linearly with
clubs; both sit comfortably inside a flat per-club subscription priced against a
receptionist shift (PRD §8) — the guardrail exists to keep it that way.

## Router pattern (the cost lever — relevant at pilot scale now)

Two-tier setup:

1. **Haiku 4.5** handles simple turns fully: "¿precios?", "mis reservas", "cancela mi
   cancha del martes", reminder button replies.
2. **Sonnet** handles complex turns: multi-constraint booking, rescheduling with policy
   questions, payment discrepancies, anything the router is unsure about.

Realistic split ~70% Haiku / 30% Sonnet → blended cost roughly half of pure Sonnet.
Under PRD v1 this was deferred past ~1,000 conversations/month; **a single design-partner
club already crosses that line**, so build the loop with a per-turn model choice from the
start (trivial: model id is a parameter) and turn the router on when pilot telemetry
justifies it. Don't build the router itself before the pilot — measure first.

## Degraded mode (LLM availability ≠ booking availability)

PRD FR-2/NFR: if the Anthropic API is down or slow past the latency budget, core booking
falls back to WhatsApp interactive lists/buttons driven directly by the engine (pick a
slot → hold → pay link). This caps the blast radius of provider outages and is another
reason the engine must own all logic — the buttons flow reuses the same tools, minus the
model.

## Recommendation

**Claude direct + tool use, no framework. Sonnet (`claude-sonnet-4-6`, env-configurable)
as default. Prompt caching on the per-tenant static prompt. Per-booking cost telemetry
from day one; flip on the Haiku router when pilot data shows the guardrail under
pressure.**

Reasoning:
1. The hard task changed (group-chat resolution → payment-aware booking dialogue in
   es-PE) but its class didn't: multi-constraint, multi-tool, natural language. Sonnet
   handles it reliably; the engine backstops every write anyway.
2. **One agent, one purpose.** Frameworks earn their keep with many agents. This is one
   agent with a typed tool registry — direct SDK is ~200 LOC and you own every step.
3. **The static prompt dominates input tokens** and caching cuts it ~90% on reads.
4. **Unit economics fit** with headroom: ≈ S/0.25–0.35 all-in per booking vs the S/0.50
   guardrail, with the router as a 2× lever in reserve.
5. One vendor, one SDK, one observability story.

## Cost levers if/when needed

- **Router** — Haiku for the ~70% of simple turns (biggest lever, ~2× blended).
- **Trim history** — fewer verbatim turns per call.
- **Shorter tool descriptions** — schemas ship every turn.
- **1-hour cache TTL** — 2× write cost, pays off for a busy club's continuous daytime traffic.
- **Batches API (50% off)** — digests, segment scoring, dunning-copy generation.
- **Template discipline** — reminders are the guardrail's other half; frequency caps and
  confirm-buttons (which open a free service window) keep Meta spend down.
