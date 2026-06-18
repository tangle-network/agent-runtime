[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / EffortSettings

# Interface: EffortSettings

Defined in: [intelligence/effort.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L31)

The flat, resolved settings a tier compiles to. Every field is individually
overridable through `resolveEffort`. Pure data — read by the wrapper, never
self-executing.

## Properties

### analysts

> **analysts**: `boolean`

Defined in: [intelligence/effort.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L33)

Whether trace-derived analyst diagnosis may spawn. `false` ⇒ no analyst.

***

### corpus

> **corpus**: [`CorpusAccess`](../type-aliases/CorpusAccess.md)

Defined in: [intelligence/effort.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L35)

Cross-run corpus access this tier permits.

***

### fanout

> **fanout**: `number`

Defined in: [intelligence/effort.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L37)

Parallel candidate width. `1` ⇒ single-shot, no breadth.

***

### loops

> **loops**: `boolean`

Defined in: [intelligence/effort.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L39)

Whether multi-step improvement loops (refine / fanout-vote) may run.

***

### intelligenceBudgetUsd

> **intelligenceBudgetUsd**: `number` \| `null`

Defined in: [intelligence/effort.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/effort.ts#L46)

Ceiling, in USD, for INTELLIGENCE-class spawns only (analysts, corpus,
loops) — NOT base inference. `0` refuses every intelligence spawn; `null`
means uncapped (the spend lands on the Pareto receipt). Base-stream
inference is billed on its own channel and is never constrained here.
