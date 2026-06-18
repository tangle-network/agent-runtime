[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / contentAddress

# Function: contentAddress()

> **contentAddress**(`artifact`): `string`

Defined in: [durable/spawn-journal.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L48)

Mint the content-addressed `outRef` for a result artifact: `sha256:<hex>` over a
stable JSON encoding. Producers call this to derive the `outRef` they journal and
`put`; the FS/in-mem stores re-derive it on `put` to verify the supplied ref
matches (fail loud on a mismatch — a forged ref breaks the replay invariant).

Stable encoding: object keys are sorted recursively so two structurally-equal
artifacts hash identically regardless of key insertion order.

## Parameters

### artifact

`unknown`

## Returns

`string`
