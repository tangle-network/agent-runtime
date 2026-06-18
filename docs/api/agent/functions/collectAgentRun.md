[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [agent](../README.md) / collectAgentRun

# Function: collectAgentRun()

> **collectAgentRun**\<`TRunOutput`\>(`invocation`): `Promise`\<\{ `events`: readonly [`RuntimeStreamEvent`](../../index/type-aliases/RuntimeStreamEvent.md)[]; `output`: `TRunOutput`; \}\>

Defined in: [agent/define-agent.ts:222](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L222)

Drain `act`'s `events` into an array AND await its `output`. Useful for
eval / outcome-measurement code paths that don't care about live
rendering. The events array is preserved so the substrate can inspect
tool calls / readiness / questions retrospectively.

IMPORTANT: chat-centric UX MUST NOT call this — it defeats streaming
(no incremental render). Use `for await (const ev of invocation.events)`
directly in the chat surface.

## Type Parameters

### TRunOutput

`TRunOutput`

## Parameters

### invocation

[`AgentRunInvocation`](../interfaces/AgentRunInvocation.md)\<`TRunOutput`\>

## Returns

`Promise`\<\{ `events`: readonly [`RuntimeStreamEvent`](../../index/type-aliases/RuntimeStreamEvent.md)[]; `output`: `TRunOutput`; \}\>
