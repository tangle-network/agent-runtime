[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / tool-loop

# tool-loop

## Interfaces

### ToolLoopCall

#### Properties

##### toolCallId?

> `optional` **toolCallId?**: `string`

##### toolName

> **toolName**: `string`

##### args

> **args**: `Record`\<`string`, `unknown`\>

***

### ToolLoopAssistantToolCall

One OpenAI-shaped tool-call entry carried on an assistant message.

#### Properties

##### id

> **id**: `string`

##### type

> **type**: `"function"`

##### function

> **function**: `object`

###### name

> **name**: `string`

###### arguments

> **arguments**: `string`

***

### ToolLoopResult

#### Properties

##### finalText

> **finalText**: `string`

##### toolResults

> **toolResults**: `object`[]

###### call

> **call**: [`ToolLoopCall`](#toolloopcall)

###### label

> **label**: `string`

###### outcome

> **outcome**: [`ToolCallOutcome`](#toolcalloutcome)

##### turns

> **turns**: `number`

##### stopReason

> **stopReason**: [`ToolLoopStopReason`](#toolloopstopreason)

##### ~~cappedOut~~

> **cappedOut**: `boolean`

###### Deprecated

Use `stopReason !== 'completed'` instead.

***

### RunToolLoopOptions

#### Properties

##### systemPrompt

> **systemPrompt**: `string`

##### userMessage

> **userMessage**: `string`

##### priorMessages?

> `optional` **priorMessages?**: [`ToolLoopMessage`](#toolloopmessage)[]

##### streamTurn

> **streamTurn**: (`messages`) => `AsyncIterable`\<[`ToolLoopEvent`](#toolloopevent)\>

###### Parameters

###### messages

[`ToolLoopMessage`](#toolloopmessage)[]

###### Returns

`AsyncIterable`\<[`ToolLoopEvent`](#toolloopevent)\>

##### executeToolCall

> **executeToolCall**: (`call`) => `Promise`\<[`ToolCallOutcome`](#toolcalloutcome)\>

###### Parameters

###### call

[`ToolLoopCall`](#toolloopcall)

###### Returns

`Promise`\<[`ToolCallOutcome`](#toolcalloutcome)\>

##### isExecutableTool

> **isExecutableTool**: (`toolName`) => `boolean`

###### Parameters

###### toolName

`string`

###### Returns

`boolean`

##### maxToolTurns?

> `optional` **maxToolTurns?**: `number`

Runaway-backstop cap. Default 200 — set far above any legitimate workflow.
 For per-workflow limits, use `maxCostUsd` or `deadlineMs` instead.

##### deadlineMs?

> `optional` **deadlineMs?**: `number`

Wall-clock deadline in ms since epoch (Date.now()-based). When exceeded the
 loop stops with stopReason `deadline`.

##### maxCostUsd?

> `optional` **maxCostUsd?**: `number`

Maximum total cost in USD. Requires `costOf` to meter each tool call.

##### costOf?

> `optional` **costOf?**: (`call`, `outcome`) => `number`

Return the USD cost of one outcome. Required for `maxCostUsd` to work.

###### Parameters

###### call

[`ToolLoopCall`](#toolloopcall)

###### outcome

[`ToolCallOutcome`](#toolcalloutcome)

###### Returns

`number`

##### renderResult?

> `optional` **renderResult?**: (`label`, `outcome`) => `string`

###### Parameters

###### label

`string`

###### outcome

[`ToolCallOutcome`](#toolcalloutcome)

###### Returns

`string`

##### labelFor?

> `optional` **labelFor?**: (`call`) => `string`

###### Parameters

###### call

[`ToolLoopCall`](#toolloopcall)

###### Returns

`string`

##### runId?

> `optional` **runId?**: `string`

##### scenarioId?

> `optional` **scenarioId?**: `string`

##### hooks?

> `optional` **hooks?**: [`RuntimeHooks`](index.md#runtimehooks)

***

### StreamToolLoopOptions

#### Type Parameters

##### Raw

`Raw`

#### Properties

##### systemPrompt

> **systemPrompt**: `string`

##### userMessage

> **userMessage**: `string`

##### priorMessages?

> `optional` **priorMessages?**: [`ToolLoopMessage`](#toolloopmessage)[]

##### streamTurn

> **streamTurn**: (`messages`) => `AsyncIterable`\<`Raw`\>

###### Parameters

###### messages

[`ToolLoopMessage`](#toolloopmessage)[]

###### Returns

`AsyncIterable`\<`Raw`\>

##### extractText

> **extractText**: (`event`) => `string`

###### Parameters

###### event

`Raw`

###### Returns

`string`

##### extractToolCall

> **extractToolCall**: (`event`) => [`ToolLoopCall`](#toolloopcall) \| `null`

###### Parameters

###### event

`Raw`

###### Returns

[`ToolLoopCall`](#toolloopcall) \| `null`

##### isExecutableTool

> **isExecutableTool**: (`toolName`) => `boolean`

###### Parameters

###### toolName

`string`

###### Returns

`boolean`

##### executeToolCall

> **executeToolCall**: (`call`) => `Promise`\<[`ToolCallOutcome`](#toolcalloutcome)\>

###### Parameters

###### call

[`ToolLoopCall`](#toolloopcall)

###### Returns

`Promise`\<[`ToolCallOutcome`](#toolcalloutcome)\>

##### maxToolTurns?

> `optional` **maxToolTurns?**: `number`

Runaway-backstop cap. Default 200 — set far above any legitimate workflow.

##### deadlineMs?

> `optional` **deadlineMs?**: `number`

Wall-clock deadline in ms since epoch (Date.now()-based).

##### maxCostUsd?

> `optional` **maxCostUsd?**: `number`

Maximum total cost in USD. Requires `costOf` to meter each tool call.

##### costOf?

> `optional` **costOf?**: (`call`, `outcome`) => `number`

Return the USD cost of one outcome. Required for `maxCostUsd` to work.

###### Parameters

###### call

[`ToolLoopCall`](#toolloopcall)

###### outcome

[`ToolCallOutcome`](#toolcalloutcome)

###### Returns

`number`

##### renderResult?

> `optional` **renderResult?**: (`label`, `outcome`) => `string`

###### Parameters

###### label

`string`

###### outcome

[`ToolCallOutcome`](#toolcalloutcome)

###### Returns

`string`

##### labelFor?

> `optional` **labelFor?**: (`call`) => `string`

###### Parameters

###### call

[`ToolLoopCall`](#toolloopcall)

###### Returns

`string`

##### runId?

> `optional` **runId?**: `string`

##### scenarioId?

> `optional` **scenarioId?**: `string`

##### hooks?

> `optional` **hooks?**: [`RuntimeHooks`](index.md#runtimehooks)

## Type Aliases

### ToolCallOutcome

> **ToolCallOutcome** = \{ `ok`: `true`; `result`: `unknown`; \} \| \{ `ok`: `false`; `code`: `string`; `message`: `string`; `status?`: `number`; \}

Outcome of one tool dispatch — structurally compatible with a hub/integration
 tool-outcome union, so callers can fold either through the loop.

***

### ToolLoopMessage

> **ToolLoopMessage** = `object`

A message in the running conversation the loop sends to `streamTurn`.

The base `{ role, content }` covers `system` / `user` / plain `assistant`
turns. Two optional fields carry the OpenAI function-calling contract so a
strict model (Claude, and any OpenAI-compatible provider that validates tool
history) reads its own tool use back instead of re-issuing the same call:

  - an assistant turn that emitted tool calls carries `tool_calls`, and its
    `content` is `null` when the turn was tool-only;
  - each tool result is its own `{ role: 'tool', tool_call_id, content }`
    message keyed to the call that produced it.

Widening is additive: a `streamTurn` that reads only `role` + `content` still
works; one that forwards the whole message to an OpenAI-compatible endpoint
now sends correct tool history.

#### Properties

##### role

> **role**: `string`

##### content

> **content**: `string` \| `null`

##### tool\_calls?

> `optional` **tool\_calls?**: [`ToolLoopAssistantToolCall`](#toolloopassistanttoolcall)[]

##### tool\_call\_id?

> `optional` **tool\_call\_id?**: `string`

***

### ToolLoopEvent

> **ToolLoopEvent** = \{ `type`: `"text"`; `text`: `string`; \} \| \{ `type`: `"tool_call"`; `call`: [`ToolLoopCall`](#toolloopcall); \} \| \{ `type`: `"other"`; `event`: `unknown`; \}

***

### ToolLoopStopReason

> **ToolLoopStopReason** = `"completed"` \| `"stuck-loop"` \| `"backstop"` \| `"deadline"` \| `"budget"`

Why the loop stopped. `completed` = model finished naturally; `stuck-loop` =
 ≥3 consecutive identical tool calls (same tool + args); `backstop` = hit the
 runaway-backstop cap (200 by default); `deadline` = wall-clock deadlineMs
 exceeded; `budget` = maxCostUsd exhausted. Non-`completed` stops are infra /
 resource outcomes — eval scoring must distinguish them from capability failure.

***

### StreamToolLoopYield

> **StreamToolLoopYield**\<`Raw`\> = \{ `kind`: `"event"`; `event`: `Raw`; \} \| \{ `kind`: `"tool_result"`; `toolName`: `string`; `toolCallId?`: `string`; `label`: `string`; `outcome`: [`ToolCallOutcome`](#toolcalloutcome); \} \| \{ `kind`: `"capped"`; `pending`: `number`; `stopReason`: `Exclude`\<[`ToolLoopStopReason`](#toolloopstopreason), `"completed"`\>; \}

#### Type Parameters

##### Raw

`Raw`

## Functions

### runToolLoop()

> **runToolLoop**(`opts`): `Promise`\<[`ToolLoopResult`](#toolloopresult)\>

Run the bounded tool loop and return the final text + every executed tool
 outcome. Awaitable — callers needing to stream events to a UI use
 [streamToolLoop](#streamtoolloop).

#### Parameters

##### opts

[`RunToolLoopOptions`](#runtoolloopoptions)

#### Returns

`Promise`\<[`ToolLoopResult`](#toolloopresult)\>

***

### streamToolLoop()

> **streamToolLoop**\<`Raw`\>(`opts`): `AsyncGenerator`\<[`StreamToolLoopYield`](#streamtoolloopyield)\<`Raw`\>, `void`, `unknown`\>

Streaming bounded tool loop: yields each raw turn event (the caller maps +
 telemetries + re-emits it) and each executed `tool_result`; emits one
 `capped` if it stops for any non-completed reason with calls still pending.

#### Type Parameters

##### Raw

`Raw`

#### Parameters

##### opts

[`StreamToolLoopOptions`](#streamtoolloopoptions)\<`Raw`\>

#### Returns

`AsyncGenerator`\<[`StreamToolLoopYield`](#streamtoolloopyield)\<`Raw`\>, `void`, `unknown`\>
