[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / FanoutSynthesis

# Interface: FanoutSynthesis\<D\>

Defined in: [runtime/personify/wave-types.ts:149](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L149)

How a fanout's synthesis child is built + read. `synthesisTask` projects the drained child
 settlements into the synthesis child's task; `collect` reads its settled output into the
 deliverable `Outcome<D>`.

## Type Parameters

### D

`D`

## Methods

### synthesisTask()

> **synthesisTask**(`gathered`, `ctx`): `unknown`

Defined in: [runtime/personify/wave-types.ts:150](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L150)

#### Parameters

##### gathered

readonly [`Settled`](../type-aliases/Settled.md)\<[`Outcome`](../type-aliases/Outcome.md)\<`D`\>\>[]

##### ctx

[`ShapeContext`](ShapeContext.md)\<`D`\>

#### Returns

`unknown`

***

### collect()

> **collect**(`settled`): [`Outcome`](../type-aliases/Outcome.md)\<`D`\>

Defined in: [runtime/personify/wave-types.ts:151](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L151)

#### Parameters

##### settled

[`Settled`](../type-aliases/Settled.md)\<[`Outcome`](../type-aliases/Outcome.md)\<`D`\>\>

#### Returns

[`Outcome`](../type-aliases/Outcome.md)\<`D`\>
