[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / WidenDecision

# Type Alias: WidenDecision\<D\>

> **WidenDecision**\<`D`\> = \{ `kind`: `"widen"`; `toward`: [`WidenLineage`](../interfaces/WidenLineage.md)\<`D`\>; \} \| \{ `kind`: `"stop"`; `rationale?`: `string`; \}

Defined in: [runtime/personify/wave-types.ts:323](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L323)

A widening decision: extend one lineage by one child, or stop widening. `flatWidenGate`
 always returns `{ kind: 'stop' }`.

## Type Parameters

### D

`D`
