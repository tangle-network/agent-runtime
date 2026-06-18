[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / RuntimeRunRow

# Interface: RuntimeRunRow

Defined in: [runtime-run.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L60)

## Stable

## Properties

### id

> **id**: `string`

Defined in: [runtime-run.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L62)

Stable runtime-side identifier. Adapters may translate to their own primary key.

***

### workspaceId

> **workspaceId**: `string`

Defined in: [runtime-run.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L63)

***

### sessionId?

> `optional` **sessionId?**: `string`

Defined in: [runtime-run.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L64)

***

### agentId?

> `optional` **agentId?**: `string`

Defined in: [runtime-run.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L65)

***

### domain?

> `optional` **domain?**: `string`

Defined in: [runtime-run.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L66)

***

### taskId

> **taskId**: `string`

Defined in: [runtime-run.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L67)

***

### scenarioId?

> `optional` **scenarioId?**: `string`

Defined in: [runtime-run.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L68)

***

### status

> **status**: `RuntimeRunStatus`

Defined in: [runtime-run.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L69)

***

### resultSummary?

> `optional` **resultSummary?**: `string`

Defined in: [runtime-run.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L70)

***

### error?

> `optional` **error?**: `string`

Defined in: [runtime-run.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L71)

***

### cost

> **cost**: `RuntimeRunCost`

Defined in: [runtime-run.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L72)

***

### startedAt

> **startedAt**: `string`

Defined in: [runtime-run.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L73)

***

### completedAt?

> `optional` **completedAt?**: `string`

Defined in: [runtime-run.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L74)

***

### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [runtime-run.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L75)
