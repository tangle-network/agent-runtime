[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / selectValidWinner

# Function: selectValidWinner()

> **selectValidWinner**\<`D`\>(`opts?`): [`FanoutWinnerSelector`](../type-aliases/FanoutWinnerSelector.md)\<`D`\>

Defined in: [runtime/personify/combinators.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/combinators.ts#L58)

The single content-free valid-only winner selector. Among the gated-VALID children only
(`verdict.valid === true`), pick by `strategy` — best score / smallest delivered artifact /
earliest — ties broken by earliest index; returns `undefined` when NONE is valid (an ungated
output can never win — the deliverable gate is the point). `sizeOf` (for `'smallest-artifact'`)
reads the child's settled deliverable — the raw value a leaf settles, or the unwrapped `Outcome<D>`
a delegate path produces; a domain passes e.g. patch diff-lines. This is the de-duplicated home of
the selection logic previously copied per role.

## Type Parameters

### D

`D`

## Parameters

### opts?

#### strategy?

[`WinnerStrategy`](../type-aliases/WinnerStrategy.md)

#### sizeOf?

(`deliverable`) => `number`

## Returns

[`FanoutWinnerSelector`](../type-aliases/FanoutWinnerSelector.md)\<`D`\>
