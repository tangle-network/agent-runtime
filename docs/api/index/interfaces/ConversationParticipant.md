[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / ConversationParticipant

# Interface: ConversationParticipant

Defined in: [conversation/types.ts:20](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L20)

## Stable

## Properties

### name

> **name**: `string`

Defined in: [conversation/types.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L25)

Stable name used as the speaker label in the transcript. Must be unique
within a `Conversation`.

***

### backend

> **backend**: [`AgentExecutionBackend`](AgentExecutionBackend.md)

Defined in: [conversation/types.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L32)

Backend that runs this participant's turn. Reuses the existing
`AgentExecutionBackend` contract from `runAgentTaskStream`, so any
registered backend (iterable, sandbox, OpenAI-compatible) works without
adaptation.

***

### label?

> `optional` **label?**: `string`

Defined in: [conversation/types.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L37)

Optional human label for traces / dashboards. Distinct from `name`, which
is the addressing key.

***

### callPolicy?

> `optional` **callPolicy?**: [`BackendCallPolicy`](BackendCallPolicy.md)

Defined in: [conversation/types.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L43)

Optional per-participant override of the conversation's default
`callPolicy`. Use to tighten the deadline or raise the retry budget for
a participant known to be slow or flaky.

***

### authSource?

> `optional` **authSource?**: [`AuthSource`](../type-aliases/AuthSource.md)

Defined in: [conversation/types.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L63)

Who pays for THIS participant's outbound calls?

- `'forward-user'` (default) — propagate the caller's
  `X-Tangle-Forwarded-Authorization` so the downstream gateway bills the
  original user. Right for pass-through agents that aggregate/route
  without taking economic risk.
- `'agent-owned'` — DO NOT forward the user's auth; the participant's
  backend uses its own credentials (typically a sk-tan-AGENT or x402
  wallet baked into the backend at construction). Downstream charges
  land on the agent, not the user. Right for resold-bundle agents that
  take margin between their inbound price and their sub-agent costs.
- `(state) => AuthSource` — per-turn / per-condition decision, e.g. base
  sub-services are agent-owned but premium add-ons forward the user.

The agent's own credentials live on the backend (set at construction
time, e.g. `createOpenAICompatibleBackend({ apiKey })`); this field is
purely about *whether to also forward the user's identity downstream*.
