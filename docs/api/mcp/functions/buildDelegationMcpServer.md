[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / buildDelegationMcpServer

# Function: buildDelegationMcpServer()

> **buildDelegationMcpServer**(`options?`): `Record`\<`string`, `AgentProfileMcpServer`\> \| `undefined`

Defined in: [mcp/delegation-profile.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-profile.ts#L69)

Build the delegation MCP entry the sandbox-side agent loads on startup.
Returns `undefined` when no sandbox API key is resolvable — callers merge
the result into a profile's `mcp` map only when defined.

## Parameters

### options?

[`BuildDelegationMcpServerOptions`](../interfaces/BuildDelegationMcpServerOptions.md) = `{}`

## Returns

`Record`\<`string`, `AgentProfileMcpServer`\> \| `undefined`
