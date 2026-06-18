[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / RunToolLoopOptions

# Interface: RunToolLoopOptions

Defined in: [tool-loop.ts:129](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L129)

## Properties

### systemPrompt

> **systemPrompt**: `string`

Defined in: [tool-loop.ts:130](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L130)

***

### userMessage

> **userMessage**: `string`

Defined in: [tool-loop.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L131)

***

### priorMessages?

> `optional` **priorMessages?**: [`ToolLoopMessage`](../type-aliases/ToolLoopMessage.md)[]

Defined in: [tool-loop.ts:132](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L132)

***

### streamTurn

> **streamTurn**: (`messages`) => `AsyncIterable`\<[`ToolLoopEvent`](../type-aliases/ToolLoopEvent.md)\>

Defined in: [tool-loop.ts:133](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L133)

#### Parameters

##### messages

[`ToolLoopMessage`](../type-aliases/ToolLoopMessage.md)[]

#### Returns

`AsyncIterable`\<[`ToolLoopEvent`](../type-aliases/ToolLoopEvent.md)\>

***

### executeToolCall

> **executeToolCall**: (`call`) => `Promise`\<[`ToolCallOutcome`](../type-aliases/ToolCallOutcome.md)\>

Defined in: [tool-loop.ts:134](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L134)

#### Parameters

##### call

[`ToolLoopCall`](ToolLoopCall.md)

#### Returns

`Promise`\<[`ToolCallOutcome`](../type-aliases/ToolCallOutcome.md)\>

***

### isExecutableTool

> **isExecutableTool**: (`toolName`) => `boolean`

Defined in: [tool-loop.ts:135](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L135)

#### Parameters

##### toolName

`string`

#### Returns

`boolean`

***

### maxToolTurns?

> `optional` **maxToolTurns?**: `number`

Defined in: [tool-loop.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L138)

Runaway-backstop cap. Default 200 — set far above any legitimate workflow.
 For per-workflow limits, use `maxCostUsd` or `deadlineMs` instead.

***

### deadlineMs?

> `optional` **deadlineMs?**: `number`

Defined in: [tool-loop.ts:141](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L141)

Wall-clock deadline in ms since epoch (Date.now()-based). When exceeded the
 loop stops with stopReason `deadline`.

***

### maxCostUsd?

> `optional` **maxCostUsd?**: `number`

Defined in: [tool-loop.ts:143](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L143)

Maximum total cost in USD. Requires `costOf` to meter each tool call.

***

### costOf?

> `optional` **costOf?**: (`call`, `outcome`) => `number`

Defined in: [tool-loop.ts:145](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L145)

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

Defined in: [tool-loop.ts:146](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L146)

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

Defined in: [tool-loop.ts:147](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L147)

#### Parameters

##### call

[`ToolLoopCall`](ToolLoopCall.md)

#### Returns

`string`

***

### runId?

> `optional` **runId?**: `string`

Defined in: [tool-loop.ts:148](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L148)

***

### scenarioId?

> `optional` **scenarioId?**: `string`

Defined in: [tool-loop.ts:149](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L149)

***

### hooks?

> `optional` **hooks?**: [`RuntimeHooks`](RuntimeHooks.md)

Defined in: [tool-loop.ts:150](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L150)
