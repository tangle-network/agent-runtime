[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / EvolutionBandInfo

# Interface: EvolutionBandInfo

Defined in: [runtime/strategy-evolution.ts:204](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L204)

## Properties

### screened

> **screened**: `number`

Defined in: [runtime/strategy-evolution.ts:206](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L206)

Tasks screened by the reference on the holdout pool.

***

### inBand

> **inBand**: `number`

Defined in: [runtime/strategy-evolution.ts:208](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L208)

Tasks kept (reference score ≤ maxRefScore) before truncating to holdoutN.

***

### refScores

> **refScores**: `object`[]

Defined in: [runtime/strategy-evolution.ts:210](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L210)

Reference scores per screened task (the screening record).

#### taskId

> **taskId**: `string`

#### score

> **score**: `number`
