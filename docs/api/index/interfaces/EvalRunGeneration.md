[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / EvalRunGeneration

# Interface: EvalRunGeneration

Defined in: [otel-export.ts:521](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L521)

## Properties

### index

> **index**: `number`

Defined in: [otel-export.ts:523](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L523)

0-based ordinal of this generation within the run (required by ingest).

***

### surfaceHash

> **surfaceHash**: `string`

Defined in: [otel-export.ts:525](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L525)

Identity of the proposed surface change (content-addressed hash).

***

### surface?

> `optional` **surface?**: `unknown`

Defined in: [otel-export.ts:527](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L527)

Arbitrary provenance for this generation (rationale, evidence, source).

***

### cells?

> `optional` **cells?**: `unknown`[]

Defined in: [otel-export.ts:529](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L529)

Per-scenario results; empty until the generation is measured.

***

### compositeMean

> **compositeMean**: `number`

Defined in: [otel-export.ts:531](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L531)

Mean composite score (0 when unmeasured — pair with labels.measured).

***

### costUsd

> **costUsd**: `number`

Defined in: [otel-export.ts:532](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L532)

***

### durationMs

> **durationMs**: `number`

Defined in: [otel-export.ts:533](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L533)
