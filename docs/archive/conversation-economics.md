# Conversation Economics — Who Pays For What

agent-runtime is wire-compatible with Tangle's billing chain: every outbound participant call carries `X-Tangle-Forwarded-Authorization` so a downstream gateway can bill the *original* caller, no matter how many hops the request crosses. Most of the time you want exactly that — pass-through agents are simple, the user pays for what they triggered, and nothing else needs to be configured.

But three real commercial shapes show up in multi-agent systems, and the runtime supports all three through one knob: **`ConversationParticipant.authSource`**.

## TL;DR

| Mode | `authSource` value | Who pays | When to use |
|---|---|---|---|
| Pass-through | `'forward-user'` (default) | Original user | Aggregator / router agents that take no economic risk |
| Reseller | `'agent-owned'` | The agent | Bundled-price agents that absorb sub-agent costs |
| Mixed | `(state) => 'forward-user' \| 'agent-owned'` | Decided per turn | Tiered services — base is agent-owned, premium add-ons forward the user |

The agent's *own* credentials (the sk-tan-AGENT or x402 wallet that pays when `authSource` is `agent-owned`) are configured **on the executor at construction**, not on this knob.
This field is purely about whether to *additionally* forward the user's identity downstream.

## How forwarding actually works

The conversation runner reads `propagatedHeaders` on every `runConversation` call (typically threaded in by the gateway middleware that received the inbound request) and emits the [agent-bus headers](../agent-bus-protocol.md) on every outbound participant call.
The forwarded-authorization header — `x-tangle-forwarded-authorization` — is the one that determines downstream billing identity.

```
user ──Bearer sk-tan-user-123──▶ gateway ──▶ runConversation({
                                                propagatedHeaders: {
                                                  'x-tangle-forwarded-authorization': 'Bearer sk-tan-user-123',
                                                  ...
                                                }
                                              })
                                                  │
                                                  ▼
                              participant.backend.stream(input, {
                                propagatedHeaders: {
                                  'x-tangle-forwarded-authorization': 'Bearer sk-tan-user-123'  // forward-user (default)
                                  // or absent when authSource is 'agent-owned'
                                },
                                ...
                              })
```

When a participant uses `createProfileExecutionBackend(...)` with Runtime's Router executor, `context.propagatedHeaders` is merged into the outbound request automatically — the receiving gateway sees the user's token and bills accordingly.
A caller-owned HTTP backend must merge those headers itself.

## Mode 1 — Pass-through (`forward-user`, default)

Default behavior. The participant forwards the user's authorization unchanged. Downstream charges the user.

Use when the participant is a logical relay — a router, a fan-out coordinator, a critic that *reviews* other agents' output without itself being a paid service.

```ts
import { defineConversation, runConversation } from '@tangle-network/agent-runtime'

const conv = defineConversation({
  participants: [
    { name: 'researcher', backend: researcherBackend /* forward-user is default */ },
    { name: 'critic', backend: criticBackend },
  ],
  policy: { maxTurns: 6 },
})

await runConversation(conv, {
  seed: 'evaluate the latest mainnet upgrade',
  propagatedHeaders: { 'x-tangle-forwarded-authorization': `Bearer ${userToken}` },
})
```

Every outbound call from `researcher` and `critic` carries the user's `sk-tan-user-123`. Tangle bills the user for both participants' LLM usage at the router level. The aggregator agent earns nothing per-call — its monetization (if any) lives elsewhere (subscription, success fee, equity-in-output).

## Mode 2 — Reseller (`agent-owned`)

The participant pays its own bill.
The user's auth is stripped from outbound calls; the participant's profile-backed executor uses its own credentials.

Use when the participant is a paid service that bundles upstream costs into a fixed price. Inbound revenue (whatever the user paid for the outer conversation) minus outbound costs (what this participant spends on its sub-LLM calls) is the participant's margin.

