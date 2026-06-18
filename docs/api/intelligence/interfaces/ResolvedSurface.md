[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / ResolvedSurface

# Interface: ResolvedSurface

Defined in: [intelligence/capability.ts:212](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L212)

What `composeCertifiedProfile` produces. Every binding fans into the same
slots, consumed identically by the in-process seam (`RouterToolsSeam.{tools,
executeToolCall}` + folded prompt) and the sandbox seam (`AgentProfile`).
`dispose()` tears provisioned hosts down in REVERSE dependency order.

## Properties

### tools

> **tools**: [`ToolSpec`](../../runtime/interfaces/ToolSpec.md)[]

Defined in: [intelligence/capability.ts:214](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L214)

Host-side tool defs → `RouterToolsSeam.tools` / agent-app `extraTools`.

***

### mcpConnections

> **mcpConnections**: `Record`\<`string`, `AgentProfileMcpServer`\>

Defined in: [intelligence/capability.ts:219](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L219)

Sandbox-side tool delivery → `AgentProfile.mcp` / in-proc `createMcpEnvironment`.

***

### promptAdditions

> **promptAdditions**: `string`[]

Defined in: [intelligence/capability.ts:221](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L221)

Prompt-context additions, byte-stable-ordered → folded system prompt.

***

### files

> **files**: `object`[]

Defined in: [intelligence/capability.ts:223](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L223)

Workspace files → `AgentProfile.resources.files`.

#### path

> **path**: `string`

#### content

> **content**: `string`

#### executable?

> `optional` **executable?**: `boolean`

***

### retrieval

> **retrieval**: [`ResolvedRetrieval`](ResolvedRetrieval.md)[]

Defined in: [intelligence/capability.ts:225](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L225)

Uniform retrieval handles.

***

### hooks

> **hooks**: [`ResolvedHook`](ResolvedHook.md)[]

Defined in: [intelligence/capability.ts:227](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L227)

Hooks → `AgentProfile.hooks`.

***

### subagents

> **subagents**: [`ResolvedSubagent`](ResolvedSubagent.md)[]

Defined in: [intelligence/capability.ts:229](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L229)

Subagents → `AgentProfile.subagents`.

***

### systemPrompt

> **systemPrompt**: `string`

Defined in: [intelligence/capability.ts:232](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L232)

The folded system prompt — base + the byte-stable prompt additions, exactly
 as `composeCertifiedPrompt` renders the inline/context capabilities.

## Methods

### execute()

> **execute**(`name`, `args`, `task`): `Promise`\<`string`\>

Defined in: [intelligence/capability.ts:217](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L217)

Host-side dispatch for a resolved tool. Throws when `name` is unknown so a
 mis-dispatch is loud, never a silent empty string.

#### Parameters

##### name

`string`

##### args

`Record`\<`string`, `unknown`\>

##### task

`unknown`

#### Returns

`Promise`\<`string`\>

***

### dispose()

> **dispose**(): `Promise`\<`void`\>

Defined in: [intelligence/capability.ts:234](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L234)

Tear down provisioned hosts (reverse dependency order).

#### Returns

`Promise`\<`void`\>
