[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / AgenticRunResult

# Interface: AgenticRunResult

Defined in: [runtime/strategy.ts:505](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L505)

## Properties

### mode

> **mode**: `string`

Defined in: [runtime/strategy.ts:507](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L507)

The strategy name (built-in 'depth'/'breadth' or a custom strategy's name).

***

### score

> **score**: `number`

Defined in: [runtime/strategy.ts:508](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L508)

***

### resolved

> **resolved**: `boolean`

Defined in: [runtime/strategy.ts:509](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L509)

***

### completions

> **completions**: `number`

Defined in: [runtime/strategy.ts:510](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L510)

***

### progression

> **progression**: `number`[]

Defined in: [runtime/strategy.ts:512](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L512)

DEPTH: score after each shot — the progress-over-rounds curve. BREADTH: best-so-far per rollout.

***

### shots

> **shots**: `number`

Defined in: [runtime/strategy.ts:513](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L513)

***

### usd

> **usd**: `number`

Defined in: [runtime/strategy.ts:516](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L516)

The cost vector, stamped by `runAgentic` from the Supervisor's conserved pool: real
 router tokens, priced usd (0 when the model is unpriced — never fabricated), wall ms.

***

### ms

> **ms**: `number`

Defined in: [runtime/strategy.ts:517](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L517)

***

### tokens

> **tokens**: `object`

Defined in: [runtime/strategy.ts:518](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L518)

#### input

> **input**: `number`

#### output

> **output**: `number`
