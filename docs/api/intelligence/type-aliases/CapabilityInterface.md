[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / CapabilityInterface

# Type Alias: CapabilityInterface

> **CapabilityInterface** = \{ `surface`: `"tool"`; `name`: `string`; `description?`: `string`; `parameters`: [`JsonSchema`](JsonSchema.md); `returns?`: [`JsonSchema`](JsonSchema.md); \} \| \{ `surface`: `"mcp"`; `serverName`: `string`; `toolset?`: `string`[]; \} \| \{ `surface`: `"context"`; `kind`: `"prompt-surface"` \| `"skill"` \| `"instructions"`; `name`: `string`; \} \| \{ `surface`: `"retrieval"`; `name`: `string`; `description?`: `string`; `topK?`: `number`; \} \| \{ `surface`: `"hook"`; `event`: `string`; `matcher?`: `string`; \} \| \{ `surface`: `"subagent"`; `name`: `string`; `description?`: `string`; \}

Defined in: [intelligence/capability.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L42)

What the agent consumes. CLOSED — a new runtime kind NEVER extends this. Each
arm maps slot-for-slot onto `AgentProfile` + the host `RouterToolsSeam`.
