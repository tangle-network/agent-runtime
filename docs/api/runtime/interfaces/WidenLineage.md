[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / WidenLineage

# Interface: WidenLineage\<D\>

Defined in: [runtime/personify/wave-types.ts:329](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L329)

A lineage the gate may widen toward — the settled child that looked promising + the findings
 that justified it (the trace-derived provenance the firewall requires).

## Type Parameters

### D

`D`

## Properties

### settled

> `readonly` **settled**: `object`

Defined in: [runtime/personify/wave-types.ts:330](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L330)

#### kind

> **kind**: `"done"`

#### handle

> **handle**: [`Handle`](Handle.md)\<[`Outcome`](../type-aliases/Outcome.md)\<`D`\>\>

#### out

> **out**: [`Outcome`](../type-aliases/Outcome.md)

#### outRef

> **outRef**: `string`

#### verdict?

> `optional` **verdict?**: `DefaultVerdict`

#### spent

> **spent**: [`Spend`](Spend.md)

#### seq

> **seq**: `number`

***

### findings

> `readonly` **findings**: readonly `AnalystFinding`[]

Defined in: [runtime/personify/wave-types.ts:331](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L331)
