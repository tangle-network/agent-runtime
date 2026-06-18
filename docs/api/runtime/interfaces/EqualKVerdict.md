[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / EqualKVerdict

# Interface: EqualKVerdict

Defined in: [runtime/personify/wave-types.ts:577](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L577)

The equal-k-on-cost verdict: whether every arm spent within `tolerance` of the others on the
CONSERVED cost channels (tokens + usd), so a downstream metric comparison is "at equal k". Per-
arm cost is surfaced so a caller can see HOW close. `withinTolerance: false` means the arms are
NOT comparable at equal compute — a confound to report, not a result to publish.

## Properties

### withinTolerance

> `readonly` **withinTolerance**: `boolean`

Defined in: [runtime/personify/wave-types.ts:578](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L578)

***

### arms

> `readonly` **arms**: readonly `object`[]

Defined in: [runtime/personify/wave-types.ts:580](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L580)

Per-arm conserved cost (the basis: tokens total + usd).

***

### spread

> `readonly` **spread**: `object`

Defined in: [runtime/personify/wave-types.ts:587](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L587)

The realized spread on each channel (max − min across arms), for the report.

#### tokens

> `readonly` **tokens**: `number`

#### usd

> `readonly` **usd**: `number`

***

### tolerance

> `readonly` **tolerance**: `number`

Defined in: [runtime/personify/wave-types.ts:589](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L589)

The fractional tolerance the check used (spread / median ≤ tolerance per channel).
