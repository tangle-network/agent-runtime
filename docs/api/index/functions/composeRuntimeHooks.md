[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / composeRuntimeHooks

# Function: composeRuntimeHooks()

> **composeRuntimeHooks**(...`entries`): [`RuntimeHooks`](../interfaces/RuntimeHooks.md)

Defined in: [runtime-hooks.ts:115](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L115)

Merge several [RuntimeHooks](../interfaces/RuntimeHooks.md) into one. Falsy entries are dropped (so you can
pass `flag && hooks`), and every observer's `onEvent`/`onDecisionPoint` fires for each
event. Use this to attach N observers to a loop instead of a second event bus.

## Parameters

### entries

...(`false` \| [`RuntimeHooks`](../interfaces/RuntimeHooks.md) \| `null` \| `undefined`)[]

## Returns

[`RuntimeHooks`](../interfaces/RuntimeHooks.md)
