[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / discriminatingMeans

# Function: discriminatingMeans()

> **discriminatingMeans**(`report`, `fieldOrder`): `Record`\<`string`, \{ `score`: `number`; `usd`: `number`; \}\> \| `null`

Defined in: [runtime/strategy-evolution.ts:237](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L237)

Strategy means recomputed over the DISCRIMINATING tasks only — tasks where the field
 strategies did not all score identically. Zero-spread tasks (everyone 1.0, everyone
 0.0, everyone tied) carry no selection information; averaging over them dilutes real
 differences toward zero. Search-side denoising only — the gate never uses this.

## Parameters

### report

[`BenchmarkReport`](../interfaces/BenchmarkReport.md)

### fieldOrder

`string`[]

## Returns

`Record`\<`string`, \{ `score`: `number`; `usd`: `number`; \}\> \| `null`
