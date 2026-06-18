[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / routerToolLoop

# Function: routerToolLoop()

> **routerToolLoop**(`cfg`, `system`, `user`, `tools`, `execute`, `opts?`): `Promise`\<[`RouterToolLoopResult`](../interfaces/RouterToolLoopResult.md)\>

Defined in: [runtime/router-client.ts:207](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L207)

The tool-using router backend: a real agentic loop OVER the Tangle router (which
supports tool-calling), off-box — no sandbox. Each turn is one router completion
with `tools`; if the model emits tool_calls, `execute` runs them on the host and
their results are folded back as `tool` messages; the loop repeats until the
model answers without a tool call or the turn budget is hit. One turn = one
inference call, so `maxTurns` is the equal-compute unit against random@k.

This is the depth substrate for agentic gates (the worker ACTS, observes the real
result, and continues) that the chat-only `routerChatWithUsage` cannot express.

## Parameters

### cfg

[`RouterConfig`](../interfaces/RouterConfig.md)

### system

`string`

### user

`string`

### tools

readonly [`ToolSpec`](../interfaces/ToolSpec.md)[]

### execute

(`name`, `args`) => `Promise`\<`string`\>

### opts?

#### maxTurns?

`number`

#### temperature?

`number`

#### signal?

`AbortSignal`

#### maxTokens?

`number`

#### initialMessages?

readonly `Record`\<`string`, `unknown`\>[]

Seed the loop with an existing conversation (depth continuation) instead of
 `[system, user]`. When set, `system`/`user` are ignored. The array is copied.

## Returns

`Promise`\<[`RouterToolLoopResult`](../interfaces/RouterToolLoopResult.md)\>
