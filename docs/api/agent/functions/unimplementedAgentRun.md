[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [agent](../README.md) / unimplementedAgentRun

# Function: unimplementedAgentRun()

> **unimplementedAgentRun**\<`TRunOutput`\>(`reason?`): [`AgentRunInvocation`](../interfaces/AgentRunInvocation.md)\<`TRunOutput`\>

Defined in: [agent/define-agent.ts:203](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L203)

Stub for agents whose `runtime.act` is not yet wired to the substrate's
eval path. Preserves the streaming contract (empty event stream + a
rejected `output` promise that tells the caller exactly what to fix).

Per-vertical manifests usually start with this stub and replace it with
the agent's real streaming runtime (`runChatTurn` or equivalent) once
the eval path consumes the manifest end-to-end.

## Type Parameters

### TRunOutput

`TRunOutput` = `unknown`

## Parameters

### reason?

`string` = `'AgentRuntime.act is not yet wired for this manifest'`

## Returns

[`AgentRunInvocation`](../interfaces/AgentRunInvocation.md)\<`TRunOutput`\>
