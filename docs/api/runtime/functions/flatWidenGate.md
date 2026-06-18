[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / flatWidenGate

# Function: flatWidenGate()

> **flatWidenGate**\<`D`\>(): [`ScopeWidenGate`](../interfaces/ScopeWidenGate.md)\<`D`\>

Defined in: [runtime/personify/combinators.ts:450](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/combinators.ts#L450)

The flat default `ScopeWidenGate` — never widens, keeping the R2 selector≠judge collision
dormant. A gate run passes this explicitly; a test asserts the default is flat.

## Type Parameters

### D

`D`

## Returns

[`ScopeWidenGate`](../interfaces/ScopeWidenGate.md)\<`D`\>
