[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / ConversationTurn

# Interface: ConversationTurn

Defined in: [conversation/types.ts:136](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L136)

## Stable

## Properties

### index

> **index**: `number`

Defined in: [conversation/types.ts:137](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L137)

***

### speaker

> **speaker**: `string`

Defined in: [conversation/types.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L138)

***

### turnId

> **turnId**: `string`

Defined in: [conversation/types.ts:144](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L144)

Deterministic turn identifier — stable across retries of the same logical
turn so caching gateways and trace backends can dedupe. Shape:
`${runId}.t${index}.${speakerSlug}`.

***

### text

> **text**: `string`

Defined in: [conversation/types.ts:145](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L145)

***

### usage?

> `optional` **usage?**: `object`

Defined in: [conversation/types.ts:151](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L151)

Aggregated backend usage for this turn alone. Populated from any
`llm_call` stream events the backend emitted; `undefined` when the
backend reports no usage.

#### tokensIn?

> `optional` **tokensIn?**: `number`

#### tokensOut?

> `optional` **tokensOut?**: `number`

#### costUsd?

> `optional` **costUsd?**: `number`

#### latencyMs?

> `optional` **latencyMs?**: `number`

#### model?

> `optional` **model?**: `string`

***

### attempts

> **attempts**: `number`

Defined in: [conversation/types.ts:163](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L163)

Number of attempts that ran before this turn committed. `1` is the
common case; higher means the call policy retried after transient
failures.

***

### startedAt

> **startedAt**: `string`

Defined in: [conversation/types.ts:164](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L164)

***

### endedAt

> **endedAt**: `string`

Defined in: [conversation/types.ts:165](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L165)
