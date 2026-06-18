[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / CorpusRecord

# Interface: CorpusRecord

Defined in: [runtime/personify/wave-types.ts:414](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L414)

One accreted fact in the cross-run corpus — the learning-flywheel's durable unit. DISTINCT from
a `SpawnEvent` (a per-run decision record): a `CorpusRecord` is a fact a run LEARNED that a
FUTURE run should read back (the world-model for story 5). It is content the next persona reads,
not a replay input. Tagged + scored so `query`/`renderCorpusToInstructions` can project the
relevant, high-confidence subset.

## Properties

### schemaVersion

> `readonly` **schemaVersion**: `"1.0.0"`

Defined in: [runtime/personify/wave-types.ts:415](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L415)

***

### id

> `readonly` **id**: `string`

Defined in: [runtime/personify/wave-types.ts:417](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L417)

Stable id over identity-defining fields (claim + tags) so a re-learned fact dedups.

***

### runId

> `readonly` **runId**: `string`

Defined in: [runtime/personify/wave-types.ts:419](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L419)

The run that produced this fact (the journal `runId`/`root`) — provenance back to the trace.

***

### producedAt

> `readonly` **producedAt**: `string`

Defined in: [runtime/personify/wave-types.ts:420](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L420)

***

### area

> `readonly` **area**: `string`

Defined in: [runtime/personify/wave-types.ts:422](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L422)

Coarse classification the query/render filters on (free-form, mirrors `AnalystFinding.area`).

***

### claim

> `readonly` **claim**: `string`

Defined in: [runtime/personify/wave-types.ts:424](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L424)

The accreted fact — the instruction-shaped statement the next run reads back.

***

### rationale?

> `readonly` `optional` **rationale?**: `string`

Defined in: [runtime/personify/wave-types.ts:426](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L426)

Optional supporting detail the renderer may include under the claim.

***

### tags

> `readonly` **tags**: readonly `string`[]

Defined in: [runtime/personify/wave-types.ts:428](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L428)

Free-form tags for `query` filtering (domain, persona, surface).

***

### confidence

> `readonly` **confidence**: `number`

Defined in: [runtime/personify/wave-types.ts:430](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L430)

0..1 — the producing run's confidence in this fact (the render threshold reads it).

***

### evidence?

> `readonly` `optional` **evidence?**: readonly `object`[]

Defined in: [runtime/personify/wave-types.ts:432](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L432)

Optional provenance back into the run that learned it (a finding id / outRef / span).
