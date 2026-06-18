[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [agent](../README.md) / measureOutcome

# Function: measureOutcome()

> **measureOutcome**\<`TProposal`, `TEdit`\>(`result`, `opts`): `Promise`\<[`RunAnalystLoopResult`](../../analyst-loop/interfaces/RunAnalystLoopResult.md)\<`TProposal`, `TEdit`\> & `object`\>

Defined in: [agent/outcome.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/outcome.ts#L65)

Run `runAnalystLoop` and stamp an `OutcomeMeasurement` onto the
result. The substrate calls this after each canonical eval; the
delta lands in `loop-report.json` for cross-run trend analysis.

The function returns the original `RunAnalystLoopResult` enriched
with `outcome` so callers stay backwards-compatible (the field is
optional on the type; missing means no measurement was wired).

## Type Parameters

### TProposal

`TProposal`

### TEdit

`TEdit`

## Parameters

### result

[`RunAnalystLoopResult`](../../analyst-loop/interfaces/RunAnalystLoopResult.md)\<`TProposal`, `TEdit`\>

### opts

[`OutcomeMeasurementOpts`](../interfaces/OutcomeMeasurementOpts.md)

## Returns

`Promise`\<[`RunAnalystLoopResult`](../../analyst-loop/interfaces/RunAnalystLoopResult.md)\<`TProposal`, `TEdit`\> & `object`\>
