[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / PromotionVerdict

# Interface: PromotionVerdict

Defined in: [runtime/promotion-gate.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L39)

## Properties

### promoted

> **promoted**: `boolean`

Defined in: [runtime/promotion-gate.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L40)

***

### reason

> **reason**: `"identical-champion"` \| `"few-tasks"` \| `"no-margin"` \| `"significant"` \| `"non-inferior-and-cheaper"` \| `"non-inferiority-unproven"` \| `"not-cheaper"`

Defined in: [runtime/promotion-gate.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L41)

***

### mode

> **mode**: `"superiority"` \| `"non-inferiority"`

Defined in: [runtime/promotion-gate.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L49)

***

### n

> **n**: `number`

Defined in: [runtime/promotion-gate.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L51)

Paired tasks that carried both strategies' cells.

***

### lift

> **lift**: `object`

Defined in: [runtime/promotion-gate.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L53)

Paired (candidate − incumbent) lift across the holdout tasks.

#### mean

> **mean**: `number`

#### median

> **median**: `number`

#### low

> **low**: `number`

#### high

> **high**: `number`

***

### costSavings?

> `optional` **costSavings?**: `object`

Defined in: [runtime/promotion-gate.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L56)

non-inferiority mode: paired (incumbent − candidate) cost SAVINGS per task (usd) —
 positive means the candidate is cheaper; significant iff the CI low clears zero.

#### mean

> **mean**: `number`

#### median

> **median**: `number`

#### low

> **low**: `number`

#### high

> **high**: `number`

***

### latency?

> `optional` **latency?**: `object`

Defined in: [runtime/promotion-gate.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L60)

Paired (candidate − incumbent) wall-clock per task (ms) — negative = the candidate
 is FASTER. Informational in every mode (never gates); the latency answer to "what
 does this win actually cost the user?".

#### mean

> **mean**: `number`

#### median

> **median**: `number`

#### low

> **low**: `number`

#### high

> **high**: `number`
