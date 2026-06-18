[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [agent](../README.md) / CreateSandboxActOptions

# Interface: CreateSandboxActOptions\<TPersona, TRunOutput\>

Defined in: [agent/sandbox-act.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/sandbox-act.ts#L28)

## Type Parameters

### TPersona

`TPersona`

### TRunOutput

`TRunOutput`

## Properties

### baseProfile

> **baseProfile**: `AgentProfile`

Defined in: [agent/sandbox-act.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/sandbox-act.ts#L30)

Canonical agent profile — the same one the prod chat turn composes from.

***

### sandboxClient

> **sandboxClient**: [`SandboxClient`](../../runtime/interfaces/SandboxClient.md)

Defined in: [agent/sandbox-act.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/sandbox-act.ts#L32)

Sandbox client used to boot the per-run sandbox.

***

### buildPrompt

> **buildPrompt**: (`persona`) => `string`

Defined in: [agent/sandbox-act.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/sandbox-act.ts#L34)

Persona → prompt. Pure; the eval cell's input.

#### Parameters

##### persona

`TPersona`

#### Returns

`string`

***

### output

> **output**: [`OutputAdapter`](../../runtime/interfaces/OutputAdapter.md)\<`TRunOutput`\>

Defined in: [agent/sandbox-act.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/sandbox-act.ts#L36)

Sandbox event stream → typed output the rubric scores.

***

### compose?

> `optional` **compose?**: (`persona`) => [`ComposeProductionAgentProfileOptions`](../../mcp/interfaces/ComposeProductionAgentProfileOptions.md)

Defined in: [agent/sandbox-act.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/sandbox-act.ts#L43)

Per-persona composition overrides (workspace-augmented system prompt,
extra file mounts, sandbox key). Merged into
[composeProductionAgentProfile](../../mcp/functions/composeProductionAgentProfile.md); `env` here is overridden by the
top-level `env` option when both are set.

#### Parameters

##### persona

`TPersona`

#### Returns

[`ComposeProductionAgentProfileOptions`](../../mcp/interfaces/ComposeProductionAgentProfileOptions.md)

***

### sandboxOverrides?

> `optional` **sandboxOverrides?**: `Partial`\<`Omit`\<`CreateSandboxOptions`, `"backend"`\>\> & `object`

Defined in: [agent/sandbox-act.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/sandbox-act.ts#L45)

Sandbox-SDK overrides forwarded to `createSandboxForSpec`.

#### Type Declaration

##### backend?

> `optional` **backend?**: `Omit`\<`BackendConfig`, `"profile"`\>

***

### name?

> `optional` **name?**: `string`

Defined in: [agent/sandbox-act.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/sandbox-act.ts#L47)

Stable run name surfaced in mapped `llm_call` events.

***

### mapEvent?

> `optional` **mapEvent?**: (`event`, `opts`) => [`RuntimeStreamEvent`](../../index/type-aliases/RuntimeStreamEvent.md) \| `undefined`

Defined in: [agent/sandbox-act.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/sandbox-act.ts#L49)

Override the `SandboxEvent → RuntimeStreamEvent` mapper.

#### Parameters

##### event

`SandboxEvent`

##### opts

###### agentRunName?

`string`

#### Returns

[`RuntimeStreamEvent`](../../index/type-aliases/RuntimeStreamEvent.md) \| `undefined`

***

### env?

> `optional` **env?**: `Record`\<`string`, `string` \| `undefined`\>

Defined in: [agent/sandbox-act.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/sandbox-act.ts#L54)

Environment source for delegation-MCP composition. Defaults to `process.env`.
