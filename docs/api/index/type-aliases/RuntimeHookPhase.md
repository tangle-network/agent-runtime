[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / RuntimeHookPhase

# Type Alias: RuntimeHookPhase

> **RuntimeHookPhase** = `"before"` \| `"after"` \| `"error"` \| `"event"`

Defined in: [runtime-hooks.ts:9](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L9)

**`Experimental`**

Runtime hook contracts. Hooks are execution-scoped observers, not part of an
`AgentProfile`: profiles stay portable agent recipes; hooks attach to the
loop or product harness that is running the profile.
