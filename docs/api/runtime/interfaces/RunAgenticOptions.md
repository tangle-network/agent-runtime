[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / RunAgenticOptions

# Interface: RunAgenticOptions

Defined in: [runtime/strategy.ts:965](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L965)

## Extends

- [`AgenticOptions`](AgenticOptions.md)

## Properties

### routerBaseUrl

> **routerBaseUrl**: `string`

Defined in: [runtime/strategy.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L86)

#### Inherited from

[`AgenticOptions`](AgenticOptions.md).[`routerBaseUrl`](AgenticOptions.md#routerbaseurl)

***

### routerKey

> **routerKey**: `string`

Defined in: [runtime/strategy.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L87)

#### Inherited from

[`AgenticOptions`](AgenticOptions.md).[`routerKey`](AgenticOptions.md#routerkey)

***

### model

> **model**: `string`

Defined in: [runtime/strategy.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L88)

#### Inherited from

[`AgenticOptions`](AgenticOptions.md).[`model`](AgenticOptions.md#model)

***

### temperature?

> `optional` **temperature?**: `number`

Defined in: [runtime/strategy.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L89)

#### Inherited from

[`AgenticOptions`](AgenticOptions.md).[`temperature`](AgenticOptions.md#temperature)

***

### maxTokens?

> `optional` **maxTokens?**: `number`

Defined in: [runtime/strategy.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L92)

Completion cap per worker turn — REQUIRED for thinking models (they burn unbounded
 budgets on reasoning and return empty content without it). Omitted ⇒ provider default.

#### Inherited from

[`AgenticOptions`](AgenticOptions.md).[`maxTokens`](AgenticOptions.md#maxtokens)

***

### innerTurns?

> `optional` **innerTurns?**: `number`

Defined in: [runtime/strategy.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L94)

Turns the agent may take within ONE shot before the driver intervenes.

#### Inherited from

[`AgenticOptions`](AgenticOptions.md).[`innerTurns`](AgenticOptions.md#innerturns)

***

### analystInstruction?

> `optional` **analystInstruction?**: `string`

Defined in: [runtime/strategy.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L97)

The depth STEERER's analyst instruction (observe()'s system prompt). The knob a
 prompt optimizer (GEPA) tunes — the analyst IS the steerer. Omitted ⇒ the default.

#### Inherited from

[`AgenticOptions`](AgenticOptions.md).[`analystInstruction`](AgenticOptions.md#analystinstruction)

***

### analystModel?

> `optional` **analystModel?**: `string`

Defined in: [runtime/strategy.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L100)

The critic's model — lets the analyst be a stronger (or cheaper) model than the
 worker. Omitted ⇒ the worker's `model`.

#### Inherited from

[`AgenticOptions`](AgenticOptions.md).[`analystModel`](AgenticOptions.md#analystmodel)

***

### corpus?

> `optional` **corpus?**: [`Corpus`](Corpus.md)

Defined in: [runtime/strategy.ts:104](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L104)

Across-run learning: when set, the analyst's observe() pass appends trace-derived
 facts here (the flywheel write side). Priming (the read side) is the caller's move —
 query the corpus and fold facts into the task's systemPrompt before runAgentic.

#### Inherited from

[`AgenticOptions`](AgenticOptions.md).[`corpus`](AgenticOptions.md#corpus)

***

### corpusTags?

> `optional` **corpusTags?**: `string`[]

Defined in: [runtime/strategy.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L106)

Tags written onto learned facts (and used by the caller's priming query).

#### Inherited from

[`AgenticOptions`](AgenticOptions.md).[`corpusTags`](AgenticOptions.md#corpustags)

***

### surface

> **surface**: [`AgenticSurface`](AgenticSurface.md)

Defined in: [runtime/strategy.ts:966](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L966)

***

### task

> **task**: [`AgenticTask`](AgenticTask.md)

Defined in: [runtime/strategy.ts:967](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L967)

***

### hooks?

> `optional` **hooks?**: [`RuntimeHooks`](../../index/interfaces/RuntimeHooks.md)

Defined in: [runtime/strategy.ts:970](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L970)

Lifecycle observability — every spawn/settle (shots, analysts) streams here live.
 The seam online watchdogs/route-auditors subscribe to.

***

### strategy?

> `optional` **strategy?**: [`Strategy`](Strategy.md)

Defined in: [runtime/strategy.ts:972](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L972)

A Strategy (the open way) — author/pass your own. Overrides `mode` when present.

***

### mode?

> `optional` **mode?**: `"depth"` \| `"breadth"`

Defined in: [runtime/strategy.ts:974](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L974)

Built-in shorthand: 'depth'→refine, 'breadth'→sample. Default 'depth'.

***

### budget

> **budget**: `number`

Defined in: [runtime/strategy.ts:976](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L976)

budget: refine→max shots; sample→rollout width.

***

### rootBudget?

> `optional` **rootBudget?**: [`Budget`](Budget.md)

Defined in: [runtime/strategy.ts:977](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L977)
