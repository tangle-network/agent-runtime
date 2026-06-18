[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / anytimeReport

# Function: anytimeReport()

> **anytimeReport**(`spans`, `opts?`): [`AnytimeReport`](../interfaces/AnytimeReport.md)

Defined in: [runtime/anytime.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L73)

Derive anytime metrics from waterfall spans. `targets` are the satisficing score
 bars (default [1] = fully resolved; COCO-style multi-target: [0.5, 0.8, 1]);
 `targetFor` overrides the bar per task (task-specific satisfaction) — when set, the
 per-task bar replaces every entry of `targets` for that task.

## Parameters

### spans

[`WaterfallSpan`](../interfaces/WaterfallSpan.md)[]

### opts?

#### targets?

`number`[]

#### targetFor?

(`taskId`) => `number`

## Returns

[`AnytimeReport`](../interfaces/AnytimeReport.md)
