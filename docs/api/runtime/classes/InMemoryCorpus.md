[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / InMemoryCorpus

# Class: InMemoryCorpus

Defined in: [runtime/personify/corpus.ts:161](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/corpus.ts#L161)

In-memory `Corpus`. Keyed by record `id`; `append` validates the record, is idempotent on an
identical re-append, and returns a typed `{ succeeded: false }` on a conflicting re-append under
the same `id` (never overwrites). `query` routes through the single-sourced `applyFilter`.

## Implements

- [`Corpus`](../interfaces/Corpus.md)

## Constructors

### Constructor

> **new InMemoryCorpus**(): `InMemoryCorpus`

#### Returns

`InMemoryCorpus`

## Methods

### append()

> **append**(`record`): `Promise`\<\{ `succeeded`: `true`; \} \| \{ `succeeded`: `false`; `error`: `string`; \}\>

Defined in: [runtime/personify/corpus.ts:164](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/corpus.ts#L164)

Append one accreted fact. Idempotent on an identical record; returns a typed outcome —
 inspect `succeeded` before treating it as durable (no silent write-through on conflict).

#### Parameters

##### record

[`CorpusRecord`](../interfaces/CorpusRecord.md)

#### Returns

`Promise`\<\{ `succeeded`: `true`; \} \| \{ `succeeded`: `false`; `error`: `string`; \}\>

#### Implementation of

[`Corpus`](../interfaces/Corpus.md).[`append`](../interfaces/Corpus.md#append)

***

### query()

> **query**(`filter`): `Promise`\<readonly [`CorpusRecord`](../interfaces/CorpusRecord.md)[]\>

Defined in: [runtime/personify/corpus.ts:186](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/corpus.ts#L186)

Query accreted facts by filter — most-confident first. Returns the matching records (an
 empty array when none match is a valid result, NOT an error).

#### Parameters

##### filter

[`CorpusFilter`](../interfaces/CorpusFilter.md)

#### Returns

`Promise`\<readonly [`CorpusRecord`](../interfaces/CorpusRecord.md)[]\>

#### Implementation of

[`Corpus`](../interfaces/Corpus.md).[`query`](../interfaces/Corpus.md#query)
