# Agent Stack Recommendation (cost-driven)

> **Status note (2026-07-02):** Model-agnostic gateways (OpenRouter, Vercel AI Gateway,
> LiteLLM) were explored and set aside — at ~1-to-few users, vendor neutrality isn't worth
> the extra layer, so V1 calls **Anthropic directly** (this doc's original recommendation).
> See [technical-requirements.md](./technical-requirements.md) for the current stack
> direction.

## Goal

Pick the LLM provider and agent-loop strategy for openclub's WhatsApp agent. The primary driver is **cost**, weighed against reasoning quality on the two hardest things the agent has to do:

1. **Group-chat reasoning** — resolving multiple participants in a WhatsApp group against the member DB, then handling multi-entity booking requests ("us four, court Tuesday after 7, prefer indoor").
2. **Tool orchestration** — chaining backend calls correctly in one turn (search availability → check member status → create booking → confirm).

## Architecture invariants (same for every option)

These don't change based on which LLM you pick. They establish the cost base before model choice:

```
WhatsApp user
   ↓ inbound webhook
Meta WhatsApp Cloud API
   ↓
openclub backend
   ├─ phone lookup (Postgres) — free, ~ms
   ├─ load last N conversation turns
   ├─ LLM agent loop (the variable cost)
   ├─ persist turn
   └─ outbound WhatsApp send
```

What that means: WhatsApp messaging cost (Meta) and DB cost (Postgres) are *fixed* regardless of LLM choice. The LLM is the lever.

### Meta WhatsApp Cloud API cost (orthogonal to LLM)
- **Service conversations** (any reply within 24h of a user's message): the only mode V1 needs.
- Meta gives **1,000 free service conversations per WhatsApp Business Account per month**.
- Beyond the free tier, service conversations are **billed per country**, roughly **$0.005–$0.05 per 24h conversation window**. US ≈ $0.025, Sweden ≈ $0.03, India ≈ $0.005.
- A "conversation" is a 24-hour window per user. Multiple messages in 24h = one billable conversation.

For the V1 dogfood (founder + 5 friends), WhatsApp will be free.

## Options

| | **Claude direct** | **OpenAI direct** | **Framework (LangChain / Mastra / Vercel AI SDK)** |
|---|---|---|---|
| Reasoning on multi-turn tool use | Strongest in class today | Strong, slightly behind on long tool chains | Same as underlying model |
| Group-chat entity resolution | Excellent | Good | Same as model |
| Tool use ergonomics | Native, parallel, well-typed | Native, mature | Wrapped abstraction |
| Prompt caching for static system prompt | First-class, 90% off on cached reads | Available, different mechanics | Depends on framework support |
| Debuggability | High — you own the loop | High | Lower — extra layers |
| Velocity for *one* focused agent | High (~200 LOC loop) | High | Lower (framework setup) |
| Velocity if you later run many agents / orchestration | Lower (you'd reinvent some plumbing) | Lower | Higher |
| Vendor portability | Low | Low | High |

## Cost model

### Per-turn token budget (working estimate)

A "turn" is one LLM call inside the agent loop. A booking conversation typically takes 2–4 LLM calls (user msg → maybe tool calls → final reply).

| Component | Tokens | Notes |
|---|---:|---|
| System prompt (club context, policies, persona) | ~2,500 | **Cacheable** — mostly static per club |
| Tool definitions (10–12 tools, JSON schemas) | ~1,500 | **Cacheable** |
| Conversation history (last ~5 turns, summarized older) | ~1,000 | Not cacheable (changes each turn) |
| Current user message | ~50 | Not cacheable |
| **Input total** | **~5,050** | **~4,000 cacheable, ~1,050 fresh** |
| Output (assistant reply + tool calls) | ~400 | |

**Per booking conversation:** ~3 turns × 5,050 input + 3 × 400 output ≈ **15K input, 1.2K output**.

### Anthropic pricing (per million tokens, as of January 2026)

| Model | Input | Output | Cache write (5m) | Cache read |
|---|---:|---:|---:|---:|
| **Sonnet 4.6** | $3.00 | $15.00 | $3.75 | $0.30 |
| **Haiku 4.5** | $1.00 | $5.00 | $1.25 | $0.10 |
| Opus 4.7 | $15.00 | $75.00 | $18.75 | $1.50 |

Opus is out of scope here — overkill for routine booking turns.

### Cost per booking conversation

**Sonnet 4.6, no caching:**
- Input: 15K × $3 = $0.045
- Output: 1.2K × $15 = $0.018
- **Total: ~$0.063 per booking**

**Sonnet 4.6, with prompt caching** (4K cached per turn, 1K fresh):
- Cache writes: amortized across turns, ~$0.005
- Cache reads: 12K × $0.30 = $0.0036
- Fresh input: 3K × $3 = $0.009
- Output: 1.2K × $15 = $0.018
- **Total: ~$0.036 per booking** (≈ 43% savings)

**Haiku 4.5, with prompt caching:**
- Cache reads: 12K × $0.10 = $0.0012
- Fresh input: 3K × $1 = $0.003
- Output: 1.2K × $5 = $0.006
- **Total: ~$0.010 per booking** (≈ 84% cheaper than Sonnet uncached)

### Volume scenarios

| Scenario | Conversations/month | Sonnet cached | Haiku cached | Router (Haiku + Sonnet) |
|---|---:|---:|---:|---:|
| V1 dogfood (6 users) | ~50 | **$1.80** | $0.50 | $1.20 |
| 1 real club (~200 members, ~100 active) | ~3,500 | $126 | $35 | ~$70 |
| 10 clubs | ~35,000 | $1,260 | $350 | ~$700 |

Plus Meta WhatsApp at scale:
- 1 club: ~2,500 billable conversations × $0.025 ≈ **$62/month**
- 10 clubs: ~$700/month

So WhatsApp ends up roughly the same order of magnitude as LLM cost at scale. Worth optimizing both, but neither dominates.

## Router pattern (cost lever)

Instead of running every turn through Sonnet, use a two-tier setup:

1. **Haiku 4.5 as intent classifier / simple-turn handler.** For turns like "list my bookings," "what time is open play tomorrow," "cancel my Tuesday slot" — Haiku handles them fully.
2. **Sonnet 4.6 for complex turns.** Multi-entity group bookings, ambiguous requests, error-recovery flows. Haiku routes to Sonnet when confidence is low or tools-needed signals complexity.

Realistic split: ~70% of turns go to Haiku, ~30% to Sonnet. That puts blended cost between Haiku and Sonnet — closer to Haiku.

Trade-off: a router adds latency (one extra LLM call) and complexity. Not worth it at V1 dogfood scale. Becomes interesting at >1,000 conversations/month.

## Recommendation

**Use Claude direct + tool use, no framework. Sonnet 4.6 as default model. Add a Haiku router when monthly volume exceeds ~1,000 conversations.**

Reasoning:
1. **Group-chat resolution is the hardest reasoning task** in openclub. Multi-entity + multi-constraint + natural language. Sonnet 4.6 handles this class of problem reliably; cheaper models hallucinate participants.
2. **One agent, one purpose.** Frameworks earn their keep with many agents or complex orchestration. openclub has one. Direct SDK is ~200 LOC and you own every step.
3. **Your system prompt is mostly static** (club info, courts, programs, pros, policies, tool descriptions). Prompt caching cuts ~43% of LLM cost on Sonnet, and is a one-line API change.
4. **Costs are negligible at V1 dogfood scale.** Under $2/month total. Optimization is a problem for V1.next, not V1.
5. **You're already Anthropic-native** (Claude Code on Opus 4.7). One vendor, one SDK, one observability story.

### Concrete stack

- **Provider:** Anthropic API directly. `@anthropic-ai/sdk` (TS) or `anthropic` (Python).
- **Model:** Claude Sonnet 4.6 (`claude-sonnet-4-6`) as default.
- **Pattern:** Stateless tool-calling loop. Each turn: load history, call API with `tools=[…]` and cached system prompt, execute returned tool calls, append results, call again until no more tool calls, send final text to WhatsApp.
- **Caching:** Mark system prompt and tool definitions with `cache_control: { type: "ephemeral" }`. 5-minute TTL is fine for V1.
- **History strategy:** Keep last 10 turns verbatim; summarize older turns into a compact paragraph. Cap context at ~6K tokens of history.
- **Observability:** Log every turn (input tokens, output tokens, cache hit %, tool calls, latency) to your DB. Cheapest possible "agent eval" surface.

## Cost levers if/when needed

- **Trim conversation history** — fewer turns kept verbatim = cheaper, but worse long-context.
- **Summarize aggressively** — collapse old turns to one sentence each.
- **Shorter tool descriptions** — tool schemas are sent every turn; brevity helps.
- **Add the router** — Haiku 4.5 handles 70% of turns at 1/3 the cost.
- **Lengthen cache TTL** — 1-hour cache is 2× write cost but pays off for high-frequency users.
- **Batch-friendly ops** — bulk operations (admin scripts, retention runs) can use the Anthropic Message Batches API at 50% discount when latency doesn't matter.
