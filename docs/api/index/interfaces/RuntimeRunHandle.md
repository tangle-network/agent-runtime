[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / RuntimeRunHandle

# Interface: RuntimeRunHandle

Defined in: [runtime-run.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L106)

## Stable

## Properties

### id

> `readonly` **id**: `string`

Defined in: [runtime-run.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L108)

Stable id assigned at start.

***

### workspaceId

> `readonly` **workspaceId**: `string`

Defined in: [runtime-run.ts:109](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L109)

***

### sessionId

> `readonly` **sessionId**: `string` \| `undefined`

Defined in: [runtime-run.ts:110](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L110)

***

### taskSpec

> `readonly` **taskSpec**: [`AgentTaskSpec`](AgentTaskSpec.md)

Defined in: [runtime-run.ts:111](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L111)

***

### status

> `readonly` **status**: `RuntimeRunStatus`

Defined in: [runtime-run.ts:112](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L112)

## Methods

### observe()

> **observe**(`event`): `void`

Defined in: [runtime-run.ts:119](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L119)

Observe a single `RuntimeStreamEvent`. The handle ignores non-cost events
(text deltas, tool calls) silently so consumers can pipe the whole stream
through `handle.observe`. `llm_call` events update the ledger.

#### Parameters

##### event

[`RuntimeStreamEvent`](../type-aliases/RuntimeStreamEvent.md)

#### Returns

`void`

***

### cost()

> **cost**(): `RuntimeRunCost`

Defined in: [runtime-run.ts:122](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L122)

Snapshot of the current cost ledger. Safe to call at any time.

#### Returns

`RuntimeRunCost`

***

### complete()

> **complete**(`input`): `void`

Defined in: [runtime-run.ts:129](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L129)

Transition to a terminal state. Idempotent for the same status; throws
`RuntimeRunStateError` for a different terminal status (state machines
don't time-travel).

#### Parameters

##### input

`RuntimeRunCompleteInput`

#### Returns

`void`

***

### toRow()

> **toRow**(`metadata?`): [`RuntimeRunRow`](RuntimeRunRow.md)

Defined in: [runtime-run.ts:132](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L132)

Build the current row without writing it. Useful for tests + dry runs.

#### Parameters

##### metadata?

`Record`\<`string`, `unknown`\>

#### Returns

[`RuntimeRunRow`](RuntimeRunRow.md)

***

### persist()

> **persist**(`metadata?`): `Promise`\<`void`\>

Defined in: [runtime-run.ts:139](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L139)

Persist the current row via the configured adapter. Must be called after
`complete()`. Idempotent for the same terminal state (the adapter sees
the same row on retry).

#### Parameters

##### metadata?

`Record`\<`string`, `unknown`\>

#### Returns

`Promise`\<`void`\>
