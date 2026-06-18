[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / HarvestCorpusOptions

# Interface: HarvestCorpusOptions

Defined in: [runtime/harvest-corpus.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L28)

## Properties

### runs

> **runs**: `AsyncIterable`\<[`ObserveInput`](ObserveInput.md), `any`, `any`\> \| `Iterable`\<[`ObserveInput`](ObserveInput.md), `any`, `any`\>

Defined in: [runtime/harvest-corpus.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L30)

The completed runs to analyze — map your store's rows to `ObserveInput`.

***

### chat

> **chat**: `ChatClient`

Defined in: [runtime/harvest-corpus.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L32)

The model-call seam (agent-eval `createChatClient`).

***

### model?

> `optional` **model?**: `string`

Defined in: [runtime/harvest-corpus.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L33)

***

### corpus

> **corpus**: [`Corpus`](Corpus.md)

Defined in: [runtime/harvest-corpus.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L35)

The durable corpus the facts accrete into.

***

### tags?

> `optional` **tags?**: readonly `string`[]

Defined in: [runtime/harvest-corpus.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L37)

Tags written onto learned facts (the product/domain key the read side queries by).

***

### analystInstruction?

> `optional` **analystInstruction?**: `string`

Defined in: [runtime/harvest-corpus.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L39)

Override the analyst instruction (the GEPA-tunable knob).

***

### concurrency?

> `optional` **concurrency?**: `number`

Defined in: [runtime/harvest-corpus.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L41)

Runs analyzed in parallel. Default 4.

***

### maxRuns?

> `optional` **maxRuns?**: `number`

Defined in: [runtime/harvest-corpus.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L43)

Hard cap on runs consumed from the stream (a cost guard for unbounded stores).

***

### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [runtime/harvest-corpus.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L44)
