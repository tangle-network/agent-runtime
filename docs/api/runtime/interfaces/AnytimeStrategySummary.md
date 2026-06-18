[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / AnytimeStrategySummary

# Interface: AnytimeStrategySummary

Defined in: [runtime/anytime.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L36)

## Properties

### strategy

> **strategy**: `string`

Defined in: [runtime/anytime.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L37)

***

### target

> **target**: `number`

Defined in: [runtime/anytime.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L39)

The satisficing target this row summarizes.

***

### tasks

> **tasks**: `number`

Defined in: [runtime/anytime.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L40)

***

### reachedTarget

> **reachedTarget**: `number`

Defined in: [runtime/anytime.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L41)

***

### medianTttMs

> **medianTttMs**: `number` \| `null`

Defined in: [runtime/anytime.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L43)

Median time-to-target over the tasks that reached it (null when none did).

***

### medianShotsToTarget

> **medianShotsToTarget**: `number` \| `null`

Defined in: [runtime/anytime.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L44)

***

### ertMs

> **ertMs**: `number` \| `null`

Defined in: [runtime/anytime.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L46)

COCO ERT: Σ all task wall-time (incl. failures) / #successes. Null when 0 succeed.

***

### erUsd

> **erUsd**: `number` \| `null`

Defined in: [runtime/anytime.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L48)

Same construction over dollars: Σ all spend / #successes.

***

### curveByShot

> **curveByShot**: `number`[]

Defined in: [runtime/anytime.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L50)

Mean best-so-far score by shot index (the anytime curve, averaged over tasks).

***

### auc

> **auc**: `number`

Defined in: [runtime/anytime.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L52)

Area under the per-shot anytime curve, normalized to [0,1].