```ts
import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  createProfileExecutionBackend,
  defineConversation,
  runConversation,
} from '@tangle-network/agent-runtime'
import { createExecutor } from '@tangle-network/agent-runtime/kernel'

const researcherProfile = {
  name: 'researcher',
  harness: 'cli-base',
  model: { provider: 'tangle-router', default: 'openai/gpt-4o-mini' },
} satisfies AgentProfile

const researcher = createProfileExecutionBackend({
  profile: researcherProfile,
  executor: createExecutor({
    backend: 'router',
    routerBaseUrl: 'https://router.tangle.tools/v1',
    routerKey: process.env.RESEARCHER_AGENT_SK_TAN!, // ← the AGENT's key, not the user's
  }),
})

const conv = defineConversation({
  participants: [
    {
      name: 'researcher',
      backend: researcher,
      authSource: 'agent-owned', // ← strip user auth; the executor's routerKey takes over
    },
    { name: 'critic', backend: criticBackend /* forwards user */ },
  ],
  policy: { maxTurns: 6 },
})

await runConversation(conv, {
  seed: 'evaluate the latest mainnet upgrade',
  propagatedHeaders: { 'x-tangle-forwarded-authorization': `Bearer ${userToken}` },
})
```

What changes on the wire:

- `researcher`'s outbound call has **no** `x-tangle-forwarded-authorization`; the receiving gateway authenticates via the executor's `routerKey` (the agent's own sk-tan-AGENT) and bills the agent.
- `critic`'s outbound call **still has** the user's forwarded-authorization; that hop bills the user.

You can mix the two freely within one conversation — the runtime resolves `authSource` per participant per turn.

## Mode 3 — Mixed (`(state) => …`)

A function that decides per turn. Use when the same participant has tiers: cheap base calls run on the agent's own credit, premium ones forward the user so the user is billed at premium rates.

```ts
import { defineConversation, runConversation } from '@tangle-network/agent-runtime'

const conv = defineConversation({
  participants: [
    {
      name: 'tiered-analyst',
      backend: analystBackend,
      authSource: (state) => {
        // Base service free to the user (agent eats the cost). Once the
        // conversation has accumulated some spend or content depth, escalate
        // to premium and bill the user directly.
        const enteredPremium =
          state.spentCreditsCents >= 50 ||
          state.transcript.some((t) => t.text.toLowerCase().includes('deep-dive'))
        return enteredPremium ? 'forward-user' : 'agent-owned'
      },
    },
    { name: 'user-facing', backend: userFacingBackend },
  ],
  policy: { maxTurns: 8, maxCreditsCents: 500 },
})
```

The predicate receives `{ transcript, turnIndex, spentCreditsCents }` — enough to gate on conversation content, turn count, or aggregate spend. The decision is recomputed before every backend call, so a participant can flip between modes turn by turn.

## What this is NOT

- **Not authentication.** The agent's credentials live on the executor, which is constructed once and bound to the profile.
  `authSource` does not set or change those credentials — it only decides whether to also forward the user's identity downstream.
- **Not a policy engine.** The decision returns one of two strings; if you want richer routing (e.g. *which* downstream model to call), do that in your backend, not here.
- **Not a substitute for `policy.maxCreditsCents`.** The hard credit ceiling still applies. A reseller participant that bills against its own creds is still counted against the conversation's `spentCreditsCents` budget so a runaway reseller can't drain the agent's wallet under cover of "the user isn't paying anyway."

## Auditing actual behavior

The simplest way to verify a configuration: inspect the propagated headers your backend sees inside its `stream`. Either:

1. Tail your agent-gateway access logs — the inbound `x-tangle-forwarded-authorization` shows the effective billing identity at every hop.
2. In tests, use the pattern in `src/conversation/auth-source.test.ts`: a capture backend records `AgentBackendContext.propagatedHeaders` and assertions check whether `x-tangle-forwarded-authorization` is set or absent per turn.

## Related

- [agent-bus-protocol.md](../agent-bus-protocol.md) — the wire-level header contract this builds on.
- [durability-adapters.md](../durability-adapters.md) — how to persist the resulting conversations across crashes.
- `src/conversation/types.ts` — full `AuthSource` and `ConversationDriveState` definitions.
