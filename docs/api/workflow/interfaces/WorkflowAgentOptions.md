[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [workflow](../README.md) / WorkflowAgentOptions

# Interface: WorkflowAgentOptions\<TOutput\>

Defined in: [workflow/types.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L74)

## Type Parameters

### TOutput

`TOutput` = `unknown`

## Properties

### label?

> `optional` **label?**: `string`

Defined in: [workflow/types.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L75)

***

### schema?

> `optional` **schema?**: [`JsonSchema`](../type-aliases/JsonSchema.md)

Defined in: [workflow/types.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L76)

***

### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [workflow/types.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L77)

***

### allowWorkflow?

> `optional` **allowWorkflow?**: `boolean`

Defined in: [workflow/types.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L82)

Nested workflows are denied by default. Consumers that expose them through
a delegate must also honor `ctx.depth` and `ctx.caps.maxDepth`.

***

### decode?

> `optional` **decode?**: (`value`) => `TOutput`

Defined in: [workflow/types.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L83)

#### Parameters

##### value

`unknown`

#### Returns

`TOutput`
