[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / FileCorpus

# Class: FileCorpus

Defined in: [runtime/personify/corpus.ts:202](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/corpus.ts#L202)

JSONL on disk — one validated `CorpusRecord` per line, append-only. `query` replays the whole
file, validating every line (a malformed line fails loud — a corrupted corpus must never read
back silently) and folding by `id`: a later identical line dedups, a later conflicting line
under the same `id` is a corruption (fail loud). `append` first replays to enforce the same
idempotence/conflict contract as the in-mem impl, then fsyncs the new line so a crash between
writes never loses an acknowledged fact. Shares the JSONL append-line spine with the spawn
journal, but the interface stays separate (a learned fact is not a replay record).

## Implements

- [`Corpus`](../interfaces/Corpus.md)

## Constructors

### Constructor

> **new FileCorpus**(`path`): `FileCorpus`

Defined in: [runtime/personify/corpus.ts:203](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/corpus.ts#L203)

#### Parameters

##### path

`string`

#### Returns

`FileCorpus`

## Methods

### append()

> **append**(`record`): `Promise`\<\{ `succeeded`: `true`; \} \| \{ `succeeded`: `false`; `error`: `string`; \}\>

Defined in: [runtime/personify/corpus.ts:205](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/corpus.ts#L205)

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

Defined in: [runtime/personify/corpus.ts:233](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/corpus.ts#L233)

Query accreted facts by filter — most-confident first. Returns the matching records (an
 empty array when none match is a valid result, NOT an error).

#### Parameters

##### filter

[`CorpusFilter`](../interfaces/CorpusFilter.md)

#### Returns

`Promise`\<readonly [`CorpusRecord`](../interfaces/CorpusRecord.md)[]\>

#### Implementation of

[`Corpus`](../interfaces/Corpus.md).[`query`](../interfaces/Corpus.md#query)
