[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / EqualKArm

# Interface: EqualKArm

Defined in: [runtime/personify/wave-types.ts:566](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L566)

One arm of an equal-k comparison — a labeled trajectory (a `TrajectoryReport` is one arm's whole
run). The arm's conserved COST is `report.total` (tokens + usd), which the sandbox executor
already reports INCLUSIVE of a leaf's internal sub-agent fanout — so comparing arms on this cost
(not raw `iterations`) closes the leaf-fanout confound: a treatment arm whose leaf fanned out
internally is charged for that fanout in `total.tokens`/`total.usd`, not hidden behind one
iteration count.

## Properties

### label

> `readonly` **label**: `string`

Defined in: [runtime/personify/wave-types.ts:567](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L567)

***

### report

> `readonly` **report**: [`TrajectoryReport`](TrajectoryReport.md)

Defined in: [runtime/personify/wave-types.ts:568](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L568)
