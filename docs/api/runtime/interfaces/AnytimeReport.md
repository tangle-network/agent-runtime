[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / AnytimeReport

# Interface: AnytimeReport

Defined in: [runtime/anytime.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L55)

## Properties

### targets

> **targets**: `number`[]

Defined in: [runtime/anytime.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L56)

***

### perTask

> **perTask**: [`AnytimeTaskCurve`](AnytimeTaskCurve.md)[]

Defined in: [runtime/anytime.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L57)

***

### perStrategy

> **perStrategy**: [`AnytimeStrategySummary`](AnytimeStrategySummary.md)[]

Defined in: [runtime/anytime.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L59)

One summary per (strategy, target) pair — the COCO-style multi-target view.
