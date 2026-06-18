[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / resolveEffort

# Function: resolveEffort()

> **resolveEffort**(`tier`, `overrides?`): [`EffortSettings`](../interfaces/EffortSettings.md)

Defined in: [intelligence/effort.ts:107](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L107)

Compile a named tier (plus optional per-field overrides) into the flat
`EffortSettings` the wrapper reads. Pure: same inputs → same object, no I/O,
no execution. Fails loud on an unknown tier rather than silently defaulting —
a typo'd tier must not quietly grant or deny intelligence.

Invariant preserved for the billing floor: `resolveEffort('off')` always
yields `intelligenceBudgetUsd: 0` with every intelligence knob off UNLESS the
caller explicitly overrides a field — overriding off is an opt-in the caller
owns, not a default the composer leaks.

## Parameters

### tier

[`EffortTier`](../type-aliases/EffortTier.md)

### overrides?

`Partial`\<[`EffortSettings`](../interfaces/EffortSettings.md)\>

## Returns

[`EffortSettings`](../interfaces/EffortSettings.md)
