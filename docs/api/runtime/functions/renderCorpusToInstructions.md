[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / renderCorpusToInstructions

# Function: renderCorpusToInstructions()

> **renderCorpusToInstructions**(`opts`): `Promise`\<`AgentProfile`\>

Defined in: [runtime/personify/corpus.ts:301](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/corpus.ts#L301)

The learning-flywheel READ side. Queries the corpus through `filter`, renders the matching facts
(most-confident first, capped by `maxLines`) into instruction lines, and returns a FRESH
`AgentProfile` with them merged in — never mutates the input profile. Default `target: 'prompt'`
appends the lines to `prompt.instructions[]` (the additive append-line seam); `target:
'resources'` folds them into the single-blob `resources.instructions` string (preserving any
existing blob, but failing loud on a non-string existing blob — a `resources.instructions` that
was already an `AgentProfileResourceRef` cannot be string-appended without dropping it).

An empty query result returns a fresh COPY of the profile with no instruction change (a valid
"nothing learned yet" read, not an error).

## Parameters

### opts

[`RenderCorpusToInstructionsOptions`](../interfaces/RenderCorpusToInstructionsOptions.md)

## Returns

`Promise`\<`AgentProfile`\>
