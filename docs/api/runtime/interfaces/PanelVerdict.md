[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / PanelVerdict

# Interface: PanelVerdict

Defined in: [runtime/personify/wave-types.ts:233](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L233)

One judge child's settled verdict, surfaced to the write-only `merge`. `down` judges carry no
 verdict (excluded from the merge `n`, like an infra-errored cell).

## Properties

### judge

> `readonly` **judge**: [`PanelJudge`](PanelJudge.md)

Defined in: [runtime/personify/wave-types.ts:234](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L234)

***

### verdict?

> `readonly` `optional` **verdict?**: `DefaultVerdict`

Defined in: [runtime/personify/wave-types.ts:235](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L235)

***

### output?

> `readonly` `optional` **output?**: `unknown`

Defined in: [runtime/personify/wave-types.ts:237](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L237)

The judge child's raw output — what it was asked to assess, for a merge that quotes it.

***

### down

> `readonly` **down**: `boolean`

Defined in: [runtime/personify/wave-types.ts:239](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L239)

True when the judge child went `down` (no usable verdict — kept out of the merge denominator).
