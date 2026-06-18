[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / runDelegatedLoop

# Function: runDelegatedLoop()

> **runDelegatedLoop**\<`T`\>(`mode`, `registry`, `options?`): `Promise`\<[`DelegatedLoopResult`](../interfaces/DelegatedLoopResult.md)\<`T`\>\>

Defined in: [loop-runner.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L98)

**`Experimental`**

Dispatch a configured loop by mode. Fails loud (throws `ConfigError`) when no
runner is registered for the mode — a routine pointed at an unwired mode is a
config bug, not a silent no-op. A runner that throws is captured as
`{ ok: false }` so unattended runs record the failure rather than crash.

## Type Parameters

### T

`T` = `unknown`

## Parameters

### mode

`"code"` \| `"review"` \| `"research"` \| `"audit"` \| `"self-improve"`

### registry

[`DelegatedLoopRegistry`](../type-aliases/DelegatedLoopRegistry.md)

### options?

[`RunDelegatedLoopOptions`](../interfaces/RunDelegatedLoopOptions.md) = `{}`

## Returns

`Promise`\<[`DelegatedLoopResult`](../interfaces/DelegatedLoopResult.md)\<`T`\>\>
