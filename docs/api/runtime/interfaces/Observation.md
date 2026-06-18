[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / Observation

# Interface: Observation

Defined in: [runtime/observe.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L64)

## Properties

### findings

> **findings**: `AnalystFinding`[]

Defined in: [runtime/observe.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L65)

***

### learned

> **learned**: [`CorpusRecord`](CorpusRecord.md)[]

Defined in: [runtime/observe.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L67)

Facts persisted to the corpus (empty when no corpus was supplied).

***

### report

> **report**: `string`

Defined in: [runtime/observe.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L69)

Operator-facing markdown: what the observer noticed + what to change.
