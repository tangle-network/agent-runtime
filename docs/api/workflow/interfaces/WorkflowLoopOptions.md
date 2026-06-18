[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [workflow](../README.md) / WorkflowLoopOptions

# Interface: WorkflowLoopOptions\<TOutput\>

Defined in: [workflow/types.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L86)

## Type Parameters

### TOutput

`TOutput` = `unknown`

## Properties

### label?

> `optional` **label?**: `string`

Defined in: [workflow/types.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L87)

***

### schema?

> `optional` **schema?**: [`JsonSchema`](../type-aliases/JsonSchema.md)

Defined in: [workflow/types.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L88)

***

### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [workflow/types.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L89)

***

### decode?

> `optional` **decode?**: (`value`) => `TOutput`

Defined in: [workflow/types.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L90)

#### Parameters

##### value

`unknown`

#### Returns

`TOutput`
