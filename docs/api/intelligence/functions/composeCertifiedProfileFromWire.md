[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / composeCertifiedProfileFromWire

# Function: composeCertifiedProfileFromWire()

> **composeCertifiedProfileFromWire**(`base`, `profile`, `ctx?`): `Promise`\<[`ResolvedSurface`](../interfaces/ResolvedSurface.md)\>

Defined in: [intelligence/resolver.ts:663](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/resolver.ts#L663)

Lower a plane `CertifiedProfile` straight into a `ResolvedSurface` via
 `manifestFromProfile` — the convenience the shipped pull lane calls when it
 already holds a `CertifiedProfile` (today's wire) rather than a manifest.

## Parameters

### base

#### systemPrompt

`string`

### profile

[`CertifiedProfile`](../interfaces/CertifiedProfile.md) \| `null`

### ctx?

[`ResolveCtx`](../interfaces/ResolveCtx.md) = `{}`

## Returns

`Promise`\<[`ResolvedSurface`](../interfaces/ResolvedSurface.md)\>
