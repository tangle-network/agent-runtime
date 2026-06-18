[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / AuthorStrategyOptions

# Interface: AuthorStrategyOptions

Defined in: [runtime/strategy-author.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L77)

## Properties

### chat

> **chat**: `ChatClient`

Defined in: [runtime/strategy-author.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L79)

The model-call seam (agent-eval `createChatClient`).

***

### model?

> `optional` **model?**: `string`

Defined in: [runtime/strategy-author.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L80)

***

### fallbackModel?

> `optional` **fallbackModel?**: `string`

Defined in: [runtime/strategy-author.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L85)

A NAMED fallback author tried once when the primary call fails or returns no code
 block (thinking models time out at the edge on long authoring prompts, or return
 empty content without `maxTokens`). Opt-in — absent means the primary's failure
 propagates.

***

### contract?

> `optional` **contract?**: `string`

Defined in: [runtime/strategy-author.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L89)

The contract text shown to the author. Default `strategyAuthorContract`. The
 meta-optimization coordinate: a GEPA/skill loop can evolve this text and gate each
 variant on the same frozen holdout as any strategy.

***

### environmentName

> **environmentName**: `string`

Defined in: [runtime/strategy-author.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L91)

The environment the losses came from (orientation only — never the verifiers).

***

### lossesJson

> **lossesJson**: `string`

Defined in: [runtime/strategy-author.ts:93](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L93)

The per-task losses table (e.g. JSON.stringify(report.perTask)) — the gradient.

***

### budget

> **budget**: `number`

Defined in: [runtime/strategy-author.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L95)

The budget the strategy must respect (shots/width).

***

### outDir

> **outDir**: `string`

Defined in: [runtime/strategy-author.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L97)

Where the authored module file is written (created if missing).

***

### temperature?

> `optional` **temperature?**: `number`

Defined in: [runtime/strategy-author.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L98)

***

### maxTokens?

> `optional` **maxTokens?**: `number`

Defined in: [runtime/strategy-author.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L100)

Completion cap — required by thinking-model authors that stream reasoning first.

***

### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [runtime/strategy-author.ts:101](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L101)
