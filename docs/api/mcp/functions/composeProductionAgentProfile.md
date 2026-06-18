[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / composeProductionAgentProfile

# Function: composeProductionAgentProfile()

> **composeProductionAgentProfile**(`baseProfile`, `options?`): `AgentProfile`

Defined in: [mcp/delegation-profile.ts:164](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-profile.ts#L164)

Compose the production `AgentProfile`: the canonical base profile with the
delegation MCP merged into `mcp`. Used by every call site that boots a
sandbox or runs a chat turn through the sandbox path, and by eval wiring so
the scorecard profile hash reflects the actual production profile.

Merge rules:
  - `mcp`: base map preserved; `options.mcpConnections` (resolved certified
    servers) merged over it; the delegation entry is appended last under
    [DELEGATION\_MCP\_SERVER\_KEY](../variables/DELEGATION_MCP_SERVER_KEY.md), and omitted entirely when no sandbox
    API key resolves.
  - `tools`: base box-flags map preserved; `options.tools` overlaid per key.
  - `hooks`: per event, base commands preserved; `options.hooks[event]`
    appended after the base ones.
  - `subagents`: base map preserved; `options.subagents` overlaid per key.
  - `prompt.systemPrompt`: replaced when `options.systemPrompt` is set.
  - `resources.files`: `options.extraFiles` concatenated after base files.
  - `name`: replaced when `options.name` is set.

## Parameters

### baseProfile

`AgentProfile`

### options?

[`ComposeProductionAgentProfileOptions`](../interfaces/ComposeProductionAgentProfileOptions.md) = `{}`

## Returns

`AgentProfile`
