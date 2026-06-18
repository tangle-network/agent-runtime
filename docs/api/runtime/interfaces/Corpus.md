[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / Corpus

# Interface: Corpus

Defined in: [runtime/personify/wave-types.ts:458](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L458)

The durable cross-run corpus — the learning-flywheel store. DISTINCT from `SpawnJournal`
(per-run decisions, replay) and `ResultBlobStore` (per-run payloads): `Corpus` holds accreted
FACTS across runs that the next run reads back. `InMemoryCorpus` + `FileCorpus` (JSONL) impls
live in `corpus.ts` and MAY share a storage spine with the JSONL journal, but the INTERFACE is
separate so a consumer never confuses a replay record with a learned fact.

Fail-loud, typed-outcome boundary: `append` is idempotent on an identical record (same `id` +
`claim`); a conflicting re-append under the same `id` is a typed error, never a silent overwrite.

## Methods

### append()

> **append**(`record`): `Promise`\<\{ `succeeded`: `true`; \} \| \{ `succeeded`: `false`; `error`: `string`; \}\>

Defined in: [runtime/personify/wave-types.ts:461](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L461)

Append one accreted fact. Idempotent on an identical record; returns a typed outcome —
 inspect `succeeded` before treating it as durable (no silent write-through on conflict).

#### Parameters

##### record

[`CorpusRecord`](CorpusRecord.md)

#### Returns

`Promise`\<\{ `succeeded`: `true`; \} \| \{ `succeeded`: `false`; `error`: `string`; \}\>

***

### query()

> **query**(`filter`): `Promise`\<readonly [`CorpusRecord`](CorpusRecord.md)[]\>

Defined in: [runtime/personify/wave-types.ts:464](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L464)

Query accreted facts by filter — most-confident first. Returns the matching records (an
 empty array when none match is a valid result, NOT an error).

#### Parameters

##### filter

[`CorpusFilter`](CorpusFilter.md)

#### Returns

`Promise`\<readonly [`CorpusRecord`](CorpusRecord.md)[]\>
