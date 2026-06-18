[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / Settled

# Type Alias: Settled\<Out\>

> **Settled**\<`Out`\> = \{ `kind`: `"done"`; `handle`: [`Handle`](../interfaces/Handle.md)\<`Out`\>; `out`: `Out`; `outRef`: `string`; `verdict?`: `DefaultVerdict`; `spent`: [`Spend`](../interfaces/Spend.md); `seq`: `number`; \} \| \{ `kind`: `"down"`; `handle`: [`Handle`](../interfaces/Handle.md)\<`Out`\>; `reason`: `string`; `infra`: `boolean`; `restartCount`: `number`; `seq`: `number`; \}

Defined in: [runtime/supervise/types.ts:255](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L255)

A settled child, delivered by `scope.next()`. `seq` is the monotonic cursor order
`next()` yielded this settlement (B2) — NOT wall-clock — and replay delivers strictly
in `seq` order. `outRef` rehydrates `out` from the `ResultBlobStore` on replay.

## Type Parameters

### Out

`Out`

## Union Members

### Type Literal

\{ `kind`: `"done"`; `handle`: [`Handle`](../interfaces/Handle.md)\<`Out`\>; `out`: `Out`; `outRef`: `string`; `verdict?`: `DefaultVerdict`; `spent`: [`Spend`](../interfaces/Spend.md); `seq`: `number`; \}

***

### Type Literal

\{ `kind`: `"down"`; `handle`: [`Handle`](../interfaces/Handle.md)\<`Out`\>; `reason`: `string`; `infra`: `boolean`; `restartCount`: `number`; `seq`: `number`; \}

#### kind

> **kind**: `"down"`

#### handle

> **handle**: [`Handle`](../interfaces/Handle.md)\<`Out`\>

#### reason

> **reason**: `string`

#### infra

> **infra**: `boolean`

True = infrastructure failure (excluded from merge `n` / equal-k), not a bad result.

#### restartCount

> **restartCount**: `number`

#### seq

> **seq**: `number`
