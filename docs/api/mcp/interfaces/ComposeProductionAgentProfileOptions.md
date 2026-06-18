[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / ComposeProductionAgentProfileOptions

# Interface: ComposeProductionAgentProfileOptions

Defined in: [mcp/delegation-profile.ts:112](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-profile.ts#L112)

## Properties

### sandboxApiKey?

> `optional` **sandboxApiKey?**: `string`

Defined in: [mcp/delegation-profile.ts:115](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-profile.ts#L115)

Sandbox API key forwarded to the delegation MCP child. Defaults to
 `env.TANGLE_API_KEY`. When unset, the delegation MCP entry is omitted.

***

### sandboxBaseUrl?

> `optional` **sandboxBaseUrl?**: `string`

Defined in: [mcp/delegation-profile.ts:117](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-profile.ts#L117)

Sandbox base URL forwarded as `SANDBOX_BASE_URL` to the MCP child.

***

### systemPrompt?

> `optional` **systemPrompt?**: `string`

Defined in: [mcp/delegation-profile.ts:120](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-profile.ts#L120)

Replace the base profile's system prompt. Used by per-turn calls that
 swap in workspace-augmented prompts (board summary, learned style).

***

### extraFiles?

> `optional` **extraFiles?**: `AgentProfileFileMount`[]

Defined in: [mcp/delegation-profile.ts:122](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-profile.ts#L122)

Extra file mounts layered after the base profile's `resources.files`.

***

### name?

> `optional` **name?**: `string`

Defined in: [mcp/delegation-profile.ts:124](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-profile.ts#L124)

Override the profile `name`. Defaults to the base profile's name.

***

### env?

> `optional` **env?**: `Record`\<`string`, `string` \| `undefined`\>

Defined in: [mcp/delegation-profile.ts:126](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-profile.ts#L126)

Environment source for key + OTEL resolution. Defaults to `process.env`.

***

### tools?

> `optional` **tools?**: `Record`\<`string`, `boolean`\>

Defined in: [mcp/delegation-profile.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-profile.ts#L131)

Box built-in tool ON/OFF flags merged over the base profile's `tools`
 (overlay wins per key). The sandbox-seam mapping of a certified surface's
 tool grants — `AgentProfile.tools` is `Record<string, boolean>` box flags,
 so it carries grants, not arbitrary tool defs.

***

### hooks?

> `optional` **hooks?**: `Record`\<`string`, `AgentProfileHookCommand`[]\>

Defined in: [mcp/delegation-profile.ts:134](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-profile.ts#L134)

Per-event hook commands merged over the base profile's `hooks`. An event
 present in both has the extra commands appended after the base ones.

***

### subagents?

> `optional` **subagents?**: `Record`\<`string`, `AgentSubagentProfile`\>

Defined in: [mcp/delegation-profile.ts:137](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-profile.ts#L137)

Subagent definitions merged over the base profile's `subagents` (overlay
 wins per key).

***

### mcpConnections?

> `optional` **mcpConnections?**: `Record`\<`string`, `AgentProfileMcpServer`\>

Defined in: [mcp/delegation-profile.ts:142](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-profile.ts#L142)

Resolved certified MCP connections injected into `AgentProfile.mcp` — the
 sandbox-seam delivery of a `ResolvedSurface.mcpConnections`. Merged after
 the base map and before the delegation entry, so a base/delegation key is
 never silently shadowed by an injected one.
