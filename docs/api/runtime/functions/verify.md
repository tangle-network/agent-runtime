[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / verify

# Function: verify()

> **verify**\<`Task`, `Candidate`, `D`\>(`spec`): [`CombinatorShape`](../type-aliases/CombinatorShape.md)\<`Task`, `D`\>

Defined in: [runtime/personify/combinators.ts:333](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/combinators.ts#L333)

`verify(spec)` — an IMPLEMENT child produces a candidate, then a SEPARATE VERIFIER child grades
it; only a `valid` verifier verdict ships. Any other outcome (implement down, verifier down,
verifier verdict absent or not `valid`) is a concrete blocker carrying the failure verbatim —
never a coerced "done". The implement child does not grade itself.

## Type Parameters

### Task

`Task`

### Candidate

`Candidate`

### D

`D`

## Parameters

### spec

[`VerifySpec`](../interfaces/VerifySpec.md)\<`Task`, `Candidate`, `D`\>

## Returns

[`CombinatorShape`](../type-aliases/CombinatorShape.md)\<`Task`, `D`\>
