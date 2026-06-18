[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / CertifiedArtifact

# Interface: CertifiedArtifact

Defined in: [intelligence/delivery.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L33)

A promoted, certified artifact (one entry in the composed profile).

## Properties

### path

> **path**: `string` \| `null`

Defined in: [intelligence/delivery.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L34)

***

### content

> **content**: `string`

Defined in: [intelligence/delivery.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L35)

***

### contentHash

> **contentHash**: `string`

Defined in: [intelligence/delivery.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L36)

***

### version

> **version**: `number` \| `null`

Defined in: [intelligence/delivery.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L37)

***

### lift

> **lift**: `string` \| `null`

Defined in: [intelligence/delivery.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L40)

Held-out gate lift attached at certification, e.g. "+3.1pp" — never a
 within-run claim. `null` when the promotion carried no lift record.

***

### promotedAt

> **promotedAt**: `string`

Defined in: [intelligence/delivery.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L41)
