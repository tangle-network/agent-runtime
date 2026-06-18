[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / manifestFromProfile

# Function: manifestFromProfile()

> **manifestFromProfile**(`profile`): [`CapabilityManifest`](../interfaces/CapabilityManifest.md)

Defined in: [intelligence/capability.ts:365](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L365)

Lower the EXISTING plane wire (`CertifiedProfile`) into a `CapabilityManifest`.
`prompt-surface`/`skill` artifacts → `context`/inline capabilities (the
shipped fold, generalized); any other artifact type → best-effort binding
inference (see inferCapability). `promptSurface` is carried through so
the resolver folds it first, exactly as `composeCertifiedPrompt` does today.
This delivers the spine against today's wire before the plane changes.

## Parameters

### profile

[`CertifiedProfile`](../interfaces/CertifiedProfile.md)

## Returns

[`CapabilityManifest`](../interfaces/CapabilityManifest.md)
