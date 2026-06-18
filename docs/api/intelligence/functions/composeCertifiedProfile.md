[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / composeCertifiedProfile

# Function: composeCertifiedProfile()

> **composeCertifiedProfile**(`base`, `manifest`, `ctx?`): `Promise`\<[`ResolvedSurface`](../interfaces/ResolvedSurface.md)\>

Defined in: [intelligence/resolver.ts:158](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L158)

Compose a certified profile into a uniform `ResolvedSurface`. Additive over
`composeCertifiedPrompt`: the inline/context fold is delegated to
`composeCertifiedPrompt` so the byte-stable ordering (prompt surface first,
then type alphabetic, then path locale-compare) is reused EXACTLY — the
prompt-only path is a strict subset of this.

Fail-closed: a `null` manifest returns the base surface only.

## Parameters

### base

#### systemPrompt

`string`

### manifest

[`CapabilityManifest`](../interfaces/CapabilityManifest.md) \| `null`

### ctx?

[`ResolveCtx`](../interfaces/ResolveCtx.md) = `{}`

## Returns

`Promise`\<[`ResolvedSurface`](../interfaces/ResolvedSurface.md)\>
