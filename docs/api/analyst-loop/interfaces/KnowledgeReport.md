[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [analyst-loop](../README.md) / KnowledgeReport

# Interface: KnowledgeReport\<TProposal\>

Defined in: [analyst-loop/types.ts:128](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L128)

## Type Parameters

### TProposal

`TProposal` = `unknown`

## Properties

### proposals

> **proposals**: `TProposal`[]

Defined in: [analyst-loop/types.ts:129](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L129)

***

### applied

> **applied**: `string`[]

Defined in: [analyst-loop/types.ts:130](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L130)

***

### skipped

> **skipped**: `number`

Defined in: [analyst-loop/types.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L131)

***

### errors

> **errors**: `object`[]

Defined in: [analyst-loop/types.ts:132](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L132)

#### findingId

> **findingId**: `string`

#### subject

> **subject**: `string`

#### message

> **message**: `string`

***

### withheld\_for\_review

> **withheld\_for\_review**: `number`

Defined in: [analyst-loop/types.ts:133](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L133)
