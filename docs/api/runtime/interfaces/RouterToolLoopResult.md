[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / RouterToolLoopResult

# Interface: RouterToolLoopResult

Defined in: [runtime/router-client.ts:181](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L181)

## Properties

### final

> **final**: `string`

Defined in: [runtime/router-client.ts:183](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L183)

The model's final assistant text (the turn where it stopped calling tools, or the budget turn).

***

### turns

> **turns**: `number`

Defined in: [runtime/router-client.ts:185](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L185)

Inference turns spent (≤ maxTurns) — the equal-budget unit vs random@k.

***

### toolCalls

> **toolCalls**: `number`

Defined in: [runtime/router-client.ts:186](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L186)

***

### toolTrace

> **toolTrace**: `object`[]

Defined in: [runtime/router-client.ts:189](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L189)

The behavior trace: each tool call + its result, in order. What a trace-analyst
 steerer reads (behavior, never the verdict) to diagnose + redirect the next shot.

#### name

> **name**: `string`

#### args

> **args**: `string`

#### result

> **result**: `string`

***

### usage

> **usage**: `object`

Defined in: [runtime/router-client.ts:190](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L190)

#### input

> **input**: `number`

#### output

> **output**: `number`

***

### messages

> **messages**: `Record`\<`string`, `unknown`\>[]

Defined in: [runtime/router-client.ts:193](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L193)

The full conversation after the loop (seed + every assistant/tool turn). Lets a caller
 CARRY the messages into the next shot (depth continuation) and read the trajectory.
