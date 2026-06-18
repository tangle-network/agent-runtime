[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / CombinatorShape

# Type Alias: CombinatorShape\<Task, D\>

> **CombinatorShape**\<`Task`, `D`\> = [`LoopShape`](LoopShape.md)\<`Task`, `D`\>

Defined in: [runtime/personify/wave-types.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L64)

A combinator is just a `LoopShape`: a factory `(ShapeContext) => Agent` whose `Agent.act`
runs the combinator's structure over the `Scope` (spawn children, drain `next()`, select via
the single-sourced `settledToIteration`+`defaultSelectWinner`, synthesize an `Outcome<D>`).
Aliased — NOT a new type — so a combinator stays a first-class shape the persona layer's
`runPersonified`/`ShapeRegistry` resolve with zero new machinery. The SHAPE is content-free;
the persona carries the domain.

## Type Parameters

### Task

`Task`

### D

`D`
