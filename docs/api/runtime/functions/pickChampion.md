[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / pickChampion

# Function: pickChampion()

> **pickChampion**(`means`, `fieldOrder`, `policy`, `epsilon`): [`ChampionPick`](../interfaces/ChampionPick.md)

Defined in: [runtime/strategy-evolution.ts:262](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L262)

The champion pick over a means table. 'score' takes the best mean score (ties →
 field order). 'costAware' treats scores within `epsilon` of the best as tied and
 takes the cheapest — the (score, $) Pareto rule collapsed to one pick.

## Parameters

### means

`Record`\<`string`, \{ `score`: `number`; `usd`: `number`; \}\>

### fieldOrder

`string`[]

### policy

[`ChampionPolicy`](../type-aliases/ChampionPolicy.md)

### epsilon

`number`

## Returns

[`ChampionPick`](../interfaces/ChampionPick.md)
