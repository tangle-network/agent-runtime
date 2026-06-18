[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / CertifiedProfile

# Interface: CertifiedProfile

Defined in: [intelligence/delivery.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L54)

The composed certified profile — exactly the shape the plane's
 `GET /v1/profiles/:target/composed` returns.

## Properties

### target

> **target**: `string`

Defined in: [intelligence/delivery.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L55)

***

### generatedAt

> **generatedAt**: `string`

Defined in: [intelligence/delivery.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L56)

***

### promptSurface

> **promptSurface**: [`CertifiedPromptSurface`](CertifiedPromptSurface.md) \| `null`

Defined in: [intelligence/delivery.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L57)

***

### artifacts

> **artifacts**: `Record`\<`string`, [`CertifiedArtifact`](CertifiedArtifact.md)[]\>

Defined in: [intelligence/delivery.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L58)
