[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / RuntimeHookEvent

# Interface: RuntimeHookEvent\<Payload\>

Defined in: [runtime-hooks.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L35)

## Type Parameters

### Payload

`Payload` = `unknown`

## Properties

### id

> **id**: `string`

Defined in: [runtime-hooks.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L36)

***

### runId

> **runId**: `string`

Defined in: [runtime-hooks.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L37)

***

### scenarioId?

> `optional` **scenarioId?**: `string`

Defined in: [runtime-hooks.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L38)

***

### target

> **target**: [`RuntimeHookTarget`](../type-aliases/RuntimeHookTarget.md)

Defined in: [runtime-hooks.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L39)

***

### phase

> **phase**: [`RuntimeHookPhase`](../type-aliases/RuntimeHookPhase.md)

Defined in: [runtime-hooks.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L40)

***

### timestamp

> **timestamp**: `number`

Defined in: [runtime-hooks.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L41)

***

### stepIndex?

> `optional` **stepIndex?**: `number`

Defined in: [runtime-hooks.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L42)

***

### parentId?

> `optional` **parentId?**: `string`

Defined in: [runtime-hooks.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L43)

***

### payload?

> `optional` **payload?**: `Payload`

Defined in: [runtime-hooks.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L44)

***

### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [runtime-hooks.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L45)
