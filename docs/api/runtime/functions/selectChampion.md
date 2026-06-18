[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / selectChampion

# Function: selectChampion()

> **selectChampion**(`report`, `fieldOrder`, `policy`, `epsilon`): [`ChampionPick`](../interfaces/ChampionPick.md)

Defined in: [runtime/strategy-evolution.ts:285](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L285)

Search-side champion selection over a tournament report.

## Parameters

### report

[`BenchmarkReport`](../interfaces/BenchmarkReport.md)

### fieldOrder

`string`[]

### policy

[`ChampionPolicy`](../type-aliases/ChampionPolicy.md)

### epsilon

`number`

## Returns

[`ChampionPick`](../interfaces/ChampionPick.md)
