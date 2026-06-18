[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / CapabilityManifest

# Interface: CapabilityManifest

Defined in: [intelligence/capability.ts:176](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L176)

The strict generalization of `CertifiedProfile`. `promptSurface` is kept
during the migration window (the shipped pull lane still emits it); new
capabilities live in `capabilities`.

## Properties

### target

> **target**: `string`

Defined in: [intelligence/capability.ts:177](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L177)

***

### generatedAt

> **generatedAt**: `string`

Defined in: [intelligence/capability.ts:178](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L178)

***

### promptSurface

> **promptSurface**: [`CertifiedPromptSurface`](CertifiedPromptSurface.md) \| `null`

Defined in: [intelligence/capability.ts:179](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L179)

***

### capabilities

> **capabilities**: [`CertifiedCapability`](CertifiedCapability.md)[]

Defined in: [intelligence/capability.ts:180](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L180)
