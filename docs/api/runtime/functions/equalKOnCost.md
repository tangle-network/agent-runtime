[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / equalKOnCost

# Function: equalKOnCost()

> **equalKOnCost**(`arms`, `options?`): [`EqualKVerdict`](../interfaces/EqualKVerdict.md)

Defined in: [runtime/personify/trajectory.ts:143](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/trajectory.ts#L143)

Assert the arms are comparable at EQUAL conserved COST (tokens + usd), NOT raw iteration
count. Compares each arm's root-rolled-up `total` on the two conserved channels: an arm is
within-tolerance when the per-channel spread (max − min across arms) over the median is
`≤ tolerance`. Pure over the reports — no I/O. Fails loud on an empty arm list (nothing to
compare) so a vacuous "equal" is never returned.

## Parameters

### arms

readonly [`EqualKArm`](../interfaces/EqualKArm.md)[]

### options?

[`EqualKOnCostOptions`](../interfaces/EqualKOnCostOptions.md) = `{}`

## Returns

[`EqualKVerdict`](../interfaces/EqualKVerdict.md)
