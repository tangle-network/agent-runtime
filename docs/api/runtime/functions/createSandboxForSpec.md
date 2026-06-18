[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / createSandboxForSpec

# Function: createSandboxForSpec()

> **createSandboxForSpec**\<`Task`\>(`client`, `spec`, `signal`): `Promise`\<`SandboxInstance`\>

Defined in: [runtime/run-loop.ts:851](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-loop.ts#L851)

Instantiate a sandbox for an `AgentRunSpec`: sets `backend.profile` to the
spec's profile (inferring the backend type when the spec doesn't override
it) and merges `sandboxOverrides`. Shared by the loop kernel and the
`AgentRuntime.act` sandbox bridge so both boot the sandbox identically.

## Type Parameters

### Task

`Task`

## Parameters

### client

[`SandboxClient`](../interfaces/SandboxClient.md)

### spec

[`AgentRunSpec`](../interfaces/AgentRunSpec.md)\<`Task`\>

### signal

`AbortSignal`

## Returns

`Promise`\<`SandboxInstance`\>
