[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / TraceOutcome

# Interface: TraceOutcome

Defined in: [intelligence/index.ts:200](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L200)

The resolved outcome of one traced run, surfaced on the export span and
 available to the caller for downstream billing assertions.

## Properties

### runId

> **runId**: `string`

Defined in: [intelligence/index.ts:201](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L201)

***

### traceId

> **traceId**: `string`

Defined in: [intelligence/index.ts:202](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L202)

***

### project

> **project**: `string`

Defined in: [intelligence/index.ts:203](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L203)

***

### effort

> **effort**: [`EffortSettings`](EffortSettings.md)

Defined in: [intelligence/index.ts:205](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L205)

The resolved effort settings this run executed under.

***

### intelligenceOff

> **intelligenceOff**: `boolean`

Defined in: [intelligence/index.ts:207](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L207)

True when this run ran as pure passthrough (the OFF floor).

***

### success?

> `optional` **success?**: `boolean`

Defined in: [intelligence/index.ts:208](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L208)

***

### score?

> `optional` **score?**: `number`

Defined in: [intelligence/index.ts:209](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L209)

***

### usage

> **usage**: [`UsageSplit`](UsageSplit.md)

Defined in: [intelligence/index.ts:211](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L211)

Per-class billing split. `intelligenceUsd` is `0` at the OFF tier.
