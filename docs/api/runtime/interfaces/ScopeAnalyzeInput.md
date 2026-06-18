[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / ScopeAnalyzeInput

# Interface: ScopeAnalyzeInput\<D\>

Defined in: [runtime/personify/wave-types.ts:369](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L369)

Input to a `ScopeAnalyst.analyze` — the root task framing + the children settled so far.

## Type Parameters

### D

`D`

## Properties

### task

> `readonly` **task**: `unknown`

Defined in: [runtime/personify/wave-types.ts:371](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L371)

Opaque root-task framing (whatever the combinator was invoked with).

***

### settledSoFar

> `readonly` **settledSoFar**: readonly [`Settled`](../type-aliases/Settled.md)\<[`Outcome`](../type-aliases/Outcome.md)\<`D`\>\>[]

Defined in: [runtime/personify/wave-types.ts:373](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L373)

The children this combinator has drained off `scope.next()`, in cursor order.

***

### nodeId

> `readonly` **nodeId**: `string`

Defined in: [runtime/personify/wave-types.ts:375](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L375)

This combinator's scope id (the trace-correlation root for the analyst).
