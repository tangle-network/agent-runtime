[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [workflow](../README.md) / WorkflowCheckpointOptions

# Interface: WorkflowCheckpointOptions\<TOutput\>

Defined in: [workflow/types.ts:93](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L93)

## Type Parameters

### TOutput

`TOutput` = `unknown`

## Properties

### label?

> `optional` **label?**: `string`

Defined in: [workflow/types.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L94)

***

### schema?

> `optional` **schema?**: [`JsonSchema`](../type-aliases/JsonSchema.md)

Defined in: [workflow/types.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L95)

***

### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [workflow/types.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L96)

***

### decode?

> `optional` **decode?**: (`value`) => `TOutput`

Defined in: [workflow/types.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L97)

#### Parameters

##### value

`unknown`

#### Returns

`TOutput`
