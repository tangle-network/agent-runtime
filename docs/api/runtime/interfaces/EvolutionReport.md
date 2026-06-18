[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / EvolutionReport

# Interface: EvolutionReport

Defined in: [runtime/strategy-evolution.ts:213](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L213)

## Properties

### gen0

> **gen0**: [`BenchmarkReport`](BenchmarkReport.md)

Defined in: [runtime/strategy-evolution.ts:214](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L214)

***

### gen0Champion

> **gen0Champion**: [`ChampionPick`](ChampionPick.md)

Defined in: [runtime/strategy-evolution.ts:215](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L215)

***

### generations

> **generations**: [`EvolutionGeneration`](EvolutionGeneration.md)[]

Defined in: [runtime/strategy-evolution.ts:216](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L216)

***

### archive

> **archive**: [`EvolutionArchiveNode`](EvolutionArchiveNode.md)[]

Defined in: [runtime/strategy-evolution.ts:217](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L217)

***

### finalChampion

> **finalChampion**: [`ChampionPick`](ChampionPick.md)

Defined in: [runtime/strategy-evolution.ts:218](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L218)

***

### holdout

> **holdout**: [`BenchmarkReport`](BenchmarkReport.md)

Defined in: [runtime/strategy-evolution.ts:219](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L219)

***

### verdict

> **verdict**: [`PromotionVerdict`](PromotionVerdict.md)

Defined in: [runtime/strategy-evolution.ts:220](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L220)

***

### band?

> `optional` **band?**: [`EvolutionBandInfo`](EvolutionBandInfo.md)

Defined in: [runtime/strategy-evolution.ts:223](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L223)

Present when band screening ran — the verdict's estimand is then "paired lift on
 headroom tasks" (band membership fixed by the reference screen, pre-registered).

***

### reproduction?

> `optional` **reproduction?**: `ReproductionCheck`

Defined in: [runtime/strategy-evolution.ts:225](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L225)

Present when reproducerCheck ran (final champion was authored).

***

### trajectory

> **trajectory**: `object`[]

Defined in: [runtime/strategy-evolution.ts:230](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L230)

SEARCH TELEMETRY, not evidence: each entry is that generation's own train-slice
 re-measurement, so cross-generation deltas mix true drift with run-to-run variance
 (entries are unpaired across generations). The only evidence-grade comparison in
 this report is `verdict` — both finalists measured fresh, paired, on the holdout.

#### generation

> **generation**: `number`

#### champion

> **champion**: `string`

#### score

> **score**: `number`

#### usd

> **usd**: `number`
