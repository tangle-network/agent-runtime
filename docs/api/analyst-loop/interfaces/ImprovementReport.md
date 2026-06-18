[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [analyst-loop](../README.md) / ImprovementReport

# Interface: ImprovementReport\<TEdit\>

Defined in: [analyst-loop/types.ts:136](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L136)

## Type Parameters

### TEdit

`TEdit` = `unknown`

## Properties

### edits

> **edits**: `TEdit`[]

Defined in: [analyst-loop/types.ts:137](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L137)

***

### applied

> **applied**: `string`[]

Defined in: [analyst-loop/types.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L138)

***

### skipped

> **skipped**: `number`

Defined in: [analyst-loop/types.ts:139](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L139)

***

### errors

> **errors**: `object`[]

Defined in: [analyst-loop/types.ts:140](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L140)

#### findingId

> **findingId**: `string`

#### subject

> **subject**: `string`

#### message

> **message**: `string`

***

### withheld\_for\_review

> **withheld\_for\_review**: `number`

Defined in: [analyst-loop/types.ts:141](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L141)
