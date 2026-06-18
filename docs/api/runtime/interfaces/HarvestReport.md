[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / HarvestReport

# Interface: HarvestReport

Defined in: [runtime/harvest-corpus.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L52)

## Properties

### runsObserved

> **runsObserved**: `number`

Defined in: [runtime/harvest-corpus.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L53)

***

### findings

> **findings**: `number`

Defined in: [runtime/harvest-corpus.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L55)

Total findings the analyst produced (including ones already known).

***

### learned

> **learned**: `number`

Defined in: [runtime/harvest-corpus.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L57)

NEW facts actually appended (idempotent dedup excludes re-learned ones).

***

### failures

> **failures**: [`HarvestFailure`](HarvestFailure.md)[]

Defined in: [runtime/harvest-corpus.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L59)

Per-run analysis failures — reported, never silently dropped.
