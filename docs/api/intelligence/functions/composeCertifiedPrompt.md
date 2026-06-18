[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / composeCertifiedPrompt

# Function: composeCertifiedPrompt()

> **composeCertifiedPrompt**(`base`, `certified`): `string`

Defined in: [intelligence/delivery.ts:166](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L166)

Fold the certified prompt surface (and any certified prompt-folding artifacts:
`prompt-surface` / `skill` / `instructions`) into a base system prompt under a
marked section, so the deployed agent prompt == base + the gate-certified
additions. Order is stable (prompt surface first, then artifact buckets in
`promptFoldTypes` order, then by path within a bucket) so the same profile
renders byte-identically each call. Returns `base` unchanged when there is no
usable certified content.

## Parameters

### base

`string`

### certified

[`CertifiedProfile`](../interfaces/CertifiedProfile.md) \| `null`

## Returns

`string`
