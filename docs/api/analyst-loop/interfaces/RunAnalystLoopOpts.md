[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [analyst-loop](../README.md) / RunAnalystLoopOpts

# Interface: RunAnalystLoopOpts

Defined in: [analyst-loop/types.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L76)

## Properties

### runId

> **runId**: `string`

Defined in: [analyst-loop/types.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L78)

The run id of the work being analysed.

***

### registry

> **registry**: [`AnalystRegistryLike`](AnalystRegistryLike.md)

Defined in: [analyst-loop/types.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L80)

The registry — pre-populated with the analyst kinds the consumer wants.

***

### inputs

> **inputs**: `AnalystRunInputs`

Defined in: [analyst-loop/types.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L82)

Inputs forwarded to `registry.run` — typically `{ traceStore }`.

***

### findingsStore

> **findingsStore**: [`FindingsStoreLike`](FindingsStoreLike.md) \| `null`

Defined in: [analyst-loop/types.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L88)

Findings ledger. The loop appends the new run + diffs against the
baseline run before running adapters. Pass `null` to skip
persistence (useful for one-shot analyses).

***

### baselineRunId?

> `optional` **baselineRunId?**: `string` \| `null`

Defined in: [analyst-loop/types.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L95)

Prior run id whose findings the loop reads + provides to analysts
as `priorFindings` AND diffs against. When omitted, the loop picks
the most recent run in the store (excluding `runId` itself); pass
`null` to explicitly start with an empty baseline.

***

### priorFindingsStrategy?

> `optional` **priorFindingsStrategy?**: `"none"` \| `"per-kind"` \| `"wildcard"`

Defined in: [analyst-loop/types.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L97)

Strategy for forwarding prior findings into `ctx.priorFindings`.

***

### knowledgeAdapter?

> `optional` **knowledgeAdapter?**: [`KnowledgeAdapter`](KnowledgeAdapter.md)\<`unknown`\>

Defined in: [analyst-loop/types.ts:99](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L99)

Knowledge-side bridge — usually `agent-knowledge`'s `proposeFromFindings`.

***

### improvementAdapter?

> `optional` **improvementAdapter?**: [`ImprovementAdapter`](ImprovementAdapter.md)\<`unknown`\>

Defined in: [analyst-loop/types.ts:101](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L101)

Improvement-side bridge — usually a consumer-specific prompt/tool diff producer.

***

### autoApply?

> `optional` **autoApply?**: [`AutoApplyPolicy`](AutoApplyPolicy.md)

Defined in: [analyst-loop/types.ts:103](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L103)

Auto-apply rails. Default off; review-then-apply is the safer default.

***

### log?

> `optional` **log?**: (`msg`, `fields?`) => `void`

Defined in: [analyst-loop/types.ts:105](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L105)

Optional logger. Defaults to `console.log` for `[analyst-loop]` lines.

#### Parameters

##### msg

`string`

##### fields?

`Record`\<`string`, `unknown`\>

#### Returns

`void`

***

### onEvent?

> `optional` **onEvent?**: (`event`) => `void` \| `Promise`\<`void`\>

Defined in: [analyst-loop/types.ts:116](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L116)

Event sink for live progress. Called for every phase of the loop:
baseline resolution, registry events forwarded from `runStream`,
ledger persistence, diff, knowledge / improvement proposals +
apply outcomes, and the terminal `loop-completed`. Awaited so
slow sinks (SSE write, JSONL append) apply backpressure.

The callback MUST NOT throw — exceptions propagate and abort the
loop. Catch + swallow internally if your sink is unreliable.

#### Parameters

##### event

[`AnalystLoopEvent`](../type-aliases/AnalystLoopEvent.md)

#### Returns

`void` \| `Promise`\<`void`\>
