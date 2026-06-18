[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / FlatWidenGate

# Type Alias: FlatWidenGate

> **FlatWidenGate** = \<`D`\>() => [`ScopeWidenGate`](../interfaces/ScopeWidenGate.md)\<`D`\>

Defined in: [runtime/personify/wave-types.ts:340](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L340)

The flat default `ScopeWidenGate` factory contract — never widens, keeping the R2 firewall
 conflict dormant. Exported so a gate run can pass it explicitly and a test can assert the
 default is flat.

## Type Parameters

### D

`D`

## Returns

[`ScopeWidenGate`](../interfaces/ScopeWidenGate.md)\<`D`\>
