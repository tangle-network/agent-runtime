[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [analyst-loop](../README.md) / AnalystLoopEvent

# Type Alias: AnalystLoopEvent

> **AnalystLoopEvent** = \{ `type`: `"baseline-resolved"`; `runId`: `string`; `baselineRunId`: `string` \| `null`; `priorFindingCount`: `number`; \} \| \{ `type`: `"analyst"`; `runId`: `string`; `event`: `AnalystRunEvent`; \} \| \{ `type`: `"findings-persisted"`; `runId`: `string`; `count`: `number`; \} \| \{ `type`: `"diff-computed"`; `runId`: `string`; `baselineRunId`: `string`; `appeared`: `number`; `disappeared`: `number`; `persisted`: `number`; `changed`: `number`; \} \| \{ `type`: `"knowledge-proposed"`; `runId`: `string`; `proposalCount`: `number`; `skipped`: `number`; `errors`: `number`; \} \| \{ `type`: `"knowledge-applied"`; `runId`: `string`; `writtenCount`: `number`; `withheldForReview`: `number`; \} \| \{ `type`: `"improvement-proposed"`; `runId`: `string`; `editCount`: `number`; `skipped`: `number`; `errors`: `number`; \} \| \{ `type`: `"improvement-applied"`; `runId`: `string`; `appliedCount`: `number`; `withheldForReview`: `number`; \} \| \{ `type`: `"loop-completed"`; `runId`: `string`; `durationMs`: `number`; \}

Defined in: [analyst-loop/types.ts:200](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L200)

Events emitted by `runAnalystLoop` via `opts.onEvent`. UIs and
JSONL tail-sinks consume this stream. The loop awaits each
callback so a slow sink applies backpressure to the loop's phases
(e.g. an SSE write that takes 200ms delays the next phase by
200ms — the loop never out-paces its observer).

Forwards registry events verbatim via `analyst` so consumers don't
have to wire two streams.

## Union Members

### Type Literal

\{ `type`: `"baseline-resolved"`; `runId`: `string`; `baselineRunId`: `string` \| `null`; `priorFindingCount`: `number`; \}

***

### Type Literal

\{ `type`: `"analyst"`; `runId`: `string`; `event`: `AnalystRunEvent`; \}

#### type

> **type**: `"analyst"`

#### runId

> **runId**: `string`

#### event

> **event**: `AnalystRunEvent`

Forwarded verbatim from `AnalystRegistry.runStream`.

***

### Type Literal

\{ `type`: `"findings-persisted"`; `runId`: `string`; `count`: `number`; \}

***

### Type Literal

\{ `type`: `"diff-computed"`; `runId`: `string`; `baselineRunId`: `string`; `appeared`: `number`; `disappeared`: `number`; `persisted`: `number`; `changed`: `number`; \}

***

### Type Literal

\{ `type`: `"knowledge-proposed"`; `runId`: `string`; `proposalCount`: `number`; `skipped`: `number`; `errors`: `number`; \}

***

### Type Literal

\{ `type`: `"knowledge-applied"`; `runId`: `string`; `writtenCount`: `number`; `withheldForReview`: `number`; \}

***

### Type Literal

\{ `type`: `"improvement-proposed"`; `runId`: `string`; `editCount`: `number`; `skipped`: `number`; `errors`: `number`; \}

***

### Type Literal

\{ `type`: `"improvement-applied"`; `runId`: `string`; `appliedCount`: `number`; `withheldForReview`: `number`; \}

***

### Type Literal

\{ `type`: `"loop-completed"`; `runId`: `string`; `durationMs`: `number`; \}
