[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / StreamToolLoopOptions

# Interface: StreamToolLoopOptions\<Raw\>

Defined in: [tool-loop.ts:309](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L309)

## Type Parameters

### Raw

`Raw`

## Properties

### systemPrompt

> **systemPrompt**: `string`

Defined in: [tool-loop.ts:310](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L310)

***

### userMessage

> **userMessage**: `string`

Defined in: [tool-loop.ts:311](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L311)

***

### priorMessages?

> `optional` **priorMessages?**: [`ToolLoopMessage`](../type-aliases/ToolLoopMessage.md)[]

Defined in: [tool-loop.ts:312](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L312)

***

### streamTurn

> **streamTurn**: (`messages`) => `AsyncIterable`\<`Raw`\>

Defined in: [tool-loop.ts:313](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L313)

#### Parameters

##### messages

[`ToolLoopMessage`](../type-aliases/ToolLoopMessage.md)[]

#### Returns

`AsyncIterable`\<`Raw`\>

***

### extractText

> **extractText**: (`event`) => `string`

Defined in: [tool-loop.ts:314](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L314)

#### Parameters

##### event

`Raw`

#### Returns

`string`

***

### extractToolCall

> **extractToolCall**: (`event`) => [`ToolLoopCall`](ToolLoopCall.md) \| `null`

Defined in: [tool-loop.ts:315](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L315)

#### Parameters

##### event

`Raw`

#### Returns

[`ToolLoopCall`](ToolLoopCall.md) \| `null`

***

### isExecutableTool

> **isExecutableTool**: (`toolName`) => `boolean`

Defined in: [tool-loop.ts:316](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L316)

#### Parameters

##### toolName

`string`

#### Returns

`boolean`

***

### executeToolCall

> **executeToolCall**: (`call`) => `Promise`\<[`ToolCallOutcome`](../type-aliases/ToolCallOutcome.md)\>

Defined in: [tool-loop.ts:317](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L317)

#### Parameters

##### call

[`ToolLoopCall`](ToolLoopCall.md)

#### Returns

`Promise`\<[`ToolCallOutcome`](../type-aliases/ToolCallOutcome.md)\>

***

### maxToolTurns?

> `optional` **maxToolTurns?**: `number`

Defined in: [tool-loop.ts:319](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L319)

Runaway-backstop cap. Default 200 — set far above any legitimate workflow.

***

### deadlineMs?

> `optional` **deadlineMs?**: `number`

Defined in: [tool-loop.ts:321](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L321)

Wall-clock deadline in ms since epoch (Date.now()-based).

***

### maxCostUsd?

> `optional` **maxCostUsd?**: `number`

Defined in: [tool-loop.ts:323](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L323)

Maximum total cost in USD. Requires `costOf` to meter each tool call.

***

### costOf?

> `optional` **costOf?**: (`call`, `outcome`) => `number`

Defined in: [tool-loop.ts:325](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L325)

Return the USD cost of one outcome. Required for `maxCostUsd` to work.

#### Parameters

##### call

[`ToolLoopCall`](ToolLoopCall.md)

##### outcome

[`ToolCallOutcome`](../type-aliases/ToolCallOutcome.md)

#### Returns

`number`

***

### renderResult?

> `optional` **renderResult?**: (`label`, `outcome`) => `string`

Defined in: [tool-loop.ts:326](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L326)

#### Parameters

##### label

`string`

##### outcome

[`ToolCallOutcome`](../type-aliases/ToolCallOutcome.md)

#### Returns

`string`

***

### labelFor?

> `optional` **labelFor?**: (`call`) => `string`

Defined in: [tool-loop.ts:327](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L327)

#### Parameters

##### call

[`ToolLoopCall`](ToolLoopCall.md)

#### Returns

`string`

***

### runId?

> `optional` **runId?**: `string`

Defined in: [tool-loop.ts:328](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L328)

***

### scenarioId?

> `optional` **scenarioId?**: `string`

Defined in: [tool-loop.ts:329](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L329)

***

### hooks?

> `optional` **hooks?**: [`RuntimeHooks`](RuntimeHooks.md)

Defined in: [tool-loop.ts:330](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L330)
