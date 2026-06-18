[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / BenchmarkCell

# Interface: BenchmarkCell

Defined in: [runtime/run-benchmark.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L63)

One strategy's outcome on one task — the per-task cell an optimizer consumes.

## Properties

### score

> **score**: `number`

Defined in: [runtime/run-benchmark.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L64)

***

### resolved

> **resolved**: `boolean`

Defined in: [runtime/run-benchmark.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L65)

***

### progression

> **progression**: `number`[]

Defined in: [runtime/run-benchmark.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L67)

The progress curve (refine: score per shot; sample: best-so-far per rollout).

***

### usd

> **usd**: `number`

Defined in: [runtime/run-benchmark.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L68)

***

### ms

> **ms**: `number`

Defined in: [runtime/run-benchmark.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L69)

***

### tokens

> **tokens**: `object`

Defined in: [runtime/run-benchmark.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L70)

#### input

> **input**: `number`

#### output

> **output**: `number`
