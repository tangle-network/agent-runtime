[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / AgenticOptions

# Interface: AgenticOptions

Defined in: [runtime/strategy.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L85)

## Extended by

- [`RunAgenticOptions`](RunAgenticOptions.md)

## Properties

### routerBaseUrl

> **routerBaseUrl**: `string`

Defined in: [runtime/strategy.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L86)

***

### routerKey

> **routerKey**: `string`

Defined in: [runtime/strategy.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L87)

***

### model

> **model**: `string`

Defined in: [runtime/strategy.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L88)

***

### temperature?

> `optional` **temperature?**: `number`

Defined in: [runtime/strategy.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L89)

***

### maxTokens?

> `optional` **maxTokens?**: `number`

Defined in: [runtime/strategy.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L92)

Completion cap per worker turn — REQUIRED for thinking models (they burn unbounded
 budgets on reasoning and return empty content without it). Omitted ⇒ provider default.

***

### innerTurns?

> `optional` **innerTurns?**: `number`

Defined in: [runtime/strategy.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L94)

Turns the agent may take within ONE shot before the driver intervenes.

***

### analystInstruction?

> `optional` **analystInstruction?**: `string`

Defined in: [runtime/strategy.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L97)

The depth STEERER's analyst instruction (observe()'s system prompt). The knob a
 prompt optimizer (GEPA) tunes — the analyst IS the steerer. Omitted ⇒ the default.

***

### analystModel?

> `optional` **analystModel?**: `string`

Defined in: [runtime/strategy.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L100)

The critic's model — lets the analyst be a stronger (or cheaper) model than the
 worker. Omitted ⇒ the worker's `model`.

***

### corpus?

> `optional` **corpus?**: [`Corpus`](Corpus.md)

Defined in: [runtime/strategy.ts:104](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L104)

Across-run learning: when set, the analyst's observe() pass appends trace-derived
 facts here (the flywheel write side). Priming (the read side) is the caller's move —
 query the corpus and fold facts into the task's systemPrompt before runAgentic.

***

### corpusTags?

> `optional` **corpusTags?**: `string`[]

Defined in: [runtime/strategy.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L106)

Tags written onto learned facts (and used by the caller's priming query).
