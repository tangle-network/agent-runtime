[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [agent](../README.md) / createSandboxAct

# Function: createSandboxAct()

> **createSandboxAct**\<`TPersona`, `TRunOutput`\>(`options`): (`persona`, `ctx`) => [`AgentRunInvocation`](../interfaces/AgentRunInvocation.md)\<`TRunOutput`\>

Defined in: [agent/sandbox-act.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/sandbox-act.ts#L63)

Build an `AgentRuntime.act` implementation backed by a single prod-profile
sandbox run. The returned function honours the `act` contract: it returns
synchronously with a live `events` iterator and an `output` promise that
resolves only after the iterator drains.

## Type Parameters

### TPersona

`TPersona`

### TRunOutput

`TRunOutput`

## Parameters

### options

[`CreateSandboxActOptions`](../interfaces/CreateSandboxActOptions.md)\<`TPersona`, `TRunOutput`\>

## Returns

(`persona`, `ctx`) => [`AgentRunInvocation`](../interfaces/AgentRunInvocation.md)\<`TRunOutput`\>
