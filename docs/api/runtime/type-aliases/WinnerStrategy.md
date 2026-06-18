[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / WinnerStrategy

# Type Alias: WinnerStrategy

> **WinnerStrategy** = `"highest-score"` \| `"smallest-artifact"` \| `"first-valid"`

Defined in: [runtime/personify/wave-types.ts:144](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L144)

Built-in valid-only winner strategies for `selectValidWinner` (selector≠judge): best gated-valid
 score, the smallest delivered artifact (via a `sizeOf` extractor), or the earliest valid.
