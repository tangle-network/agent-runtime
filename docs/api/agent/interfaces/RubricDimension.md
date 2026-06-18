[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [agent](../README.md) / RubricDimension

# Interface: RubricDimension\<TRunOutput\>

Defined in: [agent/define-agent.ts:129](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L129)

`@tangle-network/agent-runtime/agent` — declarative agent manifest +
substrate-default adapters.

Every vertical agent (tax / legal / gtm / creative / N future
verticals) ships ONE `defineAgent({...})` call + a thin invocation
of `runAnalystLoop` wired through the substrate-default adapters.
No per-vertical glue. No fabricated paths. No theater.

## Type Parameters

### TRunOutput

`TRunOutput`

## Properties

### id

> **id**: `string`

Defined in: [agent/define-agent.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L131)

Unique identifier — appears in finding subjects (`rubric:<id>`).

***

### weight

> **weight**: `number`

Defined in: [agent/define-agent.ts:133](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L133)

0..1 — weight in the composite.

***

### score

> **score**: (`input`) => `number`

Defined in: [agent/define-agent.ts:139](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L139)

Deterministic scorer: given the persona + run output, returns a
0..1 score. The substrate sums weight × score across dimensions
for the deterministic composite; judges supplement subjective dims.

#### Parameters

##### input

###### persona

`unknown`

###### output

`TRunOutput`

#### Returns

`number`

***

### label?

> `optional` **label?**: `string`

Defined in: [agent/define-agent.ts:141](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L141)

Optional human-readable label for reports.
