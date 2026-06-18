[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / EvalRunEvent

# Interface: EvalRunEvent

Defined in: [otel-export.ts:536](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L536)

## Properties

### runId

> **runId**: `string`

Defined in: [otel-export.ts:537](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L537)

***

### runDir

> **runDir**: `string`

Defined in: [otel-export.ts:538](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L538)

***

### timestamp

> **timestamp**: `string`

Defined in: [otel-export.ts:540](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L540)

ISO timestamp.

***

### status

> **status**: `"started"` \| `"baseline-complete"` \| `"generation-complete"` \| `"gate-decided"` \| `"finished"` \| `"errored"`

Defined in: [otel-export.ts:541](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L541)

***

### labels?

> `optional` **labels?**: `Record`\<`string`, `string`\>

Defined in: [otel-export.ts:548](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L548)

***

### baseline?

> `optional` **baseline?**: [`EvalRunGeneration`](EvalRunGeneration.md)

Defined in: [otel-export.ts:549](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L549)

***

### generations?

> `optional` **generations?**: [`EvalRunGeneration`](EvalRunGeneration.md)[]

Defined in: [otel-export.ts:550](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L550)

***

### gateDecision?

> `optional` **gateDecision?**: `"ship"` \| `"hold"` \| `"need_more_work"` \| `"model_ceiling"` \| `"arch_ceiling"`

Defined in: [otel-export.ts:551](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L551)

***

### holdoutLift?

> `optional` **holdoutLift?**: `number`

Defined in: [otel-export.ts:552](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L552)

***

### totalCostUsd

> **totalCostUsd**: `number`

Defined in: [otel-export.ts:553](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L553)

***

### totalDurationMs

> **totalDurationMs**: `number`

Defined in: [otel-export.ts:554](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L554)

***

### errorMessage?

> `optional` **errorMessage?**: `string`

Defined in: [otel-export.ts:555](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L555)
