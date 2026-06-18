[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / RunConversationOptions

# Interface: RunConversationOptions

Defined in: [conversation/types.ts:175](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L175)

## Stable

## Properties

### seed

> **seed**: `string`

Defined in: [conversation/types.ts:177](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L177)

First message kicking off the conversation. Routes to the first speaker.

***

### runId?

> `optional` **runId?**: `string`

Defined in: [conversation/types.ts:184](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L184)

Optional run identifier for cross-participant trace correlation. Auto-
generated when omitted. Reusing a runId against the same `journal`
resumes the prior run — the runner replays the persisted transcript and
continues from the first un-recorded turn.

***

### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [conversation/types.ts:186](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L186)

Cancellation signal — aborts mid-stream and halts with `{ kind: 'abort' }`.

***

### onEvent?

> `optional` **onEvent?**: (`event`) => `void` \| `Promise`\<`void`\>

Defined in: [conversation/types.ts:193](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L193)

Event sink for per-turn micro-events. Distinct from the result transcript:
the sink fires for every text-delta, every turn-start/end, and the
conversation-start/end markers. Used to drive SSE / dashboard updates
without waiting for the conversation to finish.

#### Parameters

##### event

[`ConversationStreamEvent`](../type-aliases/ConversationStreamEvent.md)

#### Returns

`void` \| `Promise`\<`void`\>

***

### journal?

> `optional` **journal?**: [`ConversationJournal`](ConversationJournal.md)

Defined in: [conversation/types.ts:200](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L200)

Optional durable transcript. When set, the runner persists every
committed turn before yielding `turn_end`. Reusing the same `runId`
against the same journal resumes from the last committed turn — so a
driver process crash mid-run loses zero acknowledged turns.

***

### propagatedHeaders?

> `optional` **propagatedHeaders?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [conversation/types.ts:207](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L207)

Headers to forward verbatim to every participant backend call (gateway
propagation: `X-Tangle-Forwarded-Authorization`, run/turn correlation,
depth counter). Backends opt in by reading `propagatedHeaders` from
their `AgentBackendContext`; backends that ignore the field still work.

***

### inboundDepth?

> `optional` **inboundDepth?**: `number`

Defined in: [conversation/types.ts:213](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L213)

Inbound depth at the point this driver was invoked. The runner
increments it on every outbound participant call; gateways refuse at
`DEFAULT_MAX_DEPTH`. Default 0 (origin caller).

***

### parentTurnId?

> `optional` **parentTurnId?**: `string`

Defined in: [conversation/types.ts:220](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L220)

Parent turn id when this conversation is *inside* another turn (i.e. the
driver is itself a participant via `createConversationBackend`). The
runner stamps each outbound call with this as `X-Tangle-Parent-TurnId`
so trace stitching survives nested orchestration.
