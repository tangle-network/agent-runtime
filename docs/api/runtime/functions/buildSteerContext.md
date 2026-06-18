[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / buildSteerContext

# Function: buildSteerContext()

> **buildSteerContext**\<`D`\>(`findings`, `settledSoFar`): [`SteerContext`](../interfaces/SteerContext.md)\<`D`\>

Defined in: [runtime/personify/analyst.ts:230](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/analyst.ts#L230)

Build the `SteerContext` a combinator reads to steer (its `loopUntil.until`, `widen` gate, any
future steer). One place enforces the firewall: `findings` is asserted trace-derived before it is
surfaced, and `lastValidScore` is provided for OBSERVABILITY only — a combinator that steers off
it re-introduces selector = judge, the coupling the architecture forbids.

`findings` is re-asserted here even when it came from `createScopeAnalyst` (which already asserted
it): the assertion is cheap and idempotent, and a `SteerContext` may be built from findings that
arrived by another path (a caller-supplied diagnosis). Belt-and-suspenders on the one coupling
that must never leak.

## Type Parameters

### D

`D`

## Parameters

### findings

readonly `AnalystFinding`[]

### settledSoFar

readonly [`Settled`](../type-aliases/Settled.md)\<[`Outcome`](../type-aliases/Outcome.md)\<`D`\>\>[]

## Returns

[`SteerContext`](../interfaces/SteerContext.md)\<`D`\>
