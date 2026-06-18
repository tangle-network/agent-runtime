[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / ToolLoopMessage

# Type Alias: ToolLoopMessage

> **ToolLoopMessage** = `object`

Defined in: [tool-loop.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L68)

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

## Properties

### role

> **role**: `string`

Defined in: [tool-loop.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L69)

***

### content

> **content**: `string` \| `null`

Defined in: [tool-loop.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L70)

***

### tool\_calls?

> `optional` **tool\_calls?**: [`ToolLoopAssistantToolCall`](../interfaces/ToolLoopAssistantToolCall.md)[]

Defined in: [tool-loop.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L71)

***

### tool\_call\_id?

> `optional` **tool\_call\_id?**: `string`

Defined in: [tool-loop.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L72)
