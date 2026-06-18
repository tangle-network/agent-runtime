[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / RenderCorpusToInstructionsOptions

# Interface: RenderCorpusToInstructionsOptions

Defined in: [runtime/personify/wave-types.ts:478](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L478)

Project accreted corpus facts into an `AgentProfile`'s instruction seams — the learning-flywheel
READ side. Reads the corpus through `filter`, renders the matching facts into instruction lines,
and returns a NEW profile with them merged into `prompt.instructions` (the append-line seam) so
the next run's persona reads the accreted world-model. Pure projection over the queried records;
never mutates the input profile (returns a fresh one). The impl lives in `corpus.ts`.

`resources.instructions` is `string | AgentProfileResourceRef`; `prompt.instructions` is
`string[]`. The render targets `prompt.instructions` (additive lines) by default; a caller that
wants the single-blob `resources.instructions` form passes `target: 'resources'`.

## Properties

### corpus

> `readonly` **corpus**: [`Corpus`](Corpus.md)

Defined in: [runtime/personify/wave-types.ts:479](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L479)

***

### filter

> `readonly` **filter**: [`CorpusFilter`](CorpusFilter.md)

Defined in: [runtime/personify/wave-types.ts:480](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L480)

***

### profile

> `readonly` **profile**: `AgentProfile`

Defined in: [runtime/personify/wave-types.ts:482](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L482)

The profile to project the facts into. The result is a fresh profile — the input is unchanged.

***

### target?

> `readonly` `optional` **target?**: `"resources"` \| `"prompt"`

Defined in: [runtime/personify/wave-types.ts:485](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L485)

Where the rendered facts land: appended to `prompt.instructions[]` (default) or folded into
 the single-blob `resources.instructions` string.

***

### maxLines?

> `readonly` `optional` **maxLines?**: `number`

Defined in: [runtime/personify/wave-types.ts:487](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L487)

Optional cap on rendered lines (most-confident first), independent of the query `limit`.
