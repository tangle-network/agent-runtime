[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / CertProvenance

# Interface: CertProvenance

Defined in: [intelligence/capability.ts:154](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L154)

The certify lane's held-out lift travelling WITH delivery. The shipped
`CertifiedArtifact` envelope minus its content (which moves into the binding
arm): `version`/`contentHash`/`lift` are stamped by the promote step, never
the author.

`sourcePath` is the artifact's ORIGINAL path (including `null`). It is the
byte-stable fold sort key — the resolver folds context artifacts in
`composeCertifiedPrompt` order, which sorts by `path ?? ''`, so a `null` path
is load-bearing and MUST round-trip exactly. It is distinct from a context
`iface.name` (display only): collapsing the two flips the fold order for a
mix of null-path and non-null-path artifacts.

## Properties

### contentHash

> **contentHash**: `string`

Defined in: [intelligence/capability.ts:155](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L155)

***

### version

> **version**: `number` \| `null`

Defined in: [intelligence/capability.ts:156](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L156)

***

### lift

> **lift**: `string` \| `null`

Defined in: [intelligence/capability.ts:157](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L157)

***

### promotedAt

> **promotedAt**: `string`

Defined in: [intelligence/capability.ts:158](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L158)

***

### sourcePath

> **sourcePath**: `string` \| `null`

Defined in: [intelligence/capability.ts:159](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L159)
