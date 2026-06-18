[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / mapSandboxEvent

# Function: mapSandboxEvent()

> **mapSandboxEvent**(`event`, `opts?`): [`RuntimeStreamEvent`](../../index/type-aliases/RuntimeStreamEvent.md) \| `undefined`

Defined in: [runtime/sandbox-events.ts:123](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-events.ts#L123)

Project one `SandboxEvent` onto the `RuntimeStreamEvent` chat-UX vocabulary,
for runtimes that bridge a sandbox `streamPrompt` into the
`AgentRuntime.act` streaming contract. Returns `undefined` for events that
have no faithful projection — the raw stream is preserved separately for the
`OutputAdapter`, so an unmapped event never loses data.

Mapped (the task-optional incremental variants — no synthesized task
lifecycle, no guessed tool-part shapes):
  - `message.part.updated` text part → `text_delta`
  - `message.part.updated` reasoning/thinking part → `reasoning_delta`
  - cost-bearing events → `llm_call` (shared with the ledger extractor)

The opencode backend emits incremental text as
`{ type: 'message.part.updated', data: { part: { type, text }, delta } }`;
`delta` is the increment, `part.text` the running accumulation.

## Parameters

### event

`SandboxEvent`

### opts?

#### agentRunName?

`string`

## Returns

[`RuntimeStreamEvent`](../../index/type-aliases/RuntimeStreamEvent.md) \| `undefined`
